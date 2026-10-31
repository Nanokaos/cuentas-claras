package es.cuentasclaras.core.budget

import es.cuentasclaras.core.ledger.Ledger
import es.cuentasclaras.core.model.Account
import es.cuentasclaras.core.model.Category
import es.cuentasclaras.core.model.CategoryLimit
import es.cuentasclaras.core.model.EffectiveStatus
import es.cuentasclaras.core.model.Goal
import es.cuentasclaras.core.model.GoalContribution
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.model.UserId
import es.cuentasclaras.core.money.Money
import es.cuentasclaras.core.money.sumMoney
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale

data class BudgetSettings(
    /** Colchón: nunca se considera disponible. */
    val buffer: Money = Money.ZERO,
    /** Ahorro que se quiere apartar cada mes (traspaso a cuentas no líquidas). */
    val monthlySavings: Money = Money.ZERO,
    /** Fecha del próximo cobro. Si es null, se usa fin de mes como escenario provisional. */
    val nextPayday: LocalDate? = null,
    /** Reservar lo que debo a mi pareja por gastos comunes. */
    val reserveSettlementDebt: Boolean = true,
    val weekStart: DayOfWeek = DayOfWeek.MONDAY,
)

data class BudgetInput(
    val userId: UserId,
    val now: LocalDateTime,
    val accounts: List<Account>,
    val transactions: List<Transaction>,
    val settings: BudgetSettings,
    val goals: List<Goal> = emptyList(),
    val contributions: List<GoalContribution> = emptyList(),
    val categories: List<Category> = emptyList(),
    val limits: List<CategoryLimit> = emptyList(),
    /** Lo que debo a mi pareja (positivo). Se calcula con SplitCalculator.balanceBetween. */
    val settlementOwed: Money = Money.ZERO,
)

enum class HorizonKind { HASTA_COBRO, FIN_DE_MES }

data class Horizon(
    val kind: HorizonKind,
    /** Último día incluido en las reservas. */
    val endDate: LocalDate,
    /** Días para repartir, hoy incluido. */
    val days: Int,
    /** true si se calcula sin fecha de cobro válida. */
    val provisional: Boolean,
)

data class ReservedItem(val transactionId: String, val concept: String, val date: LocalDate, val amount: Money, val overdue: Boolean)

data class Reservations(
    val obligations: Money,
    val obligationItems: List<ReservedItem>,
    val savings: Money,
    val goals: Money,
    val buffer: Money,
    val settlementDebt: Money,
) {
    val total: Money get() = obligations + savings + goals + buffer + settlementDebt
}

enum class CategoryState { BIEN, ATENCION, SUPERADO }

data class CategoryStatus(
    val categoryId: String,
    val name: String,
    val limit: Money,
    val spent: Money,
    val committed: Money,
    val remaining: Money,
    val perDay: Money,
    val state: CategoryState,
)

enum class WarningCode { SIN_FECHA_COBRO, FECHA_COBRO_PASADA, DEFICIT, PENDIENTES_VENCIDOS, INGRESOS_ESTIMADOS }

data class BudgetWarning(val code: WarningCode, val message: String)

enum class LineKind { BASE, RESTA, RESULTADO, NOTA }

data class ExplanationLine(val kind: LineKind, val text: String, val amount: Money? = null)

data class BudgetResult(
    val horizon: Horizon,
    val totalBalance: Money,
    val liquidBalance: Money,
    val reserved: Reservations,
    /** Saldo líquido menos reservas. Puede ser negativo (déficit). */
    val available: Money,
    val deficit: Money,
    val dailyRate: Money,
    val today: Money,
    val thisWeek: Money,
    val spentToday: Money,
    /** Ingresos previstos dentro del horizonte: NO incluidos en [available]. */
    val expectedIncome: Money,
    val expectedIncomeIsEstimate: Boolean,
    val availableWithExpectedIncome: Money,
    val categories: List<CategoryStatus>,
    val explanation: List<ExplanationLine>,
    val warnings: List<BudgetWarning>,
)

/**
 * Cálculo determinista del dinero disponible. Sin IA, sin red, sin redondeos optimistas.
 *
 * Disponible = saldo líquido − (recibos/cuotas previstos o pendientes hasta el fin del horizonte
 *              + ahorro del mes por apartar + objetivos + colchón + deuda con la pareja).
 * Los ingresos futuros nunca cuentan como disponibles; se muestran como escenario aparte.
 */
object BudgetEngine {

    private val dayFmt = DateTimeFormatter.ofPattern("d MMM", Locale.forLanguageTag("es-ES"))

    fun compute(input: BudgetInput, kind: HorizonKind): BudgetResult {
        val today = input.now.toLocalDate()
        val warnings = mutableListOf<BudgetWarning>()
        val horizon = horizon(input.settings, today, kind, warnings)

        val myAccounts = input.accounts.filter { it.ownerId == input.userId && !it.archived }
        val liquidIds = myAccounts.filter { it.liquid }.map { it.id }.toSet()
        val myIds = myAccounts.map { it.id }.toSet()
        val live = input.transactions.filter { !it.deleted }
        val byId = input.transactions.associateBy { it.id }

        val balances = Ledger.balances(myAccounts, live)
        val totalBalance = myAccounts.sumMoney { balances.getValue(it.id) }
        val liquidBalance = myAccounts.filter { it.liquid }.sumMoney { balances.getValue(it.id) }

        // --- Obligaciones: previstos y pendientes que saldrán de cuentas líquidas propias ---
        val notDone = live.filter {
            it.status == TxStatus.PREVISTO && !it.date.isAfter(horizon.endDate)
        }
        val obligationItems = notDone
            .filter { (it.kind == TxKind.GASTO || it.kind == TxKind.LIQUIDACION) && it.accountId in liquidIds }
            .sortedBy { it.dateTime }
            .map {
                ReservedItem(it.id, it.concept, it.date, it.amount, it.effectiveStatus(input.now) == EffectiveStatus.PENDIENTE)
            }
        val scheduledSettlements = notDone
            .filter { it.kind == TxKind.LIQUIDACION && it.accountId in liquidIds }
            .sumMoney { it.amount }
        val obligations = obligationItems.sumMoney { it.amount }
        val overdue = obligationItems.filter { it.overdue }
        if (overdue.isNotEmpty()) {
            warnings += BudgetWarning(
                WarningCode.PENDIENTES_VENCIDOS,
                "Hay ${overdue.size} pago(s) con fecha pasada sin confirmar (${overdue.sumMoney { it.amount }}). Se siguen reservando hasta que los confirmes o elimines.",
            )
        }

        // --- Ahorro del mes: objetivo mensual menos lo ya apartado; o traspasos programados si son mayores ---
        val monthStart = today.withDayOfMonth(1)
        val savingsDone = live.filter {
            it.kind == TxKind.TRASPASO && it.status == TxStatus.REALIZADO && it.goalId == null &&
                it.accountId in liquidIds && it.toAccountId in myIds && it.toAccountId !in liquidIds &&
                !it.date.isBefore(monthStart) && !it.date.isAfter(today)
        }.sumMoney { it.amount }
        val scheduledSavings = notDone.filter {
            it.kind == TxKind.TRASPASO && it.goalId == null && it.accountId in liquidIds && it.toAccountId !in liquidIds
        }.sumMoney { it.amount }
        val savings = maxOf((input.settings.monthlySavings - savingsDone).atLeastZero(), scheduledSavings)

        // --- Objetivos ---
        val goalsReserve = input.goals.filter { it.active && it.ownerId == input.userId }.sumMoney { goal ->
            val all = input.contributions.filter { it.goalId == goal.id }
            val saved = all.sumMoney { it.amount }
            val thisMonth = all.filter { !it.date.isBefore(monthStart) && !it.date.isAfter(today) }.sumMoney { it.amount }
            val stillNeeded = (goal.target - saved).atLeastZero()
            val monthly = (minOf(goal.monthlyContribution, stillNeeded) - thisMonth).atLeastZero()
            val held = if (goal.heldInLiquidAccount) minOf(saved, goal.target).atLeastZero() else Money.ZERO
            monthly + held
        }

        val settlementDebt = if (input.settings.reserveSettlementDebt)
            (input.settlementOwed.atLeastZero() - scheduledSettlements).atLeastZero() else Money.ZERO

        val reserved = Reservations(
            obligations = obligations,
            obligationItems = obligationItems,
            savings = savings,
            goals = goalsReserve,
            buffer = input.settings.buffer.atLeastZero(),
            settlementDebt = settlementDebt,
        )
        val available = liquidBalance - reserved.total
        val deficit = if (available.isNegative) -available else Money.ZERO

        // --- Hoy y esta semana ---
        val spentToday = live.filter {
            it.kind == TxKind.GASTO && it.status == TxStatus.REALIZADO && !it.planned &&
                it.date == today && it.accountId in liquidIds
        }.sumMoney { it.amount }
        val startOfDay = available + spentToday
        val dailyRate = if (startOfDay.isPositive) startOfDay.floorDiv(horizon.days) else Money.ZERO
        val todayAllowance = dailyRate - spentToday
        val weekEnd = minOf(today.with(TemporalAdjusters.nextOrSame(input.settings.weekStart.minus(1))), lastSpendingDay(horizon, today))
        val daysLeftInWeek = (ChronoUnit.DAYS.between(today, weekEnd) + 1).toInt().coerceAtLeast(1)
        val thisWeek = minOf(dailyRate * daysLeftInWeek - spentToday, available.atLeastZero())

        // --- Escenario con ingresos previstos (no disponibles) ---
        val expectedIncomeTxs = notDone.filter {
            // Hasta el cobro: el propio cobro abre el siguiente periodo, así que no se incluye.
            it.kind == TxKind.INGRESO && it.accountId in liquidIds &&
                (kind == HorizonKind.FIN_DE_MES || horizon.provisional || it.date.isBefore(horizon.endDate))
        }
        val expectedIncome = expectedIncomeTxs.sumMoney { it.amount }
        val incomeIsEstimate = expectedIncomeTxs.any { it.estimated }
        if (incomeIsEstimate) {
            warnings += BudgetWarning(WarningCode.INGRESOS_ESTIMADOS, "Algunos ingresos previstos son estimaciones; el importe real puede variar.")
        }

        if (available.isNegative) {
            warnings += BudgetWarning(
                WarningCode.DEFICIT,
                "Faltan $deficit para cubrir lo reservado hasta el ${dayFmt.format(horizon.endDate)}. " +
                    "Si no cambia nada, tendrás que usar el colchón, retrasar el ahorro o aplazar algún pago.",
            )
        }

        val categories = categoryStatuses(input, today, byId, live)

        val explanation = buildList {
            add(ExplanationLine(LineKind.BASE, "Saldo líquido en tus cuentas", liquidBalance))
            if (obligations.isPositive) add(ExplanationLine(LineKind.RESTA, "Recibos y cuotas hasta el ${dayFmt.format(horizon.endDate)} (${obligationItems.size})", obligations))
            if (savings.isPositive) add(ExplanationLine(LineKind.RESTA, "Ahorro del mes por apartar", savings))
            if (goalsReserve.isPositive) add(ExplanationLine(LineKind.RESTA, "Objetivos", goalsReserve))
            if (reserved.buffer.isPositive) add(ExplanationLine(LineKind.RESTA, "Colchón", reserved.buffer))
            if (settlementDebt.isPositive) add(ExplanationLine(LineKind.RESTA, "Lo que debes a tu pareja", settlementDebt))
            add(ExplanationLine(LineKind.RESULTADO, "Disponible para ${horizon.days} día(s)", available))
            if (dailyRate.isPositive) add(ExplanationLine(LineKind.NOTA, "Unos $dailyRate al día"))
            if (expectedIncome.isPositive) add(
                ExplanationLine(
                    LineKind.NOTA,
                    "No incluye $expectedIncome de ingresos previstos" + (if (incomeIsEstimate) " (estimados)" else "") + ": aún no los has cobrado.",
                ),
            )
            if (horizon.provisional) add(ExplanationLine(LineKind.NOTA, "Cálculo provisional hasta fin de mes: falta la fecha del próximo cobro."))
        }

        return BudgetResult(
            horizon = horizon,
            totalBalance = totalBalance,
            liquidBalance = liquidBalance,
            reserved = reserved,
            available = available,
            deficit = deficit,
            dailyRate = dailyRate,
            today = todayAllowance,
            thisWeek = thisWeek,
            spentToday = spentToday,
            expectedIncome = expectedIncome,
            expectedIncomeIsEstimate = incomeIsEstimate,
            availableWithExpectedIncome = available + expectedIncome,
            categories = categories,
            explanation = explanation,
            warnings = warnings,
        )
    }

    private fun horizon(settings: BudgetSettings, today: LocalDate, kind: HorizonKind, warnings: MutableList<BudgetWarning>): Horizon {
        val monthEnd = today.with(TemporalAdjusters.lastDayOfMonth())
        val payday = settings.nextPayday
        if (kind == HorizonKind.FIN_DE_MES) {
            return Horizon(kind, monthEnd, (ChronoUnit.DAYS.between(today, monthEnd) + 1).toInt(), provisional = false)
        }
        return when {
            payday == null -> {
                warnings += BudgetWarning(WarningCode.SIN_FECHA_COBRO, "Indica la fecha de tu próximo cobro para calcular hasta entonces. Mientras, se usa fin de mes.")
                Horizon(kind, monthEnd, (ChronoUnit.DAYS.between(today, monthEnd) + 1).toInt(), provisional = true)
            }
            !payday.isAfter(today) -> {
                warnings += BudgetWarning(WarningCode.FECHA_COBRO_PASADA, "La fecha del próximo cobro (${dayFmt.format(payday)}) ya ha llegado. Actualízala. Mientras, se usa fin de mes.")
                Horizon(kind, monthEnd, (ChronoUnit.DAYS.between(today, monthEnd) + 1).toInt(), provisional = true)
            }
            // Se reservan los pagos hasta el día de cobro incluido (criterio prudente),
            // y se reparte entre los días previos al cobro.
            else -> Horizon(kind, payday, ChronoUnit.DAYS.between(today, payday).toInt(), provisional = false)
        }
    }

    private fun lastSpendingDay(h: Horizon, today: LocalDate): LocalDate =
        today.plusDays((h.days - 1).toLong())

    private fun categoryStatuses(
        input: BudgetInput,
        today: LocalDate,
        byId: Map<String, Transaction>,
        live: List<Transaction>,
    ): List<CategoryStatus> {
        if (input.limits.isEmpty()) return emptyList()
        val monthStart = today.withDayOfMonth(1)
        val monthEnd = today.with(TemporalAdjusters.lastDayOfMonth())
        val daysInMonth = monthEnd.dayOfMonth
        val daysLeft = (ChronoUnit.DAYS.between(today, monthEnd) + 1).toInt()
        val inMonth = live.filter { !it.date.isBefore(monthStart) && !it.date.isAfter(monthEnd) }
        val names = input.categories.associate { it.id to it.name }

        return input.limits.map { limit ->
            val ids = Ledger.subtree(limit.categoryId, input.categories)
            val inCat = inMonth.filter { Ledger.categoryOf(it, byId) in ids }
            val spent = inCat.filter { it.status == TxStatus.REALIZADO }
                .sumMoney { Ledger.spendingShare(it, input.userId, byId) }
            val committed = inCat.filter { it.status == TxStatus.PREVISTO && it.kind == TxKind.GASTO }
                .sumMoney { Ledger.spendingShare(it, input.userId, byId) }
            val remaining = limit.monthlyLimit - spent - committed
            // Ritmo esperado: proporción del mes transcurrida (hoy incluido)
            val pace = Money(limit.monthlyLimit.cents * today.dayOfMonth / daysInMonth)
            val state = when {
                remaining.isNegative -> CategoryState.SUPERADO
                spent > pace -> CategoryState.ATENCION
                else -> CategoryState.BIEN
            }
            CategoryStatus(
                categoryId = limit.categoryId,
                name = names[limit.categoryId] ?: limit.categoryId,
                limit = limit.monthlyLimit,
                spent = spent,
                committed = committed,
                remaining = remaining,
                perDay = if (remaining.isPositive) remaining.floorDiv(daysLeft) else Money.ZERO,
                state = state,
            )
        }
    }
}

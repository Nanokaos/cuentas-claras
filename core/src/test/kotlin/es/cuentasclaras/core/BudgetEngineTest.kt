package es.cuentasclaras.core

import es.cuentasclaras.core.F.ANA
import es.cuentasclaras.core.F.LUIS
import es.cuentasclaras.core.F.day
import es.cuentasclaras.core.F.eur
import es.cuentasclaras.core.F.tx
import es.cuentasclaras.core.budget.BudgetEngine
import es.cuentasclaras.core.budget.BudgetInput
import es.cuentasclaras.core.budget.BudgetSettings
import es.cuentasclaras.core.budget.CategoryState
import es.cuentasclaras.core.budget.HorizonKind
import es.cuentasclaras.core.budget.WarningCode
import es.cuentasclaras.core.model.Category
import es.cuentasclaras.core.model.CategoryLimit
import es.cuentasclaras.core.model.Goal
import es.cuentasclaras.core.model.GoalContribution
import es.cuentasclaras.core.model.Split
import es.cuentasclaras.core.model.SplitRule
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.money.Money
import es.cuentasclaras.core.split.SplitCalculator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class BudgetEngineTest {

    private val payday28 = BudgetSettings(buffer = eur("200"), monthlySavings = eur("100"), nextPayday = LocalDate.of(2026, 11, 28))

    private fun run(
        txs: List<Transaction>,
        settings: BudgetSettings = payday28,
        kind: HorizonKind = HorizonKind.HASTA_COBRO,
        goals: List<Goal> = emptyList(),
        contributions: List<GoalContribution> = emptyList(),
        limits: List<CategoryLimit> = emptyList(),
        categories: List<Category> = emptyList(),
        owed: Money = Money.ZERO,
        user: String = ANA,
    ) = BudgetEngine.compute(
        BudgetInput(user, F.NOW, F.anaAccounts + F.luisCuenta, txs, settings, goals, contributions, categories, limits, owed),
        kind,
    )

    private fun planned(amount: String, d: Int, month: Int = 11, kind: TxKind = TxKind.GASTO, estimated: Boolean = false, category: String? = null) =
        tx(kind, amount, date = java.time.LocalDateTime.of(2026, month, d, 9, 0), status = TxStatus.PREVISTO, estimated = estimated, category = category)

    @Test fun reservesBillsSavingsAndBufferBeforeAvailable() {
        val r = run(listOf(planned("60", 15), planned("30", 28), planned("700", 1, month = 12)))
        assertEquals(eur("3600"), r.totalBalance)
        assertEquals(eur("1600"), r.liquidBalance)
        assertEquals(eur("90"), r.reserved.obligations) // el del día de cobro se reserva; el de diciembre no
        assertEquals(eur("100"), r.reserved.savings)
        assertEquals(eur("200"), r.reserved.buffer)
        assertEquals(eur("1210"), r.available)
        assertEquals(18, r.horizon.days)
        assertEquals(eur("67,22"), r.dailyRate)
        assertEquals(eur("67,22"), r.today)
        assertEquals(eur("403,32"), r.thisWeek) // martes a domingo: 6 días
        assertFalse(r.horizon.provisional)
    }

    @Test fun endOfMonthHorizon() {
        val r = run(listOf(planned("60", 15), planned("30", 28), planned("700", 1, month = 12)), kind = HorizonKind.FIN_DE_MES)
        assertEquals(21, r.horizon.days)
        assertEquals(eur("1210"), r.available)
        assertEquals(eur("57,61"), r.dailyRate)
    }

    @Test fun confirmingAPlannedBillDoesNotCountTwice() {
        val luz = planned("60", 5) // vencido sin confirmar
        val before = run(listOf(luz))
        assertTrue(before.warnings.any { it.code == WarningCode.PENDIENTES_VENCIDOS })
        val after = run(listOf(luz.confirm(actualDateTime = F.NOW.minusHours(1))))
        assertEquals(before.available, after.available)
        assertEquals(before.today, after.today)
        assertEquals(eur("0"), after.spentToday) // un recibo previsto no es gasto discrecional de hoy
    }

    @Test fun futureIncomeIsNeverAvailable() {
        val nomina = planned("1400", 28, kind = TxKind.INGRESO, estimated = true)
        val extra = planned("300", 20, kind = TxKind.INGRESO)
        val base = run(emptyList())
        val untilPayday = run(listOf(nomina, extra))
        assertEquals(base.available, untilPayday.available)
        assertEquals(eur("300"), untilPayday.expectedIncome) // la nómina abre el periodo siguiente
        val month = run(listOf(nomina, extra), kind = HorizonKind.FIN_DE_MES)
        assertEquals(eur("1700"), month.expectedIncome)
        assertTrue(month.expectedIncomeIsEstimate)
        assertEquals(month.available + eur("1700"), month.availableWithExpectedIncome)
        assertTrue(month.warnings.any { it.code == WarningCode.INGRESOS_ESTIMADOS })
    }

    @Test fun paydayChangeRecalculates() {
        val bills = listOf(planned("50", 26))
        val at28 = run(bills)
        val at25 = run(bills, payday28.copy(nextPayday = LocalDate.of(2026, 11, 25)))
        assertEquals(15, at25.horizon.days)
        assertEquals(at28.available + eur("50"), at25.available) // el recibo del 26 cae en el periodo siguiente
        assertTrue(at25.dailyRate > at28.dailyRate)
    }

    @Test fun unknownOrPastPaydayIsProvisional() {
        val unknown = run(emptyList(), payday28.copy(nextPayday = null))
        assertTrue(unknown.horizon.provisional)
        assertEquals(LocalDate.of(2026, 11, 30), unknown.horizon.endDate)
        assertTrue(unknown.warnings.any { it.code == WarningCode.SIN_FECHA_COBRO })
        val past = run(emptyList(), payday28.copy(nextPayday = LocalDate.of(2026, 11, 8)))
        assertTrue(past.warnings.any { it.code == WarningCode.FECHA_COBRO_PASADA })
    }

    @Test fun deficitIsExplicit() {
        val r = run(listOf(planned("1450", 20)))
        assertEquals(eur("-150"), r.available)
        assertEquals(eur("150"), r.deficit)
        assertEquals(eur("0"), r.dailyRate)
        assertEquals(eur("0"), r.today)
        assertTrue(r.warnings.any { it.code == WarningCode.DEFICIT })
    }

    @Test fun overspendingTodayGoesNegative() {
        val r = run(listOf(tx(TxKind.GASTO, "100", concept = "Capricho")))
        assertEquals(eur("100"), r.spentToday)
        assertTrue(r.today.isNegative)
    }

    @Test fun savingsTransferDoesNotChangeAvailable() {
        val before = run(emptyList(), BudgetSettings(monthlySavings = eur("100"), nextPayday = LocalDate.of(2026, 11, 28)))
        val traspaso = tx(TxKind.TRASPASO, "100", date = day(3), account = "cc", to = "sav")
        val after = run(listOf(traspaso), BudgetSettings(monthlySavings = eur("100"), nextPayday = LocalDate.of(2026, 11, 28)))
        assertEquals(before.available, after.available)
        assertEquals(eur("0"), after.reserved.savings)
        assertEquals(before.totalBalance, after.totalBalance)
    }

    @Test fun scheduledSavingsTransferIsNotDoubleReserved() {
        val s = BudgetSettings(monthlySavings = eur("100"), nextPayday = LocalDate.of(2026, 11, 28))
        val programado = tx(TxKind.TRASPASO, "100", date = day(20), account = "cc", to = "sav", status = TxStatus.PREVISTO)
        assertEquals(eur("100"), run(listOf(programado), s).reserved.savings)
    }

    @Test fun refundRaisesAvailableAndLowersCategory() {
        val compra = tx(TxKind.GASTO, "80", category = "ropa", id = "zara")
        val dev = tx(TxKind.DEVOLUCION, "30", refundOf = "zara")
        val limits = listOf(CategoryLimit("ropa", eur("100")))
        val cats = listOf(Category("ropa", "Ropa"))
        val a = run(listOf(compra), limits = limits, categories = cats)
        val b = run(listOf(compra, dev), limits = limits, categories = cats)
        assertEquals(a.available + eur("30"), b.available)
        assertEquals(eur("50"), b.categories.single().spent)
    }

    @Test fun sharedSpendingCountsOnlyMyShareInCategories() {
        val half = SplitRule.Equal(listOf(ANA, LUIS))
        val superAna = tx(TxKind.GASTO, "90", category = "super", split = Split(ANA, half), date = day(4))
        val superLuis = tx(TxKind.GASTO, "40", category = "super", split = Split(LUIS, half), owner = LUIS, account = "luis-cc", date = day(6))
        val previsto = planned("50", 20, category = "comida")
        val cats = listOf(Category("comida", "Comida"), Category("super", "Supermercado", "comida"))
        val r = run(listOf(superAna, superLuis, previsto), limits = listOf(CategoryLimit("comida", eur("300"))), categories = cats)
        val c = r.categories.single()
        assertEquals(eur("65"), c.spent)
        assertEquals(eur("50"), c.committed)
        assertEquals(eur("185"), c.remaining)
        assertEquals(eur("8,80"), c.perDay)
        assertEquals(CategoryState.BIEN, c.state)
        // El gasto de Luis no toca los saldos de Ana
        assertEquals(eur("1510"), r.liquidBalance)
        // Saldo de pareja: Luis debe 45, Ana debe 20 → Luis debe 25 a Ana
        val txs = listOf(superAna, superLuis)
        assertEquals(eur("25"), SplitCalculator.balanceBetween(ANA, LUIS, txs))
    }

    @Test fun debtWithPartnerIsReserved() {
        val r = run(emptyList(), owed = eur("25"))
        assertEquals(eur("25"), r.reserved.settlementDebt)
    }

    @Test fun categoryOverLimit() {
        val cena = tx(TxKind.GASTO, "130", category = "ocio", date = day(7))
        val r = run(listOf(cena), limits = listOf(CategoryLimit("ocio", eur("120"))), categories = listOf(Category("ocio", "Ocio")))
        assertEquals(CategoryState.SUPERADO, r.categories.single().state)
        assertEquals(eur("-10"), r.categories.single().remaining)
        assertEquals(eur("0"), r.categories.single().perDay)
    }

    @Test fun goalsReserveMonthlyAndMoneyHeldInLiquidAccounts() {
        val vacaciones = Goal("vac", ANA, "Vacaciones", eur("1000"), eur("150"), heldInLiquidAccount = true)
        val casiHecho = Goal("tv", ANA, "Televisor", eur("200"), eur("50"), heldInLiquidAccount = false)
        val contribs = listOf(
            GoalContribution("vac", eur("300"), LocalDate.of(2026, 10, 3)),
            GoalContribution("vac", eur("50"), LocalDate.of(2026, 11, 2)),
            GoalContribution("tv", eur("180"), LocalDate.of(2026, 10, 1)),
        )
        val r = run(emptyList(), goals = listOf(vacaciones, casiHecho), contributions = contribs)
        assertEquals(eur("470"), r.reserved.goals) // 100 + 350 + 20
    }

    @Test fun weekIsCappedByPayday() {
        val r = run(emptyList(), payday28.copy(nextPayday = LocalDate.of(2026, 11, 12)))
        assertEquals(2, r.horizon.days)
        assertEquals(r.dailyRate * 2, r.thisWeek)
    }

    @Test fun explanationAddsUp() {
        val r = run(listOf(planned("60", 15)))
        val lines = r.explanation
        assertEquals(r.liquidBalance, lines.first().amount)
        assertTrue(lines.any { it.text.contains("Disponible") && it.amount == r.available })
    }
}

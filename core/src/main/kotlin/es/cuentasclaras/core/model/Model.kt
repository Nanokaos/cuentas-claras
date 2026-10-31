package es.cuentasclaras.core.model

import es.cuentasclaras.core.money.Money
import java.time.LocalDate
import java.time.LocalDateTime

typealias UserId = String

enum class AccountType { CORRIENTE, AHORRO, EFECTIVO, TARJETA, INVERSION }

/**
 * @param liquid si el saldo es utilizable para el día a día. Ahorro e inversión no lo son por defecto.
 */
data class Account(
    val id: String,
    val ownerId: UserId,
    val name: String,
    val type: AccountType,
    val openingBalance: Money = Money.ZERO,
    val liquid: Boolean = type != AccountType.AHORRO && type != AccountType.INVERSION,
    val currency: String = "EUR",
    val archived: Boolean = false,
)

data class Category(val id: String, val name: String, val parentId: String? = null)

enum class TxKind {
    GASTO,
    INGRESO,
    /** Entre cuentas propias: no es ingreso ni gasto. */
    TRASPASO,
    /** Reembolso de un gasto: reduce el gasto de su categoría. */
    DEVOLUCION,
    /** Corrección de saldo; importe con signo. No cuenta como gasto ni ingreso. */
    AJUSTE,
    /** Pago entre la pareja para saldar gastos comunes. No es gasto ni ingreso. */
    LIQUIDACION,
}

/** Estado guardado. «Pendiente» se deriva: previsto cuya fecha ya llegó sin confirmarse. */
enum class TxStatus { REALIZADO, PREVISTO }

enum class EffectiveStatus { REALIZADO, PREVISTO, PENDIENTE }

/**
 * Movimiento. [amount] siempre en euros (moneda base); si se pagó en otra moneda,
 * [currency] y [originalAmount] guardan el importe original.
 *
 * @param planned true si nació como previsto (programado o recurrente). Al confirmarse
 *   conserva el mismo id y pasa a REALIZADO: así nunca se cuenta dos veces.
 * @param estimated importe aproximado (p. ej. ingreso variable aún sin cobrar).
 */
data class Transaction(
    val id: String,
    val ownerId: UserId,
    val kind: TxKind,
    val amount: Money,
    val dateTime: LocalDateTime,
    val status: TxStatus = TxStatus.REALIZADO,
    val accountId: String? = null,
    val toAccountId: String? = null,
    val concept: String = "",
    val categoryId: String? = null,
    val notes: String = "",
    val currency: String = "EUR",
    val originalAmount: Money? = null,
    val split: Split? = null,
    val planned: Boolean = false,
    val estimated: Boolean = false,
    val recurrenceId: String? = null,
    val refundOf: String? = null,
    val debtId: String? = null,
    val goalId: String? = null,
    val counterpartUserId: UserId? = null,
    val deleted: Boolean = false,
) {
    init {
        if (kind != TxKind.AJUSTE) require(!amount.isNegative) { "El importe debe ser positivo ($kind)" }
        if (kind == TxKind.TRASPASO) {
            require(accountId != null && toAccountId != null) { "Un traspaso necesita cuenta origen y destino" }
            require(accountId != toAccountId) { "Origen y destino no pueden coincidir" }
        }
    }

    val date: LocalDate get() = dateTime.toLocalDate()
    val isShared: Boolean get() = split != null

    fun effectiveStatus(now: LocalDateTime): EffectiveStatus = when {
        status == TxStatus.REALIZADO -> EffectiveStatus.REALIZADO
        !dateTime.isAfter(now) -> EffectiveStatus.PENDIENTE
        else -> EffectiveStatus.PREVISTO
    }

    /** Confirma un previsto conservando el id (evita duplicar la previsión). */
    fun confirm(actualAmount: Money = amount, actualDateTime: LocalDateTime = dateTime): Transaction =
        copy(status = TxStatus.REALIZADO, amount = actualAmount, dateTime = actualDateTime, estimated = false)
}

/** Reparto de un gasto común. [payerId] es quien adelanta el dinero. */
data class Split(val payerId: UserId, val rule: SplitRule) {
    val participants: Set<UserId>
        get() = when (rule) {
            is SplitRule.Equal -> rule.participants.toSet()
            is SplitRule.Percentages -> rule.basisPoints.keys
            is SplitRule.Amounts -> rule.amounts.keys
        }
}

sealed interface SplitRule {
    /** 50/50 (o a partes iguales entre N). */
    data class Equal(val participants: List<UserId>) : SplitRule

    /** Porcentajes en puntos básicos: 6000 = 60 %. Deben sumar 10000. */
    data class Percentages(val basisPoints: Map<UserId, Int>) : SplitRule

    /** Importes exactos por persona. Deben sumar el total. */
    data class Amounts(val amounts: Map<UserId, Money>) : SplitRule
}

data class Goal(
    val id: String,
    val ownerId: UserId,
    val name: String,
    val target: Money,
    val monthlyContribution: Money,
    /** true si el dinero apartado sigue en una cuenta líquida y debe reservarse. */
    val heldInLiquidAccount: Boolean,
    val deadline: LocalDate? = null,
    val active: Boolean = true,
)

data class GoalContribution(val goalId: String, val amount: Money, val date: LocalDate)

data class CategoryLimit(val categoryId: String, val monthlyLimit: Money)

data class Debt(
    val id: String,
    val ownerId: UserId,
    val name: String,
    val total: Money,
)

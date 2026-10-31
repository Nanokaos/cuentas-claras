package es.cuentasclaras.core.ledger

import es.cuentasclaras.core.model.Account
import es.cuentasclaras.core.model.Category
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.model.UserId
import es.cuentasclaras.core.money.Money
import es.cuentasclaras.core.split.SplitCalculator

object Ledger {

    /** Efecto de un movimiento sobre el saldo de cada cuenta. */
    fun balanceEffects(tx: Transaction): List<Pair<String, Money>> {
        val effects = mutableListOf<Pair<String, Money>>()
        when (tx.kind) {
            TxKind.GASTO -> tx.accountId?.let { effects += it to -tx.amount }
            TxKind.INGRESO, TxKind.DEVOLUCION, TxKind.AJUSTE -> tx.accountId?.let { effects += it to tx.amount }
            TxKind.TRASPASO, TxKind.LIQUIDACION -> {
                tx.accountId?.let { effects += it to -tx.amount }
                tx.toAccountId?.let { effects += it to tx.amount }
            }
        }
        return effects
    }

    /** Saldo actual: apertura + movimientos realizados. Los previstos y pendientes no afectan. */
    fun balances(accounts: Collection<Account>, txs: Collection<Transaction>): Map<String, Money> {
        val result = accounts.associate { it.id to it.openingBalance }.toMutableMap()
        for (tx in txs) {
            if (tx.deleted || tx.status != TxStatus.REALIZADO) continue
            for ((accountId, delta) in balanceEffects(tx)) {
                result[accountId]?.let { result[accountId] = it + delta }
            }
        }
        return result
    }

    /** Categoría efectiva: una devolución hereda la del gasto original si no tiene propia. */
    fun categoryOf(tx: Transaction, byId: Map<String, Transaction>): String? =
        tx.categoryId ?: tx.refundOf?.let { byId[it]?.categoryId }

    /**
     * Gasto atribuible a [userId]: positivo para gastos, negativo para devoluciones.
     * En gastos comunes solo cuenta su parte, así la vista individual y la conjunta no duplican.
     * Traspasos, ajustes, ingresos y liquidaciones no son gasto.
     */
    fun spendingShare(tx: Transaction, userId: UserId, byId: Map<String, Transaction>): Money = when (tx.kind) {
        TxKind.GASTO -> SplitCalculator.shareOf(tx, userId)
        TxKind.DEVOLUCION -> {
            val original = tx.refundOf?.let { byId[it] }
            val split = original?.split ?: tx.split
            val owner = original?.ownerId ?: tx.ownerId
            val share = if (split == null) {
                if (owner == userId) tx.amount else Money.ZERO
            } else {
                SplitCalculator.shares(tx.amount, split.rule)[userId] ?: Money.ZERO
            }
            -share
        }
        else -> Money.ZERO
    }

    /** Gasto conjunto de la pareja: cada gasto común cuenta una sola vez, por su importe total. */
    fun householdSpending(tx: Transaction): Money = when {
        !tx.isShared && tx.refundOf == null -> Money.ZERO
        tx.kind == TxKind.GASTO -> tx.amount
        tx.kind == TxKind.DEVOLUCION -> -tx.amount
        else -> Money.ZERO
    }

    /** Ids de la categoría y todas sus subcategorías. */
    fun subtree(rootId: String, categories: Collection<Category>): Set<String> {
        val children = categories.groupBy { it.parentId }
        val result = mutableSetOf<String>()
        val stack = ArrayDeque(listOf(rootId))
        while (stack.isNotEmpty()) {
            val id = stack.removeLast()
            if (result.add(id)) children[id]?.forEach { stack.addLast(it.id) }
        }
        return result
    }

    /** Importe pendiente de una deuda o pago a plazos: total menos cuotas realizadas. */
    fun debtRemaining(debtId: String, total: Money, txs: Collection<Transaction>): Money {
        val paid = txs.filter { it.debtId == debtId && !it.deleted && it.status == TxStatus.REALIZADO && it.kind == TxKind.GASTO }
            .fold(Money.ZERO) { a, t -> a + t.amount }
        return (total - paid).atLeastZero()
    }
}

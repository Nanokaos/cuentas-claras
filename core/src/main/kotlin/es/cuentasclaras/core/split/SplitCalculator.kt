package es.cuentasclaras.core.split

import es.cuentasclaras.core.model.Split
import es.cuentasclaras.core.model.SplitRule
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.model.UserId
import es.cuentasclaras.core.money.Money

object SplitCalculator {

    /**
     * Parte de [total] que corresponde a cada persona. La suma es siempre exactamente [total]
     * (método del mayor resto; empates resueltos por orden de id para que sea determinista).
     */
    fun shares(total: Money, rule: SplitRule): Map<UserId, Money> = when (rule) {
        is SplitRule.Equal -> {
            require(rule.participants.isNotEmpty()) { "Reparto sin participantes" }
            allocate(total, rule.participants.distinct().associateWith { 1L })
        }
        is SplitRule.Percentages -> {
            require(rule.basisPoints.values.all { it >= 0 }) { "Porcentaje negativo" }
            require(rule.basisPoints.values.sum() == 10_000) { "Los porcentajes deben sumar 100 %" }
            allocate(total, rule.basisPoints.mapValues { it.value.toLong() })
        }
        is SplitRule.Amounts -> {
            require(rule.amounts.values.all { !it.isNegative }) { "Importe negativo en el reparto" }
            val sum = rule.amounts.values.fold(Money.ZERO) { a, b -> a + b }
            if (sum == total) rule.amounts
            else allocate(total, rule.amounts.mapValues { it.value.cents }) // p. ej. devolución parcial
        }
    }

    /** Reparto proporcional exacto a unos pesos. */
    fun allocate(total: Money, weights: Map<UserId, Long>): Map<UserId, Money> {
        val sumW = weights.values.sum()
        require(sumW > 0) { "Pesos vacíos" }
        val sign = if (total.isNegative) -1 else 1
        val abs = total.cents * sign
        val base = mutableMapOf<UserId, Long>()
        val remainders = mutableListOf<Pair<UserId, Long>>()
        for ((user, w) in weights.toSortedMap()) {
            val product = abs.toBigInteger() * w.toBigInteger()
            val q = product / sumW.toBigInteger()
            base[user] = q.toLong()
            remainders += user to (product - q * sumW.toBigInteger()).toLong()
        }
        var left = abs - base.values.sum()
        for ((user, _) in remainders.sortedWith(compareByDescending<Pair<UserId, Long>> { it.second }.thenBy { it.first })) {
            if (left <= 0) break
            base[user] = base.getValue(user) + 1
            left--
        }
        return base.mapValues { Money(it.value * sign) }
    }

    /** Parte de un usuario en un movimiento (gasto completo si no es compartido y es suyo). */
    fun shareOf(tx: Transaction, userId: UserId, split: Split? = tx.split): Money =
        if (split == null) {
            if (tx.ownerId == userId) tx.amount else Money.ZERO
        } else {
            shares(tx.amount, split.rule)[userId] ?: Money.ZERO
        }

    /**
     * Saldo entre dos personas por gastos comunes realizados y liquidaciones.
     * Positivo: [b] debe a [a]. Negativo: [a] debe a [b].
     */
    fun balanceBetween(a: UserId, b: UserId, txs: Collection<Transaction>): Money {
        val byId = txs.associateBy { it.id }
        var net = Money.ZERO
        for (tx in txs) {
            if (tx.deleted || tx.status != TxStatus.REALIZADO) continue
            when (tx.kind) {
                TxKind.GASTO, TxKind.DEVOLUCION -> {
                    val split = if (tx.kind == TxKind.DEVOLUCION) tx.refundOf?.let { byId[it]?.split } else tx.split
                    split ?: continue
                    val shares = shares(tx.amount, split.rule)
                    val direction = if (tx.kind == TxKind.GASTO) 1 else -1
                    // En una devolución, el dinero vuelve a quien pagó: se invierte la deuda.
                    if (split.payerId == a) net += (shares[b] ?: Money.ZERO) * direction
                    if (split.payerId == b) net -= (shares[a] ?: Money.ZERO) * direction
                }
                TxKind.LIQUIDACION -> {
                    if (tx.ownerId == b && tx.counterpartUserId == a) net -= tx.amount
                    if (tx.ownerId == a && tx.counterpartUserId == b) net += tx.amount
                }
                else -> Unit
            }
        }
        return net
    }
}

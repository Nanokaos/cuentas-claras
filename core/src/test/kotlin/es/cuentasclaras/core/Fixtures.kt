package es.cuentasclaras.core

import es.cuentasclaras.core.model.Account
import es.cuentasclaras.core.model.AccountType
import es.cuentasclaras.core.model.Split
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.money.Money
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.concurrent.atomic.AtomicInteger

object F {
    const val ANA = "ana"
    const val LUIS = "luis"

    /** Martes 10 de noviembre de 2026, 12:00. */
    val NOW: LocalDateTime = LocalDateTime.of(2026, 11, 10, 12, 0)
    val TODAY: LocalDate = NOW.toLocalDate()

    private val seq = AtomicInteger()

    fun eur(s: String) = Money.parse(s)!!

    val corriente = Account("cc", ANA, "Cuenta corriente", AccountType.CORRIENTE, eur("1500"))
    val efectivo = Account("cash", ANA, "Efectivo", AccountType.EFECTIVO, eur("100"))
    val ahorro = Account("sav", ANA, "Ahorro", AccountType.AHORRO, eur("2000"))
    val anaAccounts = listOf(corriente, efectivo, ahorro)

    val luisCuenta = Account("luis-cc", LUIS, "Cuenta Luis", AccountType.CORRIENTE, eur("900"))

    fun tx(
        kind: TxKind,
        amount: String,
        date: LocalDateTime = NOW.minusHours(1),
        account: String? = "cc",
        to: String? = null,
        status: TxStatus = TxStatus.REALIZADO,
        owner: String = ANA,
        category: String? = null,
        concept: String = "",
        split: Split? = null,
        planned: Boolean = status == TxStatus.PREVISTO,
        estimated: Boolean = false,
        refundOf: String? = null,
        id: String = "t${seq.incrementAndGet()}",
        debtId: String? = null,
        counterpart: String? = null,
    ) = Transaction(
        id = id, ownerId = owner, kind = kind, amount = eur(amount), dateTime = date, status = status,
        accountId = account, toAccountId = to, concept = concept, categoryId = category, split = split,
        planned = planned, estimated = estimated, refundOf = refundOf, debtId = debtId, counterpartUserId = counterpart,
    )

    fun day(d: Int, hour: Int = 9): LocalDateTime = LocalDateTime.of(2026, 11, d, hour, 0)
}

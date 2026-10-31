package es.cuentasclaras.app.data

import es.cuentasclaras.core.model.Account
import es.cuentasclaras.core.model.AccountType
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.money.Money
import es.cuentasclaras.core.recurrence.Frequency
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.TemporalAdjusters

object DefaultData {
    /** Las claves coinciden con las que devuelve el intérprete de frases (comida, ocio...). */
    val categories = listOf(
        CategoryEntity("comida", "Comida", null, null),
        CategoryEntity("comida-super", "Supermercado", "comida", null),
        CategoryEntity("ocio", "Ocio", null, null),
        CategoryEntity("ocio-rest", "Restaurantes y bares", "ocio", null),
        CategoryEntity("transporte", "Transporte", null, null),
        CategoryEntity("suscripciones", "Suscripciones", null, null),
        CategoryEntity("hogar", "Hogar", null, null),
        CategoryEntity("salud", "Salud", null, null),
        CategoryEntity("ropa", "Ropa", null, null),
        CategoryEntity("otros", "Otros", null, null),
        CategoryEntity("ing-nomina", "Nómina", null, null, forIncome = true),
        CategoryEntity("ing-extra", "Ingresos extra", null, null, forIncome = true),
    )

    suspend fun seedReal(repo: Repository) {
        repo.saveAccount(Account("cc", ME, "Cuenta corriente", AccountType.CORRIENTE))
        repo.saveAccount(Account("cash", ME, "Efectivo", AccountType.EFECTIVO))
        repo.saveAccount(Account("sav", ME, "Ahorro", AccountType.AHORRO))
    }

    /** Ejemplo realista para enseñar la app. Vive en demo.db, separado de tus datos. */
    suspend fun seedDemo(repo: Repository) {
        val today = LocalDate.now()
        repo.saveAccount(Account("cc", ME, "Cuenta corriente", AccountType.CORRIENTE, Money.euros(1450)))
        repo.saveAccount(Account("cash", ME, "Efectivo", AccountType.EFECTIVO, Money.euros(100)))
        repo.saveAccount(Account("sav", ME, "Ahorro", AccountType.AHORRO, Money.euros(2000)))
        val payday = today.with(TemporalAdjusters.lastDayOfMonth()).minusDays(2).let { if (it.isAfter(today)) it else it.plusMonths(1) }
        repo.put("nextPayday", payday.toString())
        repo.put("buffer", "20000")
        repo.put("monthlySavings", "10000")
        repo.setLimit(CategoryEntity("ocio", "Ocio", null, 12000))
        repo.setLimit(CategoryEntity("comida", "Comida", null, 30000))
        repo.setLimit(CategoryEntity("transporte", "Transporte", null, 8000))
        fun past(days: Long, h: Int) = today.minusDays(days).atTime(h, 15)
        val txs = listOf(
            Transaction(newId(), ME, TxKind.GASTO, Money.euros(42), past(1, 21), accountId = "cc", concept = "Cena con amigos", categoryId = "ocio-rest"),
            Transaction(newId(), ME, TxKind.GASTO, Money.of(38, 60), past(2, 18), accountId = "cc", concept = "Mercadona", categoryId = "comida-super"),
            Transaction(newId(), ME, TxKind.GASTO, Money.euros(30), past(3, 10), accountId = "cc", concept = "Gasolina", categoryId = "transporte"),
            Transaction(newId(), ME, TxKind.GASTO, Money.euros(88), past(4, 22), accountId = "cc", concept = "Concierto", categoryId = "ocio"),
            Transaction(newId(), ME, TxKind.GASTO, Money.of(12, 50), past(5, 13), accountId = "cash", concept = "Menú del día", categoryId = "ocio-rest"),
        )
        txs.forEach { repo.save(it) }
        val start = today.plusDays(5)
        repo.addRecurrence(Transaction("tpl-luz", ME, TxKind.GASTO, Money.euros(60), start.atTime(LocalTime.of(9, 0)), status = TxStatus.PREVISTO, accountId = "cc", concept = "Luz", categoryId = "hogar", planned = true), Frequency.MENSUAL, null)
        repo.addRecurrence(Transaction("tpl-gym", ME, TxKind.GASTO, Money.euros(30), today.plusDays(9).atTime(9, 0), status = TxStatus.PREVISTO, accountId = "cc", concept = "Gimnasio", categoryId = "suscripciones", planned = true), Frequency.MENSUAL, null)
        repo.addRecurrence(Transaction("tpl-nomina", ME, TxKind.INGRESO, Money.euros(1400), payday.atTime(8, 0), status = TxStatus.PREVISTO, accountId = "cc", concept = "Nómina", categoryId = "ing-nomina", planned = true, estimated = true), Frequency.MENSUAL, null)
    }
}

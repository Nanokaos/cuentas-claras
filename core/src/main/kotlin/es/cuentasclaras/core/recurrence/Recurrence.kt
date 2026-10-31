package es.cuentasclaras.core.recurrence

import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxStatus
import java.time.LocalDate
import java.time.LocalTime

enum class Frequency { DIARIA, SEMANAL, MENSUAL, ANUAL }

/**
 * Regla de movimiento recurrente (recibos, nómina, cuotas).
 * [template] define tipo, importe, cuenta, categoría y reparto; su fecha se ignora.
 * Con [count] se modelan pagos a plazos (p. ej. 12 cuotas).
 */
data class RecurrenceRule(
    val id: String,
    val template: Transaction,
    val frequency: Frequency,
    val interval: Int = 1,
    val start: LocalDate,
    val end: LocalDate? = null,
    val count: Int? = null,
    val time: LocalTime = LocalTime.of(9, 0),
    val active: Boolean = true,
) {
    init {
        require(interval >= 1) { "El intervalo debe ser >= 1" }
        require(count == null || count >= 1) { "El número de repeticiones debe ser >= 1" }
    }
}

object RecurrenceExpander {

    /** Id determinista de cada ocurrencia: regenerar nunca duplica. */
    fun occurrenceId(ruleId: String, date: LocalDate) = "$ruleId@$date"

    /**
     * Fechas de la regla entre [from] y [to], ambos incluidos.
     * Se calculan siempre desde la fecha inicial: un recibo del día 31 cae el 30 o el 28/29
     * en meses cortos y vuelve al 31 en el siguiente, sin derivar.
     */
    fun dates(rule: RecurrenceRule, from: LocalDate, to: LocalDate): List<LocalDate> {
        if (!rule.active || to.isBefore(from)) return emptyList()
        val result = mutableListOf<LocalDate>()
        var n = 0L
        while (true) {
            if (rule.count != null && n >= rule.count) break
            val date = nth(rule, n)
            if (date.isAfter(to)) break
            if (rule.end != null && date.isAfter(rule.end)) break
            if (!date.isBefore(from)) result += date
            n++
            if (n > 100_000) break // salvaguarda
        }
        return result
    }

    private fun nth(rule: RecurrenceRule, n: Long): LocalDate {
        val step = n * rule.interval
        return when (rule.frequency) {
            Frequency.DIARIA -> rule.start.plusDays(step)
            Frequency.SEMANAL -> rule.start.plusWeeks(step)
            Frequency.MENSUAL -> rule.start.plusMonths(step)
            Frequency.ANUAL -> rule.start.plusYears(step)
        }
    }

    /**
     * Ocurrencias previstas que faltan por crear entre [from] y [to].
     * Si una ocurrencia ya existe (aunque esté borrada o confirmada) no se recrea.
     */
    fun materialize(
        rule: RecurrenceRule,
        from: LocalDate,
        to: LocalDate,
        existingIds: Set<String>,
    ): List<Transaction> =
        dates(rule, from, to)
            .map { occurrenceId(rule.id, it) to it }
            .filter { (id, _) -> id !in existingIds }
            .map { (id, date) ->
                rule.template.copy(
                    id = id,
                    dateTime = date.atTime(rule.time),
                    status = TxStatus.PREVISTO,
                    planned = true,
                    recurrenceId = rule.id,
                    deleted = false,
                )
            }
}

package es.cuentasclaras.core.parse

import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.money.Money
import java.text.Normalizer
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.temporal.TemporalAdjusters

enum class PaymentHint { TARJETA, EFECTIVO, BIZUM, TRANSFERENCIA }

enum class MissingField { IMPORTE, CUENTA, CONCEPTO }

/** Borrador extraído de una frase. Nunca se guarda sin confirmación del usuario. */
data class Draft(
    val kind: TxKind,
    val amount: Money?,
    val concept: String,
    /** Clave genérica: comida, ocio, suscripciones, transporte, hogar, salud... La app la traduce a su categoría. */
    val categoryKey: String?,
    val dateTime: LocalDateTime,
    val payment: PaymentHint?,
    val missing: Set<MissingField>,
)

data class ParseResult(val drafts: List<Draft>, val dateWasExplicit: Boolean)

/**
 * Intérprete local (sin IA, sin red) de frases cortas en español de España.
 * Ejemplo: «Ayer gasté 23 euros en el supermercado y 8 en cenar; los 23 los pagué con tarjeta y los 8 en efectivo».
 * La IA, cuando está disponible, cubre frases más libres; su salida se valida con este mismo modelo de borrador.
 */
object QuickEntryParser {

    private val weekdays = mapOf(
        "lunes" to DayOfWeek.MONDAY, "martes" to DayOfWeek.TUESDAY, "miercoles" to DayOfWeek.WEDNESDAY,
        "jueves" to DayOfWeek.THURSDAY, "viernes" to DayOfWeek.FRIDAY, "sabado" to DayOfWeek.SATURDAY,
        "domingo" to DayOfWeek.SUNDAY,
    )
    private val months = listOf(
        "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
        "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    )

    private val categoryKeywords: List<Pair<String, List<String>>> = listOf(
        "comida" to listOf("supermercado", "super", "mercadona", "lidl", "carrefour", "dia", "aldi", "eroski", "alcampo", "compra", "fruteria", "carniceria", "panaderia", "pescaderia"),
        "ocio" to listOf("cenar", "cena", "comer fuera", "restaurante", "bar", "cafe", "copas", "cine", "concierto", "teatro", "tapas", "cerveza", "brunch", "desayunar"),
        "suscripciones" to listOf("netflix", "spotify", "hbo", "max", "disney", "prime", "suscripcion", "gimnasio", "gym", "icloud", "youtube"),
        "transporte" to listOf("gasolina", "gasoil", "diesel", "metro", "bus", "autobus", "taxi", "uber", "cabify", "tren", "renfe", "parking", "aparcamiento", "peaje", "abono"),
        "hogar" to listOf("alquiler", "hipoteca", "luz", "agua", "gas", "internet", "fibra", "comunidad", "ikea", "limpieza"),
        "salud" to listOf("farmacia", "medico", "dentista", "fisio", "optica"),
        "ropa" to listOf("ropa", "zapatos", "zapatillas", "zara", "primark"),
    )

    private val incomeWords = Regex("\\b(cobre|cobrado|ingreso|ingresaron|ingresado|nomina|me pagaron|me han pagado|me devolvieron|recibi)\\b")

    private val amountRegex = Regex("(?<![\\d:])(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)(?![\\d:])\\s*(€|euros?|eur|pavos)?")

    fun parse(text: String, now: LocalDateTime): ParseResult {
        var s = normalize(text)
        val (date, explicit, withoutDate) = extractDate(s, now.toLocalDate())
        s = withoutDate
        val (time, withoutTime) = extractTime(s)
        s = withoutTime
        val dateTime = date.atTime(time ?: now.toLocalTime().withSecond(0).withNano(0))
        val sentenceIsIncome = incomeWords.containsMatchIn(s)

        data class Item(var amount: Money?, val amountText: String?, val concept: String, val kind: TxKind, var payment: PaymentHint?)

        val items = mutableListOf<Item>()
        val generalPayments = mutableListOf<PaymentHint>()

        // La coma decimal (15,50) no separa segmentos.
        val segments = s.split(';').flatMap { it.split(Regex("(?<!\\d),|,(?!\\d)|\\by\\b|\\be\\b")) }.map { it.trim() }.filter { it.isNotEmpty() }
        for (seg in segments) {
            val payment = paymentIn(seg)
            val m = amountRegex.find(seg)
            val amountText = m?.groupValues?.get(1)
            val amount = amountText?.let { Money.parse(it) }
            val concept = conceptOf(seg, m)
            val referencesExisting = amountText != null && items.any { it.amountText == amountText }

            if (payment != null && concept.isEmpty() && (amountText == null || referencesExisting)) {
                if (amountText == null) generalPayments += payment
                else items.filter { it.amountText == amountText && it.payment == null }.forEach { it.payment = payment }
                continue
            }
            if (amount == null) {
                // Segmento sin importe: puede ser solo contexto («ayer», «en el súper»). Se adjunta al anterior si no tiene concepto.
                continue
            }
            val kind = if (incomeWords.containsMatchIn(seg) || (sentenceIsIncome && !Regex("\\b(gaste|pague|gastado|pagado)\\b").containsMatchIn(seg))) TxKind.INGRESO else TxKind.GASTO
            items += Item(amount, amountText, concept, kind, payment)
        }
        if (generalPayments.size == 1) items.filter { it.payment == null }.forEach { it.payment = generalPayments.first() }

        val drafts = items.map { item ->
            val missing = mutableSetOf<MissingField>()
            if (item.amount == null) missing += MissingField.IMPORTE
            if (item.payment == null) missing += MissingField.CUENTA
            if (item.concept.isEmpty()) missing += MissingField.CONCEPTO
            Draft(
                kind = item.kind,
                amount = item.amount,
                concept = item.concept.replaceFirstChar { it.uppercase() },
                categoryKey = if (item.kind == TxKind.GASTO) categoryFor(item.concept) else null,
                dateTime = dateTime,
                payment = item.payment,
                missing = missing,
            )
        }
        return ParseResult(drafts, explicit)
    }

    internal fun normalize(s: String): String =
        Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .replace(' ', ' ')
            .replace(Regex("\\s+"), " ")
            .trim()

    private data class DateExtraction(val date: LocalDate, val explicit: Boolean, val rest: String)

    private fun extractDate(s: String, today: LocalDate): DateExtraction {
        Regex("\\b(anteayer|antes de ayer|antier)\\b").find(s)?.let { return DateExtraction(today.minusDays(2), true, s.removeRange(it.range)) }
        Regex("\\bayer\\b").find(s)?.let { return DateExtraction(today.minusDays(1), true, s.removeRange(it.range)) }
        Regex("\\bpasado manana\\b").find(s)?.let { return DateExtraction(today.plusDays(2), true, s.removeRange(it.range)) }
        Regex("\\bmanana\\b").find(s)?.let { return DateExtraction(today.plusDays(1), true, s.removeRange(it.range)) }
        Regex("\\bhoy\\b").find(s)?.let { return DateExtraction(today, true, s.removeRange(it.range)) }
        Regex("\\b(?:el )?(\\d{1,2}) de (${months.joinToString("|")})(?: de (\\d{4}))?\\b").find(s)?.let { m ->
            val day = m.groupValues[1].toInt()
            val month = months.indexOf(m.groupValues[2]) + 1
            val year = m.groupValues[3].toIntOrNull() ?: today.year
            runCatching { LocalDate.of(year, month, day) }.getOrNull()?.let { return DateExtraction(it, true, s.removeRange(m.range)) }
        }
        // Solo «el día 5»: «el 23» suele referirse a un importe.
        Regex("\\bel dia (\\d{1,2})\\b").find(s)?.let { m ->
            val day = m.groupValues[1].toInt()
            val thisMonth = runCatching { today.withDayOfMonth(day) }.getOrNull()
            val date = if (thisMonth != null && !thisMonth.isAfter(today)) thisMonth
            else runCatching { today.minusMonths(1).withDayOfMonth(day) }.getOrNull()
            if (date != null) return DateExtraction(date, true, s.removeRange(m.range))
        }
        Regex("\\b(?:el )?(?:pasado )?(${weekdays.keys.joinToString("|")})(?: pasado)?\\b").find(s)?.let { m ->
            val dow = weekdays.getValue(m.groupValues[1])
            return DateExtraction(today.with(TemporalAdjusters.previous(dow)), true, s.removeRange(m.range))
        }
        return DateExtraction(today, false, s)
    }

    private fun extractTime(s: String): Pair<LocalTime?, String> {
        val m = Regex("\\ba las (\\d{1,2})(?::(\\d{2}))?\\b").find(s) ?: return null to s
        val h = m.groupValues[1].toInt()
        val min = m.groupValues[2].toIntOrNull() ?: 0
        if (h !in 0..23 || min !in 0..59) return null to s
        return LocalTime.of(h, min) to s.removeRange(m.range)
    }

    private fun paymentIn(seg: String): PaymentHint? = when {
        Regex("\\btarjeta|\\bvisa\\b|\\bdebito\\b|\\bcredito\\b|\\bdatafono\\b").containsMatchIn(seg) -> PaymentHint.TARJETA
        Regex("\\befectivo\\b|\\bmetalico\\b|\\bcash\\b|\\ben mano\\b").containsMatchIn(seg) -> PaymentHint.EFECTIVO
        Regex("\\bbizum\\b").containsMatchIn(seg) -> PaymentHint.BIZUM
        Regex("\\btransferencia\\b").containsMatchIn(seg) -> PaymentHint.TRANSFERENCIA
        else -> null
    }

    private val fillers = setOf(
        "el", "la", "los", "las", "lo", "un", "una", "unos", "unas", "en", "de", "del", "al", "para", "por", "con",
        "me", "he", "ha", "hemos", "se", "mi", "mis", "nos", "gaste", "gastado", "gastamos", "pague", "pagado", "pagamos",
        "pago", "cobre", "cobrado", "ingreso", "ingresaron", "ingresado", "recibi", "han", "hoy", "que", "y", "e", "eso",
        "tarjeta", "efectivo", "bizum", "transferencia", "metalico", "cash", "visa", "debito", "credito",
        "euro", "euros", "eur", "pavos", "gasto", "compre", "comprado", "costo", "costado", "fueron", "fue",
        "todo", "toda", "todos", "todas", "ambos", "ambas", "dos",
    )

    /** Concepto: texto tras el importe sin artículos ni verbos de gasto; si no hay, el texto anterior. */
    private fun conceptOf(seg: String, amountMatch: MatchResult?): String {
        val after = amountMatch?.let { seg.substring(it.range.last + 1) } ?: seg
        val before = amountMatch?.let { seg.substring(0, it.range.first) } ?: ""
        fun clean(t: String) = t.replace(Regex("[^a-z0-9ñ ]"), " ").split(' ')
            .filter { it.isNotBlank() && it !in fillers }.joinToString(" ")
        return clean(after).ifEmpty { clean(before) }
    }

    fun categoryFor(concept: String): String? {
        val c = " ${normalize(concept)} "
        return categoryKeywords.firstOrNull { (_, words) -> words.any { c.contains(" $it ") } }?.first
    }
}

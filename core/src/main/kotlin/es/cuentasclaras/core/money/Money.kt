package es.cuentasclaras.core.money

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Importe monetario en céntimos de euro. Nunca se usan Double/Float para dinero.
 * Las operaciones lanzan ArithmeticException si hay desbordamiento.
 */
@JvmInline
value class Money(val cents: Long) : Comparable<Money> {

    operator fun plus(other: Money) = Money(Math.addExact(cents, other.cents))
    operator fun minus(other: Money) = Money(Math.subtractExact(cents, other.cents))
    operator fun unaryMinus() = Money(Math.negateExact(cents))
    operator fun times(n: Int) = Money(Math.multiplyExact(cents, n.toLong()))
    override fun compareTo(other: Money) = cents.compareTo(other.cents)

    val isNegative get() = cents < 0
    val isPositive get() = cents > 0
    val isZero get() = cents == 0L

    fun abs(): Money = if (cents < 0) -this else this
    fun atLeastZero(): Money = if (cents < 0) ZERO else this

    /** Reparto entero hacia abajo: nunca sobreestima lo que se puede gastar. */
    fun floorDiv(parts: Int): Money {
        require(parts > 0) { "parts debe ser > 0" }
        return Money(Math.floorDiv(cents, parts.toLong()))
    }

    fun format(withPlusSign: Boolean = false): String = MoneyFormat.format(this, withPlusSign)

    override fun toString(): String = format()

    companion object {
        val ZERO = Money(0)
        fun euros(e: Long) = Money(Math.multiplyExact(e, 100L))
        fun of(euros: Long, cents: Int) = Money(Math.addExact(Math.multiplyExact(euros, 100L), cents.toLong()))
        fun parse(text: String): Money? = MoneyParser.parse(text)
    }
}

fun <T> Iterable<T>.sumMoney(selector: (T) -> Money): Money =
    fold(Money.ZERO) { acc, item -> acc + selector(item) }

fun Iterable<Money>.sum(): Money = fold(Money.ZERO) { acc, m -> acc + m }

/** Formato es-ES: «1234,50 €», «12.345,00 €» (CLDR: no agrupa números de 4 cifras). */
internal object MoneyFormat {
    private const val NBSP = ' '

    fun format(m: Money, withPlusSign: Boolean): String {
        val negative = m.cents < 0
        val abs = if (negative) -(m.cents.toBigInteger()) else m.cents.toBigInteger()
        val euros = abs.divide(100.toBigInteger()).toString()
        val cents = abs.mod(100.toBigInteger()).toInt()
        val sign = when {
            negative -> "-"
            withPlusSign && m.cents > 0 -> "+"
            else -> ""
        }
        return "$sign${group(euros)},${cents.toString().padStart(2, '0')}$NBSP€"
    }

    private fun group(digits: String): String {
        if (digits.length < 5) return digits
        val sb = StringBuilder()
        digits.forEachIndexed { i, c ->
            if (i > 0 && (digits.length - i) % 3 == 0) sb.append('.')
            sb.append(c)
        }
        return sb.toString()
    }
}

/**
 * Interpreta importes escritos en España: «23», «23,5», «1.234,56», «23.50 €», «8 euros».
 * Un punto seguido de exactamente 3 cifras se interpreta como separador de miles.
 */
internal object MoneyParser {
    private val currencyWords = Regex("(?i)(€|eur(os)?|euro)")

    fun parse(raw: String): Money? {
        var s = currencyWords.replace(raw, "").replace(" ", "").replace(" ", "").trim()
        if (s.isEmpty()) return null
        var negative = false
        if (s.startsWith("-") || s.startsWith("−")) { negative = true; s = s.substring(1) }
        else if (s.startsWith("+")) s = s.substring(1)

        val hasComma = ',' in s
        val hasDot = '.' in s
        val normalized = when {
            hasComma && hasDot -> {
                if (s.lastIndexOf(',') > s.lastIndexOf('.')) s.replace(".", "").replace(',', '.')
                else s.replace(",", "")
            }
            hasComma -> if (s.count { it == ',' } == 1) s.replace(',', '.') else s.replace(",", "")
            hasDot -> {
                val dots = s.count { it == '.' }
                val afterLast = s.length - s.lastIndexOf('.') - 1
                if (dots > 1 || afterLast == 3) s.replace(".", "") else s
            }
            else -> s
        }
        if (!Regex("^\\d+(\\.\\d+)?$").matches(normalized)) return null
        return try {
            val value = BigDecimal(normalized).setScale(2, RoundingMode.HALF_UP).movePointRight(2).longValueExact()
            Money(if (negative) -value else value)
        } catch (e: ArithmeticException) {
            null
        }
    }
}

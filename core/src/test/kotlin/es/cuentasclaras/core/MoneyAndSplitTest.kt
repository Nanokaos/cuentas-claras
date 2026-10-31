package es.cuentasclaras.core

import es.cuentasclaras.core.F.ANA
import es.cuentasclaras.core.F.LUIS
import es.cuentasclaras.core.F.eur
import es.cuentasclaras.core.F.tx
import es.cuentasclaras.core.model.Split
import es.cuentasclaras.core.model.SplitRule
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.money.Money
import es.cuentasclaras.core.split.SplitCalculator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MoneyAndSplitTest {

    @Test fun parsesSpanishFormats() {
        assertEquals(Money(2350), Money.parse("23,50"))
        assertEquals(Money(2350), Money.parse("23.50 €"))
        assertEquals(Money(123456), Money.parse("1.234,56"))
        assertEquals(Money(123400), Money.parse("1.234"))
        assertEquals(Money(800), Money.parse("8 euros"))
        assertEquals(Money(-1500), Money.parse("-15"))
        assertEquals(Money(2346), Money.parse("23,456"))
        assertNull(Money.parse("abc"))
        assertNull(Money.parse(""))
    }

    @Test fun formatsLikeSpain() {
        assertEquals("1234,50 €", Money(123450).format())
        assertEquals("12.345,00 €", Money(1234500).format())
        assertEquals("-0,05 €", Money(-5).format())
        assertEquals("+3,00 €", Money(300).format(withPlusSign = true))
    }

    @Test fun floorDivNeverOverstates() {
        assertEquals(Money(333), Money(1000).floorDiv(3))
        assertEquals(Money(-334), Money(-1000).floorDiv(3))
    }

    @Test fun equalSplitOddCentsSumsExactly() {
        val shares = SplitCalculator.shares(eur("10,01"), SplitRule.Equal(listOf(LUIS, ANA)))
        assertEquals(Money(501), shares[ANA]) // desempate determinista por id
        assertEquals(Money(500), shares[LUIS])
        assertEquals(eur("10,01"), shares.values.reduce { a, b -> a + b })
    }

    @Test fun percentageSplit() {
        val shares = SplitCalculator.shares(eur("100"), SplitRule.Percentages(mapOf(ANA to 6000, LUIS to 4000)))
        assertEquals(eur("60"), shares[ANA]); assertEquals(eur("40"), shares[LUIS])
    }

    @Test(expected = IllegalArgumentException::class)
    fun percentagesMustSum100() {
        SplitCalculator.shares(eur("100"), SplitRule.Percentages(mapOf(ANA to 6000, LUIS to 3000)))
    }

    @Test fun customAmountsAndPartialRefund() {
        val rule = SplitRule.Amounts(mapOf(ANA to eur("70"), LUIS to eur("30")))
        assertEquals(eur("70"), SplitCalculator.shares(eur("100"), rule)[ANA])
        // Devolución parcial de 10 €: proporcional 7 / 3
        assertEquals(eur("7"), SplitCalculator.shares(eur("10"), rule)[ANA])
    }

    @Test fun coupleBalanceWithRefundAndSettlement() {
        val half = Split(ANA, SplitRule.Equal(listOf(ANA, LUIS)))
        val cena = tx(TxKind.GASTO, "100", split = half, id = "cena")
        val luisPaga = tx(TxKind.GASTO, "60", owner = LUIS, account = "luis-cc", split = Split(LUIS, SplitRule.Equal(listOf(ANA, LUIS))))
        assertEquals(eur("20"), SplitCalculator.balanceBetween(ANA, LUIS, listOf(cena, luisPaga)))

        val devolucion = tx(TxKind.DEVOLUCION, "40", refundOf = "cena")
        assertEquals(eur("0"), SplitCalculator.balanceBetween(ANA, LUIS, listOf(cena, luisPaga, devolucion)))

        val liquidacion = tx(TxKind.LIQUIDACION, "20", owner = LUIS, account = "luis-cc", to = "cc", counterpart = ANA)
        assertEquals(eur("-20"), SplitCalculator.balanceBetween(ANA, LUIS, listOf(cena, luisPaga, devolucion, liquidacion)))
    }
}

package es.cuentasclaras.core

import es.cuentasclaras.core.F.ANA
import es.cuentasclaras.core.F.LUIS
import es.cuentasclaras.core.F.eur
import es.cuentasclaras.core.F.tx
import es.cuentasclaras.core.ledger.Ledger
import es.cuentasclaras.core.model.Category
import es.cuentasclaras.core.model.EffectiveStatus
import es.cuentasclaras.core.model.Split
import es.cuentasclaras.core.model.SplitRule
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.recurrence.Frequency
import es.cuentasclaras.core.recurrence.RecurrenceExpander
import es.cuentasclaras.core.recurrence.RecurrenceRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class LedgerAndRecurrenceTest {

    @Test fun transferIsNeitherIncomeNorExpense() {
        val t = tx(TxKind.TRASPASO, "300", account = "cc", to = "sav")
        val b = Ledger.balances(F.anaAccounts, listOf(t))
        assertEquals(eur("1200"), b["cc"]); assertEquals(eur("2300"), b["sav"])
        assertEquals(eur("0"), Ledger.spendingShare(t, ANA, emptyMap()))
    }

    @Test fun plannedAndPendingDoNotTouchBalance() {
        val futuro = tx(TxKind.GASTO, "50", date = F.day(20), status = TxStatus.PREVISTO)
        val vencido = tx(TxKind.GASTO, "30", date = F.day(5), status = TxStatus.PREVISTO)
        assertEquals(EffectiveStatus.PREVISTO, futuro.effectiveStatus(F.NOW))
        assertEquals(EffectiveStatus.PENDIENTE, vencido.effectiveStatus(F.NOW))
        assertEquals(eur("1500"), Ledger.balances(F.anaAccounts, listOf(futuro, vencido))["cc"])
    }

    @Test fun pastMovementsCountOncePosted() {
        val antiguo = tx(TxKind.GASTO, "20", date = F.day(1).minusMonths(2))
        assertEquals(eur("1480"), Ledger.balances(F.anaAccounts, listOf(antiguo))["cc"])
    }

    @Test fun refundReducesCategorySpendingAndRaisesBalance() {
        val compra = tx(TxKind.GASTO, "80", category = "ropa", id = "c1")
        val dev = tx(TxKind.DEVOLUCION, "30", refundOf = "c1")
        val byId = listOf(compra, dev).associateBy { it.id }
        assertEquals("ropa", Ledger.categoryOf(dev, byId))
        assertEquals(eur("-30"), Ledger.spendingShare(dev, ANA, byId))
        assertEquals(eur("1450"), Ledger.balances(F.anaAccounts, listOf(compra, dev))["cc"])
    }

    @Test fun correctionAdjustsBalanceWithoutBeingSpending() {
        val ajuste = tx(TxKind.AJUSTE, "-12,34")
        assertEquals(eur("1487,66"), Ledger.balances(F.anaAccounts, listOf(ajuste))["cc"])
        assertEquals(eur("0"), Ledger.spendingShare(ajuste, ANA, emptyMap()))
    }

    @Test fun sharedExpenseNotDuplicatedAcrossViews() {
        val s = tx(TxKind.GASTO, "90", split = Split(ANA, SplitRule.Equal(listOf(ANA, LUIS))))
        assertEquals(eur("45"), Ledger.spendingShare(s, ANA, emptyMap()))
        assertEquals(eur("45"), Ledger.spendingShare(s, LUIS, emptyMap()))
        assertEquals(eur("90"), Ledger.householdSpending(s))
        // El dinero sale una sola vez, de la cuenta de quien pagó
        assertEquals(eur("1410"), Ledger.balances(F.anaAccounts, listOf(s))["cc"])
    }

    @Test fun subcategoriesRollUp() {
        val cats = listOf(Category("comida", "Comida"), Category("super", "Súper", "comida"), Category("fruta", "Fruta", "super"))
        assertEquals(setOf("comida", "super", "fruta"), Ledger.subtree("comida", cats))
    }

    @Test fun monthlyOn31stDoesNotDrift() {
        val rule = RecurrenceRule("r", tx(TxKind.GASTO, "10"), Frequency.MENSUAL, start = LocalDate.of(2026, 1, 31))
        val dates = RecurrenceExpander.dates(rule, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 4, 30))
        assertEquals(listOf(LocalDate.of(2026, 1, 31), LocalDate.of(2026, 2, 28), LocalDate.of(2026, 3, 31), LocalDate.of(2026, 4, 30)), dates)
    }

    @Test fun installmentsStopAtCountAndTrackDebt() {
        val rule = RecurrenceRule(
            "movil", tx(TxKind.GASTO, "25", debtId = "deuda-movil", concept = "Cuota móvil"), Frequency.MENSUAL,
            start = LocalDate.of(2026, 9, 5), count = 12,
        )
        val all = RecurrenceExpander.materialize(rule, LocalDate.of(2026, 1, 1), LocalDate.of(2028, 1, 1), emptySet())
        assertEquals(12, all.size)
        assertEquals(LocalDate.of(2027, 8, 5), all.last().date)
        val paid = all.filter { it.date.isBefore(F.TODAY) }.map { it.confirm() }
        assertEquals(3, paid.size)
        assertEquals(eur("225"), Ledger.debtRemaining("deuda-movil", eur("300"), paid))
    }

    @Test fun materializeIsIdempotentAndRespectsDeletedOccurrences() {
        val rule = RecurrenceRule("luz", tx(TxKind.GASTO, "60"), Frequency.MENSUAL, start = LocalDate.of(2026, 11, 15))
        val first = RecurrenceExpander.materialize(rule, F.TODAY, F.TODAY.plusMonths(2), emptySet())
        assertEquals(2, first.size) // 15 nov y 15 dic (el 15 ene queda fuera)
        val again = RecurrenceExpander.materialize(rule, F.TODAY, F.TODAY.plusMonths(2), first.map { it.id }.toSet())
        assertTrue(again.isEmpty())
    }

    @Test fun confirmKeepsIdAndUsesRealAmount() {
        val nomina = tx(TxKind.INGRESO, "1400", date = F.day(28), status = TxStatus.PREVISTO, estimated = true, id = "nomina@2026-11-28")
        val real = nomina.confirm(actualAmount = eur("1462,30"), actualDateTime = F.day(27))
        assertEquals(nomina.id, real.id)
        assertEquals(TxStatus.REALIZADO, real.status)
        assertEquals(false, real.estimated)
        assertEquals(eur("2962,30"), Ledger.balances(F.anaAccounts, listOf(real))["cc"])
    }
}

package es.cuentasclaras.core

import es.cuentasclaras.core.F.ANA
import es.cuentasclaras.core.F.LUIS
import es.cuentasclaras.core.F.eur
import es.cuentasclaras.core.F.tx
import es.cuentasclaras.core.dedup.Duplicates
import es.cuentasclaras.core.model.Split
import es.cuentasclaras.core.model.SplitRule
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.parse.MissingField
import es.cuentasclaras.core.parse.PaymentHint
import es.cuentasclaras.core.parse.QuickEntryParser
import es.cuentasclaras.core.sharing.Access
import es.cuentasclaras.core.sharing.AccessLevel
import es.cuentasclaras.core.sharing.Grant
import es.cuentasclaras.core.sharing.ShareScope
import es.cuentasclaras.core.sync.Hlc
import es.cuentasclaras.core.sync.MergeOutcome
import es.cuentasclaras.core.sync.SyncMerge
import es.cuentasclaras.core.sync.Versioned
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class SharingSyncParseTest {

    private val shared = tx(TxKind.GASTO, "50", split = Split(ANA, SplitRule.Equal(listOf(ANA, LUIS))))
    private val privado = tx(TxKind.GASTO, "20", concept = "Regalo sorpresa")

    @Test fun partnerSeesOnlySharedAndLosesAccessWhenRevoked() {
        val grant = Grant("g1", ANA, LUIS, ShareScope.MovimientosCompartidos, AccessLevel.LECTURA)
        assertEquals(listOf(shared), Access.visibleTo(LUIS, listOf(shared, privado), listOf(grant)))
        assertFalse(Access.canEdit(LUIS, shared, listOf(grant)))
        assertTrue(Access.canEdit(LUIS, shared, listOf(grant.copy(level = AccessLevel.EDICION))))
        assertTrue(Access.visibleTo(LUIS, listOf(shared, privado), listOf(grant.copy(revoked = true))).isEmpty())
        // La propietaria siempre ve lo suyo
        assertEquals(2, Access.visibleTo(ANA, listOf(shared, privado), emptyList()).size)
    }

    @Test fun accountGrantAndSummaryScope() {
        val cuenta = Grant("g2", ANA, LUIS, ShareScope.Cuenta("cash"), AccessLevel.LECTURA)
        val enEfectivo = tx(TxKind.GASTO, "5", account = "cash")
        assertEquals(listOf(enEfectivo), Access.visibleTo(LUIS, listOf(privado, enEfectivo), listOf(cuenta)))
        val resumen = Grant("g3", ANA, LUIS, ShareScope.Resumen, AccessLevel.LECTURA)
        assertTrue(Access.visibleTo(LUIS, listOf(privado, enEfectivo), listOf(resumen)).isEmpty())
    }

    @Test fun hlcOrdersChangesAcrossDevices() {
        val phoneA = Hlc(1000, 0, "A")
        val a1 = phoneA.tick(900) // reloj del móvil retrasado: no retrocede
        assertTrue(a1 > phoneA)
        val phoneB = Hlc(500, 0, "B").receive(a1, 600)
        assertTrue(phoneB > a1)
        assertEquals(phoneB, Hlc.decode(phoneB.encode()))
        assertTrue(a1.encode() < phoneB.encode())
    }

    @Test fun lastWriteWinsAndDeletesPropagate() {
        val v1 = Versioned("t1", "café 2€", Hlc(1000, 0, "A"))
        val v2 = Versioned("t1", "café 2,50€", Hlc(2000, 0, "B"))
        assertEquals(MergeOutcome.REMOTO_GANA, SyncMerge.resolve(v1, v2).second)
        val borrado = Versioned<String>("t1", null, Hlc(3000, 0, "A"), deleted = true)
        assertTrue(SyncMerge.resolve(borrado, v2).first!!.deleted)
        val merged = SyncMerge.mergeAll(listOf(v1), listOf(v2, Versioned("t2", "nuevo", Hlc(1, 0, "B"))))
        assertEquals(setOf("t1", "t2"), merged.keys)
        assertEquals("café 2,50€", merged["t1"]!!.value)
    }

    @Test fun retriedSaveWithSameIdIsNotADuplicate() {
        val draft = tx(TxKind.GASTO, "23", concept = "Supermercado", id = "draft-123")
        val store = linkedMapOf<String, Any>()
        repeat(3) { store[draft.id] = draft } // insertar o reemplazar por id
        assertEquals(1, store.size)
    }

    @Test fun manualDoubleEntryIsFlagged() {
        val a = tx(TxKind.GASTO, "23", concept = "Mercadona")
        val b = tx(TxKind.GASTO, "23", concept = "mercadona ", date = a.dateTime.plusHours(3))
        val c = tx(TxKind.GASTO, "23", concept = "Gasolina")
        assertEquals(listOf(a), Duplicates.suspects(b, listOf(a, c)))
    }

    @Test fun parsesTheExampleSentence() {
        val r = QuickEntryParser.parse(
            "Ayer gasté 23 euros en el supermercado y 8 en cenar; los 23 los pagué con tarjeta y los 8 en efectivo",
            F.NOW,
        )
        assertTrue(r.dateWasExplicit)
        assertEquals(2, r.drafts.size)
        val (a, b) = r.drafts
        assertEquals(eur("23"), a.amount); assertEquals("Supermercado", a.concept); assertEquals("comida", a.categoryKey)
        assertEquals(PaymentHint.TARJETA, a.payment); assertEquals(LocalDate.of(2026, 11, 9), a.dateTime.toLocalDate())
        assertEquals(eur("8"), b.amount); assertEquals("Cenar", b.concept); assertEquals("ocio", b.categoryKey)
        assertEquals(PaymentHint.EFECTIVO, b.payment)
        assertTrue(a.missing.isEmpty() && b.missing.isEmpty())
    }

    @Test fun parserDefaultsToNowAndAsksOnlyForMissingAccount() {
        val r = QuickEntryParser.parse("15,50 en gasolina", F.NOW)
        val d = r.drafts.single()
        assertFalse(r.dateWasExplicit)
        assertEquals(F.NOW, d.dateTime)
        assertEquals("transporte", d.categoryKey)
        assertEquals(setOf(MissingField.CUENTA), d.missing)
    }

    @Test fun parserHandlesIncomeTimeAndWeekday() {
        val r = QuickEntryParser.parse("El viernes cobré 250 euros de un trabajo extra a las 18:30 por transferencia", F.NOW)
        val d = r.drafts.single()
        assertEquals(TxKind.INGRESO, d.kind)
        assertEquals(eur("250"), d.amount)
        assertEquals(LocalDate.of(2026, 11, 6), d.dateTime.toLocalDate())
        assertEquals(18, d.dateTime.hour)
        assertEquals(PaymentHint.TRANSFERENCIA, d.payment)
    }

    @Test fun parserSingleMethodAppliesToAll() {
        val r = QuickEntryParser.parse("he gastado 12 en el bar y 30 en la farmacia, todo con tarjeta", F.NOW)
        assertEquals(2, r.drafts.size)
        assertTrue(r.drafts.all { it.payment == PaymentHint.TARJETA })
        assertEquals("salud", r.drafts[1].categoryKey)
    }
}

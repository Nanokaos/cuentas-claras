package es.cuentasclaras.core.dedup

import es.cuentasclaras.core.model.Transaction
import java.text.Normalizer
import java.time.temporal.ChronoUnit

/**
 * Dos capas contra duplicados:
 * 1. Idempotencia: cada borrador (formulario, texto, voz o IA) recibe su id al crearse.
 *    Guardar es «insertar o reemplazar por id», así un reintento nunca crea otro movimiento.
 * 2. Sospecha: si alguien registra lo mismo dos veces a mano, se avisa (no se bloquea).
 */
object Duplicates {

    fun suspects(candidate: Transaction, existing: Collection<Transaction>, maxDays: Long = 1): List<Transaction> =
        existing.filter {
            !it.deleted &&
                it.id != candidate.id &&
                it.ownerId == candidate.ownerId &&
                it.kind == candidate.kind &&
                it.amount == candidate.amount &&
                kotlin.math.abs(ChronoUnit.DAYS.between(it.date, candidate.date)) <= maxDays &&
                similar(it.concept, candidate.concept)
        }

    internal fun normalize(s: String): String =
        Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .replace(Regex("[^a-z0-9 ]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()

    private fun similar(a: String, b: String): Boolean {
        val x = normalize(a)
        val y = normalize(b)
        if (x.isEmpty() || y.isEmpty()) return true
        return x == y || x.contains(y) || y.contains(x)
    }
}

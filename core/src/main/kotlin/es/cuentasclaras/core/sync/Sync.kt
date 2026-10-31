package es.cuentasclaras.core.sync

/**
 * Reloj lógico híbrido: ordena cambios de varios dispositivos aunque sus relojes no coincidan.
 * Orden: tiempo físico, contador, id de dispositivo (desempate determinista).
 */
data class Hlc(val wallMillis: Long, val counter: Int, val nodeId: String) : Comparable<Hlc> {

    override fun compareTo(other: Hlc): Int =
        compareValuesBy(this, other, { it.wallMillis }, { it.counter }, { it.nodeId })

    /** Nuevo sello para un cambio local. */
    fun tick(nowMillis: Long): Hlc =
        if (nowMillis > wallMillis) Hlc(nowMillis, 0, nodeId) else Hlc(wallMillis, counter + 1, nodeId)

    /** Ajusta el reloj local al recibir un cambio remoto. */
    fun receive(remote: Hlc, nowMillis: Long): Hlc {
        val wall = maxOf(wallMillis, remote.wallMillis, nowMillis)
        val c = when {
            wall == wallMillis && wall == remote.wallMillis -> maxOf(counter, remote.counter) + 1
            wall == wallMillis -> counter + 1
            wall == remote.wallMillis -> remote.counter + 1
            else -> 0
        }
        return Hlc(wall, c, nodeId)
    }

    /** Serialización ordenable lexicográficamente (para consultas «cambios desde»). */
    fun encode(): String = "${wallMillis.toString().padStart(15, '0')}-${counter.toString().padStart(6, '0')}-$nodeId"

    companion object {
        fun decode(s: String): Hlc {
            val parts = s.split('-', limit = 3)
            return Hlc(parts[0].toLong(), parts[1].toInt(), parts[2])
        }
    }
}

/** Documento sincronizable. Los borrados son lápidas para que se propaguen. */
data class Versioned<T>(val id: String, val value: T?, val hlc: Hlc, val deleted: Boolean = false)

enum class MergeOutcome { LOCAL_GANA, REMOTO_GANA, IGUALES }

object SyncMerge {

    /**
     * Última escritura gana por documento, según HLC. Un borrado posterior gana a una edición
     * anterior; una edición posterior a un borrado lo resucita (decisión explícita del usuario).
     */
    fun <T> resolve(local: Versioned<T>?, remote: Versioned<T>?): Pair<Versioned<T>?, MergeOutcome> = when {
        local == null && remote == null -> null to MergeOutcome.IGUALES
        local == null -> remote to MergeOutcome.REMOTO_GANA
        remote == null -> local to MergeOutcome.LOCAL_GANA
        remote.hlc > local.hlc -> remote to MergeOutcome.REMOTO_GANA
        local.hlc > remote.hlc -> local to MergeOutcome.LOCAL_GANA
        else -> local to MergeOutcome.IGUALES
    }

    /** Fusiona dos colecciones completas; devuelve el estado final por id. */
    fun <T> mergeAll(local: Collection<Versioned<T>>, remote: Collection<Versioned<T>>): Map<String, Versioned<T>> {
        val l = local.associateBy { it.id }
        val r = remote.associateBy { it.id }
        return (l.keys + r.keys).associateWith { id -> resolve(l[id], r[id]).first!! }
    }
}

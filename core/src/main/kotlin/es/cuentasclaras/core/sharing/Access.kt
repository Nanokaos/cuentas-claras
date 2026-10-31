package es.cuentasclaras.core.sharing

import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.UserId

enum class AccessLevel { LECTURA, EDICION }

sealed interface ShareScope {
    /** Movimientos marcados como compartidos en los que participa el invitado. */
    data object MovimientosCompartidos : ShareScope

    /** Todos los movimientos de una cuenta concreta. */
    data class Cuenta(val accountId: String) : ShareScope

    /** Solo totales y presupuestos, sin detalle de movimientos. */
    data object Resumen : ShareScope
}

/** Permiso concedido por [ownerId] a [granteeId]. Revocable en cualquier momento. */
data class Grant(
    val id: String,
    val ownerId: UserId,
    val granteeId: UserId,
    val scope: ShareScope,
    val level: AccessLevel,
    val revoked: Boolean = false,
)

/**
 * Reglas de acceso. Las mismas reglas se replican en las reglas de seguridad de Firestore
 * (el servidor es quien manda); aquí sirven para filtrar la vista y el contexto de la IA.
 */
object Access {

    fun canRead(viewer: UserId, tx: Transaction, grants: Collection<Grant>): Boolean =
        tx.ownerId == viewer || grants.any { it.matches(viewer, tx) }

    fun canEdit(viewer: UserId, tx: Transaction, grants: Collection<Grant>): Boolean =
        tx.ownerId == viewer || grants.any { it.level == AccessLevel.EDICION && it.matches(viewer, tx) }

    /** Lo único que la IA de [viewer] puede ver. */
    fun visibleTo(viewer: UserId, txs: Collection<Transaction>, grants: Collection<Grant>): List<Transaction> =
        txs.filter { !it.deleted && canRead(viewer, it, grants) }

    private fun Grant.matches(viewer: UserId, tx: Transaction): Boolean {
        if (revoked || granteeId != viewer || ownerId != tx.ownerId) return false
        return when (val s = scope) {
            ShareScope.MovimientosCompartidos -> tx.split?.participants?.contains(viewer) == true
            is ShareScope.Cuenta -> tx.accountId == s.accountId || tx.toAccountId == s.accountId
            ShareScope.Resumen -> false
        }
    }
}

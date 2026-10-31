package es.cuentasclaras.app.vera

import es.cuentasclaras.app.UiState
import es.cuentasclaras.core.budget.CategoryState
import es.cuentasclaras.core.budget.WarningCode
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.money.Money

/**
 * Frases de Vera. Las cifras siempre vienen del motor determinista; la personalidad solo pone el tono.
 * Nivel de sarcasmo: 0 neutra, 1 irónica, 2 sarcástica, 3 despiadada. Tras la broma, siempre dato y propuesta.
 */
object VeraLines {
    private fun pick(level: Int, vararg v: String) = v[level.coerceIn(0, v.size - 1)]
    fun moodFor(level: Int) = if (level >= 2) "sarcastica" else "neutral"
    private val Money.e get() = format()

    fun hello(s: UiState): String {
        val l = s.snap.settings.sarcasm
        val r = s.toPayday
        if (r.available.isNegative) return deficit(s)
        if (r.warnings.any { it.code == WarningCode.SIN_FECHA_COBRO }) return pick(l,
            "Hola. Indica en Ajustes la fecha de tu próximo cobro para calcular mejor.",
            "Hola. Me falta la fecha de tu próximo cobro; ponla en Ajustes.",
            "Hola. Calculo hasta fin de mes porque no sé cuándo cobras. Una pista en Ajustes y dejo de adivinar.",
            "Sin fecha de cobro, mis cálculos son provisionales. Como tus planes de ahorro. Ajustes, por favor.")
        return pick(l,
            "Hola. Hoy puedes gastar ${r.today.e}.",
            "Hola. Hoy puedes gastar ${r.today.e}. Buen comienzo.",
            "Hola de nuevo. Te quedan ${r.today.e} para hoy. Intentemos que mañana sigan existiendo.",
            "Has vuelto. Tu saldo y yo lo celebramos con moderación. Hoy: ${r.today.e}.")
    }

    fun deficit(s: UiState): String {
        val r = s.toPayday; val l = s.snap.settings.sarcasm
        val cut = Money((r.deficit.cents + r.horizon.days - 1) / r.horizon.days.coerceAtLeast(1))
        return pick(l,
            "Aviso: faltan ${r.deficit.e} para cubrir lo reservado. Opciones: retrasar el ahorro del mes o recortar ${cut.e} al día.",
            "Aviso: hay un déficit de ${r.deficit.e}. Puedes retrasar el ahorro o recortar ${cut.e} al día.",
            "Aviso. Faltan ${r.deficit.e}. No es una opinión, es aritmética. Retrasa el ahorro o recorta ${cut.e} al día.",
            "Faltan ${r.deficit.e}. Las cifras no tienen sentido del humor y hoy yo tampoco. Retrasa el ahorro o recorta ${cut.e} al día.")
    }

    fun explain(s: UiState): String {
        val r = s.toPayday; val res = r.reserved
        val base = "Saldo líquido ${r.liquidBalance.e}. Menos recibos ${res.obligations.e}, ahorro ${res.savings.e}, objetivos ${res.goals.e} y colchón ${res.buffer.e}. Quedan ${r.available.e} para ${r.horizon.days} días: ${r.dailyRate.e} al día." +
            if (r.expectedIncome.isPositive) " No cuento ${r.expectedIncome.e} de ingresos que aún no has cobrado." else ""
        return pick(s.snap.settings.sarcasm, base, "$base Así de sencillo.", "$base Las cuentas no mienten. Las personas, a veces.", "$base Te lo he explicado despacio. Puedo hacerlo más despacio.")
    }

    fun remarks(s: UiState): List<String> {
        val l = s.snap.settings.sarcasm
        if (!s.snap.settings.remarks || l == 0) return emptyList()
        val list = mutableListOf<String>()
        s.toPayday.categories.filter { it.state == CategoryState.SUPERADO }.forEach {
            list += pick(l, "", "${it.name} va por ${it.spent.e} de ${it.limit.e}.", "${it.name}: ${it.spent.e} de ${it.limit.e}. No digo nada. Lo estoy diciendo.", "He mirado ${it.name.lowercase()} otra vez. Sigue por encima del límite.")
        }
        if (s.toPayday.today.isPositive) list += pick(l, "", "Hoy te quedan ${s.toPayday.today.e}.", "Te quedan ${s.toPayday.today.e} para hoy. Lo digo por si alguien pregunta.", "${s.toPayday.today.e} para hoy. Es una cifra, no un objetivo.")
        list += pick(l, "", "Sin novedades en tus recibos.", "He revisado tus recibos. Todos en orden. Por ahora.", "Sin gastos en un rato. Sospechoso, pero lo acepto.")
        return list.filter { it.isNotBlank() }
    }

    fun draftsReady(n: Int, l: Int) = if (n == 1) pick(l, "Revisa el movimiento y confírmalo.", "Lo tengo. Revísalo y confirma.", "Preparado. No pienso guardarlo a tus espaldas: confírmalo.", "Listo. Si me equivoco, prefiero que sea culpa tuya. Confirma.")
    else pick(l, "He preparado $n movimientos. Revísalos y confírmalos.", "$n movimientos preparados. Revisa y confirma.", "$n movimientos de una sola frase. Impresionante eficiencia gastando. Revísalos.", "$n de golpe. Revísalos antes de que me arrepienta de entenderte.")

    fun notUnderstood(l: Int) = pick(l, "No he encontrado ningún importe. Prueba, por ejemplo: «23 euros en el súper con tarjeta».", "No veo ningún importe. Ejemplo: «23 euros en el súper».", "Sin importe no hay gasto. Ni siquiera tú puedes gastar «algo». Ejemplo: «23 euros en el súper».", "Necesito una cifra. Una. Ejemplo: «23 euros en el súper».")
    fun discarded(l: Int) = pick(l, "Descartado. No se ha guardado nada.", "Descartado.", "Descartado. Fingiré que no ha pasado.", "Descartado. Ojalá pudiera hacer lo mismo con tus cenas.")

    /** Reacción tras guardar: (texto, ánimo, estado). */
    fun afterSaving(list: List<Transaction>, s: UiState): Triple<String, String, String> {
        val l = s.snap.settings.sarcasm; val r = s.toPayday
        if (r.available.isNegative) return Triple(deficit(s), "enfadada", "aviso")
        val total = list.filter { it.kind == TxKind.GASTO }.fold(Money.ZERO) { a, t -> a + t.amount }
        val income = list.filter { it.kind == TxKind.INGRESO }.fold(Money.ZERO) { a, t -> a + t.amount }
        val over = r.categories.firstOrNull { c -> c.state == CategoryState.SUPERADO && list.any { tx -> s.snap.categories.firstOrNull { it.id == tx.categoryId }?.let { it.id == c.categoryId || it.parentId == c.categoryId } == true } }
        if (over != null) return Triple(pick(l,
            "Guardado. ${over.name} va por ${over.spent.e} de ${over.limit.e}. Propuesta: no gastar más en ${over.name.lowercase()} este mes.",
            "Guardado. ${over.name} supera el límite: ${over.spent.e} de ${over.limit.e}. Te propongo pausarlo.",
            "Guardado. El límite de ${over.name.lowercase()} era ${over.limit.e}; por lo visto, orientativo. Vas por ${over.spent.e}. Propuesta: pausa hasta fin de mes.",
            "${over.spent.e} en ${over.name.lowercase()} con un límite de ${over.limit.e}. Admiro tu constancia, en la dirección equivocada. Hoy te quedan ${r.today.e}."),
            if (l >= 2) "sarcastica" else "decepcionada", "habla")
        if (income.isPositive && total.isZero) return Triple(pick(l,
            "Ingreso guardado: ${income.e}.", "Ingreso de ${income.e} guardado. Bien.",
            "${income.e} que entran. Lo registro antes de que encuentres en qué gastarlos.", "Ingreso: ${income.e}. Disfruta la sensación; suele durar poco."), "contenta", "habla")
        return Triple(pick(l,
            "Guardado. Hoy te quedan ${r.today.e}.", "Guardado: ${total.e}. Quedan ${r.today.e} para hoy.",
            "Guardado: ${total.e}. Te quedan ${r.today.e} para hoy. Lo digo por si alguien lleva la cuenta. Yo, por ejemplo.",
            "Guardado. ${r.today.e} para hoy. Es una cifra, no un reto."),
            if (r.today.isNegative) "decepcionada" else if (l >= 2) "sarcastica" else "contenta", "habla")
    }
}

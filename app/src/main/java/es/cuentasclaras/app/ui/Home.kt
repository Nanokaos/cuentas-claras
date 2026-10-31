package es.cuentasclaras.app.ui

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import es.cuentasclaras.app.AppViewModel
import es.cuentasclaras.app.DraftTx
import es.cuentasclaras.app.UiState
import es.cuentasclaras.app.toTx
import es.cuentasclaras.app.vera.VeraView
import es.cuentasclaras.core.budget.CategoryState
import es.cuentasclaras.core.budget.LineKind
import es.cuentasclaras.core.model.EffectiveStatus
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.money.Money
import java.time.format.DateTimeFormatter
import java.util.Locale

val ES: Locale = Locale.forLanguageTag("es-ES")
val dayFmt: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE d MMM", ES)

@Composable
fun Card(modifier: Modifier = Modifier, highlight: Color? = null, content: @Composable () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .background(Pal.panel, RoundedCornerShape(18.dp))
            .border(1.dp, highlight ?: Pal.line, RoundedCornerShape(18.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) { Column { content() } }
}

@Composable
fun Label(text: String) = Text(text, style = MaterialTheme.typography.labelMedium, color = Pal.muted)

@Composable
fun HomeScreen(vm: AppViewModel, onAdd: () -> Unit, onOpen: (String) -> Unit) {
    val s by vm.state.collectAsState()
    val drafts by vm.drafts.collectAsState()
    Column(Modifier.fillMaxSize()) {
        VeraView(
            commands = vm.vera,
            onReady = { vm.greet() },
            onTap = { vm.explain() },
            onAction = {},
            modifier = Modifier.fillMaxWidth().height(290.dp),
        )
        QuickEntry(vm, onAdd)
        val st = s ?: return@Column
        androidx.compose.runtime.LaunchedEffect(st.snap.settings, st.toPayday.today) { vm.sendConfig() }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (st.demo) item {
                Text("Estás viendo datos de demostración. Cámbialo en Ajustes.", color = Pal.warn, style = MaterialTheme.typography.labelMedium)
            }
            item { SummaryCard(st) }
            item { Tiles(st) }
            if (st.toPayday.warnings.isNotEmpty()) item {
                Card(highlight = Pal.warn.copy(alpha = .5f)) {
                    st.toPayday.warnings.forEach { Text("• " + it.message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 2.dp)) }
                }
            }
            if (st.toPayday.categories.isNotEmpty()) item { CategoriesCard(st) }
            item { UpcomingCard(st, onOpen) }
        }
    }
    if (drafts.isNotEmpty()) DraftsDialog(vm, drafts)
}

@Composable
private fun QuickEntry(vm: AppViewModel, onAdd: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val speech = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        if (res.resultCode == Activity.RESULT_OK) {
            val heard = res.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            if (!heard.isNullOrBlank()) { vm.say(es.cuentasclaras.app.vera.VeraCommand.Show("«$heard»")); vm.quickEntry(heard) }
        } else vm.say(es.cuentasclaras.app.vera.VeraCommand.State("reposo"))
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = text, onValueChange = { text = it },
            placeholder = { Text("«23 € en el súper con tarjeta»") },
            singleLine = true, modifier = Modifier.weight(1f), shape = RoundedCornerShape(24.dp),
            trailingIcon = {
                if (text.isNotBlank()) IconButton(onClick = { vm.quickEntry(text); text = "" }) { Icon(Icons.AutoMirrored.Filled.Send, "Interpretar") }
            },
        )
        Spacer(Modifier.width(8.dp))
        FilledIconButton(
            onClick = {
                vm.say(es.cuentasclaras.app.vera.VeraCommand.State("escucha"))
                val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES")
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, "Dime el gasto o el ingreso")
                runCatching { speech.launch(i) }
            },
            modifier = Modifier.size(48.dp),
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = Pal.accent),
        ) { Icon(Icons.Filled.Mic, "Dictar") }
        Spacer(Modifier.width(6.dp))
        FilledIconButton(onClick = onAdd, modifier = Modifier.size(48.dp), colors = IconButtonDefaults.filledIconButtonColors(containerColor = Pal.raise, contentColor = Pal.text)) {
            Icon(Icons.Filled.Add, "Añadir movimiento")
        }
    }
}

@Composable
private fun SummaryCard(st: UiState) {
    val r = st.toPayday
    var open by remember { mutableStateOf(false) }
    Card(Modifier.clickable { open = !open }) {
        Label(if (r.available.isNegative) "Déficit hasta el cobro" else "Disponible hoy")
        Text(
            if (r.available.isNegative) r.deficit.format() else r.today.format(),
            style = MaterialTheme.typography.displaySmall,
            color = if (r.available.isNegative || r.today.isNegative) Pal.bad else Pal.text,
        )
        Text(
            (if (r.horizon.provisional) "Hasta fin de mes (provisional)" else "Hasta el cobro (${r.horizon.endDate.format(dayFmt)})") +
                ": ${r.available.format()} · ${r.horizon.days} días",
            style = MaterialTheme.typography.bodyMedium, color = Pal.muted,
        )
        if (r.expectedIncome.isPositive) Text("Sin contar ${r.expectedIncome.format()} de ingresos previstos" + if (r.expectedIncomeIsEstimate) " (estimados)" else "", style = MaterialTheme.typography.labelMedium)
        if (open) {
            Spacer(Modifier.height(10.dp))
            r.explanation.forEach { line ->
                Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    val prefix = when (line.kind) { LineKind.RESTA -> "− "; LineKind.RESULTADO -> "= "; else -> "" }
                    Text(prefix + line.text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (line.kind == LineKind.RESULTADO) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (line.kind == LineKind.NOTA) Pal.muted else Pal.text)
                    line.amount?.let { Text(it.format(), style = MaterialTheme.typography.bodyMedium) }
                }
            }
        } else Text("Toca para ver de dónde sale", style = MaterialTheme.typography.labelMedium, color = Pal.accent2)
    }
}

@Composable
private fun Tiles(st: UiState) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.weight(1f)) { Card { Label("Esta semana"); Text(st.toPayday.thisWeek.atLeastZero().format(), style = MaterialTheme.typography.titleLarge) } }
        Box(Modifier.weight(1f)) { Card { Label("Este mes"); Text(st.toMonthEnd.available.format(), style = MaterialTheme.typography.titleLarge, color = if (st.toMonthEnd.available.isNegative) Pal.bad else Pal.text) } }
    }
    Spacer(Modifier.height(10.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.weight(1f)) { Card { Label("Saldo total"); Text(st.toPayday.totalBalance.format(), style = MaterialTheme.typography.titleLarge) } }
        Box(Modifier.weight(1f)) { Card { Label("Reservado"); Text(st.toPayday.reserved.total.format(), style = MaterialTheme.typography.titleLarge) } }
    }
}

@Composable
fun CategoriesCard(st: UiState) {
    Card {
        Text("Presupuestos del mes", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        st.toPayday.categories.forEach { c ->
            val color = when (c.state) { CategoryState.SUPERADO -> Pal.bad; CategoryState.ATENCION -> Pal.warn; CategoryState.BIEN -> Pal.ok }
            Row(Modifier.fillMaxWidth()) {
                Text(c.name, Modifier.weight(1f))
                Text("${c.spent.format()} de ${c.limit.format()}", color = Pal.muted, style = MaterialTheme.typography.bodyMedium)
            }
            LinearProgressIndicator(
                progress = { (c.spent.cents.toFloat() / c.limit.cents.coerceAtLeast(1)).coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 2.dp).height(6.dp),
                color = color, trackColor = Pal.raise,
            )
            Text(if (c.remaining.isNegative) "Superado en ${(-c.remaining).format()}" else "Quedan ${c.remaining.format()} · ${c.perDay.format()} al día",
                style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(bottom = 8.dp))
        }
    }
}

@Composable
private fun UpcomingCard(st: UiState, onOpen: (String) -> Unit) {
    val upcoming = st.snap.transactions.filter { it.effectiveStatus(st.now) != EffectiveStatus.REALIZADO }.sortedBy { it.dateTime }.take(6)
    Card {
        Text("Próximos recibos e ingresos", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
        if (upcoming.isEmpty()) Text("Nada programado. Añade recibos recurrentes desde «+».", color = Pal.muted, style = MaterialTheme.typography.bodyMedium)
        upcoming.forEach { t ->
            Row(Modifier.fillMaxWidth().clickable { onOpen(t.id) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(t.concept.ifBlank { "Sin concepto" })
                    Text(t.date.format(dayFmt) + if (t.effectiveStatus(st.now) == EffectiveStatus.PENDIENTE) " · pendiente de confirmar" else "",
                        style = MaterialTheme.typography.labelMedium, color = if (t.effectiveStatus(st.now) == EffectiveStatus.PENDIENTE) Pal.warn else Pal.muted)
                }
                Text((if (t.kind == TxKind.INGRESO) "+" else "−") + t.amount.format(), color = if (t.kind == TxKind.INGRESO) Pal.ok else Pal.text)
            }
        }
    }
}

@Composable
private fun DraftsDialog(vm: AppViewModel, drafts: List<DraftTx>) {
    val s = vm.state.collectAsState().value ?: return
    AlertDialog(
        onDismissRequest = { vm.discardDrafts() },
        containerColor = Pal.panel,
        title = { Text(if (drafts.size == 1) "Confirma el movimiento" else "Confirma ${drafts.size} movimientos") },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                drafts.forEach { d ->
                    item(d.id) {
                        Column(Modifier.fillMaxWidth().background(Pal.raise, RoundedCornerShape(14.dp)).padding(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                KindChip(d.kind) { vm.updateDraft(d.copy(kind = it)) }
                                Spacer(Modifier.width(8.dp))
                                OutlinedTextField(d.amountText, { vm.updateDraft(d.copy(amountText = it)) }, label = { Text("Importe (€)") }, singleLine = true, modifier = Modifier.weight(1f))
                            }
                            OutlinedTextField(d.concept, { vm.updateDraft(d.copy(concept = it)) }, label = { Text("Concepto") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            Picker("Cuenta", s.snap.accounts.map { it.id to it.name }, d.accountId) { vm.updateDraft(d.copy(accountId = it)) }
                            Picker("Categoría", categoryOptions(s, d.kind), d.categoryId) { vm.updateDraft(d.copy(categoryId = it)) }
                            DateTimeRow(d.dateTime) { vm.updateDraft(d.copy(dateTime = it)) }
                            if (d.accountId == null) Text("Falta la cuenta", color = Pal.warn, style = MaterialTheme.typography.labelMedium)
                            if (d.toTx() == null) Text("Revisa el importe", color = Pal.warn, style = MaterialTheme.typography.labelMedium)
                            d.duplicateOf?.let { Text("Parece repetido: ya tienes «$it» con el mismo importe.", color = Pal.warn, style = MaterialTheme.typography.labelMedium) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { vm.confirmDrafts() }, enabled = drafts.all { it.toTx() != null && it.accountId != null }) { Text("Guardar") } },
        dismissButton = { TextButton(onClick = { vm.discardDrafts() }) { Text("Descartar") } },
    )
}

fun categoryOptions(s: UiState, kind: TxKind): List<Pair<String, String>> {
    val byId = s.snap.categories.associateBy { it.id }
    return s.snap.categories
        .filter { (it.id in s.snap.incomeCategoryIds) == (kind == TxKind.INGRESO) }
        .map { c -> c.id to (c.parentId?.let { byId[it]?.name + " › " } ?: "") + c.name }
        .sortedBy { it.second }
}

@Composable
fun KindChip(kind: TxKind, onChange: (TxKind) -> Unit) {
    val (label, color) = when (kind) { TxKind.INGRESO -> "Ingreso" to Pal.ok; TxKind.TRASPASO -> "Traspaso" to Pal.accent2; else -> "Gasto" to Pal.accent }
    Text(label, color = color, modifier = Modifier
        .border(1.dp, color, CircleShape)
        .clickable { onChange(if (kind == TxKind.GASTO) TxKind.INGRESO else TxKind.GASTO) }
        .padding(horizontal = 12.dp, vertical = 6.dp))
}

fun Money.signedFor(kind: TxKind) = (if (kind == TxKind.INGRESO) "+" else if (kind == TxKind.GASTO) "−" else "") + format()

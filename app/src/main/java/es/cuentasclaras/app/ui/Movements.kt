package es.cuentasclaras.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import es.cuentasclaras.app.AppViewModel
import es.cuentasclaras.core.model.EffectiveStatus
import es.cuentasclaras.core.model.TxKind
import java.text.Normalizer

private fun norm(s: String) = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")

@Composable
fun MovementsScreen(vm: AppViewModel, onAdd: () -> Unit, onOpen: (String) -> Unit) {
    val s = vm.state.collectAsState().value ?: return
    var filter by rememberSaveable { mutableStateOf("todos") }
    var query by rememberSaveable { mutableStateOf("") }
    val cats = s.snap.categories.associateBy { it.id }
    val accounts = s.snap.accounts.associateBy { it.id }
    val list = s.snap.transactions
        .filter {
            when (filter) {
                "gastos" -> it.kind == TxKind.GASTO
                "ingresos" -> it.kind == TxKind.INGRESO
                "previstos" -> it.effectiveStatus(s.now) != EffectiveStatus.REALIZADO
                else -> true
            }
        }
        .filter { query.isBlank() || norm(it.concept + " " + (cats[it.categoryId]?.name ?: "") + " " + it.notes).contains(norm(query)) }
        .sortedByDescending { it.dateTime }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            item {
                OutlinedTextField(query, { query = it }, leadingIcon = { Icon(Icons.Filled.Search, null) }, placeholder = { Text("Buscar") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                    listOf("todos" to "Todos", "gastos" to "Gastos", "ingresos" to "Ingresos", "previstos" to "Previstos").forEach { (k, l) ->
                        FilterChip(selected = filter == k, onClick = { filter = k }, label = { Text(l) })
                    }
                }
            }
            if (list.isEmpty()) item { Text("No hay movimientos con este filtro.", color = Pal.muted, modifier = Modifier.padding(16.dp)) }
            var lastDay: java.time.LocalDate? = null
            list.forEach { t ->
                if (t.date != lastDay) { lastDay = t.date; val d = t.date; item("d$d") { Text(d.format(dayFmt), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp)) } }
                item(t.id) {
                    val st = t.effectiveStatus(s.now)
                    Card(Modifier.clickable { onOpen(t.id) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(t.concept.ifBlank { cats[t.categoryId]?.name ?: "Sin concepto" })
                                val acc = if (t.kind == TxKind.TRASPASO) "${accounts[t.accountId]?.name} → ${accounts[t.toAccountId]?.name}" else accounts[t.accountId]?.name ?: ""
                                Text(listOfNotNull(cats[t.categoryId]?.name, acc.ifBlank { null }, t.dateTime.toLocalTime().toString().take(5)).joinToString(" · "), style = MaterialTheme.typography.labelMedium)
                                when (st) {
                                    EffectiveStatus.PENDIENTE -> Text("Pendiente de confirmar", color = Pal.warn, style = MaterialTheme.typography.labelMedium)
                                    EffectiveStatus.PREVISTO -> Text(if (t.estimated) "Previsto (estimado)" else "Previsto", color = Pal.accent2, style = MaterialTheme.typography.labelMedium)
                                    else -> Unit
                                }
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(t.amount.signedFor(t.kind), color = if (t.kind == TxKind.INGRESO) Pal.ok else Pal.text)
                                if (st != EffectiveStatus.REALIZADO) TextButton(onClick = { vm.confirmTx(t.id) }) { Text("Confirmar") }
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.width(1.dp).padding(bottom = 72.dp)) }
        }
        FloatingActionButton(onClick = onAdd, containerColor = Pal.accent, modifier = Modifier.align(Alignment.BottomEnd).padding(18.dp)) { Icon(Icons.Filled.Add, "Añadir movimiento") }
    }
}

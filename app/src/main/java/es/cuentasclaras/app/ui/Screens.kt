package es.cuentasclaras.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import es.cuentasclaras.app.AppViewModel
import es.cuentasclaras.app.data.CategoryEntity
import es.cuentasclaras.app.data.ME
import es.cuentasclaras.app.data.newId
import es.cuentasclaras.core.ledger.Ledger
import es.cuentasclaras.core.model.Account
import es.cuentasclaras.core.model.AccountType
import es.cuentasclaras.core.money.Money
import kotlinx.coroutines.launch

// ---------------- Presupuestos ----------------
@Composable
fun BudgetsScreen(vm: AppViewModel) {
    val s = vm.state.collectAsState().value ?: return
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<Pair<String, String>?>(null) }
    val limits = s.snap.limits.associate { it.categoryId to it.monthlyLimit }
    val tops = s.snap.categories.filter { it.parentId == null && it.id !in s.snap.incomeCategoryIds }
    LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("Presupuestos", style = MaterialTheme.typography.titleLarge) }
        item { Text("Límite mensual por categoría. Las subcategorías cuentan dentro de su categoría.", color = Pal.muted, style = MaterialTheme.typography.bodyMedium) }
        if (s.toPayday.categories.isNotEmpty()) item { CategoriesCard(s) }
        items(tops, key = { it.id }) { c ->
            Card(Modifier.clickable { editing = c.id to (limits[c.id]?.format()?.replace(" €", "") ?: "") }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(c.name, Modifier.weight(1f))
                    Text(limits[c.id]?.let { "${it.format()} al mes" } ?: "Sin límite", color = if (limits[c.id] == null) Pal.muted else Pal.text)
                }
            }
        }
    }
    editing?.let { (id, initial) ->
        var text by remember(id) { mutableStateOf(initial) }
        val cat = s.snap.categories.first { it.id == id }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("Límite de ${cat.name}") },
            text = { OutlinedTextField(text, { text = it }, label = { Text("€ al mes (vacío = sin límite)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)) },
            confirmButton = {
                TextButton(onClick = {
                    val m = Money.parse(text)
                    scope.launch { vm.repo.setLimit(CategoryEntity(cat.id, cat.name, cat.parentId, m?.cents?.takeIf { it > 0 })) }
                    editing = null
                }) { Text("Guardar") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancelar") } },
        )
    }
}

// ---------------- Cuentas ----------------
@Composable
fun AccountsScreen(vm: AppViewModel) {
    val s = vm.state.collectAsState().value ?: return
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<Account?>(null) }
    val balances = Ledger.balances(s.snap.accounts, s.snap.transactions)
    LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Cuentas", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                TextButton(onClick = { editing = Account(newId(), ME, "", AccountType.CORRIENTE) }) { Text("Añadir") }
            }
        }
        item {
            Card {
                Label("Saldo total"); Text(s.toPayday.totalBalance.format(), style = MaterialTheme.typography.titleLarge)
                Label("Saldo líquido (utilizable)"); Text(s.toPayday.liquidBalance.format(), style = MaterialTheme.typography.titleMedium)
            }
        }
        items(s.snap.accounts, key = { it.id }) { a ->
            Card(Modifier.clickable { editing = a }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(a.name)
                        Text(typeName(a.type) + if (a.liquid) "" else " · no se usa para gastar", style = MaterialTheme.typography.labelMedium)
                    }
                    Text((balances[a.id] ?: Money.ZERO).format(), color = if ((balances[a.id] ?: Money.ZERO).isNegative) Pal.bad else Pal.text)
                }
            }
        }
        item { Text("El saldo se calcula: saldo inicial + movimientos realizados. Los previstos no cuentan hasta que se confirman.", color = Pal.muted, style = MaterialTheme.typography.labelMedium) }
    }
    editing?.let { a ->
        var name by remember(a.id) { mutableStateOf(a.name) }
        var type by remember(a.id) { mutableStateOf(a.type) }
        var opening by remember(a.id) { mutableStateOf(a.openingBalance.format().replace(" €", "")) }
        var liquid by remember(a.id) { mutableStateOf(a.liquid) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text(if (a.name.isEmpty()) "Nueva cuenta" else "Editar cuenta") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(name, { name = it }, label = { Text("Nombre") }, singleLine = true)
                    Picker("Tipo", AccountType.entries.map { it.name to typeName(it) }, type.name) {
                        type = AccountType.valueOf(it); liquid = type != AccountType.AHORRO && type != AccountType.INVERSION
                    }
                    OutlinedTextField(opening, { opening = it }, label = { Text("Saldo inicial (€)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                    Row(verticalAlignment = Alignment.CenterVertically) { Text("Dinero para gastar", Modifier.weight(1f)); Switch(liquid, { liquid = it }) }
                }
            },
            confirmButton = {
                TextButton(enabled = name.isNotBlank() && Money.parse(opening) != null, onClick = {
                    scope.launch { vm.repo.saveAccount(a.copy(name = name.trim(), type = type, openingBalance = Money.parse(opening)!!, liquid = liquid)) }
                    editing = null
                }) { Text("Guardar") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancelar") } },
        )
    }
}

fun typeName(t: AccountType) = when (t) {
    AccountType.CORRIENTE -> "Cuenta corriente"; AccountType.AHORRO -> "Ahorro"; AccountType.EFECTIVO -> "Efectivo"
    AccountType.TARJETA -> "Tarjeta"; AccountType.INVERSION -> "Inversión"
}

// ---------------- Ajustes ----------------
@Composable
fun SettingsScreen(vm: AppViewModel) {
    val s = vm.state.collectAsState().value ?: return
    val st = s.snap.settings
    var buffer by remember(st.buffer) { mutableStateOf(st.buffer.format().replace(" €", "")) }
    var savings by remember(st.monthlySavings) { mutableStateOf(st.monthlySavings.format().replace(" €", "")) }
    var sarcasm by remember(st.sarcasm) { mutableStateOf(st.sarcasm.toFloat()) }
    LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("Ajustes", style = MaterialTheme.typography.titleLarge) }
        item {
            Card {
                Text("Planificación", style = MaterialTheme.typography.titleMedium)
                DateButton("Próximo cobro", st.nextPayday) { vm.put("nextPayday", it.toString()) }
                OutlinedTextField(buffer, { buffer = it }, label = { Text("Colchón que nunca se gasta (€)") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 6.dp), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(savings, { savings = it }, label = { Text("Ahorro mensual (€)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                Button(onClick = {
                    Money.parse(buffer)?.let { vm.put("buffer", it.cents.toString()) }
                    Money.parse(savings)?.let { vm.put("monthlySavings", it.cents.toString()) }
                }, modifier = Modifier.padding(top = 8.dp)) { Text("Guardar importes") }
            }
        }
        item {
            Card {
                Text("Asistente", style = MaterialTheme.typography.titleMedium)
                Text("Sarcasmo: " + listOf("Neutra", "Irónica", "Sarcástica", "Despiadada")[sarcasm.toInt()], modifier = Modifier.padding(top = 6.dp))
                Slider(sarcasm, { sarcasm = it }, valueRange = 0f..3f, steps = 2, onValueChangeFinished = { vm.put("sarcasm", sarcasm.toInt().toString()) })
                Row(verticalAlignment = Alignment.CenterVertically) { Text("Comentarios espontáneos", Modifier.weight(1f)); Switch(st.remarks, { vm.put("remarks", it.toString()) }) }
                Row(verticalAlignment = Alignment.CenterVertically) { Text("Reducir movimiento", Modifier.weight(1f)); Switch(st.reduceMotion, { vm.put("reduceMotion", it.toString()) }) }
                Text("Calidad 3D", modifier = Modifier.padding(top = 6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("alta" to "Alta", "baja" to "Ahorro de batería").forEach { (k, l) -> FilterChip(selected = st.quality == k, onClick = { vm.put("quality", k) }, label = { Text(l) }) }
                }
                Text("Los cambios del asistente se aplican al volver a Inicio.", color = Pal.muted, style = MaterialTheme.typography.labelMedium)
            }
        }
        item {
            Card {
                Text("Datos", style = MaterialTheme.typography.titleMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Modo demostración")
                        Text("Datos de ejemplo en un archivo aparte. Tus datos reales no se tocan.", color = Pal.muted, style = MaterialTheme.typography.labelMedium)
                    }
                    Switch(s.demo, { vm.setDemo(it) })
                }
            }
        }
        item { Text("Cuentas Claras · versión de prueba (fase 2). Todo funciona en el móvil, sin servidor ni coste.", color = Pal.muted, style = MaterialTheme.typography.labelMedium) }
    }
}

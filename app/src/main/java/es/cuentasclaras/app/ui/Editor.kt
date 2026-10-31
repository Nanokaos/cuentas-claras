package es.cuentasclaras.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import es.cuentasclaras.app.AppViewModel
import es.cuentasclaras.app.data.ME
import es.cuentasclaras.app.data.newId
import es.cuentasclaras.core.dedup.Duplicates
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.money.Money
import es.cuentasclaras.core.recurrence.Frequency
import java.time.LocalDateTime

@Composable
fun EditorScreen(vm: AppViewModel, id: String?, onDone: () -> Unit) {
    val s = vm.state.collectAsState().value ?: return
    val existing = remember(id) { id?.let { i -> s.snap.transactions.firstOrNull { it.id == i } } }
    val newTxId = remember { newId() }
    var kind by remember { mutableStateOf(existing?.kind ?: TxKind.GASTO) }
    var amount by remember { mutableStateOf(existing?.amount?.format()?.replace(" €", "") ?: "") }
    var concept by remember { mutableStateOf(existing?.concept ?: "") }
    var account by remember { mutableStateOf(existing?.accountId ?: s.snap.accounts.firstOrNull { it.liquid }?.id) }
    var toAccount by remember { mutableStateOf(existing?.toAccountId) }
    var category by remember { mutableStateOf(existing?.categoryId) }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    var dateTime by remember { mutableStateOf(existing?.dateTime ?: LocalDateTime.now().withSecond(0).withNano(0)) }
    var repeat by remember { mutableStateOf<Frequency?>(null) }
    var estimated by remember { mutableStateOf(existing?.estimated ?: false) }
    var askDelete by remember { mutableStateOf(false) }

    val parsed = Money.parse(amount)?.takeIf { it.isPositive }
    val future = dateTime.isAfter(LocalDateTime.now().plusMinutes(1))
    val valid = parsed != null && account != null && (kind != TxKind.TRASPASO || (toAccount != null && toAccount != account))
    fun build() = Transaction(
        id = existing?.id ?: newTxId, ownerId = ME, kind = kind, amount = parsed!!, dateTime = dateTime,
        status = if (existing?.status == TxStatus.REALIZADO && !future) TxStatus.REALIZADO else if (future) TxStatus.PREVISTO else TxStatus.REALIZADO,
        planned = existing?.planned ?: future, accountId = account, toAccountId = if (kind == TxKind.TRASPASO) toAccount else null,
        concept = concept.trim(), categoryId = if (kind == TxKind.TRASPASO) null else category, notes = notes.trim(),
        estimated = kind == TxKind.INGRESO && estimated && future, recurrenceId = existing?.recurrenceId,
    )
    val dup = if (valid && existing == null) Duplicates.suspects(build(), s.snap.transactions).firstOrNull() else null

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if (existing == null) "Nuevo movimiento" else "Editar movimiento", style = MaterialTheme.typography.titleLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(TxKind.GASTO to "Gasto", TxKind.INGRESO to "Ingreso", TxKind.TRASPASO to "Traspaso").forEach { (k, l) ->
                FilterChip(selected = kind == k, onClick = { kind = k; category = null }, label = { Text(l) })
            }
        }
        OutlinedTextField(amount, { amount = it }, label = { Text("Importe (€)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), isError = amount.isNotBlank() && parsed == null)
        OutlinedTextField(concept, { concept = it }, label = { Text("Concepto") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Picker(if (kind == TxKind.TRASPASO) "Desde la cuenta" else "Cuenta", s.snap.accounts.map { it.id to it.name }, account) { account = it }
        if (kind == TxKind.TRASPASO) Picker("Hacia la cuenta", s.snap.accounts.filter { it.id != account }.map { it.id to it.name }, toAccount) { toAccount = it }
        else Picker("Categoría", categoryOptions(s, kind), category) { category = it }
        DateTimeRow(dateTime) { dateTime = it }
        if (future) Text("Fecha futura: se guarda como previsto y no se descuenta hasta que lo confirmes.", color = Pal.accent2, style = MaterialTheme.typography.labelMedium)
        if (future && kind == TxKind.INGRESO) Row { FilterChip(selected = estimated, onClick = { estimated = !estimated }, label = { Text("Importe aproximado") }) }
        if (existing == null) {
            Text("Repetir", style = MaterialTheme.typography.labelMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(null to "No", Frequency.SEMANAL to "Semanal", Frequency.MENSUAL to "Mensual", Frequency.ANUAL to "Anual").forEach { (f, l) ->
                    FilterChip(selected = repeat == f, onClick = { repeat = f }, label = { Text(l) })
                }
            }
        }
        OutlinedTextField(notes, { notes = it }, label = { Text("Notas") }, modifier = Modifier.fillMaxWidth())
        dup?.let { Text("Ojo: ya tienes «${it.concept}» con el mismo importe y fecha parecida.", color = Pal.warn, style = MaterialTheme.typography.labelMedium) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            Button(onClick = { vm.saveTx(build(), repeat); onDone() }, enabled = valid) { Text("Guardar") }
            OutlinedButton(onClick = onDone) { Text("Cancelar") }
            if (existing != null) TextButton(onClick = { askDelete = true }) { Text("Eliminar", color = Pal.bad) }
        }
    }
    if (askDelete) AlertDialog(
        onDismissRequest = { askDelete = false },
        title = { Text("¿Eliminar este movimiento?") },
        text = { Text("Se quitará de tus cuentas y presupuestos.") },
        confirmButton = { TextButton(onClick = { vm.deleteTx(existing!!.id); askDelete = false; onDone() }) { Text("Eliminar", color = Pal.bad) } },
        dismissButton = { TextButton(onClick = { askDelete = false }) { Text("Cancelar") } },
    )
}

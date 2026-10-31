package es.cuentasclaras.app.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Picker(label: String, options: List<Pair<String, String>>, selected: String?, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = Modifier.padding(top = 4.dp)) {
        OutlinedTextField(
            value = options.firstOrNull { it.first == selected }?.second ?: "Elegir",
            onValueChange = {}, readOnly = true, label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { onSelect(id); open = false }) }
        }
    }
}

private val dFmt = DateTimeFormatter.ofPattern("d MMM yyyy", ES)
private val tFmt = DateTimeFormatter.ofPattern("HH:mm")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateTimeRow(value: LocalDateTime, onChange: (LocalDateTime) -> Unit) {
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        OutlinedButton(onClick = { pickDate = true }, modifier = Modifier.weight(1f)) { Text(value.format(dFmt)) }
        Spacer(Modifier.width(8.dp))
        OutlinedButton(onClick = { pickTime = true }) { Text(value.format(tFmt)) }
    }
    if (pickDate) {
        val st = rememberDatePickerState(initialSelectedDateMillis = value.toLocalDate().atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { pickDate = false },
            confirmButton = {
                TextButton(onClick = {
                    st.selectedDateMillis?.let { ms -> onChange(LocalDateTime.of(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate(), value.toLocalTime())) }
                    pickDate = false
                }) { Text("Aceptar") }
            },
            dismissButton = { TextButton(onClick = { pickDate = false }) { Text("Cancelar") } },
        ) { DatePicker(st) }
    }
    if (pickTime) {
        val st = rememberTimePickerState(value.hour, value.minute, is24Hour = true)
        AlertDialog(
            onDismissRequest = { pickTime = false },
            confirmButton = { TextButton(onClick = { onChange(value.withHour(st.hour).withMinute(st.minute)); pickTime = false }) { Text("Aceptar") } },
            dismissButton = { TextButton(onClick = { pickTime = false }) { Text("Cancelar") } },
            text = { TimePicker(st) },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateButton(label: String, value: LocalDate?, onChange: (LocalDate) -> Unit) {
    var open by remember { mutableStateOf(false) }
    OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) { Text(label + ": " + (value?.format(dFmt) ?: "sin indicar")) }
    if (open) {
        val st = rememberDatePickerState(initialSelectedDateMillis = (value ?: LocalDate.now()).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = { TextButton(onClick = { st.selectedDateMillis?.let { onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }; open = false }) { Text("Aceptar") } },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancelar") } },
        ) { DatePicker(st) }
    }
}

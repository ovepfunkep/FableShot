package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DistanceChoice(value: String, onChange: (String) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    var draft by rememberSaveable { mutableStateOf(value) }
    OutlinedButton({draft=value;open=true},Modifier.fillMaxWidth().testTag("distance-choice")) {
        Text(if(value.isBlank()) "Выбрать дистанцию" else "Дистанция · $value м")
    }
    if(open) ModalBottomSheet(onDismissRequest={open=false}) {
        val valid=draft.replace(',','.').toDoubleOrNull()?.let { it.isFinite() && it>0 } == true
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text("Дистанция",style=MaterialTheme.typography.titleLarge)
            OutlinedTextField(draft,{draft=it.take(10)},Modifier.fillMaxWidth().testTag("distance-field"),
                label={Text("Метры")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf(5,10,15,18,20,25,30,40,50,60,70,90).forEach { n ->
                    FilterChip(draft==n.toString(),{draft=n.toString()},{Text("$n м")})
                }
            }
            FablePrimaryButton("Применить",{onChange(draft);open=false},Modifier.fillMaxWidth().testTag("distance-apply"),enabled=valid)
            TextButton({open=false}) { Text("Отмена") }
        }
    }
}

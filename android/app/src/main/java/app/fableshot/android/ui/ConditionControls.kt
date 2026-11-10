package app.fableshot.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

@Composable
internal fun ConditionRow(
    title: String,
    value: String,
    icon: Glyph,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    Surface(
        onClick = onClick, enabled = enabled, modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            Modifier.padding(start = 14.dp, end = 6.dp).heightIn(min = 64.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            FableIcon(icon, tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f).padding(vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(value, style = MaterialTheme.typography.bodyMedium)
            }
            actions?.invoke(this)
            FableIcon(Glyph.Next, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(6.dp))
        }
    }
}

@Composable
internal fun ConditionNumber(
    title: String,
    unit: String,
    value: String,
    choices: List<Int>,
    tag: String,
    enabled: Boolean,
    invalid: Boolean,
    modifier: Modifier = Modifier,
    onChange: (String) -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            value, onChange, Modifier.fillMaxWidth().testTag("$tag-field"),
            label = { Text(title) }, suffix = { Text(unit) }, shape = RoundedCornerShape(16.dp),
            enabled = enabled, isError = invalid, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            choices.forEach { number ->
                val selected=value.replace(',', '.').toDoubleOrNull()==number.toDouble()
                Surface(
                    onClick={onChange(number.toString())},enabled=enabled,
                    modifier=Modifier.weight(1f).heightIn(min=48.dp).testTag("$tag-$number").semantics { this.selected=selected },
                    shape=RoundedCornerShape(12.dp),border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant),
                    color=if(selected)MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                    contentColor=if(selected)MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                ) {
                    Box(Modifier.padding(horizontal=4.dp,vertical=6.dp),contentAlignment=Alignment.Center) {
                        Text(number.toString(),style=MaterialTheme.typography.labelLarge,maxLines=1,softWrap=false)
                    }
                }
            }
        }
    }
}

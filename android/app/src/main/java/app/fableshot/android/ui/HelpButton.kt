package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Contextual reference; opening it never replaces the underlying screen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpButton(title: String, body: String, term: String? = null, iconOnly: Boolean = false) {
    var open by rememberSaveable(title) { mutableStateOf(false) }
    if(term!=null) TermHelp(term,body)
    else if (iconOnly) IconButton({ open = true }) { FableIcon(Glyph.Help, description = title) }
    else TextButton(onClick = { open = true }, modifier = Modifier.heightIn(min=48.dp)) {
        Text(title)
        Spacer(Modifier.width(8.dp))
        FableIcon(Glyph.Help, description = title)
    }
    if (open) {
        ModalBottomSheet(onDismissRequest = { open = false }) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row {
                    Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                }
                Text(body, style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

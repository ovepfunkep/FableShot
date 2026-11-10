package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.journal.PersonalRecordEvent

internal fun personalRecordValue(value: Int): String = value.toString()

private fun recordComparison(record: PersonalRecordEvent): String =
    "Было ${personalRecordValue(record.previousValue)} → Стало ${personalRecordValue(record.value)}"

@Composable
internal fun PersonalRecordReportCard(
    records: List<PersonalRecordEvent>,
    availableSessionIds: Set<String>? = null,
    onSession: ((String) -> Unit)? = null,
) {
    if (records.isEmpty()) return
    var openedId by rememberSaveable { mutableStateOf<String?>(null) }
    FableCard(Modifier.testTag("personal-record-report")) {
        BlockHeading("Рекорды на момент завершения", Glyph.Trophy)
        records.forEach { record ->
            Row(Modifier.fillMaxWidth().clickable { openedId = record.id }
                .heightIn(min = 48.dp).padding(vertical = 6.dp).testTag("personal-record-${record.id}"),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(record.label, style = MaterialTheme.typography.titleSmall)
                    Text(recordComparison(record), style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                FableIcon(Glyph.Next, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    records.firstOrNull { it.id == openedId }?.let { record ->
        PersonalRecordComparisonSheet(record, { openedId = null }, availableSessionIds, onSession)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PersonalRecordComparisonSheet(
    record: PersonalRecordEvent,
    onDismiss: () -> Unit,
    availableSessionIds: Set<String>? = null,
    onSession: ((String) -> Unit)? = null,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp)
            .testTag("personal-record-details"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Личный рекорд", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            }
            Text(record.label, style = MaterialTheme.typography.titleMedium)
            Text(recordComparison(record), Modifier.testTag("personal-record-comparison"),
                style = MaterialTheme.typography.bodyLarge)
            Text("Сравнение на момент завершения тренировки", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            val previousId = record.previousSessionId.takeIf {
                it.isNotBlank() && it != record.sessionId && (availableSessionIds == null || it in availableSessionIds)
            }
            if (previousId != null && onSession != null) {
                TextButton({ onDismiss(); onSession(previousId) }, Modifier.testTag("personal-record-previous-session")) {
                    Text("Открыть прежнюю тренировку")
                }
            }
        }
    }
}

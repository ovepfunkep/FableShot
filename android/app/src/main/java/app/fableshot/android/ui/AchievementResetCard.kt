package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.fableshot.android.backup.DiaryManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun AchievementResetCard(diaries: DiaryManager, enabled: Boolean, onBusy: (Boolean) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    var confirmation by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    FableCard(Modifier.testTag("achievement-reset-card")) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FableIcon(Glyph.Trophy, tint = MaterialTheme.colorScheme.primary)
            Text("Достижения с чистого листа", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        }
        Text("Обнули полученные награды и прогресс их получения.", style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(
            onClick = { confirmation = true },
            enabled = enabled && !busy,
            modifier = Modifier.fillMaxWidth().testTag("achievement-reset"),
        ) { Text("Сбросить только достижения") }
        if (busy) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CircularProgressIndicator(Modifier.size(24.dp))
            Text("Сохраняем копию и сбрасываем достижения…", Modifier.weight(1f))
        }
        message?.let {
            Text(it, Modifier.testTag("achievement-reset-message").semantics { liveRegion = LiveRegionMode.Polite },
                color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium)
        }
    }
    if (confirmation) AlertDialog(
        onDismissRequest = { confirmation = false },
        title = { Text("Сбросить достижения?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Тренировки, статистика, рекорды, снаряжение и настройки сохранятся.")
                Text("Достижения будут набираться заново в новых тренировках и действиях. Старые результаты повторно не засчитаются.")
                Text("Сначала сохраним проверенную резервную копию в разделе «Архив».")
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    confirmation = false
                    busy = true
                    onBusy(true)
                    message = null
                    failed = false
                    scope.launch {
                        try {
                            diaries.resetAchievements()
                            message = "Достижения сброшены. Резервная копия сохранена в «Архиве»."
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Exception) {
                            android.util.Log.e("FableAchievements", "Achievement reset failed", error)
                            failed = true
                            message = "Не удалось сбросить достижения. Попробуй ещё раз."
                        } finally {
                            busy = false
                            onBusy(false)
                        }
                    }
                },
                enabled = enabled && !busy,
                modifier = Modifier.testTag("achievement-reset-confirm"),
            ) { Text("Сохранить копию и сбросить") }
        },
        dismissButton = {
            TextButton({ confirmation = false }, Modifier.testTag("achievement-reset-dismiss")) { Text("Отмена") }
        },
    )
}

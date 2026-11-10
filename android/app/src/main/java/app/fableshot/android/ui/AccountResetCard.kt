package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.fableshot.android.backup.DiaryManager
import kotlinx.coroutines.*

@Composable
internal fun AccountResetCard(diaries: DiaryManager, enabled: Boolean, onBusy: (Boolean) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    var counts by remember { mutableStateOf<Pair<Long, Long>?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmation by rememberSaveable { mutableStateOf(false) }
    var acknowledged by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var job by remember { mutableStateOf<Job?>(null) }
    LaunchedEffect(diaries) {
        try {
            counts = withContext(Dispatchers.IO) {
                val db = diaries.current.journal.openHelper.writableDatabase
                fun count(table: String) = db.query("SELECT COUNT(*) FROM `$table`").use { it.moveToFirst(); it.getLong(0) }
                count("sessions") to count("shots")
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            android.util.Log.e("FableRecovery", "Current diary counts could not be read", error)
            message = "Не удалось прочитать дневник. Сброс недоступен."
        }
    }
    FableCard(Modifier.testTag("account-reset-card")) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            FableIcon(Glyph.Trash, tint = MaterialTheme.colorScheme.error)
            Text("Сброс аккаунта полностью", style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.error)
        }
        Text("Тренировки, корзина, статистика, достижения, снаряжение и настройки начнутся с нуля.",
            style = MaterialTheme.typography.bodyMedium)
        Text("Сначала сохраним и проверим полный архив на этом устройстве. Он останется в разделе «Архив», но может исчезнуть при удалении приложения.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(
            onClick = { acknowledged = false; confirmation = true },
            enabled = enabled && !busy && counts != null,
            modifier = Modifier.fillMaxWidth().testTag("account-reset"),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) { Text("Сбросить всё") }
        if (busy) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(Modifier.size(24.dp))
                Text("Сохраняем копию перед сбросом…")
            }
            TextButton({ job?.cancel() }, modifier = Modifier.testTag("account-reset-cancel")) { Text("Отмена") }
        }
        message?.let {
            Text(it, modifier = Modifier.testTag("account-reset-message").semantics { liveRegion = LiveRegionMode.Polite },
                color = MaterialTheme.colorScheme.error)
        }
    }
    if (confirmation) AlertDialog(
        onDismissRequest = { confirmation = false },
        title = { Text("Начать с чистого листа?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                counts?.let { Text("В текущем дневнике: ${it.first} тренировок и ${it.second} стрел, включая корзину.") }
                Text("Будут сброшены также заметки, техника, разряды, профиль и все настройки.")
                Text("Это полный сброс, а не перенос в корзину. Проверенная копия останется в «Архиве».",
                    color = MaterialTheme.colorScheme.error)
                Row {
                    Checkbox(acknowledged, { acknowledged = it }, Modifier.testTag("account-reset-ack"))
                    Text("Понимаю и хочу начать с нуля", Modifier.padding(top = 12.dp))
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    confirmation = false
                    busy = true
                    onBusy(true)
                    message = null
                    val originalId = diaries.current.id
                    job = scope.launch {
                        try {
                            diaries.resetAccount()
                        } catch (error: CancellationException) {
                            message = if (diaries.current.id == originalId) "Сброс отменён. Текущий дневник сохранён."
                                else "Сброс завершён. Копия сохранена в «Архиве»."
                            throw error
                        } catch (error: Exception) {
                            android.util.Log.e("FableRecovery", "Account reset failed", error)
                            message = if (diaries.current.id == originalId)
                                "Не удалось сохранить проверенную копию или завершить сброс. Текущий дневник сохранён. Попробуй ещё раз."
                                else "Дневник сброшен, но завершение операции сообщило об ошибке. Проверенная копия сохранена в «Архиве»."
                        } finally {
                            busy = false
                            onBusy(false)
                        }
                    }
                },
                enabled = acknowledged && enabled && !busy,
                modifier = Modifier.testTag("account-reset-confirm"),
            ) { Text("Сохранить копию и сбросить", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton({ confirmation = false }) { Text("Отмена") } },
    )
}

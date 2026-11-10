package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.fableshot.android.PracticeTimer
import app.fableshot.android.TimerPhase
import app.fableshot.android.domain.CountdownStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private fun timerClock(seconds: Int) = "%02d:%02d".format(seconds / 60, seconds % 60)

@Composable
fun PracticeTimerBadge(timer: PracticeTimer, onOpen: () -> Unit) {
    val state by timer.state.collectAsStateWithLifecycle()
    val countdown = state.countdown
    val idle = countdown.status == CountdownStatus.Idle
    Surface(onClick = onOpen, shape = CircleShape, color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.height(40.dp).widthIn(max = 108.dp).testTag("practice-timer-open")
            .semantics { contentDescription = "Таймер: ${state.phase.title}, ${timerClock(countdown.displaySeconds)}" }) {
        Row(Modifier.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FableIcon(Glyph.Timer, tint = if (countdown.status == CountdownStatus.Running) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            if (!idle) FittedLine(timerClock(countdown.displaySeconds), style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PracticeTimerWindow(
    timer: PracticeTimer,
    seriesSeconds: Int,
    restSeconds: Int,
    onSave: suspend (Int, Int) -> Unit,
    onClose: () -> Unit,
) {
    val state by timer.state.collectAsStateWithLifecycle()
    val countdown = state.countdown
    val ongoing = countdown.status == CountdownStatus.Running || countdown.status == CountdownStatus.Paused
    var series by rememberSaveable(seriesSeconds) { mutableStateOf(seriesSeconds.toString()) }
    var rest by rememberSaveable(restSeconds) { mutableStateOf(restSeconds.toString()) }
    var nextPhase by rememberSaveable { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var saveError by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val validSeries = series.toIntOrNull()?.takeIf { it in 1..3600 }
    val validRest = rest.toIntOrNull()?.takeIf { it in 1..3600 }
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(20.dp)
            .testTag("practice-timer-window"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Таймер", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                IconButton(onClose, Modifier.testTag("practice-timer-close")) { FableIcon(Glyph.Close, description = "Закрыть таймер") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TimerPhase.entries.forEach { phase ->
                    FilterChip(selected = phase == state.phase, enabled = !saving,
                        onClick = { if (phase != state.phase) { if (ongoing) nextPhase = phase.name else timer.select(phase) } },
                        label = { Text(phase.title) }, modifier = Modifier.testTag("timer-phase-${phase.name}"))
                }
            }
            SlidingValue(timerClock(countdown.displaySeconds), Modifier.fillMaxWidth().testTag("timer-remaining"),
                style = MaterialTheme.typography.displayLarge, alignment = Alignment.Center, byCharacter = true)
            Text(when (countdown.status) {
                CountdownStatus.Idle -> "Готов к запуску"
                CountdownStatus.Running -> "Идёт отсчёт · ${state.phase.title.lowercase()}"
                CountdownStatus.Paused -> if (countdown.backgroundPause) "Пауза после сворачивания" else "На паузе"
                CountdownStatus.Finished -> "Время вышло"
            }, Modifier.align(Alignment.CenterHorizontally).testTag("timer-status"), style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FablePrimaryButton(when (countdown.status) {
                    CountdownStatus.Running -> "Пауза"
                    CountdownStatus.Paused -> "Продолжить"
                    CountdownStatus.Finished -> "Ещё раз"
                    else -> "Запустить"
                }, { if (countdown.status == CountdownStatus.Running) timer.pause() else timer.start() },
                    Modifier.weight(1f).testTag("timer-toggle"), enabled = !saving)
                OutlinedButton({timer.reset()}, Modifier.heightIn(min = 56.dp).testTag("timer-reset"), enabled = !saving) { Text("Сброс") }
            }
            Text("Отсчёт в фоне продолжается. Серии переключаешь сам.", style = MaterialTheme.typography.bodySmall)
            HorizontalDivider()
            Text("Длительности", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(series, {series = it.take(4); saveError = false}, Modifier.weight(1f).testTag("timer-series-seconds"),
                    label = {Text("Серия, сек")}, singleLine = true, enabled = !ongoing && !saving,
                    isError = validSeries == null, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                OutlinedTextField(rest, {rest = it.take(4); saveError = false}, Modifier.weight(1f).testTag("timer-rest-seconds"),
                    label = {Text("Отдых, сек")}, singleLine = true, enabled = !ongoing && !saving,
                    isError = validRest == null, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            }
            if (validSeries == null || validRest == null) Text("От 1 до 3600 секунд", color = MaterialTheme.colorScheme.error)
            if (saveError) Text("Не удалось сохранить длительности. Попробуй ещё раз.", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = {scope.launch {
                saving = true
                saveError = false
                try {
                    onSave(requireNotNull(validSeries), requireNotNull(validRest))
                    timer.configure(validSeries, validRest)
                    timer.reset()
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    saveError = true
                } finally {saving = false}
            }}, enabled = !ongoing && !saving && validSeries != null && validRest != null &&
                (validSeries != seriesSeconds || validRest != restSeconds), modifier = Modifier.testTag("timer-save-durations")) {
                Text(if (saving) "Сохранение…" else "Сохранить длительности")
            }
        }
    }
    nextPhase?.let { value ->
        AlertDialog(onDismissRequest = {nextPhase = null}, title = {Text("Сменить режим?")},
            text = {Text("Текущий отсчёт будет сброшен. Новый запускается вручную.")},
            confirmButton = {TextButton({timer.select(TimerPhase.valueOf(value)); nextPhase = null}, Modifier.testTag("timer-confirm-phase")) {Text("Сменить")}},
            dismissButton = {TextButton({nextPhase = null}) {Text("Отмена")}})
    }
}

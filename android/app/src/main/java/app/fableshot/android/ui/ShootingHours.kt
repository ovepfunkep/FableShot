package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.data.MAX_SHOOTING_BASE_MINUTES
import app.fableshot.android.data.journal.TrackedTrainingTime
import kotlinx.coroutines.delay

@Composable
internal fun TrainingTimeLabel(time: TrackedTrainingTime?) {
    val elapsedMs by produceState(time?.elapsedMs(System.currentTimeMillis()), time) {
        value = time?.elapsedMs(System.currentTimeMillis())
        if (time?.activeSinceMs != null) {
            while (true) {
                delay(1_000)
                value = time.elapsedMs(System.currentTimeMillis())
            }
        }
    }
    val elapsed = elapsedMs
    val label = if (time?.partial == true) "Учтённое время тренировки" else "Время тренировки"
    val value = when {
        elapsed == null -> "нет данных"
        elapsed < 60_000 -> "${elapsed / 1_000} сек"
        else -> formatMinutes(elapsed / 60_000)
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FableIcon(Glyph.Timer, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, Modifier.testTag("report-training-time").semantics { contentDescription = "$label · $value" },
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun ShootingHoursCard(baseMinutes: Long, recordedMs: Long?, modifier: Modifier = Modifier,
    onSaveMinutes: (Long) -> Unit) {
    var editing by rememberSaveable { mutableStateOf(false) }
    var hours by rememberSaveable(baseMinutes) { mutableStateOf((baseMinutes / 60).toString()) }
    var minutes by rememberSaveable(baseMinutes) { mutableStateOf((baseMinutes % 60).toString()) }
    val recordedMinutes = recordedMs?.div(60_000)
    val recorded = recordedMs?.let {
        if (it in 1 until 60_000L) "меньше 1 мин" else formatMinutes(it / 60_000)
    } ?: "нет данных"
    val total = recordedMinutes?.let { formatMinutes(baseMinutes + it) } ?: "—"
    MetricTile(total, "Часы стрельбы", modifier.testTag("profile-shooting-hours"), Glyph.Timer,
        valueModifier = Modifier.testTag("shooting-hours-total").semantics {
            contentDescription = "Всего · $total. База вручную · ${formatMinutes(baseMinutes)}. Учтено в приложении · $recorded"
        }, action = {
            IconButton(onClick = {
                hours = (baseMinutes / 60).toString()
                minutes = (baseMinutes % 60).toString()
                editing = true
            }, modifier = Modifier.testTag("shooting-hours-edit")) {
                FableIcon(Glyph.Edit, description = "Изменить базу часов стрельбы")
            }
        })
    if (editing) {
        val draftHours = hours.ifEmpty { "0" }.toLongOrNull()
        val draftMinutes = minutes.ifEmpty { "0" }.toLongOrNull()
        val next = if (draftHours != null && draftMinutes != null &&
            draftHours in 0..MAX_SHOOTING_BASE_MINUTES / 60 && draftMinutes in 0..59
        ) draftHours * 60 + draftMinutes else null
        AlertDialog(
            onDismissRequest = { editing = false },
            title = { Text("База часов стрельбы") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("База вручную · ${formatMinutes(baseMinutes)}", Modifier.testTag("shooting-hours-base"),
                        style = MaterialTheme.typography.bodyMedium)
                    Text("Учтено в приложении · $recorded", Modifier.testTag("shooting-hours-recorded"),
                        style = MaterialTheme.typography.bodyMedium)
                    Text("Введи время, которое приложение ещё не учло. Эта база прибавляется к времени из дневника.")
                    OutlinedTextField(hours, { hours = it.filter(Char::isDigit).take(6) },
                        Modifier.fillMaxWidth().testTag("shooting-hours-base-hours"),
                        label = { Text("Часы") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(2) },
                        Modifier.fillMaxWidth().testTag("shooting-hours-base-minutes"),
                        label = { Text("Минуты (0–59)") }, singleLine = true,
                        isError = draftMinutes == null || draftMinutes !in 0..59,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
            },
            confirmButton = {
                TextButton({ next?.let(onSaveMinutes); editing = false }, enabled = next != null && next != baseMinutes,
                    modifier = Modifier.testTag("shooting-hours-save")) { Text(stringResource(R.string.save)) }
            },
            dismissButton = { TextButton({ editing = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

private fun formatMinutes(minutes: Long): String = when {
    minutes < 60 -> "$minutes мин"
    minutes % 60 == 0L -> "${minutes / 60} ч"
    else -> "${minutes / 60} ч ${minutes % 60} мин"
}

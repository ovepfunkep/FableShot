package app.fableshot.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.journal.personalSeriesRecords
import app.fableshot.android.data.journal.personalVolumeRecord

@Composable
fun PersonalRecordsScreen(sessions: List<SessionSummary>, onSession: (SessionSummary) -> Unit, onRanks: () -> Unit) {
    val records = remember(sessions) {personalSeriesRecords(sessions)}
    val volume = remember(sessions) {personalVolumeRecord(sessions)}
    var showVolume by rememberSaveable {mutableStateOf(false)}
    var search by rememberSaveable {mutableStateOf("")}
    val shown = remember(records, search) {
        records.filter {record ->
            listOf(number(record.conditions.distanceMeters), number(record.conditions.diameterMm / 10.0),
                record.conditions.arrows.toString(), record.targetTitle, record.equipmentTitle).joinToString(" ").contains(search.trim(), ignoreCase = true)
        }
    }
    LazyColumn(Modifier.fillMaxSize().testTag("personal-records-screen"), contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {FablePrimaryButton("Лучшие по нормативам", onRanks, Modifier.fillMaxWidth().testTag("records-ranks"), icon = Glyph.Podium)}
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilterChip(!showVolume, {showVolume=false}, label={Text("Серии")}, modifier=Modifier.testTag("records-series"))
                FilterChip(showVolume, {showVolume=true}, label={Text("Объём")}, modifier=Modifier.testTag("records-volume"))
            }
        }
        if (showVolume) {
            item {
                if (volume == null) InfoCard("Нет завершённых тренировок", "Рекорд объёма появится после завершения непустой тренировки.")
                else FableCard(Modifier.testTag("volume-record").clickable(onClickLabel="Открыть тренировку") {onSession(volume)}) {
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        Text("Объём за тренировку", Modifier.weight(1f), style=MaterialTheme.typography.titleMedium)
                        HelpButton("Рекорд объёма", "Максимум внесённых выстрелов в одной завершённой тренировке. Включает разминку и ручной подсчёт без оценки. Это объём дневника, не оценка техники. Равное значение не является улучшением.", iconOnly=true)
                    }
                    SlidingValue("${volume.shotCount} стрел", Modifier.fillMaxWidth(), style=MaterialTheme.typography.headlineLarge)
                    Text(volume.title, style=MaterialTheme.typography.bodyMedium)
                    Text(volume.journalMeta?.localDate ?: "Дата не указана", style=MaterialTheme.typography.bodySmall)
                    FableIcon(Glyph.Next, description="Открыть тренировку")
                }
            }
        } else {
            item {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Text("Лучшие полные серии", Modifier.weight(1f), style=MaterialTheme.typography.titleMedium)
                    HelpButton("Сопоставимые серии", "Отдельный рекорд для каждой дистанции, размера и подтверждённого профиля мишени, снимка снаряжения и числа стрел. Только полные зачётные серии завершённых тренировок. Неизвестная геометрия, неполные серии и разминка не участвуют. Исправление или удаление источника пересчитывает результат. Равные очки не становятся новым более высоким рекордом.", iconOnly=true)
                }
                OutlinedTextField(search, {search=it}, Modifier.fillMaxWidth().padding(top=12.dp).testTag("records-search"),
                    label={Text("Дистанция, мишень, комплект")}, singleLine=true)
            }
            if (shown.isEmpty()) item {InfoCard(if (search.isBlank()) "Нет подходящих полных серий" else "Ничего не найдено",
                if (search.isBlank()) "Нужна завершённая тренировка с полной серией, известной дистанцией и подтверждённой мишенью." else "Измени поисковый запрос.")}
            items(shown, key={it.endId}) {record ->
                val source=sessions.firstOrNull {it.id==record.sessionId}
                FableCard(Modifier.testTag("series-record-${record.endId}").clickable(enabled=source!=null, onClickLabel="Открыть тренировку") {source?.let(onSession)}) {
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        FableIcon(Glyph.Target, tint=MaterialTheme.colorScheme.primary)
                        Text("Полная серия", Modifier.weight(1f).padding(start=12.dp), style=MaterialTheme.typography.titleMedium)
                        FableIcon(Glyph.Next)
                    }
                    SlidingValue("${record.points}/${record.maximum}", Modifier.fillMaxWidth(), style=MaterialTheme.typography.headlineLarge)
                    Text("Средний: ${number(record.points.toDouble()/record.conditions.arrows)}", style=MaterialTheme.typography.bodyMedium)
                    Text("${number(record.conditions.distanceMeters)} м · ${number(record.conditions.diameterMm/10.0)} см · ${record.conditions.arrows} стрел", style=MaterialTheme.typography.bodyMedium)
                    Text(record.targetTitle, style=MaterialTheme.typography.bodySmall)
                    Text(record.equipmentTitle, style=MaterialTheme.typography.bodySmall)
                    Text("${record.localDate ?: "Дата не указана"} · Раунд ${record.round} · Серия ${record.series}", style=MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

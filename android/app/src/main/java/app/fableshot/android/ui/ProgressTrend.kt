package app.fableshot.android.ui

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.domain.TargetScoring
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlin.math.ceil
import kotlin.math.floor

private const val VISIBLE_DAYS = 30.0
private enum class ProgressMetric { Score, Rms }
private data class ProgressWorkout(val session: SessionSummary, val day: LocalDate, val x: Double)
private val axisDate = DateTimeFormatter.ofPattern("dd.MM")
private val fullDate = DateTimeFormatter.ofPattern("dd.MM.yyyy")

/** Keeps all workouts in one timeline and pans a 30-day viewport across them. */
@Composable
internal fun ProgressTrendCard(sessions: List<SessionSummary>) {
    val showScore = statisticVisible(StatisticFeature.Average)
    val showGrouping = statisticVisible(StatisticFeature.Grouping)
    if (!statisticVisible(StatisticFeature.ProgressTrend) || (!showScore && !showGrouping)) return
    val today = LocalDate.now()
    val workouts = remember(sessions, today) {
        sessions.mapNotNull { session ->
            val day = sessionDate(session)
            if (session.state == "completed" && session.scoredCount > 0 && day != null && day <= today)
                session to day else null
        }.sortedWith(compareBy<Pair<SessionSummary, LocalDate>> { it.second }
            .thenBy { it.first.startedAt }.thenBy { it.first.id })
            .groupBy { it.second }.flatMap { (day, sameDay) ->
                sameDay.mapIndexed { index, (session, _) ->
                    ProgressWorkout(session, day, day.toEpochDay() + (index + 1.0) / (sameDay.size + 1))
                }
            }
    }
    var requestedMetric by rememberSaveable { mutableStateOf(ProgressMetric.Score) }
    val metric = if (showScore && showGrouping) requestedMetric else if (showScore) ProgressMetric.Score else ProgressMetric.Rms
    var requestedEnd by rememberSaveable { mutableStateOf<Double?>(null) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var plotWidth by remember { mutableFloatStateOf(1f) }
    val latestEnd = today.plusDays(1).toEpochDay().toDouble()
    val firstDay = workouts.firstOrNull()?.day?.toEpochDay()?.toDouble() ?: latestEnd - VISIBLE_DAYS
    val earliestEnd = (firstDay + VISIBLE_DAYS).coerceAtMost(latestEnd)
    val end = (requestedEnd ?: latestEnd).coerceIn(earliestEnd, latestEnd)
    val start = end - VISIBLE_DAYS
    val values = remember(workouts, metric) {
        workouts.mapNotNull { workout ->
            val session = workout.session
            val value = when (metric) {
                ProgressMetric.Score -> session.total.toDouble() / session.scoredCount
                ProgressMetric.Rms -> session.journalMeta?.positions?.takeIf { session.comparable && session.targetDiameterMm > 0 }
                    ?.let(TargetScoring::rms)?.times(session.targetDiameterMm / 2.0)
            }
            value?.takeIf(Double::isFinite)?.let { workout to it }
        }
    }
    val points = remember(values) { values.map { (workout, value) -> TrendPoint(workout.x, value) } }
    val visible = remember(points, start, end) { points.indices.filter { points[it].x in start..end } }
    val selected = visible.firstOrNull { values[it].first.session.id == selectedId } ?: visible.lastOrNull()
    val ceiling = if (metric == ProgressMetric.Score) 10.0 else {
        // One scale for the history makes panning comparable.
        ceil((points.maxOfOrNull { it.value } ?: 0.0) / 10).coerceAtLeast(1.0) * 10
    }
    val scrollState = rememberScrollableState { pixels ->
        val previous = (requestedEnd ?: latestEnd).coerceIn(earliestEnd, latestEnd)
        val next = (previous - pixels / plotWidth.coerceAtLeast(1f) * VISIBLE_DAYS).coerceIn(earliestEnd, latestEnd)
        requestedEnd = next
        ((previous - next) / VISIBLE_DAYS * plotWidth).toFloat()
    }
    fun shiftDays(days: Double): Boolean {
        val next = (end + days).coerceIn(earliestEnd, latestEnd)
        if (next == end) return false
        requestedEnd = next
        return true
    }
    val fromDay = LocalDate.ofEpochDay(floor(start).toLong())
    val toDay = LocalDate.ofEpochDay(ceil(end).toLong() - 1)
    val selectedValue = selected?.let { if (metric == ProgressMetric.Score) averageNumber(values[it].second) + " / 10" else number(values[it].second) + " мм" }

    FableCard(Modifier.testTag("progress-trend")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FableIcon(Glyph.Progress, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(10.dp))
            Text("Динамика прогресса", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            HelpButton("Динамика прогресса",
                "Каждая точка — завершённая тренировка. На экране 30 дней. Потяни график вправо, чтобы посмотреть " +
                    "более ранние результаты. Нажми на точку, чтобы увидеть точное значение. Средний балл считается " +
                    "по зачётным стрелам. Кучность — разброс RMS в миллиметрах, меньше значит плотнее. " +
                    "Для неё нужны минимум три подтверждённые отметки при единых условиях внутри тренировки. " +
                    "При сравнении разных тренировок учитывай дистанцию и мишень.", iconOnly = true)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if(showScore)FilterChip(metric == ProgressMetric.Score, { requestedMetric = ProgressMetric.Score },
                { androidx.compose.material3.Text("Средний балл") }, Modifier.testTag("progress-trend-score"))
            if(showGrouping)FilterChip(metric == ProgressMetric.Rms, { requestedMetric = ProgressMetric.Rms },
                { androidx.compose.material3.Text("Кучность") }, Modifier.testTag("progress-trend-rms"))
        }
        Text("${fromDay.format(fullDate)} — ${toDay.format(fullDate)}",
            Modifier.testTag("progress-trend-range"), style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Column(Modifier.width(48.dp).height(156.dp), verticalArrangement = Arrangement.SpaceBetween) {
                for (value in listOf(ceiling, ceiling / 2, 0.0)) {
                    FittedLine(number(value, 0) + if (metric == ProgressMetric.Rms) " мм" else "",
                        MaterialTheme.typography.labelSmall, MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Column(Modifier.weight(1f)) {
                Box(Modifier.fillMaxWidth().onSizeChanged { plotWidth = it.width.coerceAtLeast(1).toFloat() }
                    .scrollable(scrollState, Orientation.Horizontal, enabled = earliestEnd < latestEnd)) {
                    SelectableTrendPlot(points, start, end, ceiling, selected,
                        "Динамика прогресса с ${fromDay.format(fullDate)} по ${toDay.format(fullDate)}",
                        selectedValue, Modifier.testTag("progress-trend-chart"),
                        viewportActions = listOf(
                            CustomAccessibilityAction("Раньше на 30 дней") { shiftDays(-VISIBLE_DAYS) },
                            CustomAccessibilityAction("Позже на 30 дней") { shiftDays(VISIBLE_DAYS) },
                        ),
                    ) { selectedId = values[it].first.session.id }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    for (day in listOf(fromDay, fromDay.plusDays(15), toDay)) {
                        Text(day.format(axisDate), style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        if (selected == null) {
            val empty = if (metric == ProgressMetric.Score) "В этом отрезке нет тренировок с оценкой."
                else "В этом отрезке нет тренировок с данными для расчёта кучности."
            Text(empty, Modifier.testTag("progress-trend-empty"), style = MaterialTheme.typography.bodyMedium)
        } else {
            val workout = values[selected].first
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(workout.day.format(fullDate), style = MaterialTheme.typography.labelMedium)
                    Text(workout.session.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(requireNotNull(selectedValue), Modifier.testTag("progress-trend-value"),
                    style = MaterialTheme.typography.titleLarge)
            }
        }
    }
}

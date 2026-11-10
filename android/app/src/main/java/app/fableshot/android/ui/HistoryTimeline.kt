package app.fableshot.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import app.fableshot.android.data.SessionSummary
import java.time.LocalDate
import java.time.Instant
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal sealed interface HistoryTimelineItem {
    val key: String
    data class Year(val value: Int) : HistoryTimelineItem { override val key = "history-year-$value" }
    data class Month(val value: YearMonth) : HistoryTimelineItem { override val key = "history-month-$value" }
    data class Session(val value: SessionSummary, val date: LocalDate?) : HistoryTimelineItem {
        override val key = "history-row-${value.id}"
    }
    data object UnknownDates : HistoryTimelineItem { override val key = "history-unknown-dates" }
}

/** A saved training date wins over import, creation and correction timestamps. */
internal fun historyTrainingDate(value: SessionSummary): LocalDate? {
    val meta = value.journalMeta
    if (meta?.dateKnown == false) return null
    if (meta?.localDate != null) return runCatching { LocalDate.parse(meta.localDate) }.getOrNull()
    return sessionDate(value)
}

internal fun historyTimelineItems(sessions: List<SessionSummary>): List<HistoryTimelineItem> {
    val dated = sessions.map { HistoryTimelineItem.Session(it, historyTrainingDate(it)) }
        .sortedWith(compareByDescending<HistoryTimelineItem.Session> { it.date }
            .thenByDescending { entry ->
                val startDate = Instant.ofEpochMilli(entry.value.startedAt).atZone(ZoneId.systemDefault()).toLocalDate()
                entry.value.startedAt.takeIf { entry.date != null && startDate == entry.date }
            }.thenBy { it.value.id })
    return buildList {
        var year: Int? = null
        var month: YearMonth? = null
        var unknown = false
        for (entry in dated) {
            val day = entry.date
            if (day == null) {
                if (!unknown) { add(HistoryTimelineItem.UnknownDates); unknown = true }
            } else {
                val nextMonth = YearMonth.from(day)
                if (day.year != year) { add(HistoryTimelineItem.Year(day.year)); year = day.year }
                if (nextMonth != month) { add(HistoryTimelineItem.Month(nextMonth)); month = nextMonth }
            }
            add(entry)
        }
    }
}

private val historyMonthFormat = DateTimeFormatter.ofPattern("LLLL", Locale.forLanguageTag("ru"))
private val historyDayFormat = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.forLanguageTag("ru"))

@Composable
private fun historyDateSize(): Dp = maxOf(40.dp,
    with(LocalDensity.current) { MaterialTheme.typography.titleMedium.lineHeight.toDp() } + 12.dp)

@Composable
internal fun HistoryTimelineHeading(item: HistoryTimelineItem, arrow: Boolean) {
    val text = when (item) {
        is HistoryTimelineItem.Year -> item.value.toString()
        is HistoryTimelineItem.Month -> item.value.format(historyMonthFormat).replaceFirstChar { it.titlecase(Locale.forLanguageTag("ru")) }
        HistoryTimelineItem.UnknownDates -> "Дата не указана"
        is HistoryTimelineItem.Session -> return
    }
    val railWidth = historyDateSize()
    Box(Modifier.fillMaxWidth().heightIn(min = 32.dp)) {
        HistoryTimelineRail(Modifier.matchParentSize(), railWidth / 2, arrow = arrow, branch = true)
        Text(text, Modifier.padding(start = railWidth + 12.dp, top = 4.dp, bottom = 4.dp)
            .testTag(item.key).semantics { heading() }, style = if (item is HistoryTimelineItem.Year)
            MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun HistoryTimelineRow(
    item: HistoryTimelineItem.Session,
    deleted: Boolean,
    restoreEnabled: Boolean,
    onRestore: () -> Unit,
    onClick: () -> Unit,
) {
    val circleSize = historyDateSize()
    Box(Modifier.fillMaxWidth().testTag(item.key)) {
        HistoryTimelineRail(Modifier.matchParentSize(), circleSize / 2)
        Surface(Modifier.size(circleSize).align(Alignment.TopStart).testTag("history-date-circle-${item.value.id}")
            .semantics(mergeDescendants = true) {
                contentDescription = item.date?.format(historyDayFormat) ?: "Дата тренировки не указана"
            }, shape = CircleShape, color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.5.dp, MaterialTheme.colorScheme.primary.copy(alpha = .65f))) {
            Box(contentAlignment = Alignment.Center) {
                Text(item.date?.dayOfMonth?.toString() ?: "—", Modifier.testTag("history-day-${item.value.id}"),
                    style = MaterialTheme.typography.titleMedium)
            }
        }
        Box(Modifier.fillMaxWidth().padding(start = circleSize + 12.dp)) {
            SessionCard(item.value, deleted = deleted, restoreEnabled = restoreEnabled,
                onRestore = onRestore, showDate = false, onClick = onClick)
        }
    }
}

@Composable
private fun HistoryTimelineRail(modifier: Modifier, center: Dp, arrow: Boolean = false, branch: Boolean = false) {
    val color = MaterialTheme.colorScheme.primary
    Canvas(modifier.then(if (arrow) Modifier.testTag("history-up-arrow").semantics {
        contentDescription = "Последние тренировки сверху"
    } else Modifier)) {
        val x = center.toPx()
        val top = if (arrow) 3.dp.toPx() else -7.dp.toPx()
        drawLine(color.copy(alpha = .45f), Offset(x, top), Offset(x, size.height + 7.dp.toPx()),
            1.5.dp.toPx(), StrokeCap.Round)
        if (arrow) {
            drawLine(color, Offset(x - 4.dp.toPx(), top + 6.dp.toPx()), Offset(x, top), 1.5.dp.toPx(), StrokeCap.Round)
            drawLine(color, Offset(x + 4.dp.toPx(), top + 6.dp.toPx()), Offset(x, top), 1.5.dp.toPx(), StrokeCap.Round)
        }
        if (branch) {
            drawLine(color.copy(alpha = .45f), Offset(x, size.height / 2),
                Offset(x * 2 + 6.dp.toPx(), size.height / 2), 1.5.dp.toPx(), StrokeCap.Round)
        }
    }
}

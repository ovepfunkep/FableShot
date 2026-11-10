package app.fableshot.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.fableshot.android.BuildConfig
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.StatisticFeature
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

private val practiceMonth = DateTimeFormatter.ofPattern("LLL", Locale.forLanguageTag("ru"))
private val practiceDate = DateTimeFormatter.ofPattern("d MMMM", Locale.forLanguageTag("ru"))

/** Newest sessions arrive first. Each session, including a same-day session, owns one point. */
@Composable
internal fun PracticeTimeline(sessions: List<SessionSummary>, onSession: (SessionSummary) -> Unit) {
    val ordered = sessions.asReversed()
    val dates = ordered.map { requireNotNull(sessionDate(it)) }
    val months = dates.map(YearMonth::from)
    val transitions = months.indices.drop(1).filter { months[it] != months[it - 1] }
    val demo = ordered.map {
        BuildConfig.APPLICATION_ID == "app.fableshot.android.verification" && it.title.startsWith("Демо · ")
    }
    val density = LocalDensity.current
    val colors = MaterialTheme.colorScheme
    val dateStyle = MaterialTheme.typography.labelMedium
    val smallStyle = MaterialTheme.typography.labelSmall
    val scoreStyle = MaterialTheme.typography.titleSmall
    val dateHeight = with(density) { dateStyle.lineHeight.toDp() }
    val smallHeight = with(density) { smallStyle.lineHeight.toDp() }
    val demoHeight = if (demo.any { it }) smallHeight else 0.dp
    val axisTop = demoHeight + dateHeight + 3.dp
    val axisHeight = maxOf(14.dp, smallHeight)
    val axisY = axisTop + axisHeight / 2
    val firstCardTop = axisTop + axisHeight + 5.dp
    val cardHeight = maxOf(48.dp, with(density) { scoreStyle.lineHeight.toDp() } + smallHeight + 8.dp)
    val rowStep = cardHeight + 6.dp
    val chartHeight = firstCardTop + cardHeight + if (ordered.size > 1) rowStep else 0.dp

    BoxWithConstraints(Modifier.fillMaxWidth().height(chartHeight).testTag("home-practice-horizontal")) {
        val available = (maxWidth - 12.dp).coerceAtLeast(1.dp)
        // Leave room at the middle of each neighboring gap for the lower card's stem.
        val cardWidth = minOf(100.dp, ((available - 4.dp * (ordered.size - 1)) * 2 / (ordered.size + 1)).coerceAtLeast(1.dp))
        val spacing = if (ordered.size > 1) (available - cardWidth) / (ordered.size - 1) else available
        val centers = ordered.indices.map { index ->
            if (ordered.size == 1) available / 2 else cardWidth / 2 + spacing * index
        }
        val monthWidth = minOf(40.dp, (spacing - 9.dp).coerceAtLeast(1.dp))
        val labelWidth = minOf(cardWidth, (spacing - 3.dp).coerceAtLeast(1.dp))
        val monthCenters = transitions.map { (centers[it - 1] + centers[it]) / 2 }
        val line = colors.primary.copy(alpha = .55f)

        Canvas(Modifier.matchParentSize().testTag("home-practice-right-arrow").semantics {
            contentDescription = "Тренировки от старых к новым"
        }) {
            val y = axisY.toPx()
            val tip = size.width - 1.dp.toPx()
            var start = 0f
            for (center in monthCenters) {
                val left = (center - monthWidth / 2).toPx()
                drawLine(line, Offset(start, y), Offset(left, y), 1.5.dp.toPx(), StrokeCap.Round)
                start = (center + monthWidth / 2).toPx()
            }
            drawLine(line, Offset(start, y), Offset(tip, y), 1.5.dp.toPx(), StrokeCap.Round)
            drawLine(line, Offset(tip - 5.dp.toPx(), y - 4.dp.toPx()), Offset(tip, y), 1.5.dp.toPx(), StrokeCap.Round)
            drawLine(line, Offset(tip - 5.dp.toPx(), y + 4.dp.toPx()), Offset(tip, y), 1.5.dp.toPx(), StrokeCap.Round)
            centers.forEachIndexed { index, center ->
                val x = center.toPx()
                drawLine(line, Offset(x, y), Offset(x, (firstCardTop + rowStep * (index % 2)).toPx()), 1.dp.toPx())
            }
        }

        transitions.forEachIndexed { slot, index ->
            Box(Modifier.offset(monthCenters[slot] - monthWidth / 2, axisTop)
                .width(monthWidth).height(axisHeight).testTag("home-practice-month-${months[index]}"),
                contentAlignment = Alignment.Center) {
                FittedLine(dates[index].format(practiceMonth).trimEnd('.'), smallStyle, colors.onSurfaceVariant, alignment = Alignment.Center)
            }
        }

        ordered.forEachIndexed { index, session ->
            val center = centers[index]
            val firstMonth = index == 0 && transitions.isNotEmpty()
            val day = dates[index]
            val dateText = if (firstMonth) "${day.dayOfMonth} ${day.format(practiceMonth).trimEnd('.')}" else day.dayOfMonth.toString()
            val label = Modifier.offset(center - labelWidth / 2, demoHeight).width(labelWidth)
            Box(if (firstMonth) label.testTag("home-practice-month-${months[index]}") else label) {
                FittedLine(dateText, dateStyle, colors.onSurface, alignment = Alignment.Center)
            }
            if (demo[index]) {
                Box(Modifier.offset(center - labelWidth / 2).width(labelWidth).testTag("home-practice-demo-${session.id}")) {
                    FittedLine("Демо", smallStyle, colors.primary, alignment = Alignment.Center)
                }
            }
            Box(
                Modifier.offset(center - 4.dp, axisY - 4.dp).size(8.dp)
                    .testTag("home-practice-point-${session.id}"),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(if (index == ordered.lastIndex) 8.dp else 6.dp).background(colors.primary, CircleShape))
            }
            PracticeTimelineCard(
                session, index == ordered.lastIndex,
                Modifier.offset(center - cardWidth / 2, firstCardTop + rowStep * (index % 2))
                    .width(cardWidth).height(cardHeight),
            ) { onSession(session) }
        }
    }
}

@Composable
private fun PracticeTimelineCard(session: SessionSummary, latest: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val scored = session.scoredCount > 0
    val maxScore = session.scoredCount * 10L
    val result = if (scored) "${session.total}/$maxScore" else "${session.shotCount} стрел"
    val mean = if (scored) averageNumber(session.total.toDouble() / session.scoredCount) else "—"
    val showResult = statisticVisible(StatisticFeature.Result) && scored
    val showVolume = statisticVisible(StatisticFeature.Volume)
    val showAverage = statisticVisible(StatisticFeature.Average)
    val top = if (showResult) result else if (showVolume) "${session.shotCount} стрел" else null
    val visibleSummary = listOfNotNull(top, mean.takeIf { showAverage }).joinToString(", ")
    val day = requireNotNull(sessionDate(session))
    Box(modifier.testTag("home-practice-${session.id}")) {
        Surface(
            onClick = onClick,
            modifier = Modifier.matchParentSize().testTag("home-practice-session").semantics {
                contentDescription = "Открыть тренировку «${session.title}», ${day.format(practiceDate)}. $visibleSummary"
            },
            shape = RoundedCornerShape(10.dp),
            color = colors.surfaceVariant,
            border = BorderStroke(1.dp, if (latest) colors.primary.copy(alpha = .55f) else colors.outlineVariant),
        ) {
            Column(Modifier.padding(horizontal = 5.dp), verticalArrangement = Arrangement.Center) {
                top?.let { FittedLine(it, MaterialTheme.typography.titleSmall, colors.onSurface, alignment = Alignment.Center) }
                if (showAverage) FittedLine(mean, MaterialTheme.typography.labelSmall, colors.onSurfaceVariant, alignment = Alignment.Center)
            }
        }
    }
}

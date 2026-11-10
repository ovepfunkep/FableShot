package app.fableshot.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text as MaterialText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fableshot.android.data.StatisticFeature

data class TrainingSummaryMetric(
    val position: String,
    val score: String,
    val average: String,
    val scoreWidthReference: String,
)

private fun summaryScoreReference(metric: TrainingSummaryMetric): String {
    // A free round has no planned maximum. Reserving Int.MAX_VALUE turned every free
    // round into a narrow-screen layout, even when its actual result was just zero.
    val reference = if (metric.scoreWidthReference == Int.MAX_VALUE.toString())
        "8".repeat(maxOf(5, metric.score.length)) else metric.scoreWidthReference
    return reference.map { if (it.isDigit()) '8' else it }.joinToString("")
}

private fun summaryPositionReference(position: String): String {
    val limit = position.substringAfter('/', "")
    return if (limit.isNotEmpty()) "${"8".repeat(limit.length)}/${"8".repeat(limit.length)}"
        else "8".repeat(maxOf(3, position.length))
}

/** Layout depends on the plan and display settings, never on newly entered points. */
@Composable
fun TrainingSummary(
    round: TrainingSummaryMetric,
    series: TrainingSummaryMetric,
    hideScores: Boolean,
    onRounds: (() -> Unit)? = null,
    onSeries: (() -> Unit)? = null,
    roundRank: @Composable () -> Unit = {},
    seriesRank: @Composable () -> Unit = {},
    rank: @Composable (asColumn: Boolean) -> Unit = {},
) {
    val showResult = statisticVisible(StatisticFeature.Result)
    val showAverage = statisticVisible(StatisticFeature.Average)
    val showNorms = statisticVisible(StatisticFeature.Norms)
    BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp).testTag("training-summary")) {
        val density = LocalDensity.current
        val measurer = rememberTextMeasurer()
        val scoreStyle = MaterialTheme.typography.titleLarge
        val halfWidth = (maxWidth - 8.dp) / 2
        val cardContentWidth = halfWidth - 24.dp
        val labelStyle = MaterialTheme.typography.labelLarge
        val averageStyle = MaterialTheme.typography.bodySmall
        val roundScoreReference = summaryScoreReference(round)
        val seriesScoreReference = summaryScoreReference(series)
        val scoreReferenceWidth = if (showResult) remember(roundScoreReference, seriesScoreReference, scoreStyle, measurer, density.density, density.fontScale) {
            listOf(roundScoreReference, seriesScoreReference).maxOf {
                measurer.measure(it,
                    scoreStyle, maxLines = 1, softWrap = false, density = density).size.width
            }
        } else 0
        val headingReferenceWidth = remember(round.position, series.position, labelStyle, measurer, density.density, density.fontScale) {
            fun measured(text: String, style: TextStyle) = measurer.measure(text, style, maxLines = 1, softWrap = false, density = density).size.width
            maxOf(measured("Раунд ${summaryPositionReference(round.position)}", labelStyle),
                measured("Серия ${summaryPositionReference(series.position)}", labelStyle))
        }
        val averageReferenceWidth = if (showAverage) measurer.measure(if (LocalAverageHundredths.current) "Средний 10,00" else "Средний 10,0", averageStyle, maxLines = 1, softWrap = false, density = density).size.width else 0
        val roundAction = if (onRounds != null) Modifier.testTag("training-rounds-open").clickable(onClick = onRounds) else Modifier
        val seriesAction = if (onSeries != null) Modifier.testTag("training-series-open").clickable(onClick = onSeries) else Modifier
        val requiredCardWidth = maxOf(scoreReferenceWidth, headingReferenceWidth, averageReferenceWidth)
        val safetyMargin = with(density) { 4.dp.roundToPx() }
        val forceSingle = maxWidth <= 320.dp && density.fontScale >= 1.5f
        val asTwoCards = !forceSingle && requiredCardWidth + safetyMargin <= with(density) { cardContentWidth.roundToPx() }
        val contextFitsHalf = !forceSingle && headingReferenceWidth + safetyMargin <= with(density) { halfWidth.roundToPx() }

        if (hideScores || (!showResult && !showAverage)) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (contextFitsHalf) {
                    Row(Modifier.fillMaxWidth().testTag("training-summary-hidden"), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        SummaryContext("Раунд", round.position, "round-label", "round-number", Modifier.weight(1f).then(roundAction))
                        SummaryContext("Серия", series.position, "series-label", "end-number", Modifier.weight(1f).then(seriesAction))
                    }
                } else {
                    Column(Modifier.fillMaxWidth().testTag("training-summary-hidden"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        SummaryContext("Раунд", round.position, "round-label", "round-number", Modifier.fillMaxWidth().then(roundAction))
                        SummaryContext("Серия", series.position, "series-label", "end-number", Modifier.fillMaxWidth().then(seriesAction))
                    }
                }
                if (!hideScores && showNorms) rank(false)
            }
        } else {
            Column(Modifier.fillMaxWidth().then(if (asTwoCards) Modifier else Modifier.testTag("training-summary-stacked")),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (asTwoCards) {
                    Row(Modifier.fillMaxWidth().testTag("training-summary-cards"), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SummaryMetricCard("Раунд", round, "round", "round-number", Modifier.weight(1f).then(roundAction), actionable = onRounds != null, rank = roundRank)
                        SummaryMetricCard("Серия", series, "end", "end-number", Modifier.weight(1f).then(seriesAction), actionable = onSeries != null, rank = seriesRank)
                    }
                } else {
                    Column(Modifier.fillMaxWidth().testTag("training-summary-single"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(roundAction.fillMaxWidth()) { CompactSummaryMetric("Раунд", round, "round", "round-number", onRounds != null, roundRank) }
                        Box(seriesAction.fillMaxWidth()) { CompactSummaryMetric("Серия", series, "end", "end-number", onSeries != null, seriesRank) }
                    }
                }
                if (showNorms) rank(false)
            }
        }
    }
}

/** Dense two-row tiles preserve space for the target on narrow, enlarged displays. */
@Composable
private fun CompactSummaryMetric(title: String, metric: TrainingSummaryMetric, tag: String, positionTag: String,
    actionable: Boolean = false, rank: @Composable () -> Unit = {}) {
    val showResult = statisticVisible(StatisticFeature.Result)
    val showAverage = statisticVisible(StatisticFeature.Average)
    val density = LocalDensity.current
    val numberStyle = MaterialTheme.typography.titleMedium
    val rowHeight = maxOf(32.dp, with(density) { numberStyle.lineHeight.toDp() })
    Surface(Modifier.fillMaxWidth().testTag("$tag-compact-summary"), shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp,
            if (actionable) MaterialTheme.colorScheme.primary.copy(alpha = .48f) else MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(Modifier.fillMaxWidth().height(rowHeight), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SummaryContext(title, metric.position, if (tag == "end") "series-label" else "round-label",
                    positionTag, Modifier.weight(1f), MaterialTheme.typography.labelMedium)
                if (showResult) Box(Modifier.weight(1f).testTag("$tag-score").clearAndSetSemantics {
                    text = AnnotatedString(metric.score)
                    contentDescription = (if (tag == "end") "Очки серии: " else "Очки раунда: ") + metric.score.replace("/", " из ")
                }) {
                    FittedLine(metric.score, numberStyle, MaterialTheme.colorScheme.onSurface,
                        animate = true, alignment = Alignment.CenterEnd)
                }
            }
            Row(Modifier.fillMaxWidth().height(rowHeight), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f).testTag("$tag-average").clearAndSetSemantics {
                    if (showAverage) {
                        text = AnnotatedString("Средний ${metric.average}")
                        contentDescription = (if (tag == "end") "Средний балл серии: " else "Средний балл раунда: ") + metric.average
                    }
                }) {
                    if (showAverage) FittedLine("Ср. ${metric.average}", MaterialTheme.typography.bodySmall,
                        MaterialTheme.colorScheme.onSurfaceVariant, animate = true)
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    if (statisticVisible(StatisticFeature.Norms)) rank()
                }
            }
        }
    }
}
@Composable
private fun SummaryContext(title: String, position: String, titleTag: String, positionTag: String, modifier: Modifier, style: TextStyle = MaterialTheme.typography.labelLarge) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        MaterialText(AnnotatedString(title), Modifier.testTag(titleTag), style = style,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        MaterialText(AnnotatedString(position), Modifier.testTag(positionTag).clearAndSetSemantics {
            text = AnnotatedString(position)
            contentDescription = "$title ${position.replace("/", " из ")}"
        }, style = style)
    }
}

@Composable
private fun SummaryMetricCard(
    title: String,
    metric: TrainingSummaryMetric,
    tag: String,
    positionTag: String,
    modifier: Modifier,
    scoreLines: Int = 1,
    headingLines: Int = 1,
    averageLines: Int = 1,
    actionable: Boolean = false,
    rank: @Composable () -> Unit = {},
) {
    val density = LocalDensity.current
    val showResult = statisticVisible(StatisticFeature.Result)
    val showAverage = statisticVisible(StatisticFeature.Average)
    val showNorms = statisticVisible(StatisticFeature.Norms)
    Surface(modifier, shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, if (actionable) MaterialTheme.colorScheme.primary.copy(alpha = .48f) else MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Box(Modifier.fillMaxWidth().height((22 * headingLines * density.fontScale).dp), contentAlignment = Alignment.CenterStart) {
                if (headingLines == 1) SummaryContext(title, metric.position, if (tag == "end") "series-label" else "round-label", positionTag, Modifier.fillMaxWidth())
                else Column {
                    MaterialText(AnnotatedString(title), Modifier.testTag(if (tag == "end") "series-label" else "round-label"),
                        style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    MaterialText(AnnotatedString(metric.position), Modifier.testTag(positionTag).clearAndSetSemantics {
                        text = AnnotatedString(metric.position)
                        contentDescription = "$title ${metric.position.replace("/", " из ")}"
                    }, style = MaterialTheme.typography.labelLarge)
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    if (showResult) Box(Modifier.fillMaxWidth().height((30 * scoreLines * density.fontScale).dp)
                        .testTag("$tag-score").clearAndSetSemantics {
                            text = AnnotatedString(metric.score)
                            contentDescription = (if (tag == "end") "Очки серии: " else "Очки раунда: ") + metric.score.replace("/", " из ")
                        }, contentAlignment = Alignment.CenterStart) {
                        FittedLine(metric.score, MaterialTheme.typography.titleLarge,
                            MaterialTheme.colorScheme.onSurface, animate = true)
                    }
                    if (showAverage) Box(Modifier.fillMaxWidth().height((20 * averageLines * density.fontScale).dp)
                        .testTag("$tag-average").clearAndSetSemantics {
                            text = AnnotatedString("Средний ${metric.average}")
                            contentDescription = (if (tag == "end") "Средний балл серии: " else "Средний балл раунда: ") + metric.average
                        }, contentAlignment = Alignment.CenterStart) {
                        FittedLine("Ср. ${metric.average}", MaterialTheme.typography.bodySmall,
                            MaterialTheme.colorScheme.onSurfaceVariant, animate = true)
                    }
                }
                if (showNorms) Box(Modifier.width(56.dp).heightIn(min = 32.dp), contentAlignment = Alignment.BottomEnd) {
                    rank()
                }
            }
        }
    }
}

/** Uses the allocated font size; parent layout adapts instead of shrinking text. */
@Composable
internal fun TrainingSummaryValue(
    value: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.titleMedium,
    color: Color = MaterialTheme.colorScheme.onSurface,
    description: String? = null,
    maxLines: Int = 1,
    alignment: Alignment = Alignment.Center,
) {
    val motion = LocalFableVisuals.current.motion
    val duration = if (motion) VALUE_MOTION_MILLIS else 0
    Box(modifier.clipToBounds().clearAndSetSemantics {
        text = AnnotatedString(value)
        description?.let { contentDescription = it }
    }, contentAlignment = alignment) {
        AnimatedContent(value, transitionSpec = {
            (slideInVertically(tween(duration)) { if (motion) it / 2 else 0 } + fadeIn(tween(duration)))
                .togetherWith(slideOutVertically(tween(duration)) { if (motion) -it / 2 else 0 } + fadeOut(tween(duration)))
                .using(null)
        }, label = "training summary value") { current ->
            // Keep accessibility bounds from the actual paragraph at scaled fonts, not the
            // reconstructed layout returned by the plain String fast path in Compose.
            MaterialText(AnnotatedString(current), style = style, color = color,
                textAlign = if (alignment == Alignment.Center) TextAlign.Center else TextAlign.Start,
                maxLines = maxLines, softWrap = maxLines > 1)
        }
    }
}

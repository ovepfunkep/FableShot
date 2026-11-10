package app.fableshot.android.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.journal.JournalDetails
import app.fableshot.android.data.journal.roundProgress
import kotlin.math.abs

internal data class TrainingMeanPoint(
    val endId: String,
    val round: Int,
    val series: Int,
    val enteredCount: Int,
    val mean: Double,
    val segment: Int,
    val chronology: Int,
)

internal fun trainingMeanTrendPoints(details: JournalDetails): List<TrainingMeanPoint> {
    val points = mutableListOf<TrainingMeanPoint>()
    var segment = 0
    var chronology = 0
    for (block in details.orderedBlocks) {
        for (end in block.orderedEnds.filter { it.end.role == "scored" }) {
            if (block.block.mode == "count_only") {
                if (end.volume > 0 || end.end.state == "closed") { segment++; chronology++ }
                continue
            }
            if (end.shots.isEmpty()) continue
            if (end.shots.any { it.points !in 0..10 }) { segment++; chronology++; continue }
            val progress = details.roundProgress(end.end.id)
            points.add(TrainingMeanPoint(end.end.id, progress.number, progress.seriesNumber, end.shots.size,
                end.shots.sumOf { it.points.toLong() }.toDouble() / end.shots.size, segment, chronology++))
        }
    }
    return points
}

@Composable
fun TrainingMeanTrendCard(details: JournalDetails) {
    val points = remember(details) { trainingMeanTrendPoints(details) }
    var selectedId by rememberSaveable(details.session.id) { mutableStateOf<String?>(null) }
    val selectedIndex = points.indexOfFirst { it.endId == selectedId }.takeIf { it >= 0 } ?: points.lastIndex
    val selected = points.getOrNull(selectedIndex)
    val selectedMeanText = selected?.let { averageNumber(it.mean) }
    val accent = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    val motion = LocalFableVisuals.current.motion
    val markerRadius by animateFloatAsState(if (selectedId == null) 5f else 7f,
        animationSpec = if (motion) tween(180) else snap(), label = "selected mean series")

    FableCard(Modifier.testTag("training-mean-trend")) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FableIcon(Glyph.Progress, tint = MaterialTheme.colorScheme.primary)
            Text("Средний балл по сериям", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            HelpButton("О графике среднего балла", "Очки введённых зачётных стрел делятся на их количество. " +
                "Промах входит за ноль. Каждая точка — серия, включая неполную. " +
                "Разрыв линии обозначает учёт без оценки; пунктир разделяет раунды.",
                iconOnly = true)
        }
        if (selected == null) {
            Text("Пока нет зачётных стрел с оценками.", Modifier.testTag("training-mean-empty"),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Row(Modifier.fillMaxWidth().height(200.dp)) {
                Column(Modifier.width(28.dp).fillMaxHeight(), verticalArrangement = Arrangement.SpaceBetween) {
                    Text("10", style = MaterialTheme.typography.labelSmall)
                    Text("5", style = MaterialTheme.typography.labelSmall)
                    Text("0", style = MaterialTheme.typography.labelSmall)
                }
                Box(Modifier.weight(1f).fillMaxHeight().testTag("training-mean-plot")) {
                // Side docks reserve the controls' complete touch areas outside the plotted data.
                Canvas(Modifier.fillMaxSize().padding(horizontal = 48.dp).testTag("training-mean-chart")
                    .semantics {
                        contentDescription = "Средний балл всех зачётных серий, шкала от 0 до 10"
                        stateDescription = "Серий ${points.size}. Раунд ${selected.round}, серия ${selected.series}, средний $selectedMeanText"
                        customActions = listOf(
                            CustomAccessibilityAction("Предыдущая серия") {
                                if (selectedIndex > 0) { selectedId = points[selectedIndex - 1].endId; true } else false
                            },
                            CustomAccessibilityAction("Следующая серия") {
                                if (selectedIndex < points.lastIndex) { selectedId = points[selectedIndex + 1].endId; true } else false
                            },
                        )
                    }
                    .pointerInput(points) {
                        detectTapGestures { tap ->
                            val inset = 8.dp.toPx()
                            val span = (size.width - 2 * inset).coerceAtLeast(1f)
                            val last = points.last().chronology
                            selectedId = points.minBy { point ->
                                val x = inset + span * if (last == 0) .5f else point.chronology.toFloat() / last
                                abs(tap.x - x)
                            }.endId
                        }
                    }) {
                    val inset = 8.dp.toPx()
                    val width = (size.width - 2 * inset).coerceAtLeast(1f)
                    val height = (size.height - 2 * inset).coerceAtLeast(1f)
                    val last = points.last().chronology
                    fun location(point: TrainingMeanPoint) = Offset(
                        inset + width * if (last == 0) .5f else point.chronology.toFloat() / last,
                        inset + height * (1f - point.mean.toFloat() / 10f),
                    )
                    for (line in 0..2) {
                        val y = inset + height * line / 2
                        drawLine(grid, Offset(inset, y), Offset(size.width - inset, y), 1.dp.toPx())
                    }
                    points.zipWithNext().filter { (before, after) -> before.round != after.round }.forEach { (before, after) ->
                        val x = (location(before).x + location(after).x) / 2
                        drawLine(grid, Offset(x, inset), Offset(x, size.height - inset), 1.dp.toPx(),
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())))
                    }
                    val path = Path()
                    points.forEachIndexed { index, point ->
                        val position = location(point)
                        if (index == 0 || point.segment != points[index - 1].segment) path.moveTo(position.x, position.y)
                        else path.lineTo(position.x, position.y)
                    }
                    drawPath(path, accent, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
                    points.forEach { drawCircle(accent, 3.dp.toPx(), location(it)) }
                    val marker = location(selected)
                    drawLine(accent.copy(alpha = .3f), Offset(marker.x, inset), Offset(marker.x, size.height - inset), 1.dp.toPx())
                    drawCircle(accent, markerRadius.dp.toPx(), marker)
                }
                IconButton({ selectedId = points[selectedIndex - 1].endId }, enabled = selectedIndex > 0,
                    modifier = Modifier.align(Alignment.CenterStart).testTag("training-mean-prev")) {
                    FableIcon(Glyph.Back, description = "Предыдущая серия")
                }
                IconButton({ selectedId = points[selectedIndex + 1].endId }, enabled = selectedIndex < points.lastIndex,
                    modifier = Modifier.align(Alignment.CenterEnd).testTag("training-mean-next")) {
                    FableIcon(Glyph.Next, description = "Следующая серия")
                }
                }
            }
            FlowRow(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("training-mean-selection"),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Раунд "+selected.round+" · серия "+selected.series,
                    Modifier.align(Alignment.CenterVertically).testTag("training-mean-series"),
                    style = MaterialTheme.typography.labelMedium, maxLines = 2)
                Text(requireNotNull(selectedMeanText), Modifier.widthIn(min = 48.dp).align(Alignment.CenterVertically)
                    .testTag("training-mean-value").semantics {
                    contentDescription = "Средний балл "+selectedMeanText+" из 10"
                }, style = MaterialTheme.typography.titleLarge, maxLines = 1)
                if (statisticVisible(app.fableshot.android.data.StatisticFeature.Volume)) {
                    Row(Modifier.align(Alignment.CenterVertically), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        FableIcon(Glyph.Arrow, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("${selected.enteredCount}", Modifier.testTag("training-mean-count").semantics {
                            contentDescription = "Стрел ${selected.enteredCount}"
                        }, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

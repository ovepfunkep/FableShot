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
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.domain.TargetScoring
import java.time.format.DateTimeFormatter
import kotlin.math.*

@Composable
fun GeometryTrend(values: List<SessionSummary>) {
    val showGrouping = statisticVisible(StatisticFeature.Grouping)
    val showOffset = statisticVisible(StatisticFeature.Offset)
    if (!statisticVisible(StatisticFeature.GeometryTrend) || (!showGrouping && !showOffset)) return
    var requestedOffset by rememberSaveable { mutableStateOf(false) }
    val offset = if (showGrouping && showOffset) requestedOffset else showOffset
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    val eligible = remember(values) { values.filter { row ->
        row.targetDiameterMm > 0 && row.journalMeta?.positions?.let { points ->
            points.size >= 3 && points.all { it.x.isFinite() && it.y.isFinite() }
        } == true
    } }
    FableCard {
        SectionHeading("Кучность и точность по занятиям", icon = Glyph.Progress)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if(showGrouping)FilterChip(!offset, { requestedOffset = false }, { Text("Разброс") }, Modifier.testTag("geometry-trend-rms"))
            // Keep the chip label free of the inline glossary click target.
            if(showOffset)FilterChip(offset, { requestedOffset = true }, { androidx.compose.material3.Text("Смещение") },
                Modifier.testTag("geometry-trend-offset"))
        }
        if(statisticVisible(StatisticFeature.Volume))Text("Учтено занятий: ${eligible.size} из ${values.size} · минимум 3 координаты в каждом",
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("geometry-trend-coverage"))
        if (eligible.isEmpty()) {
            Text("Для динамики пока недостаточно подтверждённых координат.", Modifier.testTag("geometry-trend-empty"))
        } else {
            fun measure(row: SessionSummary): Double {
                val points = row.journalMeta!!.positions!!
                return (if (offset) hypot(points.sumOf { it.x } / points.size, points.sumOf { it.y } / points.size)
                else TargetScoring.rms(points)!!) * row.targetDiameterMm / 2
            }
            val shown = eligible.takeLast(12)
            val measured = shown.map(::measure)
            // Ignore arithmetic noise when the maximum is a whole millimetre.
            val ceiling = ceil(measured.maxOrNull()!! - 1e-9).coerceAtLeast(1.0)
            val selectedIndex = shown.indexOfFirst { it.id == selectedId }.takeIf { it >= 0 } ?: shown.lastIndex
            val selected = shown[selectedIndex]
            Text("${if (offset) "Смещение от центра" else "Разброс RMS"}, мм · меньше — лучше",
                style = MaterialTheme.typography.titleMedium)
            Text("Шкала: 0–${number(ceiling, 1)} мм", style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("geometry-trend-scale"))
            GeometryTrendPlot(measured, ceiling, selectedIndex) { selectedId = shown[it].id }
            Text("${trendDate(shown.first())} — ${trendDate(shown.last())} · показано ${shown.size} из ${eligible.size}",
                style = MaterialTheme.typography.bodySmall)
            Column(Modifier.fillMaxWidth().testTag("geometry-trend-selection"),
                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${number(measured[selectedIndex], 2)} мм", style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.testTag("geometry-trend-selected-value"))
                Text("${trendDate(selected)} · ${selected.title}", style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("geometry-trend-selected-session"))
                Text("Координаты ${selected.journalMeta!!.positions!!.size} из ${selected.scoredCount}",
                    style = MaterialTheme.typography.bodySmall)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton({ selectedId = shown[selectedIndex - 1].id }, enabled = selectedIndex > 0,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("geometry-trend-prev")) { Text("Раньше") }
                TextButton({ selectedId = shown[selectedIndex + 1].id }, enabled = selectedIndex < shown.lastIndex,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("geometry-trend-next")) { Text("Дальше") }
            }
            Text("Последнее: ${number(measure(eligible.last()), 1)} мм", Modifier.testTag("geometry-trend-latest"))
            if (eligible.size >= 2) {
                val before = measure(eligible.first())
                val difference = measure(eligible.last()) - before
                Text(when {
                    abs(difference) < 1e-9 -> "От первого к последнему: без изменений"
                    difference < 0 -> "От первого к последнему: уменьшение на ${number(-difference, 1)} мм"
                    else -> "От первого к последнему: увеличение на ${number(difference, 1)} мм"
                }, Modifier.testTag("geometry-trend-change"))
                if (before > 1e-9) Text("Изменение: ${if (difference > 0) "+" else ""}${number(100 * difference / before, 1)}%",
                    style = MaterialTheme.typography.bodySmall)
            }
            if (eligible.any { it.journalMeta!!.positions!!.size < it.scoredCount }) {
                Text("Неполный охват координат: геометрия описывает только отмеченную часть выстрелов.",
                    style = MaterialTheme.typography.bodySmall)
            }
        }
        GlossaryText("Выбери точку занятия · кучность RMS и смещение в миллиметрах.", mapOf(
            "занятия" to "На графике последние 12 занятий выбранной группы с минимум тремя подтверждёнными координатами. " +
                "Нажми точку или используй кнопки. Расстояние между точками обозначает порядок занятий, а не время. " +
                "Шкала в миллиметрах начинается с нуля. Первый и последний в сравнении относятся ко всей выбранной группе.",
        ), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun GeometryTrendPlot(values: List<Double>, ceiling: Double, selected: Int, onSelect: (Int) -> Unit) {
    val currentOnSelect by rememberUpdatedState(onSelect)
    val accent = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    val motion = LocalFableVisuals.current.motion
    val radius by animateFloatAsState(if (selected == values.lastIndex) 6f else 7f,
        animationSpec = if (motion) tween(180) else snap(), label = "selected geometry point")
    Row(Modifier.fillMaxWidth().height(180.dp)) {
        Column(Modifier.widthIn(min = 58.dp).fillMaxHeight(), verticalArrangement = Arrangement.SpaceBetween) {
            Text(number(ceiling, 1), style = MaterialTheme.typography.labelSmall)
            Text(number(ceiling / 2, 1), style = MaterialTheme.typography.labelSmall)
            Text("0 мм", style = MaterialTheme.typography.labelSmall)
        }
        Canvas(Modifier.weight(1f).fillMaxHeight().testTag("geometry-trend-chart")
            .semantics {
                contentDescription = "Геометрия по занятиям, шкала от 0 до ${number(ceiling, 1)} миллиметров"
                stateDescription = "Точка ${selected + 1} из ${values.size}: ${number(values[selected], 2)} миллиметров"
                customActions = listOf(
                    CustomAccessibilityAction("Предыдущее занятие") {
                        if (selected > 0) { onSelect(selected - 1); true } else false
                    },
                    CustomAccessibilityAction("Следующее занятие") {
                        if (selected < values.lastIndex) { onSelect(selected + 1); true } else false
                    },
                )
            }
            .pointerInput(values) {
                detectTapGestures { tap ->
                    val inset = 8.dp.toPx()
                    val fraction = ((tap.x - inset) / (size.width - 2 * inset).coerceAtLeast(1f)).coerceIn(0f, 1f)
                    currentOnSelect((fraction * values.lastIndex).roundToInt())
                }
            }) {
            val inset = 8.dp.toPx()
            val width = (size.width - 2 * inset).coerceAtLeast(1f)
            val height = (size.height - 2 * inset).coerceAtLeast(1f)
            fun location(index: Int) = Offset(
                inset + width * if (values.size == 1) .5f else index.toFloat() / values.lastIndex,
                inset + height * (1 - values[index] / ceiling).coerceAtLeast(0.0).toFloat(),
            )
            for (line in 0..2) {
                val y = inset + height * line / 2
                drawLine(grid, Offset(inset, y), Offset(size.width - inset, y), 1.dp.toPx())
            }
            val path = Path()
            values.indices.forEach { index ->
                val point = location(index)
                if (index == 0) path.moveTo(point.x, point.y) else path.lineTo(point.x, point.y)
            }
            drawPath(path, accent, style = Stroke(2.dp.toPx()))
            values.indices.forEach { drawCircle(accent, 3.dp.toPx(), location(it)) }
            val marker = location(selected)
            drawLine(accent.copy(alpha = .3f), Offset(marker.x, inset), Offset(marker.x, size.height - inset), 1.dp.toPx())
            drawCircle(accent, radius.dp.toPx(), marker)
        }
    }
}

private fun trendDate(row: SessionSummary): String = sessionDate(row)?.format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))
    ?: "Дата неизвестна"

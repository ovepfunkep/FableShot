package app.fableshot.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.journal.PhysicalArrowAnalysisGroup
import app.fableshot.android.data.journal.PhysicalArrowResult
import app.fableshot.android.domain.TargetCatalog
import kotlin.math.*

private val arrowColors = listOf(Color(0xFF005A9C), Color(0xFFC34700), Color(0xFF007C6D),
    Color(0xFF8C3D99), Color(0xFF9A6600), Color(0xFFB02D50), Color(0xFF445569), Color(0xFF476C00))
private val mapInset = 10.dp

private class ArrowMapFrame(size: Size, inset: Float, extent: Double) {
    val center = Offset(size.width / 2, size.height / 2)
    val radius = ((min(size.width, size.height) / 2 - inset).coerceAtLeast(1f) / extent).toFloat()

    fun point(x: Double, y: Double) = center + Offset((x * radius).toFloat(), (-y * radius).toFloat())
}

/** A fixed, shared frame includes all known hits and RMS circles, also while filtering one arrow. */
internal fun physicalArrowMapExtent(group: PhysicalArrowAnalysisGroup): Double {
    val radiusMm = group.targetDiameterMm?.takeIf { it > 0 }?.div(2.0) ?: return 1.0
    var extent = 1.0
    for (arrow in group.arrows) {
        arrow.positions.filter { it.x.isFinite() && it.y.isFinite() }.forEach {
            extent = max(extent, max(abs(it.x), abs(it.y)))
        }
        val x = arrow.centroidX
        val y = arrow.centroidY
        val rms = arrow.rmsMm
        if (x?.isFinite() == true && y?.isFinite() == true && rms?.isFinite() == true && rms >= 0) {
            extent = max(extent, max(abs(x), abs(y)) + rms / radiusMm)
        }
    }
    return extent
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PhysicalArrowComparison(
    group: PhysicalArrowAnalysisGroup,
    selected: PhysicalArrowResult?,
    onSelect: (Int?) -> Unit,
) {
    val showGrouping = statisticVisible(app.fableshot.android.data.StatisticFeature.Grouping)
    val profile = TargetCatalog.find(group.targetProfileId)
    val radiusMm = group.targetDiameterMm?.takeIf { it > 0 }?.div(2.0)
    val visible = if (selected == null) group.arrows else listOf(selected)
    val extent = remember(group) { physicalArrowMapExtent(group) }
    val selectArrow by rememberUpdatedState(onSelect)
    val colors = remember(group.arrows) {
        group.arrows.mapIndexed { index, arrow -> arrow.number to arrowColors[index % arrowColors.size] }.toMap()
    }
    FlowRow(
        Modifier.fillMaxWidth().testTag("physical-arrow-filters"),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        FilterChip(selected == null, { onSelect(null) }, { Text("Все") },
            Modifier.heightIn(min = 48.dp).testTag("physical-arrow-filter-all"))
        group.arrows.forEach { arrow ->
            FilterChip(selected?.number == arrow.number, { onSelect(arrow.number) }, { Text("№${arrow.number}") },
                Modifier.heightIn(min = 48.dp).testTag("physical-arrow-filter-${arrow.number}"),
                leadingIcon = { Box(Modifier.size(10.dp).background(colors.getValue(arrow.number), CircleShape)) })
        }
    }
    if (profile == null || radiusMm == null || group.arrows.none { it.positions.isNotEmpty() }) {
        Text("Пока нет попаданий с координатами.", Modifier.testTag("physical-arrow-map-empty"),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    Canvas(Modifier.fillMaxWidth().aspectRatio(1f).testTag("physical-arrow-map")
        .pointerInput(visible, extent) {
            detectTapGestures { tap ->
                val frame = ArrowMapFrame(Size(size.width.toFloat(), size.height.toFloat()), mapInset.toPx(), extent)
                val nearby = visible.mapNotNull { arrow ->
                    val distance = arrow.positions.minOfOrNull { hit -> (frame.point(hit.x, hit.y) - tap).getDistance() }
                    distance?.takeIf { it <= 14.dp.toPx() }?.let { arrow.number to it }
                }.sortedBy { it.second }
                val closest = nearby.firstOrNull() ?: return@detectTapGestures
                val next = nearby.getOrNull(1)
                if (next == null || next.second - closest.second > 2.dp.toPx()) selectArrow(closest.first)
            }
        }.semantics {
            contentDescription = "Общая мишень номерных стрел"
            stateDescription = "${if (selected == null) "Все номера" else "Стрела №${selected.number}"}. " +
                "Масштаб ±${number(extent * radiusMm, 1)} мм"
        }
    ) {
        // The complete group defines the frame even when only one arrow is displayed.
        val frame = ArrowMapFrame(size, mapInset.toPx(), extent)
        drawTargetFace(frame.center, frame.radius, emptyList(), null, null, profile = profile)
        if (showGrouping) visible.forEach { arrow ->
            val x = arrow.centroidX ?: return@forEach
            val y = arrow.centroidY ?: return@forEach
            val rms = arrow.rmsMm ?: return@forEach
            val color = colors.getValue(arrow.number)
            val center = frame.point(x, y)
            val radius = (rms / radiusMm * frame.radius).toFloat()
            drawCircle(color.copy(alpha = .18f), radius, center)
            drawCircle(color.copy(alpha = .65f), radius, center, style = Stroke(1.25.dp.toPx()))
        }
        visible.forEach { arrow ->
            val color = colors.getValue(arrow.number)
            arrow.positions.forEach { hit ->
                val position = frame.point(hit.x, hit.y)
                drawCircle(Color.White.copy(alpha = .9f), 3.5.dp.toPx(), position)
                drawCircle(color, 2.5.dp.toPx(), position)
            }
        }
    }
}

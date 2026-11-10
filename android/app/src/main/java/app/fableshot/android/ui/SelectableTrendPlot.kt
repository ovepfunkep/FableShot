package app.fableshot.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import kotlin.math.abs

internal data class TrendPoint(val x: Double, val value: Double)
internal val trendInset = 8.dp

/** Both charts use the same marker and tap behavior. The caller defines what the horizontal axis means. */
@Composable
internal fun SelectableTrendPlot(
    points: List<TrendPoint>,
    start: Double,
    end: Double,
    ceiling: Double,
    selected: Int?,
    description: String,
    selectedValue: String?,
    modifier: Modifier = Modifier,
    viewportActions: List<CustomAccessibilityAction> = emptyList(),
    onSelect: (Int) -> Unit,
) {
    val currentSelect by rememberUpdatedState(onSelect)
    val first = points.binarySearchBy(start) { it.x }.let { if (it >= 0) it else -it - 1 }
    val after = points.binarySearchBy(end) { it.x }.let { if (it >= 0) it + 1 else -it - 1 }
    val accent = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    Canvas(modifier.fillMaxWidth().height(156.dp).semantics {
        contentDescription = description
        selectedValue?.let { stateDescription = it }
        customActions = viewportActions + if (selected != null) {
            listOf(
                CustomAccessibilityAction("Предыдущая точка") {
                    if (selected > first) { onSelect(selected - 1); true } else false
                },
                CustomAccessibilityAction("Следующая точка") {
                    if (selected + 1 < after) { onSelect(selected + 1); true } else false
                },
            )
        } else emptyList()
    }.pointerInput(points, start, end) {
        detectTapGestures { tap ->
            val inset = trendInset.toPx()
            val width = (size.width - 2 * inset).coerceAtLeast(1f)
            val axisValue = start + (end - start) * ((tap.x - inset) / width).coerceIn(0f, 1f)
            (first until after).minByOrNull { abs(points[it].x - axisValue) }?.let(currentSelect)
        }
    }) {
        val inset = trendInset.toPx()
        val width = (size.width - 2 * inset).coerceAtLeast(1f)
        val height = (size.height - 2 * inset).coerceAtLeast(1f)
        fun position(point: TrendPoint) = Offset(
            inset + ((point.x - start) / (end - start)).toFloat() * width,
            inset + height * (1 - point.value / ceiling).coerceIn(0.0, 1.0).toFloat(),
        )
        repeat(3) { index ->
            val y = inset + height * index / 2
            drawLine(grid, Offset(inset, y), Offset(size.width - inset, y), 1.dp.toPx())
        }
        clipRect(left = inset, right = size.width - inset) {
            val begin = (first - 1).coerceAtLeast(0)
            val stop = (after + 1).coerceAtMost(points.size)
            for (index in begin + 1 until stop) {
                drawLine(accent, position(points[index - 1]), position(points[index]), 2.dp.toPx(), StrokeCap.Round)
            }
        }
        for (index in first until after) drawCircle(accent, 3.dp.toPx(), position(points[index]))
        if (selected != null && selected in first until after) {
            val marker = position(points[selected])
            drawLine(accent.copy(alpha = .35f), Offset(marker.x, inset), Offset(marker.x, size.height - inset), 1.dp.toPx())
            drawCircle(accent, 6.dp.toPx(), marker)
        }
    }
}

package app.fableshot.android.ui

import kotlin.math.roundToInt

internal data class RankLabelPlacement(val left: Int, val width: Int, val lane: Int, val anchor: Float)

/** Pack labels into lanes without changing the true numerical positions of their ticks. */
internal fun rankLabelPlacements(anchors: List<Float>, widths: List<Int>, width: Int, gap: Int): List<RankLabelPlacement> {
    require(anchors.size == widths.size && width >= 0 && gap >= 0)
    val ends = mutableListOf<Int>()
    return anchors.mapIndexed { index, anchor ->
        val labelWidth = widths[index].coerceIn(0, width)
        val left = (anchor - labelWidth / 2f).roundToInt().coerceIn(0, width - labelWidth)
        val lane = ends.indexOfFirst { it + gap <= left }.takeIf { it >= 0 } ?: ends.size
        if (lane == ends.size) ends.add(left + labelWidth) else ends[lane] = left + labelWidth
        RankLabelPlacement(left, labelWidth, lane, anchor)
    }
}

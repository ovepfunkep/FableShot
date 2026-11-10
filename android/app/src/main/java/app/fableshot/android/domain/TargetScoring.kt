package app.fableshot.android.domain

import kotlin.math.hypot
import kotlin.math.sqrt

data class TargetPoint(val x: Double, val y: Double) {
    init { require(x.isFinite() && y.isFinite()) }
}

/** Educational point geometry, not a shaft-touch judging measurement. */
object TargetScoring {
    fun score(point: TargetPoint): Int {
        val radius = hypot(point.x, point.y)
        for (value in 10 downTo 1) {
            if (radius <= (11 - value) / 10.0 + 1e-9) return value
        }
        return 0
    }

    fun rms(points: List<TargetPoint>): Double? {
        if (points.size < 3) return null
        val cx = points.sumOf { it.x } / points.size
        val cy = points.sumOf { it.y } / points.size
        return sqrt(points.sumOf { (it.x - cx) * (it.x - cx) + (it.y - cy) * (it.y - cy) } / points.size)
    }
}

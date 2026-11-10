package app.fableshot.android.domain

import app.fableshot.android.data.SessionDetails
import kotlin.math.hypot

/** Current single-condition schema only; not a CG3 or PG1 score. */
data class PracticeMetrics(
    val shotCount: Int,
    val total: Int,
    val average: Double?,
    val maximum: Int,
    val positions: List<TargetPoint>,
    val rms: Double?,
    val centroid: TargetPoint?,
    val centreOffset: Double?,
    val zoneCounts: List<Int>,
) {
    companion object {
        fun from(details: SessionDetails): PracticeMetrics {
            val shots = details.allShots
            val positions = shots.mapNotNull { if (it.x != null && it.y != null) TargetPoint(it.x, it.y) else null }
            val centroid = if (positions.isEmpty()) null else TargetPoint(positions.sumOf { it.x } / positions.size, positions.sumOf { it.y } / positions.size)
            return PracticeMetrics(shots.size, shots.sumOf { it.points }, if (shots.isEmpty()) null else shots.sumOf { it.points }.toDouble()/shots.size, shots.size*10,
                positions, TargetScoring.rms(positions), centroid, centroid?.let { hypot(it.x,it.y) }, (0..10).map { zone -> shots.count { it.points==zone } })
        }
    }
}

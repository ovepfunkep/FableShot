package app.fableshot.android.domain

import app.fableshot.android.data.SessionDetails
import app.fableshot.android.data.ShotEntity
import kotlin.math.hypot

data class TrainingHitMapSeries(
    val id: String,
    val label: String,
    val shots: List<ShotEntity>,
    val points: List<TargetPoint>,
    val unknownCoordinateCount: Int,
)

data class TrainingHitMapSelection(
    val label: String,
    val shots: List<ShotEntity>,
    val points: List<TargetPoint>,
    val unknownCoordinateCount: Int,
) {
    val shotCount: Int get() = shots.size
    val score: Int get() = shots.sumOf { it.points }
    val missCount: Int get() = shots.count { it.points == 0 || it.zoneCode == "M" }
    val rms: Double? get() = TargetScoring.rms(points)
    val centroid: TargetPoint? get() = points.takeIf { it.isNotEmpty() }?.let {
        TargetPoint(it.sumOf { point -> point.x } / it.size, it.sumOf { point -> point.y } / it.size)
    }
    val centreOffset: Double? get() = centroid?.let { hypot(it.x, it.y) }
}

/** Local map choices only; supplied journal evidence prevents legacy coordinates bypassing its validity rules. */
fun trainingHitMapSeries(
    details: SessionDetails,
    roundLabels: Map<String, String> = emptyMap(),
    coordinateEvidence: Map<String, Map<String, TargetPoint>>? = null,
): List<TrainingHitMapSeries> = details.orderedEnds
    .distinctBy { it.end.id }
    .filter { it.end.closed || it.shots.isNotEmpty() }
    .map { end ->
        val shots = end.shots.sortedBy { it.inputIndex }
        val points = if (coordinateEvidence != null) coordinateEvidence[end.end.id].orEmpty() else buildMap {
            for (shot in shots) {
                val x = shot.x
                val y = shot.y
                if (x != null && y != null && x.isFinite() && y.isFinite()) put(shot.id, TargetPoint(x, y))
            }
        }
        val unknownHits = shots.count { it.points > 0 && it.id !in points }
        TrainingHitMapSeries(end.end.id, roundLabels[end.end.id] ?: "Серия ${end.end.number}", shots, points.values.toList(), unknownHits)
    }

fun selectTrainingHitMapSeries(series: List<TrainingHitMapSeries>, endId: String?): TrainingHitMapSelection {
    val selected = series.firstOrNull { it.id == endId }
    return if (selected != null) TrainingHitMapSelection(selected.label, selected.shots, selected.points, selected.unknownCoordinateCount)
    else TrainingHitMapSelection("Все серии", series.flatMap { it.shots }, series.flatMap { it.points }, series.sumOf { it.unknownCoordinateCount })
}

package app.fableshot.android.export

import app.fableshot.android.domain.RankEvaluation
import app.fableshot.android.domain.RankThreshold

/** Neighbouring score thresholds of a complete exercise; never a forecast or assignment. */
data class PosterRankInterval(
    val points: Int,
    val arrows: Int,
    val lower: RankThreshold?,
    val upper: RankThreshold?,
) {
    val lowerScore: Int get() = lower?.score ?: 0
    val upperScore: Int get() = upper?.score ?: arrows * 10
    val aboveLower: Int get() = points - lowerScore
    val toUpper: Int get() = upperScore - points
    val position: Float get() = if (upperScore == lowerScore) 1f else
        ((points - lowerScore).toFloat() / (upperScore - lowerScore)).coerceIn(0f, 1f)

    companion object {
        fun from(evaluation: RankEvaluation): PosterRankInterval? {
            if (!evaluation.complete) return null
            return PosterRankInterval(
                evaluation.points,
                evaluation.entered,
                evaluation.result,
                evaluation.next,
            )
        }
    }
}

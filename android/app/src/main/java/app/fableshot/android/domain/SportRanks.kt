package app.fableshot.android.domain

data class RankThreshold(val label: String, val score: Int)

fun rankClassLabel(bow: String?, category: String?): String? {
    val discipline = when (bow) { "recurve" -> "КЛ"; "compound" -> "БЛ"; "barebow" -> "КЛб"; else -> return null }
    val sex = when (category) { "male" -> "М"; "female" -> "Ж"; else -> return null }
    return "$discipline($sex)"
}

/** Reference rows retain source wording and blanks; they do not enable automatic matching. */
data class RankReferenceRow(
    val sourceRow: Int,
    val group: String,
    val title: String,
    val volume: String,
    val condition: String,
    val male: List<Int?>,
    val female: List<Int?>,
)

data class RankExercise(
    val id: String,
    val bow: String,
    val distance: Int,
    val arrows: Int,
    val category: String,
    val sourceRow: Int,
    val thresholds: List<RankThreshold>,
) {
    init {
        require(arrows > 0 && thresholds.isNotEmpty())
        require(thresholds.zipWithNext().all { (a, b) -> a.score < b.score })
        require(thresholds.all { it.score in 1..arrows * 10 })
    }
}

/** Exact integer comparisons: display rounding must never promote a result. */
data class RankEvaluation(val exercise: RankExercise, val points: Int, val entered: Int) {
    init { require(entered >= 0 && points in 0..entered * 10) }
    val average: Double? get() = if (entered == 0) null else points.toDouble() / entered
    val projected: Double? get() = average?.times(exercise.arrows)
    val pace: RankThreshold? get() = if (entered == 0) null else exercise.thresholds.lastOrNull {
        points.toLong() * exercise.arrows >= it.score.toLong() * entered
    }
    val complete get() = entered == exercise.arrows
    val result: RankThreshold? get() = if (complete) pace else null
    val next: RankThreshold? get() = exercise.thresholds.firstOrNull {
        entered == 0 || points.toLong() * exercise.arrows < it.score.toLong() * entered
    }
    fun requiredRemaining(threshold: RankThreshold): Double? {
        val remaining = exercise.arrows - entered
        return if (remaining <= 0) null else ((threshold.score - points).coerceAtLeast(0)).toDouble() / remaining
    }
}

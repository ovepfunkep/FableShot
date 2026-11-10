package app.fableshot.android.data.journal

import app.fableshot.android.domain.RankEvaluation
import app.fableshot.android.domain.matchingRankExercises
import app.fableshot.android.domain.rankClassLabel

/** A forecast from one saved sample; never an assignment or an achievement grant. */
data class JournalStageRank(
    val assessment: JournalRankAssessment,
    val classLabel: String?,
    val endIds: Set<String>,
    val scopeLabel: String,
    val sampleArrowCount: Int,
    val formatKey: String,
) {
    val evaluation get() = assessment.evaluation
    val label: String? get() = evaluation?.takeIf { it.entered > 0 }?.let { it.pace?.label ?: "ниже порога" }
}

data class JournalRoundRank(val number: Int, val category: String, val rank: JournalStageRank)

fun JournalDetails.roundRank(
    category: String?,
    endId: String? = currentEnd?.end?.id,
    draft: JournalShot? = null,
): JournalStageRank {
    val round = roundProgress(endId)
    return stageRank(category, round.ends, round, "Раунд ${round.number}", draft)
}

fun JournalDetails.seriesRank(
    category: String?,
    endId: String? = currentEnd?.end?.id,
    draft: JournalShot? = null,
): JournalStageRank {
    val round = roundProgress(endId)
    val ends = orderedBlocks.flatMap { it.orderedEnds }.filter { it.end.id == endId }
    return stageRank(category, ends, round, "Серия ${round.seriesNumber}", draft)
}

fun JournalDetails.stageRankDetails(rank: JournalStageRank): JournalDetails = copy(
    blocks = orderedBlocks.mapNotNull { block ->
        block.ends.filter { it.end.id in rank.endIds }.takeIf { it.isNotEmpty() }?.let { block.copy(ends = it) }
    },
    plans = emptyList(),
)

private fun JournalDetails.stageRank(
    category: String?,
    ends: List<JournalEndDetails>,
    round: RoundProgress,
    scopeLabel: String,
    draft: JournalShot?,
): JournalStageRank {
    val scored = ends.filter { it.end.role == "scored" }
    val endIds = scored.map { it.end.id }.toSet()
    val owners = orderedBlocks.filter { block -> block.ends.any { it.end.id in endIds } }
    val conditions = owners.map { it.block.rankConditions() }.distinct()
    val shots = scored.flatMap { it.shots }.map { shot -> draft?.takeIf { it.id == shot.id } ?: shot }
    val classLabel = rankClassLabel(conditions.singleOrNull()?.bow, category)
    val conditionKey = owners.map { block ->
        val b = block.block
        listOf(b.mode, b.distanceMeters, b.targetProfileId, b.targetProfileVersion, b.targetDiameterMm,
            b.rankConditions().bow).joinToString("|")
    }.distinct().sorted().joinToString(";")
    fun unavailable(reason: String, needsBow: Boolean = false) = JournalStageRank(
        JournalRankAssessment(reason = reason, needsBowType = needsBow), classLabel, endIds,
        scopeLabel, shots.size, "$conditionKey|$category",
    )
    if (scored.isEmpty()) return unavailable("Нет зачётных стрел")
    if (owners.any { it.block.mode != "scored" } || scored.any { it.counts.isNotEmpty() })
        return unavailable("Для нормативов нужны очки попаданий")
    if (conditions.size != 1) return unavailable("В выборке разные условия — норматив не объединяем")
    val condition = conditions.single()
    if (condition.bow == null) return unavailable("Укажи тип лука в снаряжении тренировки", needsBow = true)
    if (category !in listOf("male", "female")) return unavailable("Выбери категорию сравнения")
    if (owners.any { it.block.verifiedTarget() == null })
        return unavailable("Для сравнения нужен подтверждённый профиль мишени")
    val candidates = matchingRankExercises(condition, requireNotNull(category))
    if (candidates.isEmpty()) return unavailable("Для этих условий пока нет поддерживаемого норматива")

    // A series uses its owning round's reference, never its own short volume as an exercise.
    val plannedArrows = round.plannedArrowCount
    val closedRound = round.ends.isNotEmpty() && round.ends.all { it.end.state == "closed" }
    val roundVolume = round.ends.sumOf { it.shots.size }
    val referenceVolume = plannedArrows ?: roundVolume.takeIf { closedRound }
    val exercise = candidates.firstOrNull { it.arrows == referenceVolume }
        ?: candidates.firstOrNull { it.arrows == 60 } ?: candidates.first()
    val evaluation = RankEvaluation(exercise, shots.sumOf { it.points }, shots.size)
    val assessment = JournalRankAssessment(evaluation = evaluation, plannedArrows = plannedArrows)
    return JournalStageRank(assessment, classLabel, endIds, scopeLabel, shots.size,
        "$conditionKey|${exercise.id}")
}

fun JournalDetails.roundRankSummaries(): List<JournalRoundRank> = trainingRounds().flatMap { round ->
    listOf("male", "female").map { category ->
        JournalRoundRank(round.number, category, roundRank(category, round.ends.firstOrNull()?.end?.id))
    }
}

data class HistoryRankOverview(
    val formatCount: Int,
    val evaluation: RankEvaluation? = null,
    val classLabel: String? = null,
) {
    val label: String? get() = when {
        formatCount > 1 -> when {
            formatCount % 100 in 11..14 -> "$formatCount форматов"
            formatCount % 10 in 2..4 -> "$formatCount формата"
            formatCount % 10 == 1 -> "$formatCount формат"
            else -> "$formatCount форматов"
        }
        evaluation != null -> evaluation.pace?.label ?: "ниже порога"
        else -> null
    }
}

/** Weighted mean only within the exact same reference; incompatible rounds are never ranked together. */
fun List<JournalRoundRank>.historyRank(category: String?): HistoryRankOverview {
    val values = filter { it.category == category && it.rank.sampleArrowCount > 0 }.map { it.rank }
    val formats = values.map { it.formatKey }.distinct().size
    if (formats != 1 || values.any { it.evaluation == null }) return HistoryRankOverview(formats)
    val evaluations = values.mapNotNull { it.evaluation }
    val exercise = evaluations.first().exercise
    val combined = RankEvaluation(exercise, evaluations.sumOf { it.points }, evaluations.sumOf { it.entered })
    return HistoryRankOverview(1, combined, values.first().classLabel)
}

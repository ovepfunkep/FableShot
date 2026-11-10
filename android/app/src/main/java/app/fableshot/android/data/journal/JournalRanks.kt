package app.fableshot.android.data.journal

import app.fableshot.android.domain.*
import org.json.JSONObject
import app.fableshot.android.data.EquipmentRepository
import app.fableshot.android.data.SessionSummary

data class PersonalRankResult(val session:SessionSummary,val evaluation:RankEvaluation)

/** Derived from complete source facts, never a stored award or official assignment. */
fun JournalDetails.fullRankResults():List<RankEvaluation> {
    if(session.state!="completed" || session.deletedAtMs!=null) return emptyList()
    return listOf("male","female").mapNotNull { category ->
        rankAssessment(category).takeIf { it.finalResult }?.evaluation
    }
}

fun bestRankResults(sessions:List<SessionSummary>,category:String?):List<PersonalRankResult> {
    if(category !in listOf("male","female")) return emptyList()
    return sessions.filter { it.state=="completed" }.flatMap { session ->
        session.journalMeta?.rankResults.orEmpty().filter { it.exercise.category==category }
            .map { PersonalRankResult(session,it) }
    }.groupBy { it.evaluation.exercise.id }.values.map { results ->
        results.sortedWith(compareByDescending<PersonalRankResult> { it.evaluation.points }
            .thenBy { it.session.startedAt }.thenBy { it.session.id }).first()
    }.sortedWith(compareBy<PersonalRankResult> { it.evaluation.exercise.bow }
        .thenBy { it.evaluation.exercise.distance }.thenBy { it.evaluation.exercise.arrows })
}

data class JournalRankAssessment(
    val evaluation: RankEvaluation? = null,
    val reason: String? = null,
    val finalResult: Boolean = false,
    val plannedArrows: Int? = null,
    val needsBowType: Boolean = false,
)

internal fun JournalBlock.rankConditions(): RankConditions {
    val bow = equipmentSnapshotJson?.let { json ->
        runCatching {
            JSONObject(json).optJSONObject("bow")?.optString("category")
                ?.takeIf { it in EquipmentRepository.BOW_CATEGORIES }
        }.getOrNull()
    }
    return RankConditions(bow, distanceMeters, targetProfileId, targetDiameterMm)
}

fun JournalDetails.rankClassLabel(category: String?): String? {
    val bows = orderedBlocks.filter { b -> b.ends.any { it.end.role == "scored" } }
        .map { it.block.rankConditions().bow }.distinct()
    return app.fableshot.android.domain.rankClassLabel(bows.singleOrNull(), category)
}

fun JournalDetails.rankAssessment(category: String?, draft: JournalShot? = null): JournalRankAssessment {
    val scoredBlocks = orderedBlocks.filter { b -> b.ends.any { it.end.role == "scored" } }
    if (scoredBlocks.isEmpty()) return JournalRankAssessment(reason = "Нет зачётных стрел")
    if (scoredBlocks.any { it.block.mode == "count_only" })
        return JournalRankAssessment(reason = "Для нормативов нужны очки попаданий")
    val conditions = scoredBlocks.map { it.block.rankConditions() }
    if (conditions.distinct().size != 1 || scoredBlocks.map { it.block.equipmentSnapshotJson }.distinct().size != 1)
        return JournalRankAssessment(reason = "В тренировке разные условия — норматив не объединяем")
    val condition = conditions.singleOrNull() ?: conditions.first()
    if (condition.bow == null) {
        return JournalRankAssessment(reason = "Укажи тип лука в снаряжении тренировки", needsBowType = true)
    }
    if (category == null) return JournalRankAssessment(reason = "Выбери категорию сравнения")
    val candidates = matchingRankExercises(condition, category)
    if (candidates.isEmpty()) return JournalRankAssessment(reason = "Для этих условий пока нет поддерживаемого норматива")
    val ends = scoredBlocks.flatMap { it.orderedEnds }.filter { it.end.role == "scored" }
    val shots = ends.flatMap { it.shots }.map { shot -> draft?.takeIf { it.id == shot.id } ?: shot }
    val planned = plannedEnds?.let { count ->
        val counts = ends.map { it.end.plannedCount }.distinct()
        if (counts.size == 1) count * counts.single() else null
    }
    val desired = if (session.state == "completed") shots.size else planned
    val exercise = candidates.firstOrNull { it.arrows == desired }
        ?: candidates.firstOrNull { it.arrows == 60 } ?: candidates.first()
    val evaluation = RankEvaluation(exercise, shots.sumOf { it.points }, shots.size)
    // A complete volume is necessary, but never proves official assignment/status/age.
    val fullEnds = ends.filter { it.volume > 0 }.all { it.full }
    return JournalRankAssessment(evaluation, finalResult = session.state == "completed" && evaluation.complete && fullEnds,
        plannedArrows = planned)
}

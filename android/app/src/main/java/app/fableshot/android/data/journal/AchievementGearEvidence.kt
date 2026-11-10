package app.fableshot.android.data.journal

import org.json.JSONArray
import org.json.JSONObject

internal data class AchievementGearEvidence(
    val ruleId: String,
    val sessionId: String,
    val count: Long,
    val date: String?,
)

private const val BOW_RULE = "GEAR02"
private const val DISTANCE_RULE = "GEAR03"
private const val KIT_RULE = "GEAR06"
private const val BOW_SESSIONS = 10
private const val DISTANCES = 3
private const val KIT_SESSIONS = 50
private const val DISTANCE_ARROWS = 12
private val gearRules = setOf(BOW_RULE, DISTANCE_RULE, KIT_RULE)

private data class GearTraining(
    val session: JournalSession,
    val rules: Set<String>,
    val bowId: String?,
    val kitId: String?,
    val distances: Set<Double>,
) {
    fun evidence(ruleId: String, count: Int) = AchievementGearEvidence(ruleId, session.id, count.toLong(), session.localDate)
}

private val gearChronology = compareBy<JournalSession> { it.completedAtMs ?: it.createdAtMs }
    .thenBy { it.createdAtMs }
    .thenBy { it.id }

internal fun achievementGearEvidence(
    details: List<JournalDetails>,
    enrollments: Map<String, AchievementEnrollment>,
    triggerSessionId: String? = null,
): List<AchievementGearEvidence> {
    val trainings = details.mapNotNull { detail ->
        enrollments[detail.session.id]?.let { detail.gearTraining(it) }
    }.distinctBy { it.session.id }.sortedWith(compareBy<GearTraining, JournalSession>(gearChronology) { it.session })
    return listOfNotNull(
        identityEvidence(trainings, BOW_RULE, BOW_SESSIONS, triggerSessionId, GearTraining::bowId),
        distanceEvidence(trainings, triggerSessionId),
        identityEvidence(trainings, KIT_RULE, KIT_SESSIONS, triggerSessionId, GearTraining::kitId),
    )
}

private fun identityEvidence(
    trainings: List<GearTraining>,
    ruleId: String,
    target: Int,
    triggerSessionId: String?,
    identity: (GearTraining) -> String?,
): AchievementGearEvidence? {
    val groups = trainings.mapNotNull { training ->
        identity(training)?.takeIf { ruleId in training.rules }?.let { it to training }
    }.groupBy({ it.first }, { it.second })
    if (triggerSessionId != null) {
        val trigger = trainings.firstOrNull { it.session.id == triggerSessionId && ruleId in it.rules } ?: return null
        val id = identity(trigger) ?: return null
        val group = groups[id] ?: return null
        return trigger.evidence(ruleId, group.size)
    }
    val (source, count) = groups.values.map { group ->
        group.getOrElse(target - 1) { group.last() } to group.size
    }.minWithOrNull(compareByDescending<Pair<GearTraining, Int>> { it.second }
        .thenBy(gearChronology) { it.first.session }) ?: return null
    return source.evidence(ruleId, count)
}

private fun distanceEvidence(trainings: List<GearTraining>, triggerSessionId: String?): AchievementGearEvidence? {
    val eligible = trainings.filter { DISTANCE_RULE in it.rules && it.distances.isNotEmpty() }
    val seen = mutableSetOf<Double>()
    var crossing: GearTraining? = null
    for (training in eligible) {
        val addedDistance = seen.addAll(training.distances)
        if (training.session.id == triggerSessionId) {
            return if (addedDistance) training.evidence(DISTANCE_RULE, seen.size) else null
        }
        if (crossing == null && seen.size >= DISTANCES) crossing = training
    }
    if (triggerSessionId != null) return null
    return (crossing ?: eligible.lastOrNull())?.evidence(DISTANCE_RULE, seen.size)
}

private fun JournalDetails.gearTraining(enrollment: AchievementEnrollment): GearTraining? {
    if (session.state != "completed" || session.kind != "training" || session.deletedAtMs != null ||
        session.sourceKind != "native" || session.timeSource != "app_clock" ||
        session.id != enrollment.sessionId || session.createdAtMs != enrollment.enrolledAtMs ||
        session.localDate != enrollment.localDate) return null
    val rules = runCatching {
        val raw = JSONArray(enrollment.ruleIdsJson)
        (0 until raw.length()).mapNotNull { raw.optString(it).takeIf(gearRules::contains) }.toSet()
    }.getOrDefault(emptySet())
    if (rules.isEmpty()) return null

    val bowIds = mutableSetOf<String?>()
    val kitIds = mutableSetOf<String?>()
    val distances = mutableSetOf<Double>()
    var segmentDistance: Double? = null
    var segmentArrows = 0
    for (entry in orderedBlocks) {
        var populated = false
        var scoredArrows = 0
        for (end in entry.ends) {
            val shots = end.shots.count { shot ->
                shot.createdAtMs >= enrollment.enrolledAtMs && shot.scoreSource != "imported" && shot.positionSource != "imported"
            }
            if (shots > 0 || end.counts.any { it.count > 0 && it.createdAtMs >= enrollment.enrolledAtMs }) populated = true
            if (entry.block.mode == "scored" && end.end.role == "scored") scoredArrows += shots
        }

        if (populated && (BOW_RULE in rules || KIT_RULE in rules)) {
            val snapshot = entry.block.equipmentSnapshotJson?.let { runCatching { JSONObject(it) }.getOrNull() }
            bowIds += snapshot?.optJSONObject("bow").savedId("bow")
            kitIds += snapshot?.optJSONObject("selection").savedId("setup")
        }

        // A short visit cannot borrow arrows from a different distance segment or session.
        val distance = entry.block.distanceMeters?.takeIf { it.isFinite() && it > 0.0 }
        if (distance != segmentDistance) {
            segmentDistance = distance
            segmentArrows = 0
        }
        if (distance != null && DISTANCE_RULE in rules) {
            segmentArrows += scoredArrows
            if (segmentArrows >= DISTANCE_ARROWS) distances += distance
        }
    }
    return GearTraining(session, rules, bowIds.singleOrNull(), kitIds.singleOrNull(), distances)
}

private fun JSONObject?.savedId(kind: String): String? =
    (this?.takeIf { it.optString("kind") == kind }?.opt("id") as? String)?.takeIf { it.isNotBlank() }

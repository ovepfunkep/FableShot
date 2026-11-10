package app.fableshot.android.data.journal

import app.fableshot.android.domain.ScoreRounding
import app.fableshot.android.domain.achievementBowLabels
import org.json.JSONArray
import org.json.JSONObject

internal data class AchievementProgressEvidence(
    val ruleId: String,
    val category: String,
    val sessionId: String,
    val count: Long,
    val date: String?,
)

private val progressThresholds = listOf(
    Triple("PROGRESS01", 100L, 12),
    Triple("PROGRESS02", 500L, 12),
    Triple("PROGRESS03", 1000L, 30),
)
private const val REPEATED_PROGRESS = "PROGRESS08"

internal fun AchievementEnrollment.ownsShot(shot: JournalShot): Boolean =
    shot.createdAtMs >= enrolledAtMs && shot.scoreSource != "imported" && shot.positionSource != "imported"

/** Current evidence against each scope's saved baseline. Older baseline sources need no enrollment. */
internal fun achievementProgressEvidence(
    details: List<JournalDetails>,
    enrollments: Map<String, AchievementEnrollment>,
    triggerSessionId: String? = null,
): List<AchievementProgressEvidence> {
    val strongest = linkedMapOf<Pair<String, String>, AchievementProgressEvidence>()
    val repeated = linkedMapOf<Pair<String, String>, MutableMap<String, JournalSession>>()

    fun keep(ruleId: String, category: String, source: JournalSession, count: Long) {
        val key = ruleId to category
        if (count > (strongest[key]?.count ?: 0L)) {
            strongest[key] = AchievementProgressEvidence(ruleId, category, source.id, count, source.localDate)
        }
    }

    for (detail in details) {
        val session = detail.session
        val enrollment = enrollments[session.id] ?: continue
        val startedAt = session.startedAtMs ?: continue
        if (enrollment.sessionId != session.id || session.deletedAtMs != null || session.sourceKind != "native" ||
            session.timeSource != "app_clock" || session.localDate != enrollment.localDate ||
            session.createdAtMs != enrollment.enrolledAtMs) continue
        val allowed = runCatching {
            val ids = JSONArray(enrollment.ruleIdsJson)
            (0 until ids.length()).map(ids::getString).toSet()
        }.getOrNull() ?: continue
        val checkThresholds = triggerSessionId == null || triggerSessionId == session.id
        val thresholds = if (checkThresholds) progressThresholds.filter { it.first in allowed } else emptyList()
        val checkRepeated = REPEATED_PROGRESS in allowed && session.state == "completed" && session.completedAtMs != null
        if (thresholds.isEmpty() && !checkRepeated) continue

        for (block in detail.progressAchievementScopes()) {
            val baseline = block.baselines.singleOrNull() ?: continue
            val conditions = progressConditions(block.block) ?: continue
            val category = JSONObject(conditions).getString("bowCategory")
            if (category !in achievementBowLabels || baseline.status != "ready" || baseline.scoreSum <= 0 ||
                baseline.policyVersion != "progress-pg1-v1" || baseline.conditionsJson != conditions ||
                baseline.sessionStartCutoffMs != startedAt || baseline.frozenAtMs < startedAt || baseline.maximumPerArrow != 10) continue

            val ends = block.orderedEnds.filter { it.end.role == "scored" }.toMutableList()
            if (ends.lastOrNull()?.let { it.end.state == "open" && it.volume == 0 } == true) ends.removeAt(ends.lastIndex)
            val closed = ends.takeWhile { it.end.state == "closed" && it.counts.isEmpty() && it.shots.size == it.end.plannedCount }
            val count = closed.sumOf { it.shots.size }
            if (count < 12) continue
            if (closed.any { end -> end.shots.any { !enrollment.ownsShot(it) || it.createdAtMs < baseline.frozenAtMs } }) continue

            val result = runCatching { journalProgress(block.copy(ends = closed)) }.getOrNull() ?: continue
            if (!result.fullRankAvailable) continue
            val points = ScoreRounding.hundredths(result.percentagePoints ?: continue)
            for ((id, threshold, minimum) in thresholds) {
                if (points >= threshold && count >= minimum) keep(id, category, session, 1)
            }
            if (checkRepeated && closed.size == ends.size && points > 0) {
                repeated.getOrPut(category to conditions) { linkedMapOf() }[session.id] = session
            }
        }
    }

    for ((key, sessions) in repeated) {
        val ordered = sessions.values.sortedWith(compareBy<JournalSession> { it.completedAtMs ?: it.createdAtMs }
            .thenBy { it.createdAtMs }.thenBy { it.id })
        if (triggerSessionId == null) {
            keep(REPEATED_PROGRESS, key.first, ordered[minOf(2, ordered.lastIndex)], ordered.size.toLong())
        } else {
            val index = ordered.indexOfFirst { it.id == triggerSessionId }
            if (index >= 0) keep(REPEATED_PROGRESS, key.first, ordered[index], index + 1L)
        }
    }
    return strongest.values.toList()
}

private fun JournalDetails.progressAchievementScopes(): Sequence<JournalBlockDetails> = reportScopes().asSequence()
    .filterNot { it.id.startsWith("part-") }
    .flatMap { scope ->
        // The report compares each part separately when their frozen bases disagree.
        if (scope.baseline == null) scope.blocks.asSequence() else sequenceOf(scope.merged())
    }

package app.fableshot.android

import app.fableshot.android.data.journal.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AchievementProgressEvidenceTest {
    private val rules = listOf("PROGRESS01", "PROGRESS02", "PROGRESS03", "PROGRESS08")

    private fun workout(
        id: Int,
        baselineSum: Long = 36L * 8,
        baselineCount: Int = 36,
        points: Int = 9,
        closedEnds: Int = 4,
        category: String = "barebow",
        distance: Double = 18.0,
        state: String = "completed",
        trailingShot: Boolean = false,
    ): JournalDetails {
        val start = 10_000L + id * 1000
        val session = JournalSession("session-$id", "Fixture", start, start,
            completedAtMs = if (state == "completed") start + 100 else null, localDate = "2026-11-04", state = state)
        val block = JournalBlock("block-$id", session.id, 0, "scored", distance, PRACTICE_PROFILE, 1, 600,
            practiceSnapshot(600), """{"bow":{"category":"$category"},"selection":{"name":"Bow $id"}}""", 3)
        val sources = JSONArray((1..3).map { index -> JSONObject().put("sessionId", "past-$index")
            .put("sourceKind", if (index == 1) "mytargets" else "native") })
        val baseline = ProgressBaseline(block.id, "baseline-$id", "progress-pg1-v1", start, start,
            requireNotNull(progressConditions(block)), 10, "ready", sources.toString(), baselineCount, baselineSum)
        val ends = List(closedEnds + if (trailingShot) 1 else 0) { ordinal ->
            val closed = ordinal < closedEnds
            val end = JournalEnd("end-$id-$ordinal", block.id, ordinal, 3, state = if (closed) "closed" else "open")
            val shots = List(if (closed) 3 else 1) { input ->
                JournalShot("shot-$id-$ordinal-$input", end.id, input, points, points.toString(),
                    null, null, null, null, null, "numeric_entry", "none", "unknown", null, start + 20)
            }
            JournalEndDetails(end, shots, emptyList())
        }
        return JournalDetails(session, listOf(JournalBlockDetails(block, ends, listOf(baseline))))
    }

    private fun enrollment(workout: JournalDetails, ids: List<String> = rules) = workout.session.let { session ->
        AchievementEnrollment(session.id, session.createdAtMs, requireNotNull(session.localDate), JSONArray(ids).toString(), null)
    }

    private fun ids(detail: JournalDetails, allowed: List<String> = rules): Set<String> =
        achievementProgressEvidence(listOf(detail), mapOf(detail.session.id to enrollment(detail, allowed)))
            .filter { it.ruleId != "PROGRESS08" }.map { it.ruleId }.toSet()

    @Test fun thresholdsUseDisplayedHundredthsAndMinimumClosedArrowCounts() {
        // +0.9958… pp displays as +1.00. The started fifth series is outside the last completed slice.
        assertEquals(setOf("PROGRESS01"), ids(workout(1, baselineSum = 21361, baselineCount = 2400,
            state = "active", trailingShot = true)))
        assertTrue(ids(workout(1, baselineSum = 21362, baselineCount = 2400)).isEmpty())
        assertTrue(ids(workout(1, closedEnds = 3)).isEmpty())
        assertEquals(setOf("PROGRESS01", "PROGRESS02"), ids(workout(1, baselineSum = 306)))
        assertEquals(setOf("PROGRESS01", "PROGRESS02"), ids(workout(1, closedEnds = 9)))
        assertEquals(setOf("PROGRESS01", "PROGRESS02", "PROGRESS03"), ids(workout(1, closedEnds = 10)))
    }

    @Test fun onlyEnrolledCurrentFactsQualifyAndCorrectionReevaluatesAgainstFrozenBaseline() {
        val source = workout(1)
        val validEnrollment = enrollment(source, listOf("PROGRESS01"))
        val input = mapOf(source.session.id to validEnrollment)
        assertEquals(setOf("PROGRESS01"), achievementProgressEvidence(listOf(source), input).map { it.ruleId }.toSet())
        assertTrue(achievementProgressEvidence(listOf(source), emptyMap()).isEmpty())
        assertTrue(achievementProgressEvidence(listOf(source.copy(session = source.session.copy(sourceKind = "mytargets"))), input).isEmpty())
        assertTrue(achievementProgressEvidence(listOf(source.copy(session = source.session.copy(deletedAtMs = 99_000))), input).isEmpty())
        assertTrue(achievementProgressEvidence(listOf(source.copy(session = source.session.copy(localDate = "2026-11-03"))), input).isEmpty())
        assertTrue(ids(workout(1, points = 8)).isEmpty())
        assertTrue(ids(workout(1, baselineSum = 0)).isEmpty())
        val block = source.blocks.single()
        val imported = block.ends.first().copy(shots = block.ends.first().shots.map { it.copy(scoreSource = "imported") })
        assertTrue(ids(source.copy(blocks = listOf(block.copy(ends = listOf(imported) + block.ends.drop(1))))).isEmpty())
        assertTrue(ids(source.copy(blocks = listOf(block.copy(baselines = block.baselines.map { it.copy(status = "building") })))).isEmpty())
    }

    @Test fun repeatNeedsThreeDifferentCompletedSessionsWithSameConditionsAndMatchingTrigger() {
        val a = workout(1)
        val b = workout(2)
        val otherDistance = workout(3, distance = 30.0)
        val otherBow = workout(4, category = "compound")
        val c = workout(5)
        val ongoing = workout(6, state = "active")
        val input = listOf(a, b, otherDistance, otherBow, c, ongoing)
        val enrollments = input.associate { it.session.id to enrollment(it, listOf("PROGRESS08")) }
        fun repeated(only: List<JournalDetails>, trigger: JournalDetails? = null) =
            achievementProgressEvidence(only, enrollments, trigger?.session?.id).singleOrNull { it.category == "barebow" }

        assertEquals(2L, repeated(input - c)?.count)
        assertEquals(3L, repeated(input)?.count)
        assertEquals(c.session.id, repeated(input, c)?.sessionId)
        assertEquals(3L, repeated(input, c)?.count)
        assertEquals(1L, repeated(input, otherDistance)?.count)
        assertNull(repeated(input, ongoing))
        assertEquals(2L, repeated(input.map { if (it == c) workout(5, points = 8) else it })?.count)
        assertEquals(2L, repeated(input.map { if (it == c) workout(5, trailingShot = true) else it })?.count)
        val withoutRule = enrollments + (c.session.id to enrollment(c, listOf("PROGRESS01")))
        assertEquals(2L, achievementProgressEvidence(input, withoutRule).single {
            it.ruleId == "PROGRESS08" && it.category == "barebow"
        }.count)
    }

    @Test fun severalQualifyingBlocksOfOneWorkoutStillCountAsOneWorkout() {
        val original = workout(1)
        val block = original.blocks.single()
        val second = block.copy(block = block.block.copy(id = "second-block", ordinal = 1,
            equipmentSnapshotJson = """{"bow":{"category":"barebow"},"selection":{"name":"Other bow"}}"""),
            ends = block.ends.map { entry ->
                val end = entry.end.copy(id = "second-${entry.end.id}", blockId = "second-block")
                entry.copy(end = end, shots = entry.shots.map { it.copy(id = "second-${it.id}", endId = end.id) })
            },
            baselines = block.baselines.map { it.copy(blockId = "second-block", baselineId = "second-baseline") })
        val sameWorkout = original.copy(blocks = listOf(block, second))
        val result = achievementProgressEvidence(listOf(sameWorkout), mapOf(original.session.id to enrollment(original)))
        assertEquals(1L, result.single { it.ruleId == "PROGRESS08" }.count)
    }
}

package app.fableshot.android

import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.equipmentSnapshot
import app.fableshot.android.data.journal.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class AchievementGearEvidenceTest {
    @Test fun bowThresholdCountsDistinctTrainingsBySavedIdAcrossRenamesAndKits() {
        val sameBow = (1..10).map { index ->
            training(index, segment(gear(bowName = "Bow revision $index", kitId = "kit-$index")))
        }
        val mixed = training(11, segment(gear()), segment(gear(bowId = "other")))
        val unknown = training(12, segment(gear()), segment(null))
        val emptyTail = training(13, segment(gear()), segment(gear(bowId = "other"), shots = 0))
        val alternateKit = training(14, segment(gear()), segment(gear(kitId = "another-kit")))
        val facts = sameBow + listOf(mixed, unknown, emptyTail, alternateKit, sameBow.first())
        val ninth = evidence(sameBow.take(9)).getValue("GEAR02")
        assertEquals(9L, ninth.count)
        val bow = evidence(facts.reversed()).getValue("GEAR02")
        assertEquals(12L, bow.count)
        assertEquals(sameBow.last().session.id, bow.sessionId)
        assertEquals(sameBow.last().session.localDate, bow.date)
        assertNull(evidence(facts, mixed.session.id)["GEAR02"])
        assertNull(evidence(facts, unknown.session.id)["GEAR02"])
        assertEquals(12L, evidence(facts, alternateKit.session.id).getValue("GEAR02").count)
        assertNull(evidence(facts, alternateKit.session.id)["GEAR06"])
    }

    @Test fun kitThresholdRequiresTheSameSavedSetupIdAndTriggerGroup() {
        val sameKit = (1..50).map { index ->
            training(index, segment(gear(kitName = "Kit revision $index", revision = index.toLong())))
        }
        val otherKit = training(51, segment(gear(kitId = "other-kit")))
        val directBow = training(52, segment(gear(kitId = null)))
        val mixed = training(53, segment(gear()), segment(gear(kitId = "other-kit")))
        val facts = sameKit + listOf(otherKit, directBow, mixed)
        assertEquals(49L, evidence(sameKit.take(49)).getValue("GEAR06").count)
        val kit = evidence(facts).getValue("GEAR06")
        assertEquals(50L, kit.count)
        assertEquals(sameKit.last().session.id, kit.sessionId)
        assertEquals(1L, evidence(facts, otherKit.session.id).getValue("GEAR06").count)
        assertNull(evidence(facts, directBow.session.id)["GEAR06"])
        assertNull(evidence(facts, mixed.session.id)["GEAR06"])
    }

    @Test fun distanceThresholdNeedsTwelveRecordedScoredArrowsInOneContinuousSessionSegment() {
        val first = training(1, segment(null, distance = 18.0, shots = 12))
        val second = training(2, segment(null, distance = 25.0, shots = 7), segment(null, distance = 25.0, shots = 5))
        val shortA = training(3, segment(null, distance = 30.0, shots = 6))
        val shortB = training(4, segment(null, distance = 30.0, shots = 6))
        val split = training(5, segment(null, distance = 35.0, shots = 6), segment(null, distance = 40.0, shots = 1),
            segment(null, distance = 35.0, shots = 6))
        val warmup = training(6, segment(null, distance = 50.0, shots = 12, role = "warmup"))
        val countOnly = training(7, segment(null, distance = 60.0, shots = 0, counted = 12, mode = "count_only"))
        val imported = training(8, segment(null, distance = 70.0, shots = 12, scoreSource = "imported"))
        val unknown = training(9, segment(null, distance = null, shots = 12), segment(null, distance = Double.NaN, shots = 12))
        val third = training(10, segment(null, distance = 30.0, shots = 12))
        val prior = listOf(first, second, shortA, shortB, split, warmup, countOnly, imported, unknown)
        assertEquals(2L, evidence(prior).getValue("GEAR03").count)
        val completed = prior + third
        val distance = evidence(completed.reversed()).getValue("GEAR03")
        assertEquals(3L, distance.count)
        assertEquals(third.session.id, distance.sessionId)
        assertEquals(distance, evidence(completed, third.session.id)["GEAR03"])
        for (excluded in listOf(shortA, shortB, split, warmup, countOnly, imported, unknown)) {
            assertNull(evidence(completed, excluded.session.id)["GEAR03"])
        }
    }

    @Test fun distanceTriggerMustAddNewEvidenceWithoutBorrowingLaterCompletions() {
        val first = training(1, segment(null, distance = 18.0, shots = 12))
        val second = training(2, segment(null, distance = 25.0, shots = 12))
        val third = training(3, segment(null, distance = 30.0, shots = 12))
        val repeat = training(4, segment(null, distance = 18.0, shots = 12))
        val facts = listOf(repeat, third, first, second)

        assertEquals(2L, evidence(facts, second.session.id).getValue("GEAR03").count)
        assertEquals(3L, evidence(facts, third.session.id).getValue("GEAR03").count)
        assertEquals(third.session.id, evidence(facts).getValue("GEAR03").sessionId)
        assertNull(evidence(facts, repeat.session.id)["GEAR03"])
    }

    @Test fun onlyOwnedNativeCompletedAndEnrolledFactsCount() {
        val eligible = training(1, segment(gear(), shots = 12))
        val active = training(2, segment(gear(), shots = 12)).changeSession { it.copy(state = "active") }
        val imported = training(3, segment(gear(), shots = 12)).changeSession { it.copy(sourceKind = "mytargets") }
        val deleted = training(4, segment(gear(), shots = 12)).changeSession { it.copy(deletedAtMs = 1L) }
        val old = training(5, segment(gear(), shots = 12))
        val wrongDate = training(6, segment(gear(), shots = 12))
        val newRuleOnly = training(7, segment(gear(), shots = 12, distance = 25.0))
        val oldShots = training(8, segment(gear(), shots = 12, relativeShotTime = -1L))
        val importedPositions = training(9, segment(gear(), shots = 12, positionSource = "imported"))
        val missingGear = training(10, segment("invalid", shots = 0))
        val facts = listOf(eligible, active, imported, deleted, old, wrongDate, newRuleOnly, oldShots, importedPositions, missingGear)
        val enrollments = (facts - old).associate { it.session.id to enrollment(it) }.toMutableMap()
        enrollments[wrongDate.session.id] = enrollment(wrongDate).copy(localDate = "2020-01-01")
        enrollments[newRuleOnly.session.id] = enrollment(newRuleOnly, listOf("GEAR03"))
        val progress = achievementGearEvidence(facts, enrollments).associateBy { it.ruleId }
        assertEquals(1L, progress.getValue("GEAR02").count)
        assertEquals(1L, progress.getValue("GEAR06").count)
        assertEquals(2L, progress.getValue("GEAR03").count)
        assertEquals(setOf("GEAR03"), achievementGearEvidence(facts, enrollments, newRuleOnly.session.id).map { it.ruleId }.toSet())
        assertTrue(achievementGearEvidence(facts, enrollments, active.session.id).isEmpty())
    }

    private fun evidence(facts: List<JournalDetails>, trigger: String? = null) = achievementGearEvidence(
        facts, facts.associate { it.session.id to enrollment(it) }, trigger,
    ).associateBy { it.ruleId }

    private fun enrollment(detail: JournalDetails, rules: List<String> = listOf("GEAR02", "GEAR03", "GEAR06")) = AchievementEnrollment(
        detail.session.id, detail.session.createdAtMs, requireNotNull(detail.session.localDate), JSONArray(rules).toString(), null,
    )

    private fun gear(
        bowId: String = "bow",
        bowName: String = "Bow",
        kitId: String? = "kit",
        kitName: String = "Kit",
        revision: Long = 1L,
    ): String {
        val bow = EquipmentItem(id = bowId, kind = "bow", name = bowName, category = "barebow", revision = revision)
        val kit = kitId?.let { EquipmentItem(id = it, kind = "setup", name = kitName, bowId = bow.id, revision = revision) }
        return equipmentSnapshot(kit ?: bow, listOfNotNull(bow, kit))
    }

    private data class Segment(
        val gear: String?,
        val distance: Double?,
        val shots: Int,
        val counted: Int,
        val role: String,
        val mode: String,
        val scoreSource: String,
        val positionSource: String,
        val relativeShotTime: Long,
    )

    private fun segment(
        gear: String?,
        distance: Double? = 18.0,
        shots: Int = 1,
        counted: Int = 0,
        role: String = "scored",
        mode: String = "scored",
        scoreSource: String = "numeric_entry",
        positionSource: String = "none",
        relativeShotTime: Long = 1L,
    ) = Segment(gear, distance, shots, counted, role, mode, scoreSource, positionSource, relativeShotTime)

    private fun training(index: Int, vararg segments: Segment): JournalDetails {
        val id = "session-$index"
        val created = index * 1_000L
        val session = JournalSession(id, "Training", created, created, completedAtMs = created + 500,
            localDate = LocalDate.of(2026, 11, 1).plusDays(index.toLong()).toString(), state = "completed")
        val blocks = segments.mapIndexed { ordinal, segment ->
            val block = JournalBlock("$id-block-$ordinal", id, ordinal, segment.mode, segment.distance, null, null, null, null, segment.gear, 12)
            val end = JournalEnd("${block.id}-end", block.id, 0, 12, role = segment.role, state = "closed")
            val shots = List(segment.shots) { arrow ->
                JournalShot("${end.id}-shot-$arrow", end.id, arrow, 0, "M", null, null, null, null, null,
                    segment.scoreSource, segment.positionSource, "unknown", null, created + segment.relativeShotTime)
            }
            val counts = if (segment.counted > 0) listOf(JournalCount(end.id, segment.counted, created + 1, created + 1)) else emptyList()
            JournalBlockDetails(block, listOf(JournalEndDetails(end, shots, counts)))
        }
        return JournalDetails(session, blocks)
    }

    private fun JournalDetails.changeSession(transform: (JournalSession) -> JournalSession) = copy(session = transform(session))
}

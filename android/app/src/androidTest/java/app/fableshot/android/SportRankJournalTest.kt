package app.fableshot.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SportRankJournalTest {
    private fun fixture(points: List<Int>, state: String = "active"): JournalDetails {
        val bow = EquipmentItem(kind = "bow", name = "Fixture", category = "recurve")
        val block = JournalBlock("b", "s", 0, "scored", 18.0, "wa-indoor-outer-v1", 1, 400, null,
            equipmentSnapshot(bow, listOf(bow)), 3)
        val ends = points.chunked(3).mapIndexed { n, values ->
            JournalEndDetails(JournalEnd("e$n", "b", n, 3), values.mapIndexed { i, score ->
                JournalShot("s$n-$i", "e$n", i, score, if (score == 0) "M" else if (score == 10) "X" else "$score",
                    null, null, null, null, null, "manual", "none", "none", null, 0)
            }, emptyList())
        }
        return JournalDetails(JournalSession("s", "Fixture", 0, 0, state = state),
            listOf(JournalBlockDetails(block, ends)), listOf(SessionPlan("s", 20, 2)))
    }

    @Test fun sixtyArrowExerciseSpansBothRoundsAndIncludesMisses() {
        val active = fixture(List(30) { 10 } + List(30) { 0 })
        assertEquals(5.0, active.rankAssessment("male").evaluation!!.average!!, 0.0)
        assertFalse(active.rankAssessment("male").finalResult)
        val completed = active.copy(session = active.session.copy(state = "completed"))
        val result = completed.rankAssessment("male")
        assertTrue(result.finalResult)
        assertEquals("III юн.", result.evaluation!!.result!!.label)
    }

    @Test fun incompleteAndOverlongSessionsNeverBecomeFinishedNorms() {
        assertFalse(fixture(List(33) { 9 }, "completed").rankAssessment("male").finalResult)
        assertFalse(fixture(List(63) { 9 }, "completed").rankAssessment("male").finalResult)
        val short = fixture(List(30) { 8 }, "completed").rankAssessment("male")
        assertTrue(short.finalResult)
        assertEquals(30, short.evaluation!!.exercise.arrows)
        assertEquals("II", short.evaluation!!.result!!.label)
    }

    @Test fun unknownCategoryBowAndUnverifiedImportDoNotInventNorms() {
        val value = fixture(listOf(10, 9, 0))
        assertNull(value.rankAssessment(null).evaluation)
        val block = value.blocks.single()
        assertNull(value.copy(blocks = listOf(block.copy(block = block.block.copy(equipmentSnapshotJson = null)))).rankAssessment("male").evaluation)
        assertNull(value.copy(blocks = listOf(block.copy(block = block.block.copy(targetProfileId = "mytargets-source-unknown")))).rankAssessment("male").evaluation)
        assertNull(value.copy(blocks = listOf(block.copy(block = block.block.copy(mode = "count_only")))).rankAssessment("male").evaluation)
    }

    @Test fun explicitlyNullBowCategoryRequestsEquipmentConfiguration() {
        val value = fixture(listOf(10, 9, 0))
        val block = value.blocks.single()
        val bow = EquipmentItem(kind = "bow", name = "Fixture")
        val assessment = value.copy(blocks = listOf(block.copy(
            block = block.block.copy(equipmentSnapshotJson = equipmentSnapshot(bow, listOf(bow))),
        ))).rankAssessment("male")
        assertTrue(assessment.needsBowType)
        assertNull(assessment.evaluation)
    }

    @Test fun mixedConditionsAreNotMergedAndDraftDoesNotMutateFacts() {
        val value = fixture(listOf(10, 9, 0))
        val block = value.blocks.single()
        val mixed = value.copy(blocks = value.blocks + block.copy(block = block.block.copy(id = "b2", ordinal = 1, distanceMeters = 30.0)))
        assertNull(mixed.rankAssessment("male").evaluation)
        val draft = value.allShots.last().copy(points = 8)
        assertEquals(27, value.rankAssessment("male", draft).evaluation!!.points)
        assertEquals(19, value.rankAssessment("male").evaluation!!.points)
    }

    @Test fun personalBestsArePerExactFormatAndRecalculateFromVisibleSourceFacts() {
        fun session(id:String,points:List<Int>,time:Long)=fixture(points,"completed").let {
            it.copy(session=it.session.copy(id=id,createdAtMs=time,startedAtMs=time))
        }
        val first=session("first",List(60){9},1)
        val laterTie=session("later",List(60){9},2)
        val short=session("short",List(30){8},3)
        val incomplete=session("incomplete",List(33){10},4)
        val deleted=first.copy(session=first.session.copy(deletedAtMs=5))
        assertTrue(deleted.summary().journalMeta!!.rankResults.isEmpty())
        assertTrue(incomplete.summary().journalMeta!!.rankResults.isEmpty())
        val rows=listOf(laterTie,short,first,incomplete).map { it.summary() }
        val best=bestRankResults(rows,"male")
        assertEquals(2,best.size)
        assertEquals("first",best.single {it.evaluation.exercise.arrows==60}.session.id)
        assertEquals(240,best.single {it.evaluation.exercise.arrows==30}.evaluation.points)
        assertEquals(2,bestRankResults(rows,"female").size)
        assertTrue(bestRankResults(rows,null).isEmpty())
        val reduced=first.copy(blocks=first.blocks.map { b -> b.copy(ends=b.ends.map { e ->
            e.copy(shots=e.shots.map { it.copy(points=8,zoneCode="8") })
        }) })
        val afterEdit=bestRankResults(listOf(reduced.summary(),laterTie.summary()),"male").single()
        assertEquals("later",afterEdit.session.id)
        assertEquals(540,afterEdit.evaluation.points)
        assertEquals("first",bestRankResults(listOf(reduced.summary()),"male").single().session.id)
    }
}

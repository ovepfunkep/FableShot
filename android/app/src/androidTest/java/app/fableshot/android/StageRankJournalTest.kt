package app.fableshot.android

import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.equipmentSnapshot
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import org.junit.Assert.*
import org.junit.Test

/** Source-only fixtures: no connection to either installed diary. */
class StageRankJournalTest {
    private fun fixture(series: List<List<Int>>, seriesPerRound: Int = 10): JournalDetails {
        val bow = EquipmentItem(kind = "bow", name = "Fixture", category = "recurve")
        val profile = TargetCatalog.indoor
        val block = JournalBlock("b", "s", 0, "scored", 18.0, profile.id, 1, 400,
            profile.snapshot(400), equipmentSnapshot(bow, listOf(bow)), 3)
        val ends = series.mapIndexed { n, values ->
            JournalEndDetails(JournalEnd("e$n", "b", n, 3, state = "closed"),
                values.mapIndexed { i, score ->
                    JournalShot("shot$n-$i", "e$n", i, score, if (score == 0) "M" else "$score",
                        null, null, null, null, null, "manual", "none", "none", null, 0)
                }, emptyList())
        }
        return JournalDetails(JournalSession("s", "Fixture", 0, 0),
            listOf(JournalBlockDetails(block, ends)), listOf(SessionPlan("s", seriesPerRound * 2, 2)))
    }

    @Test fun selectedRoundAndSeriesUseTheirOwnShotsAndOneRoundReference() {
        val details = fixture(List(10) { listOf(10, 10, 10) } + listOf(listOf(0, 0, 0), listOf(8, 8, 8)))
        val firstRound = details.roundRank("male", "e0")
        val secondRound = details.roundRank("male", "e11")
        val series = details.seriesRank("male", "e11")
        assertEquals(300, firstRound.evaluation!!.points)
        assertEquals(24, secondRound.evaluation!!.points)
        assertEquals(6, secondRound.evaluation!!.entered)
        assertEquals(24, series.evaluation!!.points)
        assertEquals(3, series.evaluation!!.entered)
        assertEquals(30, firstRound.evaluation!!.exercise.arrows)
        assertEquals(30, series.evaluation!!.exercise.arrows)
        assertEquals("II", series.label)
        assertFalse(firstRound.assessment.finalResult)
    }

    @Test fun oneEnteredArrowIncludingMissCanForecastButEmptyCannot() {
        val details = fixture(listOf(emptyList(), listOf(0), listOf(9)))
        assertNull(details.seriesRank("male", "e0").label)
        assertEquals("ниже порога", details.seriesRank("male", "e1").label)
        assertEquals("I", details.seriesRank("male", "e2").label)
    }

    @Test fun draftAndSelectionNeverRewriteStoredFacts() {
        val details = fixture(listOf(listOf(10, 9, 0)))
        val draft = details.allShots.last().copy(points = 8, zoneCode = "8")
        assertEquals(27, details.seriesRank("male", "e0", draft).evaluation!!.points)
        assertEquals(19, details.seriesRank("male", "e0").evaluation!!.points)
        assertEquals(0, details.allShots.last().points)
    }

    @Test fun unknownCategoryBowTargetAndCountOnlyNeverInventStageRanks() {
        val details = fixture(listOf(listOf(9, 9, 9)))
        val block = details.blocks.single()
        assertNull(details.seriesRank(null).evaluation)
        fun changed(transform: (JournalBlock) -> JournalBlock) = details.copy(
            blocks = listOf(block.copy(block = transform(block.block))))
        assertTrue(changed { it.copy(equipmentSnapshotJson = null) }.seriesRank("male").assessment.needsBowType)
        assertNull(changed { it.copy(targetSnapshotJson = null) }.seriesRank("male").evaluation)
        assertNull(changed { it.copy(targetProfileVersion = 2) }.seriesRank("male").evaluation)
        assertNull(changed { it.copy(distanceMeters = 25.0) }.seriesRank("male").evaluation)
        assertNull(changed { it.copy(mode = "count_only") }.seriesRank("male").evaluation)
    }

    @Test fun mixedRoundIsUnavailableButCompatibleSeriesStillHasItsOwnRank() {
        val details = fixture(listOf(listOf(9, 9, 9), listOf(8, 8, 8)))
        val block = details.blocks.single()
        val first = block.copy(ends = listOf(block.ends.first()))
        val second = block.copy(block = block.block.copy(id = "b2", ordinal = 1, distanceMeters = 25.0),
            ends = listOf(block.ends.last().let { it.copy(end = it.end.copy(blockId = "b2")) }))
        val mixed = details.copy(blocks = listOf(first, second))
        assertNull(mixed.roundRank("male", "e0").evaluation)
        assertEquals("I", mixed.seriesRank("male", "e0").label)
    }

    @Test fun historySummaryUsesFrozenProgressFactsAndReflectsEditsWithoutBackfill() {
        val details = fixture(listOf(listOf(8, 8, 8), listOf(8, 8, 8)))
        val frozen = ProgressBaseline("b", "baseline", "progress-pg1-v1", 10, 0, "known", 10,
            "ready", "[{\"sessionId\":\"a\"},{\"sessionId\":\"b\"},{\"sessionId\":\"c\"}]", 36, 180)
        val withBaseline = details.copy(blocks = details.blocks.map { it.copy(baselines = listOf(frozen)) })
        val meta = withBaseline.summary().journalMeta!!
        assertEquals(60.0, meta.progressRelativePercent!!, 1e-9)
        assertEquals(30.0, meta.progressPercentagePoints!!, 1e-9)
        assertEquals(5.0, meta.progressBaselineAverage!!, 0.0)
        assertEquals(8.0, meta.progressCurrentAverage!!, 0.0)
        assertEquals(3, meta.progressSourceCount)
        assertEquals("II", meta.roundRanks.historyRank("male").label)
        assertNull(details.summary().journalMeta!!.progressRelativePercent)
        assertEquals(frozen, withBaseline.blocks.single().baselines.single())
    }
}

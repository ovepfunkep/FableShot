package app.fableshot.android.domain

import app.fableshot.android.data.EndEntity
import app.fableshot.android.data.EndWithShots
import app.fableshot.android.data.SessionDetails
import app.fableshot.android.data.SessionEntity
import app.fableshot.android.data.ShotEntity
import org.junit.Assert.*
import org.junit.Test

class TrainingHitMapTest {
    private fun shot(end: String, index: Int, score: Int, x: Double?, y: Double?, zone: String? = null) =
        ShotEntity("$end-$index", end, index, score, x, y, "numeric", 1, 1, zone)

    private fun fixture(): SessionDetails {
        val ends = (1..4).map { number ->
            val id = "end-$number"
            val x = number / 10.0
            EndWithShots(EndEntity(id, "session", number, 3, true), listOf(
                shot(id, 0, 10, x, .1), shot(id, 1, 9, x + .01, .11), shot(id, 2, 8, x + .02, .12),
            ))
        }
        return SessionDetails(SessionEntity("session", "Fixture", 1, 18.0, 400, 3), ends.reversed())
    }

    @Test fun exactSeriesSelectionKeepsItsOwnCoordinatesScoresAndRoundLabelAndAllRestores() {
        val details = fixture()
        val before = PracticeMetrics.from(details)
        val labels = (1..4).associate { number ->
            "end-$number" to "Раунд ${(number - 1) / 2 + 1} · Серия ${(number - 1) % 2 + 1}"
        }
        val series = trainingHitMapSeries(details, labels)
        val selected = selectTrainingHitMapSeries(series, "end-2")
        assertEquals("Раунд 1 · Серия 2", selected.label)
        assertEquals(listOf(TargetPoint(.2, .1), TargetPoint(.2 + .01, .11), TargetPoint(.2 + .02, .12)), selected.points)
        assertEquals(listOf("end-2-0", "end-2-1", "end-2-2"), selected.shots.map { it.id })
        assertEquals(3, selected.shotCount)
        assertEquals(27, selected.score)
        assertEquals(0, selected.missCount)
        assertEquals(0, selected.unknownCoordinateCount)
        val all = selectTrainingHitMapSeries(series, null)
        assertEquals("Все серии", all.label)
        assertEquals(12, all.shotCount)
        assertEquals(12, all.points.size)
        assertEquals(108, all.score)
        assertEquals(before, PracticeMetrics.from(details))
    }

    @Test fun missingCoordinatesAndUnlocatedMissAreCountedWithoutInventingPositions() {
        val id = "end-1"
        val shots = listOf(shot(id, 0, 9, .2, .1), shot(id, 1, 0, null, null, "M"),
            shot(id, 2, 8, null, null), shot(id, 3, 7, .1, null), shot(id, 4, 6, Double.NaN, .2))
        val details = fixture().copy(ends = listOf(EndWithShots(EndEntity(id, "session", 1, 5, true), shots)))
        val selected = selectTrainingHitMapSeries(trainingHitMapSeries(details), id)
        assertEquals(listOf(TargetPoint(.2, .1)), selected.points)
        assertEquals(5, selected.shotCount)
        assertEquals(30, selected.score)
        assertEquals(1, selected.missCount)
        assertEquals(3, selected.unknownCoordinateCount)
        assertNull(selected.rms)
        assertEquals(hypotExpected(.2, .1), selected.centreOffset!!, 1e-12)
    }

    @Test fun suppliedEvidenceIsAuthoritativeAndDoesNotFallbackToRawLegacyPositions() {
        val details = fixture()
        val evidence = mapOf("end-2" to mapOf("end-2-0" to TargetPoint(-.5, -.4)))
        val series = trainingHitMapSeries(details, coordinateEvidence = evidence)
        assertTrue(series.single { it.id == "end-1" }.points.isEmpty())
        val selected = selectTrainingHitMapSeries(series, "end-2")
        assertEquals(evidence.getValue("end-2").values.toList(), selected.points)
        assertEquals(2, selected.unknownCoordinateCount)
        assertTrue(trainingHitMapSeries(details, coordinateEvidence = emptyMap()).all { it.points.isEmpty() })
    }

    @Test fun legacyLabelsDoNotInventRoundsAndStaleSelectionReturnsAll() {
        val series = trainingHitMapSeries(fixture())
        assertEquals(listOf("Серия 1", "Серия 2", "Серия 3", "Серия 4"), series.map { it.label })
        assertEquals(selectTrainingHitMapSeries(series, null), selectTrainingHitMapSeries(series, "deleted-end"))
    }

    @Test fun unusedOpenEndIsExcludedButClosedEmptyEndAndPartialSeriesRemain() {
        val details = fixture()
        val emptyClosed = EndWithShots(EndEntity("empty-closed", "session", 5, 3, true), emptyList())
        val unused = EndWithShots(EndEntity("unused", "session", 6, 3), emptyList())
        val partial = EndWithShots(EndEntity("partial", "session", 7, 3), listOf(shot("partial", 0, 8, .3, .2)))
        val series = trainingHitMapSeries(details.copy(ends = details.ends + emptyClosed + unused + partial + partial))
        assertTrue(series.any { it.id == "empty-closed" && it.shots.isEmpty() })
        assertFalse(series.any { it.id == "unused" })
        assertEquals(1, series.count { it.id == "partial" })
        assertEquals(1, selectTrainingHitMapSeries(series, "partial").shotCount)
    }

    private fun hypotExpected(x: Double, y: Double) = kotlin.math.sqrt(x * x + y * y)
}

package app.fableshot.android.data.journal

import app.fableshot.android.domain.*
import org.junit.Assert.*
import org.junit.Test

class JournalScoringTest {
    private fun end(number: Int, count: Int = 3, closed: Boolean = true): ScoringEnd =
        ScoringEnd("end-$number", number, 3, closed, List(count) { index ->
            ScoringShot("shot-$number-$index", 9, TargetPoint(index * .01, 0.0))
        })

    private fun input(vararg ends: ScoringEnd) = JournalScoringInput(ends.toList(), 10, true, 200.0)

    @Test fun partialSeriesIsExcludedWithoutBlockingTheOtherFullSeriesOrBecomingAMiss() {
        val source = input(end(1), end(2, count = 2), end(3))
        val result = source.compositeReportScore()
        assertEquals(ScoreAvailability.Available, result.availability)
        assertEquals(2, result.endCount)
        assertEquals(6, result.shotCount)
        assertEquals(54L, result.classic)
        assertEquals(60L, result.maximum)
        assertEquals(CompositePhase.Early, result.phase)
        assertEquals(ScoreAvailability.IncompleteEnd, source.score().availability)
    }

    @Test fun fullyEnteredOpenSeriesIsAReportSampleWithoutChangingItsSavedState() {
        val source = input(end(1), end(2), end(3, closed = false))
        val result = source.compositeReportScore()
        assertEquals(ScoreAvailability.Available, result.availability)
        assertTrue(result.fullRankAvailable)
        assertEquals(9, result.shotCount)
        assertFalse(source.ends.last().closed)
        assertEquals(ScoreAvailability.IncompleteEnd, source.score().availability)
    }

    @Test fun originalSliceNumbersSelectOnlyTheRequestedSeriesAndNeverReadFutureFacts() {
        val source = input(end(1), end(2, count = 1), end(3))
        val first = source.compositeReportScore(slice = 2)
        assertEquals(1, first.endCount)
        assertEquals(27L, first.classic)
        assertEquals(ScoreAvailability.NoData, source.compositeReportScore(slice = 2, singleEnd = true).availability)
        assertEquals(27L, source.compositeReportScore(slice = 3, singleEnd = true).classic)
        val corruptFuture = end(4).copy(shots = listOf(ScoringShot("corrupt", 99), ScoringShot("bad", 99), ScoringShot("bad-2", 99)))
        assertEquals(first, source.copy(ends = source.ends + corruptFuture).compositeReportScore(slice = 2))
    }

    @Test fun aReportWithoutAnyCompleteSeriesHasNoScoreAndNoInitialCardSample() {
        val source = input(end(1, count = 2), end(2, count = 0, closed = false))
        assertFalse(source.hasCompleteReportEnds)
        assertEquals(ScoreAvailability.NoData, source.compositeReportScore().availability)
        assertNull(source.compositeReportScore().total)
        assertTrue(source.copy(ends = source.ends + end(3, closed = false)).hasCompleteReportEnds)
    }

    @Test fun completeInvalidOrUnverifiedFactsRemainUnavailableAndProfilesStayExplicit() {
        val source = input(end(1), end(2), end(3), end(4, count = 1))
        assertEquals(ScoreAvailability.UnverifiedGeometry, source.copy(geometryVerified = false).compositeReportScore().availability)
        assertEquals(ScoreAvailability.UnknownMaximum, source.copy(maximumPerArrow = null).compositeReportScore().availability)
        val unknown = source.copy(ends = source.ends.map { it.copy(shots = it.shots.map { shot -> shot.copy(position = null) }) })
        assertEquals(ScoreAvailability.MissingCoordinates, unknown.compositeReportScore().availability)
        assertEquals(ScoreAvailability.Available, unknown.compositeReportScore(profile = CompositeProfile.ScoreOnly).availability)
        val invalid = source.copy(ends = source.ends.map { if (it.number == 1) it.copy(shots = it.shots.map { shot -> shot.copy(points = 11) }) else it })
        assertEquals(ScoreAvailability.InvalidData, invalid.compositeReportScore().availability)
    }
}

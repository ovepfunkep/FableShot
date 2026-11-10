package app.fableshot.android.export

import app.fableshot.android.domain.RankEvaluation
import app.fableshot.android.domain.RankExercise
import app.fableshot.android.domain.RankThreshold
import org.junit.Assert.*
import org.junit.Test

class PosterRankIntervalTest {
    private val exercise = RankExercise(
        "fixture", "barebow", 18, 60, "male", 0,
        listOf(RankThreshold("III", 392), RankThreshold("МС", 538), RankThreshold("МСМК", 553)),
    )

    @Test fun neighboursAndGapsUseExactScores() {
        val band = requireNotNull(PosterRankInterval.from(RankEvaluation(exercise, 540, 60)))
        assertEquals("МС", band.lower?.label)
        assertEquals("МСМК", band.upper?.label)
        assertEquals(2, band.aboveLower)
        assertEquals(13, band.toUpper)
        assertEquals(2f / 15f, band.position, .00001f)
    }

    @Test fun exactThresholdIsAlreadyReachedWithoutRoundingPromotion() {
        val below = requireNotNull(PosterRankInterval.from(RankEvaluation(exercise, 537, 60)))
        val exact = requireNotNull(PosterRankInterval.from(RankEvaluation(exercise, 538, 60)))
        assertEquals("МС", below.upper?.label)
        assertEquals("МС", exact.lower?.label)
        assertEquals(0, exact.aboveLower)
        assertEquals(0f, exact.position, 0f)
    }

    @Test fun zeroAndBelowFirstThresholdUseZeroAsBoundaryNotAnInventedRank() {
        val zero = requireNotNull(PosterRankInterval.from(RankEvaluation(exercise, 0, 60)))
        assertNull(zero.lower)
        assertEquals(0, zero.lowerScore)
        assertEquals(392, zero.toUpper)
        assertEquals(0f, zero.position, 0f)
    }

    @Test fun highestRankUsesExerciseMaximumWithoutInventingNextRank() {
        val band = requireNotNull(PosterRankInterval.from(RankEvaluation(exercise, 585, 60)))
        assertEquals("МСМК", band.lower?.label)
        assertNull(band.upper)
        assertEquals(32, band.aboveLower)
        assertEquals(15, band.toUpper)
        val perfect = requireNotNull(PosterRankInterval.from(RankEvaluation(exercise, 600, 60)))
        assertEquals(1f, perfect.position, 0f)
        assertEquals(0, perfect.toUpper)
    }

    @Test fun incompleteExerciseHasNoFinalInterval() {
        assertNull(PosterRankInterval.from(RankEvaluation(exercise, 27, 3)))
        assertNull(PosterRankInterval.from(RankEvaluation(exercise, 0, 0)))
    }

    @Test fun thresholdEqualToMaximumDoesNotPlacePerfectResultAtTheStart() {
        val exactMaximum = exercise.copy(thresholds = listOf(RankThreshold("Высший", 600)))
        val band = requireNotNull(PosterRankInterval.from(RankEvaluation(exactMaximum, 600, 60)))
        assertEquals(1f, band.position, 0f)
        assertEquals(0, band.aboveLower)
        assertEquals(0, band.toUpper)
    }
}

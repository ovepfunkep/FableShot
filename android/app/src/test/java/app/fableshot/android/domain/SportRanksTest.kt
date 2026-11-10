package app.fableshot.android.domain

import org.junit.Assert.*
import org.junit.Test

class SportRanksTest {
    private fun exercise(id: String = "recurve-18-60-male") = SportRankCatalog.exercises.single { it.id == id }

    @Test fun everyPublishedThresholdIsExactWithoutRoundingPromotion() {
        for (exercise in SportRankCatalog.exercises) for (threshold in exercise.thresholds) {
            assertEquals(threshold, RankEvaluation(exercise, threshold.score, exercise.arrows).result)
            assertNotEquals(threshold, RankEvaluation(exercise, threshold.score - 1, exercise.arrows).result)
        }
    }

    @Test fun sourceRowsKeepThirtyAndSixtyArrowFormatsDistinct() {
        // XLS Нормы КЛ БЛ K11/L11 vs K12/L12: 30-arrow I differs from half of 60-arrow I.
        val short = exercise("recurve-18-30-male")
        assertEquals(260, short.thresholds.single { it.label == "I" }.score)
        assertEquals("II", RankEvaluation(short, 250, 30).result?.label)
        assertEquals("I", RankEvaluation(exercise(), 500, 60).result?.label)
        assertEquals(490, exercise("recurve-18-60-female").thresholds.single { it.label == "I" }.score)
        assertEquals(467, exercise("barebow-18-60-male").thresholds.single { it.label == "I" }.score)
        assertEquals(640, exercise("compound-50-72-male").thresholds.single { it.label == "I" }.score)
    }

    @Test fun paceAndActualResultHaveDifferentCompletionRequirements() {
        val value = RankEvaluation(exercise(), 50, 6)
        assertEquals("I", value.pace?.label)
        assertNull(value.result)
        assertEquals(500.0, value.projected!!, 1e-9)
        assertEquals(50.0 / 6, value.average!!, 1e-9)
        assertNull(RankEvaluation(exercise(), 0, 0).average)
        assertNull(RankEvaluation(exercise(), 0, 0).pace)
        assertEquals(0.0, RankEvaluation(exercise(), 0, 3).average!!, 0.0)
    }

    @Test fun requiredRemainingHandlesImpossibleCrossedAndFinished() {
        val threshold = exercise().thresholds.single { it.label == "I" }
        assertTrue(RankEvaluation(exercise(), 0, 59).requiredRemaining(threshold)!! > 10)
        assertEquals(0.0, RankEvaluation(exercise(), 500, 50).requiredRemaining(threshold)!!, 0.0)
        assertNull(RankEvaluation(exercise(), 500, 60).requiredRemaining(threshold))
        assertNull(RankEvaluation(exercise(), 510, 61).result)
    }

    @Test fun matchingRequiresKnownBowCategoryAndCorrectTenAndDiameter() {
        val good = RankConditions("compound", 18.0, TargetCatalog.compound.id, 400)
        assertEquals(setOf(30, 60), matchingRankExercises(good, "male").map { it.arrows }.toSet())
        assertTrue(matchingRankExercises(good.copy(profile = TargetCatalog.indoor.id), "male").isEmpty())
        assertTrue(matchingRankExercises(good.copy(profile = TargetCatalog.practice.id), "male").isEmpty())
        assertTrue(matchingRankExercises(good.copy(bow = null), "male").isEmpty())
        assertTrue(matchingRankExercises(good.copy(diameter = 600), "male").isEmpty())
        assertTrue(matchingRankExercises(good, "unknown").isEmpty())
        assertTrue(matchingRankExercises(good.copy(distance = 70.0), "male").isEmpty())
    }
}

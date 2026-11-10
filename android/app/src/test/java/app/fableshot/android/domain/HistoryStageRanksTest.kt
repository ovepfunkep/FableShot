package app.fableshot.android.domain

import app.fableshot.android.data.journal.*
import org.junit.Assert.*
import org.junit.Test

class HistoryStageRanksTest {
    private fun round(number: Int, points: Int, entered: Int, exerciseId: String = "recurve-18-60-male"): JournalRoundRank {
        val exercise = SportRankCatalog.exercises.single { it.id == exerciseId }
        val evaluation = RankEvaluation(exercise, points, entered)
        return JournalRoundRank(number, exercise.category, JournalStageRank(
            JournalRankAssessment(evaluation), rankClassLabel(exercise.bow, exercise.category),
            setOf("e$number"), "Раунд $number", entered, exercise.id))
    }

    @Test fun comparableRoundsUseWeightedMeanInsteadOfBestRound() {
        val result = listOf(round(1, 30, 3), round(2, 70, 12)).historyRank("male")
        assertEquals(100, result.evaluation!!.points)
        assertEquals(15, result.evaluation!!.entered)
        assertEquals("I юн.", result.label)
        assertEquals(1, result.formatCount)
    }

    @Test fun incompatibleFormatsOrCategoriesNeverProduceAnOverallMaximum() {
        val formats = listOf(round(1, 300, 30, "recurve-18-30-male"), round(2, 600, 60))
        assertEquals(2, formats.historyRank("male").formatCount)
        assertNull(formats.historyRank("male").evaluation)
        assertNull(formats.historyRank("female").label)
        assertNull(formats.historyRank(null).label)
    }

    @Test fun unavailableRoundPreventsPartialHistoryFromClaimingACombinedLevel() {
        val supported = round(1, 27, 3)
        val unknown = supported.copy(number = 2, rank = supported.rank.copy(
            assessment = JournalRankAssessment(reason = "Нет подтверждённой мишени"), formatKey = "unknown"))
        assertEquals(2, listOf(supported, unknown).historyRank("male").formatCount)
        assertNull(listOf(supported, unknown).historyRank("male").evaluation)
    }
}

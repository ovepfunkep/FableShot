package app.fableshot.android.domain

import org.junit.Assert.*
import org.junit.Test

class AchievementsTest {
    private fun fact(id: String, arrows: Int = 20, completed: Boolean = true, date: String? = "2026-10-01") =
        AchievementFact(id, completed, arrows, date)

    @Test fun thresholdsUseUniqueFactsAndSourceDatesInStableOrder() {
        val source = (1..5).map {fact("s$it", date = "2026-10-0$it")}
        val result = initialAchievements(source.reversed() + source.first())
        assertTrue(result.all {it.earned})
        assertEquals("2026-10-01", result[0].earnedOn)
        assertEquals("2026-10-05", result[1].earnedOn)
        assertEquals("s5", result[2].evidenceSessionId)
        assertEquals(100L, result[1].value)
        assertEquals(5L, result[2].value)
        assertEquals("hundred-arrows:v1", result[1].key)
        assertEquals(result, initialAchievements(source))
    }

    @Test fun activeVolumeCountsButEmptyOrUnfinishedSessionsDoNotEarnPracticeMilestones() {
        val result = initialAchievements(listOf(fact("empty", 0), fact("live", 99, false)))
        assertFalse(result.any {it.earned})
        assertEquals(99L, result[1].value)
        assertEquals(0L, result[0].value)
        assertTrue(initialAchievements(listOf(fact("live", 100, false)))[1].earned)
    }

    @Test fun correctedAndRemovedEvidenceRecomputesWithoutStickyAwards() {
        val five = (1..5).map {fact("s$it")}
        val before = initialAchievements(five)
        assertTrue(before[2].earned)
        val after = initialAchievements(five.dropLast(1))
        assertTrue(after[0].earned)
        assertFalse(after[1].earned)
        assertFalse(after[2].earned)
        assertEquals(80L, after[1].value)
        assertNull(after[1].evidenceSessionId)
        assertEquals(before, initialAchievements(five))
    }

    @Test fun unknownOrInvalidDatesNeverBecomeTheImportDate() {
        val result = initialAchievements(listOf(fact("imported", 100, date = null)))
        assertTrue(result[0].earned)
        assertNull(result[0].earnedOn)
        assertNull(result[1].earnedOn)
        assertEquals("imported", result[1].evidenceSessionId)
        assertNull(initialAchievements(listOf(fact("bad-date", date = "2026-02-30")))[0].earnedOn)
    }
}

package app.fableshot.android.domain
import org.junit.Assert.*
import org.junit.Test
class ProgressScoringTest {
    @Test fun improvementUsesPercentagePointsWithoutRewardForExtraVolume(){
        assertEquals(16.6666666667,ProgressScoring.calculate(100,30,150,90,3,10,true).percentagePoints!!,1e-9)
        assertEquals(0.0,ProgressScoring.calculate(100,20,150,30,3,10,true).percentagePoints!!,0.0)
        assertEquals(0.0,ProgressScoring.calculate(100,30,300,90,3,10,true).percentagePoints!!,0.0)
    }
    @Test fun missingBaselineIsNotZeroAndRealZeroHasNoRelativePercentage(){
        assertNull(ProgressScoring.calculate(100,12,0,0,0,10,true).percentagePoints)
        val zero=ProgressScoring.calculate(120,12,0,36,3,10,true)
        assertEquals(100.0,zero.percentagePoints!!,0.0);assertNull(zero.relativePercent);assertTrue(zero.fullRankAvailable)
    }
    @Test fun smallHistorySmallSampleAndIncompleteEndArePreliminary(){
        assertFalse(ProgressScoring.calculate(120,12,120,24,2,10,true).fullRankAvailable)
        assertFalse(ProgressScoring.calculate(110,11,180,36,3,10,true).fullRankAvailable)
        assertFalse(ProgressScoring.calculate(120,12,180,36,3,10,false).fullRankAvailable)
        assertTrue(ProgressScoring.calculate(120,12,180,36,3,10,true).fullRankAvailable)
    }
    @Test fun weightedBaselineAndDeclineArePreserved(){
        val value=ProgressScoring.calculate(60,12,420,60,3,10,true)
        assertEquals(-20.0,value.percentagePoints!!,1e-9);assertEquals(7.0,value.baselineAverage!!,0.0)
        assertEquals(-28.5714285714,value.relativePercent!!,1e-9)
    }
}

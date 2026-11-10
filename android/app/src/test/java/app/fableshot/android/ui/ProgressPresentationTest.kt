package app.fableshot.android.ui

import app.fableshot.android.domain.ProgressScoring
import org.junit.Assert.*
import org.junit.Test

class ProgressPresentationTest {
    @Test fun percentagesDescribeRelativeAverageGrowthWithoutChangingPg1() {
        val scoring=ProgressScoring.calculate(72,12,60,12,3,10,true)
        val value=progressPresentation(scoring.currentAverage,scoring.baselineAverage,scoring.fullRankAvailable)!!
        assertEquals("+20%",value.label)
        assertEquals(10.0,scoring.percentagePoints!!,0.0)
        assertEquals(20.0,scoring.relativePercent!!,0.0)
        assertTrue(value.explanation(3).contains("6"))
        assertTrue(value.explanation(3).contains("5"))
        assertEquals("-20%",progressPresentation(4.0,5.0,true)!!.label)
        assertEquals("≈ +20%",progressPresentation(6.0,5.0,false)!!.label)
    }

    @Test fun zeroBaselineUsesAveragePointsAndInvalidInputsDoNotInventAComparison() {
        val value=progressPresentation(2.5,0.0,true)!!
        assertNull(value.relativePercent)
        assertEquals("+2,5 к среднему",value.label)
        assertTrue(value.explanation().contains("процент посчитать нельзя"))
        assertEquals("0%",progressPresentation(5.0,5.0,true)!!.label)
        assertNull(progressPresentation(null,5.0,true))
        assertNull(progressPresentation(Double.NaN,5.0,true))
        assertNull(progressPresentation(5.0,-1.0,true))
    }
}

package app.fableshot.android.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TargetScoringTest {
    @Test fun boundariesPreferTheHigherRingAndOutsideIsAMiss() {
        assertEquals(10, TargetScoring.score(TargetPoint(0.1, 0.0)))
        assertEquals(9, TargetScoring.score(TargetPoint(0.10001, 0.0)))
        assertEquals(1, TargetScoring.score(TargetPoint(1.0, 0.0)))
        assertEquals(0, TargetScoring.score(TargetPoint(1.001, 0.0)))
    }

    @Test fun tightBoundaryGroupMatchesTheAcceptedCoordinateFixture() {
        val points = listOf(TargetPoint(.095, 0.0), TargetPoint(.098, .002), TargetPoint(.105, -.001))
        assertEquals(listOf(10, 10, 9), points.map(TargetScoring::score))
        assertEquals(.004371625682867998, TargetScoring.rms(points)!!, 1e-12)
    }

    @Test fun geometryNeedsThreePointsAndTranslationDoesNotChangeGrouping() {
        assertNull(TargetScoring.rms(listOf(TargetPoint(0.0, 0.0))))
        val points = listOf(TargetPoint(.01, .02), TargetPoint(.03, .04), TargetPoint(.05, .02))
        val moved = points.map { TargetPoint(it.x + .6, it.y - .3) }
        assertEquals(TargetScoring.rms(points)!!, TargetScoring.rms(moved)!!, 1e-12)
    }
}

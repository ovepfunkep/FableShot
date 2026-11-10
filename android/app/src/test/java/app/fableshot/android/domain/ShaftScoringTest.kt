package app.fableshot.android.domain

import org.junit.Assert.*
import org.junit.Test

class ShaftScoringTest {
    @Test fun everyProfileUsesTouchedInnerZoneAndRejectsAnEdgeBeyondTheBoundary() {
        for (profile in TargetCatalog.all) {
            val diameter = profile.diameters.firstOrNull() ?: 400
            val shaftRadius = 6.0 / diameter
            for ((index, zone) in profile.zones.withIndex()) {
                val touching = zone.outerRadius + shaftRadius
                assertEquals("${profile.id} ${zone.code}", zone.code,
                    profile.scoreShaft(TargetPoint(touching,0.0),6.0,diameter).code)
                assertEquals(zone.code,profile.scoreShaft(TargetPoint(0.0,-touching+1e-7),6.0,diameter).code)
                assertEquals(profile.zones.getOrNull(index+1)?.code ?: "M",
                    profile.scoreShaft(TargetPoint(touching+1e-7,0.0),6.0,diameter).code)
            }
        }
    }

    @Test fun outsideCentreCanTouchTheLastRingButFurtherOutsideIsAMiss() {
        assertEquals(0,TargetCatalog.practice.score(TargetPoint(1.015,0.0)).points)
        assertEquals(1,TargetCatalog.practice.scoreShaft(TargetPoint(1.015,0.0),6.0,400).points)
        assertEquals(0,TargetCatalog.practice.scoreShaft(TargetPoint(1.01501,0.0),6.0,400).points)
        assertEquals(5,TargetCatalog.reduced.scoreShaft(TargetPoint(.6075,0.0),6.0,800).points)
        assertEquals(0,TargetCatalog.reduced.scoreShaft(TargetPoint(.60751,0.0),6.0,800).points)
    }

    @Test fun xAndSmallTenFollowTheProfileWithoutMovingCentresOrChangingRms() {
        val points=listOf(TargetPoint(.11,0.0),TargetPoint(.112,.001),TargetPoint(.108,-.001))
        val centres=points.toList()
        val rms=TargetScoring.rms(points)!!
        assertEquals(listOf(9,9,9),points.map {TargetCatalog.indoor.score(it).points})
        assertEquals(listOf(10,10,10),points.map {TargetCatalog.indoor.scoreShaft(it,6.0,400).points})
        assertEquals(centres,points)
        assertEquals(rms,TargetScoring.rms(points)!!,0.0)
        assertEquals("X",TargetCatalog.outdoor.scoreShaft(TargetPoint(.0575,0.0),6.0,800).code)
        assertEquals("10",TargetCatalog.compound.scoreShaft(TargetPoint(.065,0.0),6.0,400).code)
        assertEquals("9",TargetCatalog.compound.scoreShaft(TargetPoint(.06501,0.0),6.0,400).code)
    }

    @Test fun invalidDiametersAreRejectedAndTheCentreContractRemainsAvailable() {
        for (diameter in listOf(Double.NaN,Double.POSITIVE_INFINITY,Double.NEGATIVE_INFINITY,-1.0,0.0,.99,20.01)) {
            try { TargetCatalog.practice.scoreShaft(TargetPoint(0.0,0.0),diameter,400);fail("Accepted $diameter") }
            catch (_:IllegalArgumentException) { }
        }
        for(diameter in listOf(1.0,20.0))assertEquals(10,TargetCatalog.practice.scoreShaft(TargetPoint(0.0,0.0),diameter,400).points)
        assertEquals(9,TargetCatalog.practice.score(TargetPoint(.11,0.0)).points)
        try {TargetCatalog.practice.scoreShaft(TargetPoint(0.0,0.0),6.0,0);fail("Accepted zero target")}
        catch (_:IllegalArgumentException) { }
    }
}

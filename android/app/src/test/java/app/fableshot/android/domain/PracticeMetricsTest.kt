package app.fableshot.android.domain

import app.fableshot.android.data.*
import org.junit.Assert.*
import org.junit.Test

class PracticeMetricsTest {
    private fun details(shots:List<ShotEntity>)=SessionDetails(SessionEntity("s","Test",0,18.0,600,6),listOf(EndWithShots(EndEntity("e","s",1,6),shots)))
    private fun shot(index:Int,points:Int,x:Double?=null,y:Double?=null)=ShotEntity("a$index","e",index,points,x,y,"numeric",0)
    @Test fun unknownMissIsNotAFalseCentralHit() {
        val m=PracticeMetrics.from(details(listOf(shot(0,10,.1,.2),shot(1,9,.2,.2),shot(2,0),shot(3,8,.3,.2))))
        assertEquals(4,m.shotCount);assertEquals(27,m.total);assertEquals(6.75,m.average!!,1e-9)
        assertEquals(3,m.positions.size);assertEquals(.2,m.centroid!!.x,1e-9)
        assertEquals(kotlin.math.sqrt(.02/3),m.rms!!,1e-9)
        assertEquals(1,m.zoneCounts[0]);assertEquals(1,m.zoneCounts[10])
    }
    @Test fun emptyAndInsufficientCoordinatesStayUnavailable() {
        val empty=PracticeMetrics.from(details(emptyList()))
        assertNull(empty.average);assertNull(empty.rms);assertNull(empty.centroid)
        val partial=PracticeMetrics.from(details(listOf(shot(0,10,0.0,0.0),shot(1,0))))
        assertNull(partial.rms);assertEquals(0.0,partial.centreOffset!!,0.0)
        assertEquals(2,partial.shotCount);assertEquals(20,partial.maximum)
    }
}

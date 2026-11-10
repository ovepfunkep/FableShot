package app.fableshot.android

import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import org.junit.Assert.*
import org.junit.Test

class PersonalRecordsJournalTest {
    private fun fixture(points: List<Int>): JournalDetails {
        val target=TargetCatalog.practice
        val block=JournalBlock("block","session",0,"scored",18.0,target.id,1,400,target.snapshot(400),null,3)
        val ends=points.chunked(3).mapIndexed {n,values ->
            JournalEndDetails(JournalEnd("end-$n",block.id,n,3,state="closed"),values.mapIndexed {i,value ->
                JournalShot("shot-$n-$i","end-$n",i,value,value.toString(),null,null,null,null,null,"manual","none","none",null,0)
            },emptyList())
        }
        return JournalDetails(JournalSession("session","Fixture",0,0,localDate="2026-10-01",state="completed"),
            listOf(JournalBlockDetails(block,ends)),listOf(SessionPlan("session",2,2)))
    }

    @Test fun partialWarmupUnknownAndOpenSeriesDoNotBecomeRecords() {
        val good=fixture(listOf(9,9,9))
        assertEquals(27,good.fullSeriesRecords().single().points)
        assertTrue(fixture(listOf(10,10)).fullSeriesRecords().isEmpty())
        assertTrue(good.copy(session=good.session.copy(state="active")).fullSeriesRecords().isEmpty())
        assertTrue(good.copy(session=good.session.copy(deletedAtMs=1)).fullSeriesRecords().isEmpty())
        fun altered(block:JournalBlock=good.blocks.single().block,end:JournalEnd=good.currentEnd!!.end)=good.copy(
            blocks=listOf(good.blocks.single().copy(block=block,ends=listOf(good.currentEnd!!.copy(end=end)))))
        assertTrue(altered(end=good.currentEnd!!.end.copy(role="warmup")).fullSeriesRecords().isEmpty())
        assertTrue(altered(end=good.currentEnd!!.end.copy(state="open")).fullSeriesRecords().isEmpty())
        assertTrue(altered(block=good.blocks.single().block.copy(targetSnapshotJson=null)).fullSeriesRecords().isEmpty())
        assertTrue(altered(block=good.blocks.single().block.copy(distanceMeters=null)).fullSeriesRecords().isEmpty())
    }

    @Test fun bestSeriesRetainsActualRoundAndVolumeIsIndependentOfPoints() {
        val source=fixture(listOf(8,8,8,9,9,9))
        val record=source.summary().journalMeta!!.seriesRecords.single()
        assertEquals(2,record.round);assertEquals(1,record.series)
        assertEquals("end-1",record.endId);assertEquals(27,record.points)
        val completed=source.summary()
        val active=completed.copy(id="live",state="active",shotCount=1000)
        assertEquals(completed,personalVolumeRecord(listOf(active,completed)))
        val larger=completed.copy(id="volume",shotCount=7,total=0)
        assertEquals("volume",personalVolumeRecord(listOf(completed,larger))!!.id)
        assertEquals(record,personalSeriesRecords(listOf(completed)).single())
    }
}

package app.fableshot.android.domain

import org.junit.Assert.*
import org.junit.Test

class PersonalRecordsTest {
    private fun record(id: String, points: Int, distance: Double = 18.0, arrows: Int = 3, equipment: String? = null, date: String? = "2026-10-01") =
        SeriesRecord(SeriesRecordConditions(distance,400,"target",1,"geometry",equipment,arrows),points,arrows*10,
            id,"end-$id",1,date,0,1,1,"Target","Setup")

    @Test fun distancesArrowCountsEquipmentAndTargetsStaySeparate() {
        val base=record("base",27)
        val rows=listOf(base,record("far",30,30.0),record("six",60,arrows=6),record("kit",30,equipment="other"),
            base.copy(endId="other-target",conditions=base.conditions.copy(targetSnapshot="other-geometry")))
        assertEquals(5,bestSeriesRecords(rows).size)
    }

    @Test fun higherScoreWinsWhileEqualScoresKeepAnEarlierKnownSource() {
        val earlier=record("first",27)
        val later=record("later",27,date="2026-10-02")
        val unknown=record("unknown",27,date=null)
        assertEquals("first",bestSeriesRecords(listOf(later,unknown,earlier)).single().sessionId)
        assertEquals("higher",bestSeriesRecords(listOf(earlier,record("higher",28,date=null))).single().sessionId)
        assertEquals(bestSeriesRecords(listOf(later,earlier)),bestSeriesRecords(listOf(earlier,later)))
    }

    @Test fun correctionDeletionAndRestorationRecomputeTheWinner() {
        val old=record("old",27)
        val best=record("best",30)
        assertEquals("best",bestSeriesRecords(listOf(old,best)).single().sessionId)
        assertEquals("old",bestSeriesRecords(listOf(old,best.copy(points=20,sessionRevision=2))).single().sessionId)
        assertEquals("old",bestSeriesRecords(listOf(old)).single().sessionId)
        assertEquals("best",bestSeriesRecords(listOf(old,best)).single().sessionId)
    }
}

package app.fableshot.android.domain

import app.fableshot.android.backup.ArchiveJson
import app.fableshot.android.backup.jsonObject
import org.junit.Assert.*
import org.junit.Test

class CompositeScoringTest {
    private val fixture=ArchiveJson.parse(requireNotNull(javaClass.getResourceAsStream("/cg3-cases.json")).bufferedReader().use{it.readText()}).jsonObject()
    private fun objects(key:String)=(fixture[key] as List<*>).map{it.jsonObject()}
    private val definitions get()=objects("ends").associateBy{it["id"] as String}
    private fun end(id:String,number:Int=1):ScoringEnd {
        val raw=definitions.getValue(id);val scores=raw["scores"] as List<*>;val positions=raw["points"] as List<*>
        return ScoringEnd("$id-$number",number,scores.size,true,scores.mapIndexed{i,score->val p=positions[i] as? List<*>;ScoringShot("$id-$number-$i",(score as Number).toInt(),p?.let{TargetPoint((it[0] as Number).toDouble(),(it[1] as Number).toDouble())})})
    }
    @Test fun allAcceptedSingleEndFixturesMatchOriginalContract() {
        for(raw in objects("ends")) {
            val expected=raw["expected"].jsonObject();val result=CompositeScoring.calculate(listOf(end(raw["id"] as String)),1,10,true,singleEnd=true)
            when(expected["status"]) {
                "available"->{assertEquals(raw["id"].toString(),(expected["E"] as Number).toDouble(),result.total!!,1e-9);assertEquals(expected["E_display"],ScoreRounding.display(result.total));assertEquals((expected["rms"] as Number).toDouble(),result.rms!!,1e-9);expected["raw_equivalent_display"]?.let{assertEquals(it,ScoreRounding.display(result.rawEquivalent!!))}}
                "missing_coordinates"->assertEquals(ScoreAvailability.MissingCoordinates,result.availability)
                "insufficient_end_shots"->assertEquals(ScoreAvailability.InsufficientEndShots,result.availability)
                else->fail("Unknown fixture status")
            }
        }
    }
    @Test fun allAcceptedCumulativeFixturesMatchIncludingFutureSliceAndScoreOnly() {
        for(raw in objects("slices")) {
            val ends=(raw["end_ids"] as List<*>).mapIndexed{i,id->end(id as String,i+1)}
            val expected=raw["expected"].jsonObject();val profile=CompositeProfile.entries.single{it.id==raw["profile"]}
            val result=CompositeScoring.calculate(ends,(raw["slice_k"] as Number).toInt(),10,true,profile)
            if(expected["G"]!=null){assertEquals(raw["id"].toString(),(expected["G"] as Number).toDouble(),result.total!!,1e-9);expected["G_display"]?.let{assertEquals(it,ScoreRounding.display(result.total))}}
            else assertNull(result.total)
            expected["classic_total"]?.let{assertEquals((it as Number).toLong(),result.classic)}
            expected["full_rank_available"]?.let{assertEquals(it,result.fullRankAvailable)}
        }
    }
    @Test fun tight29CanBeatWide30WhileClassicAndFivePointCapArePreserved() {
        val tight=CompositeScoring.calculate(listOf(end("tight-29")),1,10,true,singleEnd=true)
        val wide=CompositeScoring.calculate(listOf(end("wide-30")),1,10,true,singleEnd=true)
        assertTrue(tight.total!!>wide.total!!);assertEquals(29,tight.classic.toInt());assertEquals(30,wide.classic.toInt())
        val perfect=CompositeScoring.calculate(listOf(end("known-coincident-30")),1,10,true,singleEnd=true)
        assertEquals(105.0,perfect.total!!,0.0)
        val low=end("known-coincident-30").let{it.copy(shots=it.shots.mapIndexed{i,s->s.copy(points=if(i==0)8 else 10)})}
        assertTrue(CompositeScoring.calculate(listOf(low),1,10,true,singleEnd=true).total!!<100)
    }
    @Test fun pooledRmsUsesEachOwnEndCentreAndWeightsVolumeBeforeClamping() {
        val first=end("wide-30");val second=end("tight-29",2).let{e->e.copy(shots=e.shots.map{it.copy(position=it.position!!.let{p->TargetPoint(p.x+20,p.y-30)})})}
        val result=CompositeScoring.calculate(listOf(first,second),2,10,true)
        val expected=kotlin.math.sqrt((.095*.095+0.004371625682867998*0.004371625682867998)/2)
        assertEquals(expected,result.rms!!,1e-10)
        assertNull(result.stability);assertEquals(CompositePhase.Early,result.phase)
    }
    @Test fun incompleteOrUnknownDataNeverBecomeZeroBonusOrSwitchProfilesAutomatically() {
        val end=end("wide-30")
        assertEquals(ScoreAvailability.IncompleteEnd,CompositeScoring.calculate(listOf(end.copy(closed=false)),1,10,true).availability)
        assertEquals(ScoreAvailability.IncompleteEnd,CompositeScoring.calculate(listOf(end.copy(plannedCount=6)),1,10,true).availability)
        assertEquals(ScoreAvailability.UnknownMaximum,CompositeScoring.calculate(listOf(end),1,null,true).availability)
        assertEquals(ScoreAvailability.UnverifiedGeometry,CompositeScoring.calculate(listOf(end),1,10,false).availability)
        assertEquals(ScoreAvailability.IncompleteSlice,CompositeScoring.calculate(listOf(end),Int.MAX_VALUE,10,true).availability)
        assertEquals(ScoreAvailability.InvalidData,CompositeScoring.calculate(listOf(end.copy(shots=end.shots.map{it.copy(id="same")})),1,10,true).availability)
    }
    @Test fun decimalHalfUpAndCompetitionTiesUseDisplayedHundredthsIncludingNegativeZero() {
        assertEquals("30.08",ScoreRounding.display(30.07499999999999));assertEquals("-1.01",ScoreRounding.display(-1.005));assertEquals("0.00",ScoreRounding.display(-.0001))
        assertEquals(listOf(1,1,3,null),ScoreRounding.competitionRanks(listOf(100.251,100.252,99.0,null)))
    }
    @Test fun futureCorruptionAndFarKnownMissesDoNotLeakOrGetClipped() {
        val ends=(1..3).map{end("wide-30",it)}
        val before=CompositeScoring.calculate(ends,3,10,true)
        val future=end("wide-30",4).copy(id=ends.first().id,shots=listOf(ScoringShot("bad",99,null)))
        assertEquals(before,CompositeScoring.calculate(ends+future,3,10,true))
        val far=end("wide-30").let{e->e.copy(shots=e.shots.mapIndexed{i,s->if(i==2)s.copy(points=0,position=TargetPoint(10.0,0.0))else s})}
        val result=CompositeScoring.calculate(listOf(far),1,10,true);assertEquals(0.0,result.q!!,0.0);assertTrue(result.rms!!>1)
    }

    @Test fun missWithoutPositionCountsInTheScoreAndUsesOnlyMeasuredPointsForSpread() {
        val end=ScoringEnd("end",1,3,true,listOf(
            ScoringShot("first",10,TargetPoint(.01,0.0)),
            ScoringShot("second",10,TargetPoint(.05,0.0)),
            ScoringShot("miss",0),
        ))
        val result=CompositeScoring.calculate(listOf(end),1,10,true,singleEnd=true)
        assertEquals(ScoreAvailability.Available,result.availability)
        assertEquals(20L,result.classic)
        assertEquals(30L,result.maximum)
        assertEquals(2,result.knownPositions)
        assertEquals(.02,result.rms!!,1e-9)
        assertEquals(4.0,result.groupBonus!!,1e-9)
        val unknownHit=end.copy(shots=end.shots.dropLast(1)+ScoringShot("unknown",9))
        assertEquals(ScoreAvailability.MissingCoordinates,
            CompositeScoring.calculate(listOf(unknownHit),1,10,true,singleEnd=true).availability)
    }

    @Test fun lonePointsGiveNoGroupBonusAndMissesStillContributeToStability() {
        val ends=(1..3).map { number ->
            ScoringEnd("end-$number",number,3,true,listOf(
                ScoringShot("hit-$number",10,TargetPoint(.01,0.0)),
                ScoringShot("miss-a-$number",0),ScoringShot("miss-b-$number",0),
            ))
        }
        val result=CompositeScoring.calculate(ends,3,10,true)
        assertEquals(ScoreAvailability.Available,result.availability)
        assertEquals(90L,result.maximum)
        assertEquals(30L,result.classic)
        assertNull(result.rms)
        assertEquals(0.0,result.groupBonus!!,0.0)
        assertEquals(1.0,result.stability!!,0.0)
        assertEquals(34.333333333,result.total!!,1e-9)
    }
}

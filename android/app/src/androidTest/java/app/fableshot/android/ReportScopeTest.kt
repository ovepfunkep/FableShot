package app.fableshot.android

import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.*
import org.junit.Assert.*
import org.junit.Test

internal fun reportFixture():JournalDetails {
    val target=TargetCatalog.find("wa-indoor-outer-v1")!!
    val bow=EquipmentItem(id="fixture-bow",kind="bow",name="Fixture",category="barebow")
    val equipment=equipmentSnapshot(bow,listOf(bow))
    val values=listOf(listOf(9,9,10),listOf(9,8,9),listOf(6,7,8))+List(17) {listOf(10,10,10)}
    val blocks=listOf(0 until 3,3 until 20).mapIndexed {index,range ->
        val id="block-$index"
        JournalBlockDetails(JournalBlock(id,"session",index,"scored",18.0,target.id,1,400,target.snapshot(400),equipment,3),
            range.mapIndexed {ordinal,number ->
                val endId="end-$number"
                JournalEndDetails(JournalEnd(endId,id,ordinal,3,state="closed"),values[number].mapIndexed {shot,score ->
                    val x=(10.5-score)/10.0
                    JournalShot("shot-$number-$shot",endId,shot,score,score.toString(),score,target.rule,x,0.0,"main","target_computed","manual_target","known",null,0)
                },emptyList())
            })
    }
    return JournalDetails(JournalSession("session","Тренировка",0,0,localDate="2026-11-03",state="completed"),blocks,listOf(SessionPlan("session",20,2)))
}

class ReportScopeTest {
    @Test fun identicalPartsMergeIntoAllSixtyShotsInOriginalOrder() {
        val fixture=reportFixture()
        val scopes=fixture.reportScopes()
        assertEquals(listOf("all","part-block-0","part-block-1"),scopes.map {it.id})
        val all=scopes.first().merged().scoringInput()
        assertEquals(60,all.ends.sumOf {it.shots.size})
        assertEquals((0 until 20).map {"end-$it"},all.ends.map {it.id})
        assertEquals(585L,all.score().classic)
        assertTrue(all.score().stability!!>scopes[1].merged().scoringInput().score().stability!!)
        assertEquals(1.0,scopes[2].merged().scoringInput().score().stability!!,0.0)
        assertTrue(all.score().groupBonus!!>0)
        assertEquals(60,fixture.allShots.size)
    }

    @Test fun differentDistanceAndEquipmentNeverMergeAndConflictingBaselinesStayExplicit() {
        val source=reportFixture()
        val mixed=source.copy(blocks=source.blocks.mapIndexed {index,b -> if(index==1)b.copy(block=b.block.copy(distanceMeters=30.0))else b})
        assertFalse(mixed.reportScopes().any {it.id=="all"})
        assertEquals(listOf(9,51),mixed.reportScopes().map {it.volume})
        val baseline=ProgressBaseline("block-0","b0","pg1-v1",1,0,"conditions",10,"ready","[]",30,250)
        val equal=source.copy(blocks=source.blocks.mapIndexed {index,b -> b.copy(baselines=listOf(baseline.copy(blockId=b.block.id,baselineId="b$index",frozenAtMs=index.toLong())))})
        assertNotNull(equal.reportScopes().first().baseline)
        val conflict=equal.copy(blocks=equal.blocks.mapIndexed {index,b -> if(index==1)b.copy(baselines=b.baselines.map {it.copy(scoreSum=260)})else b})
        assertNull(conflict.reportScopes().first().baseline)
    }
}

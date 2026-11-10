package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import java.util.UUID

class JournalShaftTest {
    private lateinit var db:JournalDatabase
    private lateinit var equipment:EquipmentDatabase
    private lateinit var repo:JournalRepository
    @Before fun setup() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build()
        equipment=Room.inMemoryDatabaseBuilder(context,EquipmentDatabase::class.java).build()
        repo=JournalRepository(db)
    }
    @After fun close() {db.close();equipment.close()}
    private suspend fun current()=repo.active.first()!!
    private fun saved(result:JournalWrite)=result as JournalWrite.Saved
    private fun snapshot(diameter:Any?=6.0)=JSONObject().put("arrows",JSONObject()
        .put("kind","arrows").put("id","arrows").put("name","Arrows").put("numberedCount",12)
        .put("diameterMm",diameter ?: JSONObject.NULL)).toString()
    private suspend fun start(raw:String?=snapshot()):JournalDetails {
        saved(repo.start("Shaft fixture",BlockPlan(18.0,400,6,equipmentSnapshotJson=raw)))
        return current()
    }

    @Test fun newPointsFreezeTheShaftAndKeepCentresForRmsWhileNumericMissHasNoInventedGeometry()=runBlocking(Dispatchers.IO) {
        val end=start().currentEnd!!.end.id
        val points=listOf(TargetPoint(.11,0.0),TargetPoint(.112,.001),TargetPoint(.108,-.001))
        for(point in points)saved(repo.point(end,point))
        saved(repo.numeric(end,0))
        val shots=current().allShots
        assertEquals(listOf(10,10,10,0),shots.map {it.points})
        assertTrue(shots.take(3).all {it.shaftDiameterMm==6.0&&it.automaticRuleVersion==TargetCatalog.practice.shaftRuleVersion})
        assertEquals(points,shots.take(3).map {TargetPoint(it.x!!,it.y!!)})
        assertEquals(TargetScoring.rms(points)!!,TargetScoring.rms(shots.take(3).map {TargetPoint(it.x!!,it.y!!)})!!,0.0)
        assertNull(shots.last().x);assertNull(shots.last().shaftDiameterMm)
    }

    @Test fun equipmentChangesCannotRewriteTheFrozenDiameterAndMissingOrInvalidSnapshotsUseSix()=runBlocking(Dispatchers.IO) {
        val catalog=EquipmentRepository(equipment)
        val arrows=catalog.save(EquipmentItem(kind="arrows",name="Same name 99 mm",diameterMm=8.0))
        val setup=catalog.save(EquipmentItem(kind="setup",name="Setup",arrowsId=arrows.id))
        val end=start(catalog.snapshot(setup.id)).currentEnd!!.end.id
        catalog.save(arrows.copy(diameterMm=12.0))
        saved(repo.point(end,TargetPoint(.12,0.0)))
        assertEquals(8.0,current().allShots.single().shaftDiameterMm!!,0.0)
        val block=current().currentBlock!!.block
        for(raw in listOf(null,"{}","invalid",snapshot(null),snapshot(0),snapshot(21),snapshot("8"),
            "{\"selection\":{\"kind\":\"bow\",\"diameterMm\":20},\"bow\":{\"diameterMm\":20}}"))
            assertEquals(6.0,block.copy(equipmentSnapshotJson=raw).shaftDiameterMm(),0.0)
        assertEquals(7.0,block.copy(equipmentSnapshotJson="{\"selection\":{\"kind\":\"arrows\",\"diameterMm\":7}}").shaftDiameterMm(),0.0)
    }

    @Test fun numberingAndAdapterRoundTripNeverRejudgeLegacyNativeOrImportedShots()=runBlocking(Dispatchers.IO) {
        val end=start().currentEnd!!.end.id
        saved(repo.point(end,TargetPoint(.11,0.0)))
        val native=current().allShots.single().copy(points=9,zoneCode="9",automaticPoints=9,
            automaticRuleVersion=TargetCatalog.practice.rule,shaftDiameterMm=null)
        db.journalDao().update(native)
        saved(repo.revise(native.copy(physicalArrowNumber=2)))
        var stored=current().allShots.single()
        assertEquals(native.copy(physicalArrowNumber=2,revision=stored.revision,updatedAtMs=stored.updatedAtMs),stored)
        val imported=stored.copy(points=7,zoneCode="7",scoreSource="imported",positionSource="imported",
            automaticPoints=null,automaticRuleVersion=null)
        db.journalDao().update(imported)
        val store=JournalPracticeStore(db)
        store.revise(imported.presentation().copy(physicalArrowNumber=3),UUID.randomUUID().toString())
        stored=current().allShots.single()
        assertEquals(imported.copy(physicalArrowNumber=3,revision=stored.revision,updatedAtMs=stored.updatedAtMs),stored)
        saved(repo.revise(stored.copy(x=.111,points=10,zoneCode="10",scoreSource="target_computed",positionSource="manual_target")))
        stored=current().allShots.single()
        assertEquals(.111,stored.x!!,0.0);assertEquals(10,stored.points);assertEquals(6.0,stored.shaftDiameterMm!!,0.0)
        assertEquals(TargetCatalog.practice.shaftRuleVersion,stored.automaticRuleVersion)
    }

    @Test fun invalidPersistedDiameterAndWrongComputedScoreAreRejectedWithoutPartialWrites()=runBlocking(Dispatchers.IO) {
        val end=start().currentEnd!!.end.id
        saved(repo.point(end,TargetPoint(.11,0.0)))
        val before=current()
        for(diameter in listOf(Double.NaN,Double.POSITIVE_INFINITY,0.0,20.1)) {
            assertEquals(JournalWrite.Rejected(WriteIssue.INVALID),repo.revise(before.allShots.single().copy(shaftDiameterMm=diameter)))
            assertEquals(before,current())
        }
        assertEquals(JournalWrite.Rejected(WriteIssue.INVALID),repo.revise(before.allShots.single().copy(x=.112,points=9)))
        assertEquals(before,current())
    }

    @Test fun explicitUndoRestoresTheExactLegacyFactAndNewShaftGeometryWithRevisionAndReplayProtection()=runBlocking(Dispatchers.IO) {
        val end=start().currentEnd!!.end.id
        saved(repo.point(end,TargetPoint(.11,0.0)))
        val original=current().allShots.single().copy(points=9,zoneCode="9",automaticPoints=9,
            automaticRuleVersion=TargetCatalog.practice.rule,shaftDiameterMm=null)
        db.journalDao().update(original)
        val store=JournalPracticeStore(db)
        store.revise(original.presentation().copy(x=.112,points=10,zoneCode="10"),UUID.randomUUID().toString())
        val edge=current().allShots.single()
        assertEquals(10,edge.points);assertEquals(6.0,edge.shaftDiameterMm!!,0.0)
        store.revise(edge.presentation().copy(points=0,zoneCode="M",x=null,y=null,origin="manual"),UUID.randomUUID().toString())
        val miss=current().allShots.single()
        assertNull(miss.shaftDiameterMm)
        try {
            store.undoRevision(edge.presentation().copy(revision=miss.revision.toInt()-1),UUID.randomUUID().toString())
            fail("Stale undo accepted")
        } catch (error:IllegalStateException) {assertTrue(error.message.orEmpty().startsWith("REVISION_CONFLICT:"))}
        assertEquals(miss,current().allShots.single())
        store.undoRevision(edge.presentation().copy(revision=miss.revision.toInt()),UUID.randomUUID().toString())
        val restoredEdge=current().allShots.single()
        assertEquals(edge.copy(revision=restoredEdge.revision,updatedAtMs=restoredEdge.updatedAtMs),restoredEdge)
        val undoOperation=UUID.randomUUID().toString()
        val undoValue=original.presentation().copy(revision=restoredEdge.revision.toInt())
        store.undoRevision(undoValue,undoOperation)
        val restored=current().allShots.single()
        assertEquals(original.copy(revision=restored.revision,updatedAtMs=restored.updatedAtMs),restored)
        store.undoRevision(undoValue,undoOperation)
        assertEquals(restored,current().allShots.single())
        assertTrue(db.journalDao().receipt(undoOperation)!!.kind=="undo_edit")
    }

    @Test fun undoCanRestoreACapturedLegacyArrowNumberOutsideTheCurrentSet()=runBlocking(Dispatchers.IO) {
        val end=start().currentEnd!!.end.id
        saved(repo.point(end,TargetPoint(.11,0.0)))
        val original=current().allShots.single().copy(physicalArrowNumber=777)
        db.journalDao().update(original)
        val store=JournalPracticeStore(db)
        store.revise(original.presentation().copy(physicalArrowNumber=null),UUID.randomUUID().toString())
        val cleared=current().allShots.single()
        assertNull(cleared.physicalArrowNumber)
        store.undoRevision(original.presentation().copy(revision=cleared.revision.toInt()),UUID.randomUUID().toString())
        val restored=current().allShots.single()
        assertEquals(original.copy(revision=restored.revision,updatedAtMs=restored.updatedAtMs),restored)
    }

    @Test fun equipmentDiameterUsesMillimetresAndAcceptsOnlyOneThroughTwenty()=runBlocking(Dispatchers.IO) {
        val catalog=EquipmentRepository(equipment)
        for(diameter in listOf(Double.NaN,Double.POSITIVE_INFINITY,0.0,.99,20.01)) {
            try {catalog.save(EquipmentItem(kind="arrows",name="Invalid diameter",diameterMm=diameter));fail("Accepted $diameter")}
            catch (_:IllegalArgumentException) { }
        }
        assertTrue(catalog.items.first().isEmpty())
        for(diameter in listOf(null,1.0,20.0))catalog.save(EquipmentItem(kind="arrows",name="Diameter $diameter",diameterMm=diameter))
        assertEquals(3,catalog.items.first().size)
    }
}

package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*

class EquipmentRepositoryTest {
    private lateinit var db:EquipmentDatabase
    private lateinit var repo:EquipmentRepository
    @Before fun prepare(){db=Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,EquipmentDatabase::class.java).build();repo=EquipmentRepository(db)}
    @After fun close(){db.close()}
    @Test fun snapshotsFreezeLinkedVersionsAndArchiveDoesNotRewriteHistory()=runBlocking(Dispatchers.IO) {
        val bow=repo.save(EquipmentItem(kind="bow",name="Fixture bow",category="barebow",drawWeightLb=24.0))
        val arrows=repo.save(EquipmentItem(kind="arrows",name="Fixture arrows",spine=800,lengthMm=750.0))
        val setup=repo.save(EquipmentItem(kind="setup",name="Fixture setup",bowId=bow.id,arrowsId=arrows.id,favorite=true))
        val frozen=repo.snapshot(setup.id)
        val edited=repo.save(bow.copy(drawWeightLb=26.0))
        assertEquals(24.0,JSONObject(frozen).getJSONObject("bow").getDouble("drawWeightLb"),0.0)
        assertEquals(26.0,JSONObject(repo.snapshot(setup.id)).getJSONObject("bow").getDouble("drawWeightLb"),0.0)
        repo.save(edited.copy(archived=true))
        assertTrue(repo.items.first().any{it.id==bow.id&&it.archived})
        assertFalse(selectableEquipment(repo.items.first()).any{it.id==setup.id})
        assertEquals(3,repo.revisions(bow.id).size)
        assertEquals(1L,JSONObject(frozen).getJSONObject("bow").getLong("revision"))
    }
    @Test fun staleEditsWrongLinksAndInvalidUnitsAreRejectedAtomically()=runBlocking(Dispatchers.IO) {
        val old=repo.save(EquipmentItem(kind="bow",name="First",favorite=true))
        repo.save(old.copy(name="Updated"))
        try{repo.save(old.copy(name="Stale"));fail("Stale edit overwritten")}catch(_:IllegalArgumentException){}
        try{repo.save(EquipmentItem(kind="setup",name="Invalid link",arrowsId=old.id));fail("Wrong kind accepted")}catch(_:IllegalArgumentException){}
        try{repo.save(EquipmentItem(kind="arrows",name="Negative unit",lengthMm=-1.0));fail("Negative length accepted")}catch(_:IllegalArgumentException){}
        assertEquals(1,repo.items.first().size)
        val next=repo.save(EquipmentItem(kind="bow",name="Second",favorite=true))
        assertEquals(listOf(next.id),repo.items.first().filter{it.favorite}.map{it.id})
        assertEquals(3,repo.revisions(old.id).size)
    }
}

package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class NumberingPersistenceTest {
    private lateinit var db: JournalDatabase
    @Before fun prepare() {
        db = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, JournalDatabase::class.java).build()
    }
    @After fun close() = db.close()

    private fun plan(numbering: Boolean? = null): BlockPlan {
        val arrows = EquipmentItem("arrows", "arrows", "Шесть стрел", numberedCount = 6)
        val setup = EquipmentItem("setup", "setup", "Мой комплект", arrowsId = arrows.id)
        return BlockPlan(18.0, 400, equipmentSnapshotJson = equipmentSnapshot(setup, listOf(arrows, setup)),
            flexibleSeries = true, seriesPerRound = 10, numberedArrows = numbering)
    }

    @Test fun automaticDefaultAndExplicitFalsePersistAcrossBlocksAndRepositoryReopen() = runBlocking(Dispatchers.IO) {
        val repo = JournalRepository(db)
        val id = (repo.start("Проверка", plan()) as JournalWrite.Saved).sessionId
        var details = repo.details(id)!!
        assertNull(details.session.numberedArrows)
        assertTrue(details.numberedArrowsEnabled(details.currentBlock!!.block))
        assertTrue(repo.startBlock(id, plan(false), details.session.revision, allowPartial = true) is JournalWrite.Saved)
        details = JournalRepository(db).details(id)!!
        assertEquals(false, details.session.numberedArrows)
        assertFalse(details.numberedArrowsEnabled(details.currentBlock!!.block))
        assertTrue(repo.startBlock(id, plan(true), details.session.revision, allowPartial = true) is JournalWrite.Saved)
        details = repo.details(id)!!
        assertTrue(details.numberedArrowsEnabled(details.currentBlock!!.block))
        val revision = details.session.revision
        assertEquals(JournalWrite.Conflict(revision), repo.startBlock(id, plan(false), revision - 1, true))
        assertEquals(true, repo.details(id)!!.session.numberedArrows)
    }

    @Test fun assigningOnlyTheNumberPreservesScorePositionProvenanceAndUndoState() = runBlocking(Dispatchers.IO) {
        val store = JournalPracticeStore(db)
        val id = (store.journal.start("Проверка", plan()) as JournalWrite.Saved).sessionId
        val endId = store.journal.details(id)!!.currentEnd!!.end.id
        store.add(endId, TargetPoint(.02, .03), null, "first-hit")
        val source = store.journal.details(id)!!.allShots.single()
        val previous = store.revise(source.presentation().copy(physicalArrowNumber = 4), "set-number")
        assertEquals(source.presentation(), previous)
        val result = store.journal.details(id)!!.allShots.single()
        assertEquals(source.copy(physicalArrowNumber = 4, revision = result.revision, updatedAtMs = result.updatedAtMs), result)
        assertEquals(4, result.physicalArrowNumber)
    }
}

package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/** Every command runs on a disposable database; never selects an installed diary. */
class ArrowRoundsAndRemovalTest {
    private lateinit var db:JournalDatabase
    private lateinit var repo:JournalRepository
    private lateinit var id:String

    @Before fun setup() {
        db=Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,JournalDatabase::class.java).build()
        repo=JournalRepository(db)
    }
    @After fun close() { db.close() }
    private fun saved(value:JournalWrite)=value as JournalWrite.Saved
    private suspend fun details()=repo.details(id)!!
    private suspend fun start(limit:Int=5,mode:String="scored") {
        id=saved(repo.start("Isolated rounds",BlockPlan(if(mode=="scored")18.0 else null,
            if(mode=="scored")400 else null,mode=mode,flexibleSeries=true,roundArrowLimit=limit))).id
    }
    private suspend fun shoot(count:Int) {
        repeat(count) { saved(repo.numeric(details().currentEnd!!.end.id,9)) }
    }
    private suspend fun next() {
        val end=details().currentEnd!!.end
        saved(repo.next(end.id,end.revision))
    }

    @Test fun arrowBoundaryClosesPartialSeriesOnlyOnNextAndNeverPadsMisses()=runBlocking(Dispatchers.IO) {
        start();shoot(3);next();shoot(2)
        val boundary=details()
        assertEquals(5,boundary.allShots.size)
        assertEquals(2,boundary.currentEnd!!.volume)
        assertTrue(boundary.roundProgress().endsRound)
        assertEquals(50,boundary.roundProgress().maximum)
        assertEquals(5,boundary.roundProgress().plannedArrowCount)
        assertNull(boundary.roundProgress().seriesLimit)
        assertEquals(JournalWrite.Rejected(WriteIssue.FULL),repo.numeric(boundary.currentEnd!!.end.id,10))
        next()
        val following=details()
        assertEquals(boundary.allShots,following.allShots)
        assertEquals(2,following.roundProgress().number)
        assertTrue(following.currentEnd!!.end.startsRound)
        assertEquals(0,following.currentEnd!!.volume)
        assertEquals(0,following.roundProgress().maximum)
    }

    @Test fun editingOldCountNeverMovesFollowingRoundAndCounterHonorsRemainingBudget()=runBlocking(Dispatchers.IO) {
        start(5,"count_only")
        var end=details().currentEnd!!.end
        saved(repo.setCount(end.id,3,end.revision));next()
        end=details().currentEnd!!.end
        assertEquals(JournalWrite.Rejected(WriteIssue.FULL),repo.setCount(end.id,3,end.revision))
        saved(repo.setCount(end.id,2,end.revision));next()
        assertNull(details().roundProgress().maximum)
        val first=details().orderedBlocks.first().orderedEnds.first().end
        saved(repo.reviseCount(first.id,1,first.revision))
        assertEquals(2,details().roundProgress().number)
        assertEquals(0,details().currentEnd!!.volume)
    }

    @Test fun earlyManualRoundAndNumberingEditsPreserveSavedBoundary()=runBlocking(Dispatchers.IO) {
        start(60);shoot(1)
        val first=details().allShots.single()
        saved(repo.startNextRound(id,details().session.revision))
        shoot(2)
        saved(repo.removeShot(first.id,first.revision))
        assertEquals(2,details().roundProgress().number)
        assertEquals(2,details().roundProgress().ends.sumOf { it.volume })
        assertEquals(listOf(0,2),details().trainingRounds().map { it.ends.sumOf { end -> end.volume } })
    }

    @Test fun removingSeriesFreezesAllLaterRoundsCleansNotesAndKeepsReceiptTombstones()=runBlocking(Dispatchers.IO) {
        id=saved(repo.start("Series boundaries",BlockPlan(18.0,400,seriesPerRound=2,flexibleSeries=true))).id
        repeat(4) { shoot(1);next() }
        val before=details()
        val selected=before.trainingRounds().first().ends.first()
        val kept=before.trainingRounds()[1].ends.map { it.end.id }
        val shot=selected.shots.single()
        val note=DiaryNote(sessionId=id,blockId=selected.end.blockId,endId=selected.end.id,body="Delete with its series")
        DiaryNoteRepository(db).save(note)
        val receiptCount=db.openHelper.writableDatabase.query("SELECT COUNT(*) FROM mutation_receipts").use { it.moveToFirst();it.getInt(0) }
        saved(repo.removeEnd(selected.end.id,selected.end.revision,"remove-series"))
        assertTrue(saved(repo.removeEnd(selected.end.id,selected.end.revision,"remove-series")).replayed)
        val after=details()
        assertEquals(kept,after.trainingRounds()[1].ends.map { it.end.id })
        assertEquals(listOf(0,1,2,3),after.currentBlock!!.orderedEnds.map { it.end.ordinal })
        assertNull(db.diaryNoteDao().get(note.id))
        assertNull(db.journalDao().shot(shot.id))
        db.openHelper.writableDatabase.query("SELECT COUNT(*) FROM mutation_receipts").use {
            it.moveToFirst();assertEquals(receiptCount+1,it.getInt(0))
        }
        assertEquals(JournalWrite.Rejected(WriteIssue.OPERATION_REUSED),repo.removeEnd(kept.first(),1,"remove-series"))
    }

    @Test fun deletingCurrentRoundLeavesUsableEmptyEndAndCompletedTrainingCanBecomeEmpty()=runBlocking(Dispatchers.IO) {
        start(2);shoot(2);next();shoot(1)
        var snapshot=details()
        val first=snapshot.roundProgress().ends.first().end.id
        val revision=snapshot.session.revision
        saved(repo.removeRound(id,first,revision,"remove-round"))
        assertTrue(saved(repo.removeRound(id,first,revision,"remove-round")).replayed)
        assertEquals(2,details().allShots.size)
        assertEquals("open",details().currentEnd!!.end.state)
        assertEquals(0,details().currentEnd!!.volume)
        shoot(1)
        saved(repo.complete(id,details().session.revision))
        while(details().trainingRounds().isNotEmpty()) {
            snapshot=details()
            saved(repo.removeRound(id,snapshot.trainingRounds().first().ends.first().end.id,snapshot.session.revision))
        }
        assertEquals("completed",details().session.state)
        assertTrue(details().allShots.isEmpty())
        assertNull(details().currentEnd)
        saved(repo.resume(id,details().session.revision))
        assertEquals("open",details().currentEnd!!.end.state)
        shoot(1)
    }

    @Test fun staleDeletionAndInjectedFailureLeaveEveryFactAndBoundaryUnchanged()=runBlocking(Dispatchers.IO) {
        start();shoot(1)
        val snapshot=details()
        val end=snapshot.currentEnd!!.end
        assertEquals(JournalWrite.Conflict(end.revision),repo.removeEnd(end.id,end.revision-1))
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER reject_end_delete BEFORE DELETE ON ends BEGIN SELECT RAISE(ABORT,'isolated rollback check'); END")
        try {
            repo.removeRound(id,end.id,snapshot.session.revision,"failed-delete")
            fail("Expected isolated delete failure")
        } catch(_:android.database.SQLException) { }
        assertEquals(snapshot,details())
        assertNull(db.journalDao().receipt("failed-delete"))
        db.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use { assertFalse(it.moveToFirst()) }
    }

    @Test fun absentArrowLimitKeepsLegacyStartReceiptHashAndReplay()=runBlocking(Dispatchers.IO) {
        val plan=BlockPlan(18.0,400,seriesPerRound=10,flexibleSeries=true)
        val title="Legacy retry"
        id=saved(repo.start(title,plan,"legacy-start")).id
        val oldPlan=plan.toString().removeSuffix(", roundArrowLimit=null)")+")"
        val payload=listOf(title,oldPlan).joinToString("") { "s${it.length}:$it" }
        val expected=java.security.MessageDigest.getInstance("SHA-256").digest(payload.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        assertEquals(expected,db.journalDao().receipt("legacy-start")!!.payloadHash)
        assertTrue(saved(repo.start(title,plan,"legacy-start")).replayed)
    }
}

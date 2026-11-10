package app.fableshot.android

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.util.UUID
import java.io.File

@RunWith(AndroidJUnit4::class)
class JournalRepositoryTest {
    private lateinit var db:JournalDatabase
    private lateinit var repo:JournalRepository
    @Before fun prepare(){db=Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,JournalDatabase::class.java).build();repo=JournalRepository(db)}
    @After fun cleanup(){db.close()}
    private suspend fun current()=requireNotNull(repo.active.first())
    private fun saved(result:JournalWrite)=result as JournalWrite.Saved

    @Test fun repeatedCommandsAreDurableAndDoNotResurrectRemovedShot()=runBlocking(Dispatchers.IO) {
        val create=UUID.randomUUID().toString();val first=saved(repo.start("Receipts",BlockPlan(18.0,600),create))
        assertTrue(saved(repo.start("Receipts",BlockPlan(18.0,600),create)).replayed)
        assertEquals(first.id,current().session.id)
        val end=current().currentEnd!!.end.id;val operation=UUID.randomUUID().toString()
        val shot=saved(repo.point(end,TargetPoint(0.0,0.0),operation))
        assertTrue(saved(repo.point(end,TargetPoint(0.0,0.0),operation)).replayed)
        assertEquals(1,current().allShots.size)
        assertEquals(JournalWrite.Rejected(WriteIssue.OPERATION_REUSED),repo.numeric(end,9,operation))
        saved(repo.removeShot(shot.id,1))
        assertTrue(saved(repo.point(end,TargetPoint(0.0,0.0),operation)).replayed)
        assertTrue(current().allShots.isEmpty())
    }

    @Test fun staleEditCannotOverwriteNewerEditOrMoveIdentity()=runBlocking(Dispatchers.IO) {
        saved(repo.start("CAS",BlockPlan(18.0,600)))
        val end=current().currentEnd!!.end.id;saved(repo.numeric(end,9));val original=current().allShots.single()
        saved(repo.revise(original.copy(points=8,scoreSource="manual_edit",endId="wrong",inputIndex=99,createdAtMs=0)))
        assertEquals(JournalWrite.Conflict(2),repo.revise(original.copy(points=7,scoreSource="manual_edit")))
        val latest=current().allShots.single()
        assertEquals(8,latest.points);assertEquals(original.endId,latest.endId);assertEquals(0,latest.inputIndex);assertEquals(original.createdAtMs,latest.createdAtMs)
        saved(repo.revise(original.copy(revision=latest.revision)))
        assertEquals(9,current().allShots.single().points);assertEquals(3,current().allShots.single().revision)
    }

    @Test fun blocksFreezeConditionsAndRequireExplicitPartialTransition()=runBlocking(Dispatchers.IO) {
        saved(repo.start("Conditions",BlockPlan(18.0,600)))
        val original=current().currentBlock!!.block;val end=current().currentEnd!!.end.id;saved(repo.numeric(end,9))
        var session=current().session
        assertEquals(JournalWrite.Rejected(WriteIssue.INCOMPLETE),repo.startBlock(session.id,BlockPlan(30.0,800,6),session.revision))
        saved(repo.startBlock(session.id,BlockPlan(30.0,800,6),session.revision,true))
        val result=current()
        assertEquals(2,result.blocks.size);assertEquals(original,result.orderedBlocks.first().block)
        assertEquals(1,result.orderedBlocks.first().ends.single().shots.size)
        assertEquals("closed",result.orderedBlocks.first().ends.single().end.state)
        assertEquals(6,result.currentEnd!!.end.plannedCount);assertEquals(30.0,result.currentBlock!!.block.distanceMeters!!,0.0)
    }

    @Test fun countOnlyNeverInventsMissesAndCannotMixWithScores()=runBlocking(Dispatchers.IO) {
        saved(repo.start("Volume",BlockPlan(null,null,6,"count_only")))
        var end=current().currentEnd!!.end
        assertEquals(JournalWrite.Rejected(WriteIssue.WRONG_MODE),repo.numeric(end.id,0))
        saved(repo.setCount(end.id,4,end.revision));end=current().currentEnd!!.end
        assertTrue(current().allShots.isEmpty());assertEquals(4,current().currentEnd!!.volume)
        assertEquals(JournalWrite.Rejected(WriteIssue.INCOMPLETE),repo.next(end.id,end.revision))
        saved(repo.next(end.id,end.revision,true))
        assertEquals(4,current().orderedBlocks.single().orderedEnds.first().volume)
        assertTrue(current().allShots.isEmpty())
        val closed=current().currentBlock!!.orderedEnds.first().end
        saved(repo.reviseCount(closed.id,3,closed.revision))
        assertEquals(3,current().currentBlock!!.orderedEnds.first().volume)
        assertEquals(JournalWrite.Conflict(closed.revision+1),repo.reviseCount(closed.id,2,closed.revision))
        assertTrue(current().allShots.isEmpty())
    }

    @Test fun middleRemovalReordersWithoutUniqueCollisionAndInvalidatesStaleRevision()=runBlocking(Dispatchers.IO) {
        saved(repo.start("Order",BlockPlan(18.0,600,6)));val end=current().currentEnd!!.end.id
        for(value in listOf(10,9,8,7))saved(repo.numeric(end,value))
        val before=current().allShots;val removed=before[1]
        saved(repo.removeShot(removed.id,removed.revision))
        val after=current().allShots
        assertEquals(listOf(10,8,7),after.map{it.points});assertEquals(listOf(0,1,2),after.map{it.inputIndex})
        assertEquals(before[2].id,after[1].id)
        assertEquals(JournalWrite.Conflict(2),repo.revise(before[2].copy(points=6,scoreSource="manual_edit")))
        saved(repo.numeric(end,6));assertEquals(listOf(0,1,2,3),current().allShots.map{it.inputIndex})
    }

    @Test fun trashRestorationAndPauseKeepAnotherActiveSessionIndependent()=runBlocking(Dispatchers.IO) {
        val first=saved(repo.start("First",BlockPlan(18.0,600))).id
        val end=current().currentEnd!!.end.id;saved(repo.numeric(end,10))
        var session=current().session;saved(repo.trash(session.id,session.revision))
        assertNull(repo.active.first());assertTrue(repo.history.first().isEmpty())
        val second=saved(repo.start("Second",BlockPlan(30.0,800))).id
        session=repo.details(first)!!.session;saved(repo.restore(first,session.revision))
        assertEquals(second,current().session.id);assertEquals("paused",repo.details(first)!!.session.state)
        assertEquals(10,repo.details(first)!!.allShots.single().points)
        assertEquals(JournalWrite.Rejected(WriteIssue.INACTIVE),repo.resume(first,repo.details(first)!!.session.revision))
        session=current().session;saved(repo.pause(second,session.revision))
        saved(repo.resume(first,repo.details(first)!!.session.revision));assertEquals(first,current().session.id)
    }

    @Test fun concurrentInputIsBoundedAndNextCanBeRetriedExactlyOnce()=runBlocking(Dispatchers.IO) {
        saved(repo.start("Burst",BlockPlan(18.0,600)));val end=current().currentEnd!!.end.id
        coroutineScope{(1..24).map{async{repo.numeric(end,10)}}.awaitAll()}
        assertEquals(3,current().allShots.size)
        val old=current().currentEnd!!.end;val operation=UUID.randomUUID().toString()
        val next=saved(repo.next(old.id,old.revision,operationId=operation))
        assertEquals(next.id,saved(repo.next(old.id,old.revision,operationId=operation)).id)
        assertEquals(2,current().currentBlock!!.ends.size)
    }

    @Test fun receiptFailureRollsBackShotAndAllParentRevisions()=runBlocking(Dispatchers.IO) {
        saved(repo.start("Rollback receipt",BlockPlan(18.0,600)))
        val before=current();val end=before.currentEnd!!.end.id;val operation=UUID.randomUUID().toString()
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER verification_receipt_failure BEFORE INSERT ON mutation_receipts WHEN NEW.kind='append' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END")
        try{repo.numeric(end,10,operation);fail("Receipt failure swallowed")}catch(e:Exception){assertTrue(e.toString().contains("injected receipt failure"))}
        assertTrue(current().allShots.isEmpty());assertEquals(before.session.revision,current().session.revision);assertEquals(before.currentEnd!!.end.revision,current().currentEnd!!.end.revision)
        db.openHelper.writableDatabase.execSQL("DROP TRIGGER verification_receipt_failure")
        saved(repo.numeric(end,10,operation));assertEquals(1,current().allShots.size)
    }

    @Test fun completionDropsOnlyEmptyLastEndAndRetryKeepsConfirmedShots()=runBlocking(Dispatchers.IO) {
        saved(repo.start("Trailing empty",BlockPlan(18.0,600)))
        var value=current();repeat(3){saved(repo.numeric(value.currentEnd!!.end.id,10))}
        value=current();val ids=value.allShots.map{it.id};saved(repo.next(value.currentEnd!!.end.id,value.currentEnd!!.end.revision))
        value=current();val emptyId=value.currentEnd!!.end.id;val operation=UUID.randomUUID().toString()
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_completion BEFORE INSERT ON mutation_receipts WHEN NEW.kind='complete' BEGIN SELECT RAISE(ABORT,'injected completion failure'); END")
        try{repo.complete(value.session.id,value.session.revision,operation);fail()}catch(_:Exception){}
        assertNotNull(db.journalDao().end(emptyId));assertEquals("active",current().session.state)
        db.openHelper.writableDatabase.execSQL("DROP TRIGGER fail_completion")
        saved(repo.complete(value.session.id,value.session.revision,operation))
        assertNull(db.journalDao().end(emptyId))
        val completed=repo.details(value.session.id)!!;assertEquals(1,completed.blocks.single().ends.size);assertEquals(ids,completed.allShots.map{it.id})
        assertTrue(saved(repo.complete(value.session.id,value.session.revision,operation)).replayed)
    }
    @Test fun emptyTrainingAndZeroCounterHaveNoArtificialEndButPartialInputRemains()=runBlocking(Dispatchers.IO) {
        saved(repo.start("Empty",BlockPlan(18.0,600)));var value=current();saved(repo.complete(value.session.id,value.session.revision))
        assertTrue(repo.details(value.session.id)!!.blocks.single().ends.isEmpty())
        saved(repo.start("Zero count",BlockPlan(null,null,3,"count_only")));value=current()
        saved(repo.setCount(value.currentEnd!!.end.id,0,value.currentEnd!!.end.revision));value=current();saved(repo.complete(value.session.id,value.session.revision))
        assertTrue(repo.details(value.session.id)!!.blocks.single().ends.isEmpty())
        saved(repo.start("Partial",BlockPlan(18.0,600)));value=current();saved(repo.numeric(value.currentEnd!!.end.id,9));value=current();saved(repo.complete(value.session.id,value.session.revision))
        assertEquals(1,repo.details(value.session.id)!!.blocks.single().ends.size);assertEquals(9,repo.details(value.session.id)!!.allShots.single().points)
    }
    @Test fun receiptsSurviveDiskReopenAndPreventDuplicateRetry()=runBlocking(Dispatchers.IO) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name="fableshot-verification-journal-${UUID.randomUUID()}.db"
        var disk=Room.databaseBuilder(context,JournalDatabase::class.java,name).build()
        try {
            var repository=JournalRepository(disk)
            saved(repository.start("Disk receipts",BlockPlan(18.0,600)))
            val end=repository.active.first()!!.currentEnd!!.end.id;val operation=UUID.randomUUID().toString()
            val shot=saved(repository.point(end,TargetPoint(0.0,0.0),operation))
            disk.close();disk=Room.databaseBuilder(context,JournalDatabase::class.java,name).build();repository=JournalRepository(disk)
            val replay=saved(repository.point(end,TargetPoint(0.0,0.0),operation))
            assertTrue(replay.replayed);assertEquals(shot.id,replay.id);assertEquals(1,repository.active.first()!!.allShots.size)
        }finally{disk.close();context.deleteDatabase(name)}
    }
}


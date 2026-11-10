package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.WriteGate
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class RankAssignmentRepositoryTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun currentReplacementHistoryReplayConflictAndRemovalAreExplicit()=runBlocking {
        val db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build()
        try {
            val repo=RankAssignmentRepository(db)
            val draft=RankAssignment(discipline="barebow",level="III",assignedOn="2026-01-01")
            val first=repo.save(draft)
            assertEquals(first,repo.save(draft))
            val second=repo.save(RankAssignment(discipline="barebow",level="II",assignedOn="2026-02-01"))
            val rows=repo.records.first()
            assertEquals(2,rows.size);assertFalse(rows.single {it.id==first.id}.current)
            assertTrue(rows.single {it.id==second.id}.current)
            repo.save(RankAssignment(discipline="barebow",category="female",level="I"))
            assertEquals(2,repo.records.first().count {it.current})
            try {repo.save(first.copy(level="I"));fail("Stale edit overwrote history")}catch(_:RankAssignmentConflict){}
            repo.remove(second);repo.remove(second)
            assertEquals(2,repo.records.first().size)
            assertFalse(repo.records.first().any {it.id==second.id})
            assertNotNull(db.rankAssignmentDao().get(second.id)!!.deletedAtMs)
            assertFalse(repo.records.first().single {it.id==first.id}.current)
        } finally {db.close()}
    }

    @Test fun invalidInputAndRetiredWriterLeaveStorageUnchanged()=runBlocking {
        val db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build()
        try {
            val gate=WriteGate();val repo=RankAssignmentRepository(db,gate)
            for(bad in listOf(RankAssignment(category=""),RankAssignment(level="unknown"),
                RankAssignment(assignedOn="2026-02-30"),RankAssignment(discipline="unknown"))) {
                try {repo.save(bad);fail("Invalid assignment saved")}catch(_:IllegalArgumentException){}
            }
            assertTrue(repo.records.first().isEmpty())
            gate.retire { }
            try {repo.save(RankAssignment());fail("Retired diary accepted write")}catch(_:IllegalStateException){}
            assertTrue(repo.records.first().isEmpty())
        } finally {db.close()}
    }

    @Test fun recordsSurviveDatabaseReopenWithoutBecomingTrainingAwards()=runBlocking {
        val name="fableshot-verification-ranks-${UUID.randomUUID()}.db"
        val first=Room.databaseBuilder(context,JournalDatabase::class.java,name).build()
        val original=try {RankAssignmentRepository(first).save(RankAssignment(level="КМС",reference="User order",assignedOn="2026-10-01"))}finally {first.close()}
        val reopened=Room.databaseBuilder(context,JournalDatabase::class.java,name).build()
        try {
            assertEquals(listOf(original),RankAssignmentRepository(reopened).records.first())
            assertTrue(reopened.journalDao().history().first().isEmpty())
        } finally {reopened.close();context.deleteDatabase(name)}
    }
}

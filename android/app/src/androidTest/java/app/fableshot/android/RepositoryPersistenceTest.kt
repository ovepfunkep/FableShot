package app.fableshot.android

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Disk-backed fixtures only. No MainActivity or production repository is opened. */
@RunWith(AndroidJUnit4::class)
class RepositoryPersistenceTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val filename = "fableshot-verification-${UUID.randomUUID()}.db"
    private lateinit var db: PracticeDatabase
    private lateinit var repo: PracticeRepository

    private fun open() {
        check(filename.startsWith("fableshot-verification-") && filename != "fableshot.db")
        db = Room.databaseBuilder(context, PracticeDatabase::class.java, filename).build()
        repo = PracticeRepository(db)
    }
    private suspend fun current() = requireNotNull(repo.active.first())
    @Before fun setup() { open() }
    @After fun cleanup() { db.close(); context.deleteDatabase(filename) }

    @Test fun reopenPreservesCoordinatesUnknownMissesAndManualScores() = runBlocking {
        repo.start("Disk round trip", 18.0, 600, 6)
        val end = current().currentEnd!!.end.id
        repo.add(end, TargetPoint(0.0, 0.0), null)
        val numeric = requireNotNull(repo.add(end, null, 9))
        repo.add(end, null, 0)
        repo.add(end, TargetPoint(1.1, -.2), null)
        // Manual score deliberately differs from the suggested zone at this coordinate.
        repo.revise(numeric.copy(x = .02, y = -.03, points = 7, origin = "manual"))
        val before = current()
        db.close(); open()
        val restored = current()
        assertEquals(before.session, restored.session)
        assertEquals(before.orderedEnds.map { it.end }, restored.orderedEnds.map { it.end })
        assertEquals(before.allShots, restored.allShots)
        assertEquals(listOf(10, 7, 0, 0), restored.allShots.map { it.points })
        assertEquals(0.0, restored.allShots.first().x!!, 0.0)
        assertNull(restored.allShots[2].x); assertNull(restored.allShots[2].y)
        assertEquals(1.1, restored.allShots[3].x!!, 0.0)
    }

    @Test fun concurrentInputsCannotOverfillAndRepeatedNextCreatesOneEnd() = runBlocking {
        repo.start("Concurrent commands", 10.0, 400, 3)
        val original = current().currentEnd!!.end.id
        coroutineScope { (1..24).map { async { repo.add(original, null, 10) } }.awaitAll() }
        assertEquals(3, current().allShots.size)
        assertEquals(listOf(0, 1, 2), current().allShots.map { it.inputIndex })
        coroutineScope { (1..12).map { async { repo.next(original) } }.awaitAll() }
        val details = current()
        assertEquals(listOf(1, 2), details.orderedEnds.map { it.end.number })
        assertTrue(details.orderedEnds.first().end.closed)
        assertNull(repo.add(original, null, 9))
        assertNull(repo.revise(details.allShots.first().copy(points = 8)))
        repo.next(details.currentEnd!!.end.id)
        assertEquals(2, current().ends.size)
    }

    @Test fun correctionUndoAndRemovalKeepShotIdentityAndOrdering() = runBlocking {
        repo.start("Edit and undo", 18.0, 600, 3)
        val end = current().currentEnd!!.end.id
        val first = requireNotNull(repo.add(end, TargetPoint(.01, .02), null))
        val middle = requireNotNull(repo.add(end, null, 9))
        val last = requireNotNull(repo.add(end, null, 8))
        val previous = requireNotNull(repo.revise(middle.copy(points = 7, origin = "manual", endId = "must-not-move", inputIndex = 42, createdAt = 0)))
        val edited = current().allShots[1]
        assertEquals(middle, previous)
        assertEquals(middle.id, edited.id); assertEquals(middle.endId, edited.endId)
        assertEquals(middle.createdAt, edited.createdAt); assertEquals(1, edited.inputIndex)
        assertEquals(2, edited.revision)
        repo.revise(previous)
        assertEquals(listOf(10, 9, 8), current().allShots.map { it.points })
        assertEquals(3, current().allShots[1].revision)
        repo.undoInserted(first.id, end) // A stale undo cannot remove an earlier arrow.
        assertEquals(3, current().allShots.size)
        repo.undoInserted(last.id, end)
        repo.next(end)
        assertEquals(1, current().ends.size)
        val replacement = requireNotNull(repo.add(end, null, 6))
        assertEquals(2, replacement.inputIndex)
        assertNotEquals(last.id, replacement.id)
        assertEquals(listOf(10, 9, 6), current().allShots.map { it.points })
    }

    @Test fun completingPartialEndDoesNotInventMissingShots() = runBlocking {
        repo.start("Partial end", 30.0, 800, 6)
        val session = current().session.id
        val end = current().currentEnd!!.end.id
        repo.add(end, null, 10); repo.add(end, null, 0)
        repo.complete(session)
        db.close(); open()
        assertNull(repo.active.first())
        val result = requireNotNull(repo.details(session))
        assertEquals("completed", result.session.state)
        assertNotNull(result.session.completedAt)
        assertEquals(6, result.currentEnd!!.end.plannedCount)
        assertEquals(listOf(10, 0), result.allShots.map { it.points })
        assertTrue(result.currentEnd!!.end.closed)
    }

    @Test fun invalidWritesLeavePreviouslyCommittedDataIntact() = runBlocking {
        repo.start("Atomic validation", 18.0, 600, 3)
        val end = current().currentEnd!!.end.id
        val shot = requireNotNull(repo.add(end, TargetPoint(.02, .01), null))
        try { repo.add(end, null, 11); fail("Invalid score accepted") } catch (_: IllegalArgumentException) { }
        try { repo.revise(shot.copy(y = null)); fail("Unpaired coordinates accepted") } catch (_: IllegalArgumentException) { }
        assertEquals(listOf(shot), current().allShots)
        assertEquals(shot, db.practiceDao().shot(shot.id))
        assertEquals(9, repo.add(end, null, 9)!!.points)
    }

    @Test fun deletingOneFixtureSessionCannotDeleteAnotherSession() = runBlocking {
        repo.start("First fixture", 10.0, 400, 3)
        val first = current()
        val firstEnd = first.currentEnd!!.end.id
        repo.add(firstEnd, null, 5)
        repo.complete(first.session.id)
        repo.start("Second fixture", 18.0, 600, 3)
        val secondId = current().session.id
        repo.add(current().currentEnd!!.end.id, null, 9)
        val second = current()
        repo.delete(first.session.id)
        assertNull(repo.details(first.session.id))
        assertTrue(db.practiceDao().shots(firstEnd).isEmpty())
        assertEquals(second.allShots, repo.details(secondId)!!.allShots)
        assertEquals(secondId, current().session.id)
    }
}

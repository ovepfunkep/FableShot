package app.fableshot.android

import android.os.Bundle
import android.os.Process
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Explicit two-process probe. Preparation is intentionally force-stopped after READY. */
@RunWith(AndroidJUnit4::class)
class ProcessPersistenceProbe {
    @Test fun committedDataSurvivesProcessStop() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val phase = InstrumentationRegistry.getArguments().getString("probePhase")
        assumeTrue("Run explicitly with probePhase=prepare or verify", phase == "prepare" || phase == "verify")
        val context = instrumentation.targetContext
        val filename = "fableshot-verification-process-v1.db"
        check(filename.startsWith("fableshot-verification-") && filename != "fableshot.db")
        val marker = context.getSharedPreferences("verification-process-fixture-v1", 0)
        if (phase == "prepare") {
            context.deleteDatabase(filename) // Only the explicitly named fixture from a previous probe.
            val db = Room.databaseBuilder(context, PracticeDatabase::class.java, filename).build()
            val repo = PracticeRepository(db)
            repo.start("Isolated process fixture", 18.0, 600, 3)
            val initial = requireNotNull(repo.active.first())
            val end = initial.currentEnd!!.end.id
            repo.add(end, TargetPoint(0.0, 0.0), null)
            val edited = requireNotNull(repo.add(end, null, 9))
            repo.add(end, null, 0)
            repo.revise(edited.copy(points = 8, origin = "manual"))
            repo.next(end)
            val secondEnd = requireNotNull(repo.active.first()).currentEnd!!.end.id
            repo.add(secondEnd, null, 7)
            check(marker.edit().clear().putInt("writerPid", Process.myPid()).putString("sessionId", initial.session.id).putString("editedId", edited.id).commit())
            instrumentation.sendStatus(2, Bundle().apply { putString("stream", "PERSISTENCE_FIXTURE_READY pid=${Process.myPid()}\n") })
            // Keep the actual Room connection open for an external am force-stop.
            Thread.sleep(30_000)
            db.close()
            fail("Probe must be force-stopped within 30 seconds after READY")
        } else {
            val writerPid = marker.getInt("writerPid", -1)
            assertTrue("Preparation marker missing", writerPid > 0)
            assertNotEquals("Verification must run in a new Android process", writerPid, Process.myPid())
            val db = Room.databaseBuilder(context, PracticeDatabase::class.java, filename).build()
            try {
                val repo = PracticeRepository(db)
                val restored = requireNotNull(repo.active.first())
                assertEquals(marker.getString("sessionId", null), restored.session.id)
                assertEquals(listOf(1, 2), restored.orderedEnds.map { it.end.number })
                assertTrue(restored.orderedEnds.first().end.closed)
                assertFalse(restored.currentEnd!!.end.closed)
                assertEquals(listOf(10, 8, 0, 7), restored.allShots.map { it.points })
                val edited = restored.allShots[1]
                assertEquals(marker.getString("editedId", null), edited.id)
                assertEquals(2, edited.revision); assertEquals("manual", edited.origin)
                assertNull(edited.x); assertNull(restored.allShots[2].x)
                assertEquals(0.0, restored.allShots[0].x!!, 0.0)
                instrumentation.sendStatus(2, Bundle().apply { putString("stream", "PERSISTENCE_RESTORED writerPid=$writerPid readerPid=${Process.myPid()}\n") })
            } finally { db.close() }
            context.deleteDatabase(filename)
            check(marker.edit().clear().commit())
        }
    }
}

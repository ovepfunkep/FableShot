package app.fableshot.android

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.JournalArchive
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class TrainingTimeTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun pauseAndCompletedContinuationCountOnlyActiveIntervalsThroughArchive() = runBlocking(Dispatchers.IO) {
        val folder = File(context.cacheDir, "verification-training-time-${UUID.randomUUID()}").apply { mkdirs() }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val journal = Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java).build()
        val equipment = Room.inMemoryDatabaseBuilder(context, EquipmentDatabase::class.java).build()
        val preferences = UserPreferences(PreferenceDataStoreFactory.create(scope=scope, produceFile={ File(folder,"test.preferences_pb") }))
        val archive = JournalArchive(context, journal, equipment, preferences, folder, File(folder,"staging"))
        try {
            val initial = 1_700_000_000_000L
            var instant = initial
            val repository = JournalRepository(journal, now={ instant })
            val durations = JournalPracticeStore(journal).trainingTimes
            val plan = BlockPlan(18.0, 400)
            val id = (repository.start("Tracked intervals", plan) as JournalWrite.Saved).sessionId
            suspend fun revision() = repository.details(id)!!.session.revision
            suspend fun shoot() {
                assertTrue(repository.numeric(repository.details(id)!!.currentEnd!!.end.id, 8) is JournalWrite.Saved)
            }
            shoot()
            instant = initial + 180_000
            assertTrue(repository.pause(id, revision()) is JournalWrite.Saved)
            instant = initial + 5_000_000
            assertTrue(repository.resume(id, revision()) is JournalWrite.Saved)
            assertEquals(185_000L, durations.first().bySession.getValue(id).elapsedMs(instant + 5_000))
            instant += 120_000
            assertTrue(repository.complete(id, revision()) is JournalWrite.Saved)
            assertEquals(300_000L, durations.first().recordedMs)
            instant += 86_400_000
            val beforeContinue = revision()
            assertTrue(repository.resume(id, beforeContinue, "resume-once") is JournalWrite.Saved)
            assertTrue((repository.resume(id, beforeContinue, "resume-once") as JournalWrite.Saved).replayed)
            shoot()
            instant += 60_000
            assertTrue(repository.complete(id, revision()) is JournalWrite.Saved)
            val expected = durations.first()
            assertEquals(TrackedTrainingTime(360_000, null, false), expected.bySession[id])
            assertEquals(360_000L, expected.recordedMs)
            instant += 60_000
            assertTrue(repository.trash(id, revision()) is JournalWrite.Saved)
            assertEquals(0L, durations.first().recordedMs)
            assertEquals(expected.bySession, durations.first().bySession)
            assertTrue(repository.restore(id, revision()) is JournalWrite.Saved)
            assertEquals(expected, durations.first())

            preferences.shootingBaseMinutes(145)
            val exported = archive.export()
            val prepared = archive.prepare(exported.file)
            val restored = Room.databaseBuilder(context, JournalDatabase::class.java, prepared.journalFile.absolutePath).build()
            try {
                assertEquals(expected, JournalPracticeStore(restored).trainingTimes.first())
                assertEquals("long" to 145L, prepared.preferences.getValue("shooting_base_minutes_v1"))
                val restoredSettingsFile = File(folder,"restored.preferences_pb")
                DiaryRuntime.writePreferences(context, restoredSettingsFile, prepared.preferences)
                val restoredSettings = UserPreferences(PreferenceDataStoreFactory.create(scope=scope, produceFile={ restoredSettingsFile }))
                assertEquals(145L, (restoredSettings.state.first() as SettingsRead.Ready).value.shootingBaseMinutes)
            } finally {
                restored.close()
                archive.discard(prepared.directory)
                archive.discard(exported.file)
            }
        } finally {
            scope.coroutineContext[Job]!!.cancelAndJoin()
            journal.close()
            equipment.close()
            check(folder.canonicalFile.parentFile == context.cacheDir.canonicalFile && folder.name.startsWith("verification-training-time-"))
            folder.deleteRecursively()
        }
        Unit
    }

    @Test fun missingHistoricalIntervalsRemainUnknownAndFutureAutoCompletionCounts() = runBlocking(Dispatchers.IO) {
        val journal = Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java).build()
        try {
            var instant = 1_700_000_000_000L
            val repository = JournalRepository(journal, now={ instant })
            val durations = JournalPracticeStore(journal).trainingTimes
            val old = (repository.start("Historical", BlockPlan(18.0, 400, arrows=1)) as JournalWrite.Saved).sessionId
            val end = repository.details(old)!!.currentEnd!!.end.id
            repository.numeric(end, 8)
            instant += 8_000_000
            repository.complete(old, repository.details(old)!!.session.revision)
            // Simulate historical facts without a lifecycle ledger. Preserve old dates and arrows.
            journal.openHelper.writableDatabase.execSQL("DELETE FROM mutation_receipts WHERE sessionId=?", arrayOf(old))
            assertNull(durations.first().bySession[old])
            assertEquals(0L, durations.first().recordedMs)
            instant += 86_400_000
            assertTrue(repository.resume(old, repository.details(old)!!.session.revision) is JournalWrite.Saved)
            instant += 42_000
            repository.complete(old, repository.details(old)!!.session.revision)
            assertEquals(TrackedTrainingTime(42_000, null, true), durations.first().bySession[old])

            val next = (repository.start("Planned", BlockPlan(18.0, 400, arrows=1, plannedEnds=1)) as JournalWrite.Saved).sessionId
            var open = repository.details(next)!!.currentEnd!!.end
            repository.numeric(open.id, 9)
            open = repository.details(next)!!.currentEnd!!.end
            instant += 60_000
            assertTrue(repository.next(open.id, open.revision) is JournalWrite.Saved)
            assertEquals("completed", repository.details(next)!!.session.state)
            val totals = durations.first()
            assertEquals(TrackedTrainingTime(60_000, null, false), totals.bySession[next])
            assertEquals(102_000L, totals.recordedMs)
        } finally { journal.close() }
        Unit
    }
}

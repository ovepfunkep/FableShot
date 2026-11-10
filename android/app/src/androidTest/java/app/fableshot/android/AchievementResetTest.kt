package app.fableshot.android

import android.database.Cursor
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.*
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Every runtime, DataStore, backup and SQLite trigger belongs to a UUID cache directory. */
class AchievementResetTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var root: File
    private val managers = mutableListOf<DiaryManager>()
    private val achievementTables = setOf("achievement_grants", "achievement_enrollments")

    @Before fun setup() {
        root = File(context.cacheDir, "verification-achievement-reset-${UUID.randomUUID()}").apply { mkdirs() }
    }

    @After fun cleanup() = runBlocking(Dispatchers.IO) {
        managers.forEach { it.close() }
        check(root.canonicalFile.parentFile == context.cacheDir.canonicalFile &&
            root.name.startsWith("verification-achievement-reset-"))
        root.deleteRecursively()
        Unit
    }

    private fun plan(): BlockPlan {
        val bow = EquipmentItem(id = "reset-bow", kind = "bow", name = "Reset fixture bow", category = "barebow")
        return BlockPlan(18.0, 400, 3, equipmentSnapshotJson = equipmentSnapshot(bow, listOf(bow)),
            targetProfileId = "wa-indoor-outer-v1", rankCategory = "male")
    }

    private suspend fun perfect(runtime: DiaryRuntime): String {
        val repo = runtime.repository.journal
        val id = (repo.start("Reset fixture training", plan()) as JournalWrite.Saved).sessionId
        val end = repo.details(id)!!.currentEnd!!.end.id
        repeat(3) { assertTrue(repo.point(end, TargetPoint(.01, .01)) is JournalWrite.Saved) }
        assertTrue(repo.complete(id, repo.details(id)!!.session.revision) is JournalWrite.Saved)
        return id
    }

    private suspend fun managed(checkpoint: (String) -> Unit = {}): DiaryManager {
        val generationRoot = File(root, "generations")
        val generations = DiaryGenerations(generationRoot)
        val directory = generations.newFolder()
        val runtime = DiaryRuntime(context, directory.name, directory)
        try {
            runtime.warmUp()
            runtime.preferences.finishOnboarding("completed")
            runtime.preferences.displayName("Reset fixture archer")
            runtime.preferences.style(DesignStyle.Pop)
            runtime.preferences.showAchievements(false)
            runtime.preferences.shootingBaseMinutes(123)
            runtime.preferences.hideCurrentScores(true)
            runtime.preferences.statistic(StatisticFeature.entries.first(), false)
            runtime.equipment.save(EquipmentItem(id = "reset-bow", kind = "bow", name = "Reset fixture bow", category = "barebow"))
            perfect(runtime)
            runtime.repository.notes.save(DiaryNote(body = "Preserved fixture note"))
            runtime.repository.rankAssignments.save(RankAssignment(reference = "Preserved fixture order"))
            runtime.repository.journal.achievements.service("APP04", "reset-fixture-share")
            withTimeout(10_000) {
                runtime.journal.achievementDao().observeGrants().first { rows -> rows.any { it.ruleId == "APP08" } }
            }
            runtime.repository.journal.achievements.claimNotifications(runtime.journal.achievementDao().grants().map { it.key })
            generations.seal(directory)
        } finally {
            runtime.close()
        }
        generations.activate(directory.name, DiarySelection())
        return DiaryManager(context, generationRoot, generations,
            LocalRecoveryBackups(File(root, "backups"), checkpoint)).also { managers += it }
    }

    /** Compare every field, preserving numeric types and NULL instead of only comparing counts. */
    private fun snapshot(database: RoomDatabase, tables: List<String>): Map<String, List<String>> = tables.associateWith { table ->
        database.openHelper.writableDatabase.query("SELECT * FROM `$table`").use { cursor ->
            buildList {
                while (cursor.moveToNext()) add((0 until cursor.columnCount).joinToString("|") { index ->
                    when (cursor.getType(index)) {
                        Cursor.FIELD_TYPE_NULL -> "null"
                        Cursor.FIELD_TYPE_INTEGER -> "int:${cursor.getLong(index)}"
                        Cursor.FIELD_TYPE_FLOAT -> "double:${cursor.getDouble(index)}"
                        Cursor.FIELD_TYPE_STRING -> cursor.getString(index).let { "text:${it.length}:$it" }
                        else -> error("Unexpected fixture blob")
                    }
                })
            }.sorted()
        }
    }

    private suspend fun assertReset(runtime: DiaryRuntime) {
        assertTrue(runtime.journal.achievementDao().grants().isEmpty())
        assertTrue(runtime.journal.achievementDao().enrollments().isEmpty())
        val board = runtime.repository.journal.achievements.board.first()
        assertFalse(board.failed)
        assertTrue(board.awards.isEmpty())
        assertTrue(board.statuses.all { it.value == 0L && it.earned == null })
        assertFalse(runtime.preferences.archiveSnapshot().containsKey("achievement_name_event_v2"))
    }

    @Test fun resetBacksUpAndClearsOnlyAchievementFactsAndRepeatedResetStaysEmpty() = runBlocking(Dispatchers.IO) {
        val manager = managed()
        val runtime = manager.current
        val selection = DiaryGenerations(File(root, "generations")).read()
        val allBefore = snapshot(runtime.journal, ArchiveEnvelopeVerifier.journalTables)
        val equipmentBefore = snapshot(runtime.equipmentDatabase, ArchiveEnvelopeVerifier.equipmentTables)
        val preferencesBefore = runtime.preferences.archiveSnapshot().minus("achievement_name_event_v2")
        assertTrue(allBefore.getValue("achievement_grants").isNotEmpty())
        val backup = manager.resetAchievements()
        assertSame(runtime, manager.current)
        assertEquals(selection, DiaryGenerations(File(root, "generations")).read())
        assertEquals(allBefore - achievementTables,
            snapshot(runtime.journal, ArchiveEnvelopeVerifier.journalTables.filterNot { it in achievementTables }))
        assertEquals(equipmentBefore, snapshot(runtime.equipmentDatabase, ArchiveEnvelopeVerifier.equipmentTables))
        assertEquals(preferencesBefore, runtime.preferences.archiveSnapshot())
        assertReset(runtime)
        assertTrue(backup.file.isFile && backup.sizeBytes > 0)
        assertEquals(allBefore.getValue("achievement_grants").size.toLong(),
            backup.manifest.rowCounts.getValue("data/journal/achievement_grants.jsonl"))
        val staged = manager.recoveryBackups.stage(backup, runtime.archive)
        try {
            val prepared = runtime.archive.prepare(staged)
            val copy = Room.databaseBuilder(context, JournalDatabase::class.java, prepared.journalFile.absolutePath).build()
            try { assertEquals(allBefore, snapshot(copy, ArchiveEnvelopeVerifier.journalTables)) }
            finally { copy.close(); runtime.archive.discard(prepared.directory) }
        } finally { runtime.archive.discard(staged) }
        manager.resetAchievements()
        assertReset(runtime)
        assertEquals(allBefore - achievementTables,
            snapshot(runtime.journal, ArchiveEnvelopeVerifier.journalTables.filterNot { it in achievementTables }))
    }

    @Test fun oldActiveTrainingAndCorrectionsStayIneligibleWhileNewTrainingAndActionsEarnAgain() = runBlocking(Dispatchers.IO) {
        val manager = managed()
        val runtime = manager.current
        val repo = runtime.repository.journal
        val oldId = (repo.start("Already active before reset", plan()) as JournalWrite.Saved).sessionId
        val oldEnd = repo.details(oldId)!!.currentEnd!!.end.id
        assertTrue(repo.numeric(oldEnd, 9) is JournalWrite.Saved)
        manager.resetAchievements()
        repeat(2) { assertTrue(repo.point(oldEnd, TargetPoint(.01, .01)) is JournalWrite.Saved) }
        val oldShot = repo.details(oldId)!!.allShots.first()
        assertTrue(repo.revise(oldShot.copy(points = 10, zoneCode = "10", scoreSource = "manual_edit")) is JournalWrite.Saved)
        assertTrue(repo.complete(oldId, repo.details(oldId)!!.session.revision) is JournalWrite.Saved)
        assertReset(runtime)
        val fresh = perfect(runtime)
        assertEquals(listOf(fresh), runtime.journal.achievementDao().enrollments().map { it.sessionId })
        assertEquals(fresh, runtime.journal.achievementDao().grant("HIT01:barebow")!!.sessionId)
        assertEquals(fresh, runtime.journal.achievementDao().grant("START01:global")!!.sessionId)
        assertEquals(3L, repo.achievements.board.first().statuses.first { it.definition.id == "START06" }.value)
        repo.achievements.service("APP04", "explicit-new-share")
        assertEquals("explicit-new-share", runtime.journal.achievementDao().grant("APP04:global")!!.batchId)
        assertNotNull(repo.details(oldId))
    }

    @Test fun deleteFailureRollsBackGrantsEnrollmentsAndPendingNameCommand() = runBlocking(Dispatchers.IO) {
        val manager = managed()
        val runtime = manager.current
        val before = snapshot(runtime.journal, ArchiveEnvelopeVerifier.journalTables)
        val preferences = runtime.preferences.archiveSnapshot()
        val database = runtime.journal.openHelper.writableDatabase
        database.execSQL("CREATE TRIGGER fail_achievement_reset BEFORE DELETE ON achievement_enrollments BEGIN SELECT RAISE(ABORT,'isolated reset fixture'); END")
        try {
            try { manager.resetAchievements(); fail("Accepted failed reset") }
            catch (error: Exception) { if (error is CancellationException) throw error }
            assertEquals(before, snapshot(runtime.journal, ArchiveEnvelopeVerifier.journalTables))
            assertEquals(preferences, runtime.preferences.archiveSnapshot())
            assertNotNull(manager.recoveryBackups.discover().latest)
        } finally { database.execSQL("DROP TRIGGER fail_achievement_reset") }
        manager.resetAchievements()
        assertReset(runtime)
    }

    @Test fun backupFailureAndCancellationLeaveAchievementsAndPreferencesWritable() = runBlocking(Dispatchers.IO) {
        var cancel = false
        val manager = managed { phase ->
            if (phase == "backup_validated") {
                if (cancel) throw CancellationException("isolated cancellation")
                throw IOException("isolated backup failure")
            }
        }
        val runtime = manager.current
        val before = snapshot(runtime.journal, ArchiveEnvelopeVerifier.journalTables)
        val preferences = runtime.preferences.archiveSnapshot()
        try { manager.resetAchievements(); fail("Accepted failed backup") } catch (_: IOException) { }
        assertEquals(before, snapshot(runtime.journal, ArchiveEnvelopeVerifier.journalTables))
        assertEquals(preferences, runtime.preferences.archiveSnapshot())
        assertNull(manager.recoveryBackups.discover().latest)
        cancel = true
        val resetting = launch { manager.resetAchievements() }
        resetting.join()
        assertTrue(resetting.isCancelled)
        assertEquals(before, snapshot(runtime.journal, ArchiveEnvelopeVerifier.journalTables))
        runtime.preferences.showAchievements(true)
        assertTrue((runtime.preferences.state.first() as SettingsRead.Ready).value.showAchievements)
    }

    @Test fun capturedOldNameCommandCannotReplayAfterResetOrRestartButExplicitSaveAwards() = runBlocking(Dispatchers.IO) {
        lateinit var runtime: DiaryRuntime
        var inject = false
        var manager = managed { phase ->
            if (inject && phase == "backup_saved") runBlocking {
                // Simulate a delayed command captured while reset owns the gate.
                runtime.preferences.replaceAchievementNameEventWithGateHeld("captured-before-reset|1234")
            }
        }
        runtime = manager.current
        inject = true
        manager.resetAchievements()
        assertReset(runtime)
        manager.close()
        manager = DiaryManager(context, File(root, "generations"),
            recoveryBackups = LocalRecoveryBackups(File(root, "backups"))).also { managers += it }
        runtime = manager.current
        runtime.warmUp()
        runtime.preferences.style(DesignStyle.Minimal)
        // Let the runtime observer consume the post-reset preference state.
        delay(200)
        assertReset(runtime)
        assertEquals("Reset fixture archer", (runtime.preferences.state.first() as SettingsRead.Ready).value.displayName)
        runtime.preferences.displayName("New explicit name")
        withTimeout(10_000) {
            runtime.journal.achievementDao().observeGrants().first { rows -> rows.any { it.ruleId == "APP08" } }
        }
        assertEquals("New explicit name", (runtime.preferences.state.first() as SettingsRead.Ready).value.displayName)
    }

    @Test fun resetDrainsConcurrentWritersAndBackupIsTheStateBeforeReset() = runBlocking(Dispatchers.IO) {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val manager = managed { phase ->
            if (phase == "backup_validated") {
                entered.countDown()
                check(release.await(10, TimeUnit.SECONDS))
            }
        }
        val runtime = manager.current
        val reset = async { manager.resetAchievements() }
        try {
            assertTrue(entered.await(10, TimeUnit.SECONDS))
            val attempted = CompletableDeferred<Unit>()
            val writer = async {
                attempted.complete(Unit)
                runtime.repository.journal.achievements.service("APP04", "after-reset-share")
            }
            attempted.await()
            assertFalse(writer.isCompleted)
            release.countDown()
            val backup = reset.await()
            writer.await()
            assertEquals("after-reset-share", runtime.journal.achievementDao().grant("APP04:global")!!.batchId)
            assertTrue(runtime.journal.achievementDao().enrollments().isEmpty())
            assertTrue(backup.manifest.rowCounts.getValue("data/journal/achievement_enrollments.jsonl") > 0)
        } finally { release.countDown() }
    }
}

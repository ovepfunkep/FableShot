package app.fableshot.android

import androidx.room.RoomDatabase
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.*
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.technique.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** UUID generations and database paths only. Never opens the installed personal diary. */
class AccountResetTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var root: File
    private val managers = mutableListOf<DiaryManager>()

    @Before fun setup() {
        root = File(context.cacheDir, "verification-reset-${UUID.randomUUID()}").apply { mkdirs() }
    }

    @After fun cleanup() = runBlocking(Dispatchers.IO) {
        managers.forEach { it.close() }
        check(root.canonicalFile.parentFile == context.cacheDir.canonicalFile && root.name.startsWith("verification-reset-"))
        root.deleteRecursively()
        Unit
    }

    private suspend fun managed(
        backupCheckpoint: (String) -> Unit = {},
        generationCheckpoint: (String) -> Unit = {},
    ): DiaryManager {
        val generationRoot = File(root, "generations")
        val generations = DiaryGenerations(generationRoot)
        val directory = generations.newFolder()
        val runtime = DiaryRuntime(context, directory.name, directory)
        try {
            runtime.warmUp()
            runtime.preferences.displayName("Reset fixture")
            runtime.preferences.finishOnboarding("completed")
            runtime.preferences.finishTutorial()
            runtime.preferences.style(DesignStyle.Pop)
            runtime.preferences.appearance(Appearance.Dark)
            runtime.preferences.showAchievements(false)
            runtime.preferences.shootingBaseMinutes(125)
            runtime.preferences.hideCurrentScores(true)
            runtime.preferences.rankCategory("female")
            runtime.preferences.techniqueVisibility("focus", false)
            runtime.preferences.habitualTraining("isolated stored plan")
            runtime.equipment.save(EquipmentItem(kind = "bow", name = "Fixture bow"))
            val techniques = runtime.repository.techniques
            val text = TechniqueText(title = "Fixture technique")
            val document = techniques.create(text)
            val version = techniques.publish(document, techniques.library.first().single().document.draftJson, text.json())
            val journal = runtime.repository.journal
            val first = journal.start("Trashed fixture", BlockPlan(18.0, 400,
                techniqueSelection = TechniqueSelection(version.id, "Fixture focus"))) as JournalWrite.Saved
            journal.numeric(journal.details(first.sessionId)!!.currentEnd!!.end.id, 8)
            journal.complete(first.sessionId, journal.details(first.sessionId)!!.session.revision)
            journal.trash(first.sessionId, journal.details(first.sessionId)!!.session.revision)
            val active = journal.start("Active fixture", BlockPlan(18.0, 400)) as JournalWrite.Saved
            journal.numeric(journal.details(active.sessionId)!!.currentEnd!!.end.id, 10)
            runtime.repository.notes.save(DiaryNote(body = "Fixture note"))
            runtime.repository.rankAssignments.save(RankAssignment(level = "III", reference = "Fixture order"))
            journal.achievements.service("APP04", "reset-fixture-import")
            withTimeout(10_000) {
                while (runtime.journal.achievementDao().grants().none { it.ruleId == "APP08" }) delay(10)
            }
            journal.achievements.claimNotifications(runtime.journal.achievementDao().grants().map { it.key })
            generations.seal(directory)
        } finally {
            runtime.close()
        }
        generations.activate(directory.name, DiarySelection())
        return DiaryManager(context, generationRoot, DiaryGenerations(generationRoot, generationCheckpoint),
            LocalRecoveryBackups(File(root, "recovery-backups"), backupCheckpoint)).also { managers += it }
    }

    private fun count(database: RoomDatabase, table: String): Long = database.openHelper.writableDatabase
        .query("SELECT COUNT(*) FROM `$table`").use { it.moveToFirst(); it.getLong(0) }

    private suspend fun assertEmpty(runtime: DiaryRuntime) {
        for (table in ArchiveEnvelopeVerifier.journalTables) assertEquals(table, 0L, count(runtime.journal, table))
        for (table in ArchiveEnvelopeVerifier.equipmentTables) assertEquals(table, 0L, count(runtime.equipmentDatabase, table))
        assertEquals(UserSettings(), (runtime.preferences.state.first() as SettingsRead.Ready).value)
        assertTrue(runtime.preferences.archiveSnapshot().isEmpty())
    }

    @Test fun resetPublishesOnlyAfterVerifiedDurableBackupAndReopensCompletelyEmpty() = runBlocking(Dispatchers.IO) {
        var manager = managed()
        val original = manager.current
        val backup = manager.resetAccount()
        assertNotEquals(original.id, manager.current.id)
        assertTrue(backup.file.isFile)
        assertTrue(backup.sizeBytes > 0)
        assertEquals(2L, backup.manifest.rowCounts.getValue("data/journal/sessions.jsonl"))
        assertEquals(2L, backup.manifest.rowCounts.getValue("data/journal/shots.jsonl"))
        assertTrue(backup.manifest.rowCounts.getValue("data/journal/achievement_grants.jsonl") > 0)
        assertEquals(original.id, DiaryGenerations(File(root, "generations")).read().previous)
        assertEmpty(manager.current)
        try { original.preferences.displayName("Stale writer"); fail() } catch (_: IllegalStateException) { }
        val committed = manager.current.id
        manager.close()
        manager = DiaryManager(context, File(root, "generations"), recoveryBackups = LocalRecoveryBackups(File(root, "recovery-backups")))
            .also { managers += it }
        assertEquals(committed, manager.current.id)
        assertEmpty(manager.current)
        assertEquals(backup.file, manager.recoveryBackups.discover().latest!!.file)
    }

    @Test fun backupFailureAndCancellationKeepSelectionFactsAndWritersUsable() = runBlocking(Dispatchers.IO) {
        val manager = managed(backupCheckpoint = { if (it == "before_backup_rename") throw IOException("injected backup failure") })
        val original = manager.current
        val selection = DiaryGenerations(File(root, "generations")).read()
        try { manager.resetAccount(); fail() } catch (_: IOException) { }
        assertSame(original, manager.current)
        assertEquals(selection, DiaryGenerations(File(root, "generations")).read())
        assertEquals(2L, count(original.journal, "shots"))
        assertNull(manager.recoveryBackups.discover().latest)
        original.preferences.displayName("Still writable")
        assertEquals("Still writable", (original.preferences.state.first() as SettingsRead.Ready).value.displayName)
    }

    @Test fun cancellationAfterValidationNeverPublishesOrRetiresOriginalGeneration() = runBlocking(Dispatchers.IO) {
        val manager = managed(backupCheckpoint = { if (it == "backup_validated") throw CancellationException("injected cancellation") })
        val original = manager.current
        val selection = DiaryGenerations(File(root, "generations")).read()
        val reset = launch { manager.resetAccount() }
        reset.join()
        assertTrue(reset.isCancelled)
        assertSame(original, manager.current)
        assertEquals(selection, DiaryGenerations(File(root, "generations")).read())
        assertEquals(2L, count(original.journal, "sessions"))
        original.preferences.showAchievements(true)
        assertTrue((original.preferences.state.first() as SettingsRead.Ready).value.showAchievements)
    }

    @Test fun failedSelectionCommitLeavesBackupAndOriginalDiaryUsable() = runBlocking(Dispatchers.IO) {
        val manager = managed(generationCheckpoint = { if (it == "before_selection") throw IOException("injected selection failure") })
        val original = manager.current
        try { manager.resetAccount(); fail() } catch (_: IOException) { }
        assertSame(original, manager.current)
        assertEquals(original.id, DiaryGenerations(File(root, "generations")).read().current)
        assertNotNull(manager.recoveryBackups.discover().latest)
        original.equipment.save(EquipmentItem(kind = "arrows", name = "Still writable"))
        assertEquals(2L, count(original.equipmentDatabase, "equipment_items"))
    }

    @Test fun cancellationDuringPublicationStillRetiresEveryOldWriter() = runBlocking(Dispatchers.IO) {
        lateinit var reset: Job
        val manager = managed(generationCheckpoint = {
            if (it == "before_selection") reset.cancel(CancellationException("injected during publication"))
        })
        val original = manager.current
        reset = launch(start = CoroutineStart.LAZY) { manager.resetAccount() }
        reset.start()
        reset.join()
        assertTrue(reset.isCancelled)
        assertNotEquals(original.id, manager.current.id)
        assertEquals(manager.current.id, DiaryGenerations(File(root, "generations")).read().current)
        assertEmpty(manager.current)
        assertNotNull(manager.recoveryBackups.discover().latest)
        try { original.preferences.displayName("Stale after cancellation"); fail("Old preference writer accepted") }
        catch (error: IllegalStateException) { assertEquals("DIARY_REPLACED", error.message) }
        try { original.equipment.save(EquipmentItem(kind = "bow", name = "Stale after cancellation")); fail("Old equipment writer accepted") }
        catch (error: IllegalStateException) { assertEquals("DIARY_REPLACED", error.message) }
        try {
            original.repository.journal.numeric(original.repository.journal.active.first()!!.currentEnd!!.end.id, 1)
            fail("Old journal writer accepted")
        } catch (error: IllegalStateException) { assertEquals("DIARY_REPLACED", error.message) }
    }

    @Test fun backupPreviewAndRestoreRecoverAllFactsWithoutNewCelebration() = runBlocking(Dispatchers.IO) {
        val manager = managed()
        val original = manager.current
        val expectedPreferences = original.preferences.archiveSnapshot().minus("achievement_name_event_v2")
        val expectedGrants = original.journal.achievementDao().grants()
        val expectedNotes = original.repository.notes.notes.first()
        val expectedRanks = original.repository.rankAssignments.records.first()
        val expectedTechnique = original.repository.techniques.library.first()
        val expectedEquipment = original.equipment.items.first()
        val expectedActive = original.repository.journal.active.first()
        val expectedTrash = original.repository.journal.trashHistory.first()
        val backup = manager.resetAccount()
        val empty = manager.current
        val staged = manager.recoveryBackups.stage(backup, empty.archive)
        try {
            val preview = empty.archive.prepare(staged)
            empty.archive.discard(preview.directory)
            assertSame(empty, manager.current)
            assertEmpty(empty)
            manager.restore(staged)
            val restored = manager.current
            assertEquals(expectedPreferences, restored.preferences.archiveSnapshot())
            assertEquals(expectedGrants.toSet(), restored.journal.achievementDao().grants().toSet())
            assertEquals(expectedNotes, restored.repository.notes.notes.first())
            assertEquals(expectedRanks, restored.repository.rankAssignments.records.first())
            assertEquals(expectedTechnique, restored.repository.techniques.library.first())
            assertEquals(expectedEquipment, restored.equipment.items.first())
            assertEquals(expectedActive, restored.repository.journal.active.first())
            assertEquals(expectedTrash, restored.repository.journal.trashHistory.first())
            assertTrue(restored.repository.journal.achievements.claimNotifications(expectedGrants.map { it.key }).isEmpty())
            manager.undoReplacement()
            // Undo uses the existing receipt-history policy; training replacement remains empty.
            assertEquals(empty.id, manager.current.id)
            assertEquals(0L, count(manager.current.journal, "sessions"))
        } finally { empty.archive.discard(staged) }
    }

    @Test fun catalogReportsCorruptNewestAndOffersPreviousVerifiedCopyWithMetadata() = runBlocking(Dispatchers.IO) {
        val manager = managed()
        val backup = manager.resetAccount()
        val bad = File(backup.file.parentFile, "${backup.savedAtMs + 1000}-${UUID.randomUUID()}.fableshot")
        bad.writeText("Corrupt newest fixture")
        val catalog = manager.recoveryBackups.discover()
        assertEquals(backup.file, catalog.latest!!.file)
        assertEquals(backup.savedAtMs, catalog.latest.savedAtMs)
        assertEquals(backup.sizeBytes, catalog.latest.sizeBytes)
        assertEquals(2L, catalog.latest.manifest.rowCounts.getValue("data/journal/shots.jsonl"))
        assertEquals(listOf(bad.name), catalog.issues.map { it.fileName })
        assertTrue(catalog.issues.single().reason.isNotBlank())
    }

    @Test fun writerCannotChangeSnapshotBetweenBackupAndCommit() = runBlocking(Dispatchers.IO) {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val manager = managed(backupCheckpoint = {
            if (it == "backup_validated") {
                entered.countDown()
                check(release.await(10, TimeUnit.SECONDS))
            }
        })
        val old = manager.current
        val reset = async { manager.resetAccount() }
        try {
            assertTrue(entered.await(10, TimeUnit.SECONDS))
            val attempted = CompletableDeferred<Unit>()
            val writer = async { attempted.complete(Unit); runCatching { old.preferences.displayName("Must not leak into snapshot") } }
            attempted.await()
            assertFalse(writer.isCompleted)
            release.countDown()
            val backup = reset.await()
            assertTrue(writer.await().exceptionOrNull() is IllegalStateException)
            assertEmpty(manager.current)
            val staged = manager.recoveryBackups.stage(backup, manager.current.archive)
            try {
                val prepared = manager.current.archive.prepare(staged)
                try { assertEquals("Reset fixture", prepared.preferences.getValue("displayName").second) }
                finally { manager.current.archive.discard(prepared.directory) }
            } finally { manager.current.archive.discard(staged) }
        } finally { release.countDown() }
    }
}

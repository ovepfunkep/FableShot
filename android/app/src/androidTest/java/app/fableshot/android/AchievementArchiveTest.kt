package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.*
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/** All stores belong to a temporary generation; the personal diary is never opened. */
class AchievementArchiveTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var root: File
    private val runtimes = mutableListOf<DiaryRuntime>()
    private val managers = mutableListOf<DiaryManager>()
    private val staged = mutableListOf<Pair<JournalArchive, File>>()

    @Before fun setup() {
        root = File(context.cacheDir, "verification-achievement-archive-${UUID.randomUUID()}").apply { mkdirs() }
    }

    @After fun cleanup() = runBlocking(Dispatchers.IO) {
        managers.forEach { it.close() }
        runtimes.forEach { it.close() }
        staged.forEach { (archive, file) -> archive.discard(file) }
        check(root.canonicalFile.parentFile == context.cacheDir.canonicalFile &&
            root.name.startsWith("verification-achievement-archive-"))
        root.deleteRecursively()
        Unit
    }

    private suspend fun runtime(parent: File): DiaryRuntime {
        val store = DiaryGenerations(parent)
        val directory = store.newFolder()
        return DiaryRuntime(context, directory.name, directory).also {
            runtimes.add(it)
            it.warmUp()
            it.preferences.finishOnboarding("skipped")
        }
    }

    private suspend fun managed(initial: DiaryRuntime): DiaryManager {
        val directory = requireNotNull(initial.directory)
        val store = DiaryGenerations(directory.parentFile!!)
        store.seal(directory)
        initial.close()
        store.activate(directory.name, DiarySelection())
        return DiaryManager(context, directory.parentFile!!, store).also { managers.add(it) }
    }

    private fun plan(category: String): BlockPlan {
        val bow = EquipmentItem(id = "bow-$category", kind = "bow", name = "Archive bow", category = category)
        return BlockPlan(18.0, 400, 3, equipmentSnapshotJson = equipmentSnapshot(bow, listOf(bow)),
            targetProfileId = "wa-indoor-outer-v1", rankCategory = "female")
    }

    private suspend fun perfect(runtime: DiaryRuntime, category: String, complete: Boolean = true): String {
        val repo = runtime.repository.journal
        val id = (repo.start("Archive $category", plan(category)) as JournalWrite.Saved).sessionId
        val end = repo.details(id)!!.currentEnd!!.end.id
        repeat(3) { assertTrue(repo.point(end, TargetPoint(.01, .01)) is JournalWrite.Saved) }
        if (complete) assertTrue(repo.complete(id, repo.details(id)!!.session.revision) is JournalWrite.Saved)
        assertNotNull(runtime.journal.achievementDao().grant("HIT01:$category"))
        return id
    }

    private suspend fun export(runtime: DiaryRuntime): ExportedArchive = runtime.archive.export().also {
        staged.add(runtime.archive to it.file)
    }

    private fun entries(file: File): MutableMap<String, ByteArray> = ZipFile(file).use { zip ->
        zip.entries().asSequence().associate { it.name to zip.getInputStream(it).readBytes() }.toMutableMap()
    }

    private suspend fun repack(archive: JournalArchive, data: MutableMap<String, ByteArray>): File {
        val manifest = JSONObject(data.getValue("manifest.json").toString(Charsets.UTF_8))
        val payloads = JSONArray()
        data.filterKeys { it != "manifest.json" }.forEach { (path, bytes) ->
            payloads.put(JSONObject().put("path", path).put("bytes", bytes.size.toLong())
                .put("sha256", ArchiveEnvelopeVerifier.sha256(bytes)))
        }
        data["manifest.json"] = manifest.put("payloads", payloads).toString().toByteArray()
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip ->
            data.forEach { (path, content) ->
                zip.putNextEntry(ZipEntry(path)); zip.write(content); zip.closeEntry()
            }
        }
        return archive.stage(bytes.toByteArray().inputStream()).also { staged.add(archive to it) }
    }

    private suspend fun legacySeven(archive: JournalArchive, file: File): File {
        val data = entries(file)
        val paths = ArchiveEnvelopeVerifier.requiredPathsFor(9)
        data.keys.filter { it.startsWith("data/") && it !in paths }.toList().forEach { data.remove(it) }
        val sessionsPath = "data/journal/sessions.jsonl"
        data[sessionsPath] = data.getValue(sessionsPath).toString(Charsets.UTF_8).lineSequence().filter { it.isNotBlank() }
            .joinToString("\n", postfix = "\n") { JSONObject(it).apply { remove("numberedArrows") }.toString() }.toByteArray()
        val endsPath = "data/journal/ends.jsonl"
        data[endsPath] = data.getValue(endsPath).toString(Charsets.UTF_8).lineSequence().filter { it.isNotBlank() }
            .joinToString("\n", postfix = "\n") { JSONObject(it).apply { remove("startsRound") }.toString() }.toByteArray()
        val shotsPath = "data/journal/shots.jsonl"
        data[shotsPath] = data.getValue(shotsPath).toString(Charsets.UTF_8).lineSequence().filter { it.isNotBlank() }
            .joinToString("\n", postfix = "\n") { JSONObject(it).apply { remove("shaftDiameterMm") }.toString() }.toByteArray()
        val manifest = JSONObject(data.getValue("manifest.json").toString(Charsets.UTF_8))
            .put("formatVersion", 7).put("journalSchema", 9)
        val counts = manifest.getJSONObject("rowCounts")
        counts.keys().asSequence().filter { it !in data }.toList().forEach { counts.remove(it) }
        data["manifest.json"] = manifest.toString().toByteArray()
        return repack(archive, data)
    }

    @Test fun currentFormatPreservesProofGrantsAndLatchThroughPrepareRestoreAndRestart() = runBlocking(Dispatchers.IO) {
        val source = runtime(File(root, "source"))
        val session = perfect(source, "barebow")
        source.repository.journal.achievements.service("APP04", "export-action")
        val firstKey = source.journal.achievementDao().grants().first().key
        source.repository.journal.achievements.claimNotifications(listOf(firstKey))
        val enrollments = source.journal.achievementDao().enrollments()
        val grants = source.journal.achievementDao().grants().associateBy { it.key }
        assertTrue(grants.values.any { it.notifiedAtMs == null })
        assertTrue(grants.values.any { it.notifiedAtMs != null })
        val exported = export(source)
        assertEquals(14, exported.manifest.envelope.formatVersion)
        assertEquals(16, exported.manifest.envelope.journalSchema)
        assertEquals(1L, exported.manifest.rowCounts.getValue("data/journal/achievement_enrollments.jsonl"))
        assertEquals(grants.size.toLong(), exported.manifest.rowCounts.getValue("data/journal/achievement_grants.jsonl"))
        val prepared = source.archive.prepare(exported.file)
        val copy = Room.databaseBuilder(context, JournalDatabase::class.java, prepared.journalFile.absolutePath).build()
        try {
            assertEquals(enrollments, copy.achievementDao().enrollments())
            assertEquals(grants, copy.achievementDao().grants().associateBy { it.key })
            assertEquals(source.repository.journal.details(session), copy.journalDao().details(session))
        } finally {
            copy.close()
            source.archive.discard(prepared.directory)
        }
        var manager = managed(runtime(File(root, "managed")))
        manager.restore(exported.file)
        val restoredId = manager.current.id
        fun checkLatch(values: List<AchievementGrant>) {
            assertEquals(grants.keys, values.map { it.key }.toSet())
            values.forEach { value ->
                assertNotNull(value.notifiedAtMs)
                assertEquals(grants.getValue(value.key), value.copy(notifiedAtMs = grants.getValue(value.key).notifiedAtMs))
            }
        }
        assertEquals(enrollments, manager.current.journal.achievementDao().enrollments())
        checkLatch(manager.current.journal.achievementDao().grants())
        assertTrue(manager.current.repository.journal.achievements.claimNotifications(grants.keys.toList()).isEmpty())
        manager.close()
        manager = DiaryManager(context, File(root, "managed")).also { managers.add(it) }
        assertEquals(restoredId, manager.current.id)
        checkLatch(manager.current.journal.achievementDao().grants())
        assertEquals(enrollments, manager.current.journal.achievementDao().enrollments())
        assertFalse(manager.current.repository.journal.achievements.board.first().failed)
        assertEquals(grants, source.journal.achievementDao().grants().associateBy { it.key })
    }

    @Test fun formatSevenDoesNotEnrollHistoryOnRestoreEditOrCompletion() = runBlocking(Dispatchers.IO) {
        val source = runtime(File(root, "source"))
        val oldId = perfect(source, "barebow", complete = false)
        val legacy = legacySeven(source.archive, export(source).file)
        val manager = managed(runtime(File(root, "managed")))
        manager.restore(legacy)
        val restored = manager.current
        val repo = restored.repository.journal
        assertTrue(restored.journal.achievementDao().enrollments().isEmpty())
        assertTrue(restored.journal.achievementDao().grants().isEmpty())
        assertEquals(30, repo.details(oldId)!!.allShots.sumOf { it.points })
        assertTrue(repo.details(oldId)!!.allShots.all { it.shaftDiameterMm == null })
        assertTrue(repo.achievements.board.first().statuses.all { it.value == 0L && it.earned == null })
        val shot = repo.details(oldId)!!.allShots.first()
        assertTrue(repo.revise(shot.copy(points = 9, zoneCode = "9", scoreSource = "manual_edit")) is JournalWrite.Saved)
        val changed = repo.details(oldId)!!.allShots.first { it.id == shot.id }
        assertTrue(repo.revise(changed.copy(points = 10, zoneCode = "10", scoreSource = "manual_edit")) is JournalWrite.Saved)
        assertTrue(repo.complete(oldId, repo.details(oldId)!!.session.revision) is JournalWrite.Saved)
        assertTrue(restored.journal.achievementDao().enrollments().isEmpty())
        assertTrue(restored.journal.achievementDao().grants().isEmpty())
        val fresh = perfect(restored, "compound")
        assertEquals(setOf(fresh), restored.journal.achievementDao().enrollments().map { it.sessionId }.toSet())
        assertNull(restored.journal.achievementDao().grant("HIT01:barebow"))
        assertEquals(3L, repo.achievements.board.first().statuses.first { it.definition.id == "START06" }.value)
        assertEquals(30, repo.details(oldId)!!.allShots.sumOf { it.points })
    }

    @Test fun changedSessionDatePreservesStartProofWithoutBecomingEligibleAgain() = runBlocking(Dispatchers.IO) {
        val source = runtime(File(root, "source"))
        val repo = source.repository.journal
        val session = (repo.start("Corrected date", plan("barebow")) as JournalWrite.Saved).sessionId
        val proof = source.journal.achievementDao().enrollment(session)!!
        source.journal.openHelper.writableDatabase.execSQL("UPDATE sessions SET localDate='2001-01-01' WHERE id=?", arrayOf(session))
        val manager = managed(runtime(File(root, "managed")))
        manager.restore(export(source).file)
        assertEquals(proof, manager.current.journal.achievementDao().enrollment(session))
        val restoredRepo = manager.current.repository.journal
        val end = restoredRepo.details(session)!!.currentEnd!!.end.id
        repeat(3) { assertTrue(restoredRepo.point(end, TargetPoint(.01, .01)) is JournalWrite.Saved) }
        assertTrue(restoredRepo.complete(session, restoredRepo.details(session)!!.session.revision) is JournalWrite.Saved)
        assertTrue(manager.current.journal.achievementDao().grants().isEmpty())
        assertTrue(restoredRepo.achievements.board.first().statuses.all { it.value == 0L && it.earned == null })
    }

    @Test fun restoredNameCommandIsDiscardedAcrossUndoAndRestartWhileExplicitNewNameStillAwards() = runBlocking(Dispatchers.IO) {
        val source = runtime(File(root, "source"))
        val data = entries(export(source).file)
        val preferencesPath = "data/preferences.json"
        val preferences = JSONObject(data.getValue(preferencesPath).toString(Charsets.UTF_8))
        preferences.getJSONObject("values")
            .put("displayName", JSONObject().put("type", "string").put("value", "Archived archer"))
            .put("achievement_name_event_v2", JSONObject().put("type", "string").put("value", "old-name-command|1234"))
        data[preferencesPath] = preferences.toString().toByteArray()
        val archive = repack(source.archive, data)
        var manager = managed(runtime(File(root, "managed")))
        val previousId = manager.current.id
        manager.restore(archive)
        assertEquals("Archived archer", (manager.current.preferences.state.first() as SettingsRead.Ready).value.displayName)
        assertFalse(manager.current.preferences.archiveSnapshot().containsKey("achievement_name_event_v2"))
        assertNull(manager.current.journal.achievementDao().grant("APP08:global"))
        manager.close()
        manager = DiaryManager(context, File(root, "managed")).also { managers.add(it) }
        manager.current.warmUp()
        assertEquals("Archived archer", (manager.current.preferences.state.first() as SettingsRead.Ready).value.displayName)
        assertFalse(manager.current.preferences.archiveSnapshot().containsKey("achievement_name_event_v2"))
        assertNull(manager.current.journal.achievementDao().grant("APP08:global"))

        // The previous generation is closed; simulate an unprocessed command in its saved preferences.
        val previousPreferences = File(File(File(root, "managed"), previousId), "preferences.preferences_pb")
        DiaryRuntime.writePreferences(context, previousPreferences, mapOf(
            "displayName" to ("string" to "Previous archer"),
            "achievement_name_event_v2" to ("string" to "previous-name-command|1235"),
        ))
        manager.undoReplacement()
        assertEquals(previousId, manager.current.id)
        assertEquals("Previous archer", (manager.current.preferences.state.first() as SettingsRead.Ready).value.displayName)
        assertFalse(manager.current.preferences.archiveSnapshot().containsKey("achievement_name_event_v2"))
        assertNull(manager.current.journal.achievementDao().grant("APP08:global"))
        manager.close()
        manager = DiaryManager(context, File(root, "managed")).also { managers.add(it) }
        manager.current.warmUp()
        assertNull(manager.current.journal.achievementDao().grant("APP08:global"))
        manager.current.preferences.displayName("Explicit new name")
        val awarded = withTimeout(5_000) {
            manager.current.journal.achievementDao().observeGrants().first { values -> values.any { it.ruleId == "APP08" } }
        }
        assertTrue(awarded.single { it.ruleId == "APP08" }.valid)
        assertEquals("Explicit new name", (manager.current.preferences.state.first() as SettingsRead.Ready).value.displayName)
    }

    @Test fun ordinaryRuntimeOpeningRecoversItsOwnPendingNameCommand() = runBlocking(Dispatchers.IO) {
        val directory = DiaryGenerations(File(root, "ordinary-restart")).newFolder()
        DiaryRuntime.writePreferences(context, File(directory, "preferences.preferences_pb"), mapOf(
            "displayName" to ("string" to "Locally saved name"),
            "achievement_name_event_v2" to ("string" to "local-name-command|1236"),
        ))
        val reopened = DiaryRuntime(context, directory.name, directory).also { runtimes.add(it) }
        reopened.warmUp()
        val grants = withTimeout(5_000) {
            reopened.journal.achievementDao().observeGrants().first { values -> values.any { it.ruleId == "APP08" } }
        }
        assertEquals("local-name-command", grants.single { it.ruleId == "APP08" }.batchId)
        assertEquals(1236L, grants.single { it.ruleId == "APP08" }.earnedAtMs)
    }

    @Test fun restoreAndUndoMergeReceiptsWithoutLosingThePreviousDiaryOrReplayingAwards() = runBlocking(Dispatchers.IO) {
        val initial = runtime(File(root, "managed"))
        val oldSession = perfect(initial, "barebow")
        initial.repository.journal.achievements.service("APP04", "previous-export")
        val oldGrants = initial.journal.achievementDao().grants()
        initial.repository.journal.achievements.claimNotifications(oldGrants.map { it.key })
        val oldProof = initial.journal.achievementDao().enrollments()
        val oldDetail = initial.repository.journal.details(oldSession)
        val source = runtime(File(root, "source"))
        val newSession = perfect(source, "compound")
        source.repository.journal.achievements.service("MIND08", "source-archive")
        val sourceGrants = source.journal.achievementDao().grants()
        val manager = managed(initial)
        val oldId = manager.current.id
        manager.restore(export(source).file)
        val replacementId = manager.current.id
        assertFalse(manager.current.journal.achievementDao().grant("HIT01:barebow")!!.valid)
        assertTrue(manager.current.journal.achievementDao().grant("APP04:global")!!.valid)
        assertTrue(manager.current.journal.achievementDao().grant("HIT01:compound")!!.valid)
        assertTrue(manager.current.journal.achievementDao().grants().all { it.notifiedAtMs != null })
        manager.undoReplacement()
        assertEquals(oldId, manager.current.id)
        assertEquals(oldDetail, manager.current.repository.journal.details(oldSession))
        assertNull(manager.current.repository.journal.details(newSession))
        assertEquals(oldProof, manager.current.journal.achievementDao().enrollments())
        assertTrue(manager.current.journal.achievementDao().grant("HIT01:barebow")!!.valid)
        assertFalse(manager.current.journal.achievementDao().grant("HIT01:compound")!!.valid)
        assertTrue(manager.current.journal.achievementDao().grant("MIND08:global")!!.valid)
        val mergedKeys = (oldGrants + sourceGrants).map { it.key }.toSet()
        assertEquals(mergedKeys, manager.current.journal.achievementDao().grants().map { it.key }.toSet())
        assertTrue(manager.current.repository.journal.achievements.claimNotifications(mergedKeys.toList()).isEmpty())
        manager.undoReplacement()
        assertEquals(replacementId, manager.current.id)
        assertTrue(manager.current.journal.achievementDao().grant("HIT01:compound")!!.valid)
        assertFalse(manager.current.journal.achievementDao().grant("HIT01:barebow")!!.valid)
        assertTrue(manager.current.repository.journal.achievements.claimNotifications(mergedKeys.toList()).isEmpty())
    }

    @Test fun checksummedInvalidProofAndReceiptCannotReplaceTheCurrentDiary() = runBlocking(Dispatchers.IO) {
        val initial = runtime(File(root, "managed"))
        val oldSession = perfect(initial, "barebow")
        val manager = managed(initial)
        val source = runtime(File(root, "source"))
        perfect(source, "compound")
        val exported = export(source)
        val originalId = manager.current.id
        val originalProof = manager.current.journal.achievementDao().enrollments()
        val originalGrants = manager.current.journal.achievementDao().grants()
        val proof = "data/journal/achievement_enrollments.jsonl"
        val grants = "data/journal/achievement_grants.jsonl"
        val mutations = listOf<Pair<String, (JSONObject) -> Unit>>(
            proof to { it.put("localDate", "2026-02-30") },
            proof to { it.put("enrolledAtMs", 0L) },
            proof to { it.put("sessionId", "missing") },
            proof to { it.put("ruleIdsJson", "[\"START01\",\"START01\"]") },
            grants to { it.put("rarity", 6) },
            grants to { it.put("notifiedAtMs", -1L) },
            grants to { it.put("key", "wrong:key") },
            grants to { it.put("sourceDate", "2026-02-30") },
        )
        for ((path, change) in mutations) {
            val data = entries(exported.file)
            val rows = data.getValue(path).toString(Charsets.UTF_8).lineSequence().filter { it.isNotBlank() }.toList()
            data[path] = rows.mapIndexed { index, row ->
                JSONObject(row).also { if (index == 0) change(it) }.toString()
            }.joinToString("\n", postfix = "\n").toByteArray()
            val broken = repack(manager.current.archive, data)
            try {
                manager.restore(broken)
                fail("Accepted invalid $path")
            } catch (error: Exception) {
                if (error is CancellationException) throw error
            }
            assertEquals(originalId, manager.current.id)
            assertEquals(originalProof, manager.current.journal.achievementDao().enrollments())
            assertEquals(originalGrants, manager.current.journal.achievementDao().grants())
            assertEquals(30, manager.current.repository.journal.details(oldSession)!!.allShots.sumOf { it.points })
        }
    }
}

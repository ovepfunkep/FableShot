package app.fableshot.android

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.JournalArchive
import app.fableshot.android.data.EquipmentDatabase
import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.UserPreferences
import app.fableshot.android.data.equipmentSnapshot
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.util.UUID

/** Each case owns an in-memory journal. Archive staging uses a fresh private-cache directory. */
class PhysicalArrowStorageTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var db: JournalDatabase
    private lateinit var store: JournalPracticeStore
    private val repo get() = store.journal

    @Before fun prepare() {
        db = Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java).build()
        store = JournalPracticeStore(db)
    }

    @After fun close() {
        db.close()
    }

    @Test fun numberedPointReplayKeepsOneShotAndRejectsReusedOperationWithAnotherNumber() = runBlocking(Dispatchers.IO) {
        val initial = start()
        val endId = initial.currentEnd!!.end.id
        val operation = UUID.randomUUID().toString()
        val first = saved(repo.point(endId, TargetPoint(.1, .1), operation, physicalArrowNumber = 4))
        val after = current()
        val replay = saved(repo.point(endId, TargetPoint(.1, .1), operation, physicalArrowNumber = 4))
        assertTrue(replay.replayed)
        assertEquals(first.id, replay.id)
        assertEquals(after, current())
        assertEquals(4, after.allShots.single().physicalArrowNumber)
        assertEquals(4, after.allShots.single().presentation().physicalArrowNumber)
        assertEquals(JournalWrite.Rejected(WriteIssue.OPERATION_REUSED),
            repo.point(endId, TargetPoint(.1, .1), operation, physicalArrowNumber = 5))
        assertEquals(after, current())
    }

    @Test fun failedReceiptRollsBackNumberShotAndParentRevisionsThenAllowsSameRetry() = runBlocking(Dispatchers.IO) {
        val before = start()
        val endId = before.currentEnd!!.end.id
        val operation = UUID.randomUUID().toString()
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER numbered_receipt_failure BEFORE INSERT ON mutation_receipts WHEN NEW.kind='append' BEGIN SELECT RAISE(ABORT,'numbered receipt failure'); END")
        try {
            val failure = runCatching { repo.numeric(endId, 9, operation, physicalArrowNumber = 7) }.exceptionOrNull()
            assertNotNull(failure)
            assertTrue(failure.toString().contains("numbered receipt failure"))
            assertEquals(before, current())
        } finally {
            db.openHelper.writableDatabase.execSQL("DROP TRIGGER numbered_receipt_failure")
        }
        saved(repo.numeric(endId, 9, operation, physicalArrowNumber = 7))
        assertEquals(listOf(7), current().allShots.map { it.physicalArrowNumber })
    }

    @Test fun duplicateNumberIsAtomicDuringConcurrentInputAndFlexibleSeriesGrowth() = runBlocking(Dispatchers.IO) {
        val initial = start(plan().copy(arrows = 1, flexibleSeries = true))
        val endId = initial.currentEnd!!.end.id
        val results = coroutineScope {
            (1..2).map { async { repo.numeric(endId, 9, physicalArrowNumber = 1) } }.awaitAll()
        }
        assertEquals(1, results.count { it is JournalWrite.Saved })
        assertEquals(1, results.count { it == JournalWrite.Rejected(WriteIssue.INVALID) })
        assertEquals(1, current().allShots.size)
        assertEquals(1, current().currentEnd!!.end.plannedCount)
        val before = current()
        assertEquals(JournalWrite.Rejected(WriteIssue.INVALID), repo.numeric(endId, 8, physicalArrowNumber = 1))
        assertEquals(before, current())
        saved(repo.numeric(endId, 8, physicalArrowNumber = 2))
        assertEquals(2, current().currentEnd!!.end.plannedCount)
        assertEquals(listOf(1, 2), current().allShots.map { it.physicalArrowNumber })
    }

    @Test fun numberingValidatesFrozenArrowIdentityStrictIntegerAndRangeWhileUnnumberedStillWorks() = runBlocking(Dispatchers.IO) {
        val invalidSnapshots = listOf(
            null,
            snapshot().let { raw -> JSONObject(raw).apply { remove("arrows") }.toString() },
            changedArrows { put("id", "") },
            changedArrows { put("kind", "bow") },
            changedArrows { put("numberedCount", JSONObject.NULL) },
            changedArrows { put("numberedCount", 0) },
            changedArrows { put("numberedCount", 1001) },
            changedArrows { put("numberedCount", "12") },
            changedArrows { put("numberedCount", 12.5) },
        )
        for (raw in invalidSnapshots) {
            val before = start(plan(raw))
            val endId = before.currentEnd!!.end.id
            assertEquals(JournalWrite.Rejected(WriteIssue.INVALID), repo.numeric(endId, 9, physicalArrowNumber = 1))
            assertEquals(before, current())
            saved(repo.numeric(endId, 9))
            assertNull(current().allShots.single().physicalArrowNumber)
            finish()
        }
        val initial = start(plan(snapshot(count = 1000)))
        val endId = initial.currentEnd!!.end.id
        for (number in listOf(-1, 0, 1001)) {
            assertEquals(JournalWrite.Rejected(WriteIssue.INVALID), repo.numeric(endId, 10, physicalArrowNumber = number))
            assertEquals(initial, current())
        }
        saved(repo.numericX(endId, physicalArrowNumber = 1000))
        assertEquals(1000, current().allShots.single().physicalArrowNumber)
        assertEquals("X", current().allShots.single().zoneCode)
    }

    @Test fun reviseRejectsDuplicatesAndStaleRevisionThenClearingReleasesTheNumber() = runBlocking(Dispatchers.IO) {
        val initial = start()
        val endId = initial.currentEnd!!.end.id
        saved(repo.numeric(endId, 9, physicalArrowNumber = 1))
        saved(repo.numeric(endId, 8, physicalArrowNumber = 2))
        val first = current().allShots.first()
        val before = current()
        assertEquals(JournalWrite.Rejected(WriteIssue.INVALID), repo.revise(first.copy(physicalArrowNumber = 2)))
        assertEquals(before, current())
        val operation = UUID.randomUUID().toString()
        saved(repo.revise(first.copy(physicalArrowNumber = 3), operationId = operation))
        assertTrue(saved(repo.revise(first.copy(physicalArrowNumber = 3), operationId = operation)).replayed)
        val latest = current().allShots.first()
        assertEquals(first.revision + 1, latest.revision)
        assertEquals(3, latest.physicalArrowNumber)
        assertEquals(JournalWrite.Conflict(latest.revision), repo.revise(first.copy(physicalArrowNumber = 4)))
        assertEquals(latest, current().allShots.first())
        saved(repo.revise(latest.copy(physicalArrowNumber = null)))
        assertNull(current().allShots.first().physicalArrowNumber)
        saved(repo.numeric(endId, 7, physicalArrowNumber = 3))
        assertEquals(listOf(null, 2, 3), current().allShots.map { it.physicalArrowNumber })
    }

    @Test fun nextSeriesAndDifferentFrozenArrowSetKeepIndependentNumbersInHistory() = runBlocking(Dispatchers.IO) {
        val initial = start()
        val sessionId = initial.session.id
        val firstEnd = initial.currentEnd!!.end.id
        for (number in 1..3) saved(repo.numeric(firstEnd, 9, physicalArrowNumber = number))
        val full = current().currentEnd!!.end
        saved(repo.next(full.id, full.revision))
        val nextEnd = current().currentEnd!!.end.id
        saved(repo.numeric(nextEnd, 8, physicalArrowNumber = 1))
        val beforeBlock = current()
        saved(repo.startBlock(sessionId, plan(snapshot(arrowsId = "other-arrows", count = 2)), beforeBlock.session.revision, allowPartial = true))
        val otherEnd = current().currentEnd!!.end.id
        val before = current()
        assertEquals(JournalWrite.Rejected(WriteIssue.INVALID), repo.numeric(otherEnd, 8, physicalArrowNumber = 3))
        assertEquals(before, current())
        saved(repo.numeric(otherEnd, 8, physicalArrowNumber = 1))
        finish()
        val history = repo.history.first().single()
        assertEquals(listOf(1, 2, 3, 1, 1), history.allShots.map { it.physicalArrowNumber })
        assertEquals(listOf(1, 2, 3, 1, 1), history.presentation().allShots.map { it.physicalArrowNumber })
        assertNotEquals(history.orderedBlocks.first().block.equipmentSnapshotJson, history.orderedBlocks.last().block.equipmentSnapshotJson)
    }

    @Test fun legacyUnconfiguredNumberSurvivesScoreOnlyEditAndCanBeCleared() = runBlocking(Dispatchers.IO) {
        val initial = start(plan(null))
        val endId = initial.currentEnd!!.end.id
        saved(repo.numeric(endId, 9))
        val plain = current().allShots.single()
        db.journalDao().update(plain.copy(physicalArrowNumber = 99))
        val legacy = current().allShots.single()
        saved(repo.revise(legacy.copy(points = 8, scoreSource = "manual_edit")))
        val edited = current().allShots.single()
        assertEquals(99, edited.physicalArrowNumber)
        assertEquals(8, edited.points)
        assertEquals(JournalWrite.Rejected(WriteIssue.INVALID), repo.revise(edited.copy(physicalArrowNumber = 98)))
        assertEquals(edited, current().allShots.single())
        saved(repo.revise(edited.copy(physicalArrowNumber = null)))
        assertNull(current().allShots.single().physicalArrowNumber)
    }

    @Test fun adapterCarriesNumbersAcrossAddReviseUndoAndDurableReplayWithoutResurrection() = runBlocking(Dispatchers.IO) {
        val initial = start()
        val endId = initial.currentEnd!!.end.id
        val addOperation = UUID.randomUUID().toString()
        val original = requireNotNull(store.addNumbered(endId, null, 9, 4, addOperation))
        assertEquals(4, original.physicalArrowNumber)
        assertEquals(original.id, requireNotNull(store.addNumbered(endId, null, 9, 4, addOperation)).id)
        val previous = requireNotNull(store.revise(original.copy(physicalArrowNumber = 5), UUID.randomUUID().toString()))
        assertEquals(original, previous)
        val changed = current().allShots.single()
        assertEquals(5, changed.physicalArrowNumber)
        assertEquals(original.revision + 1L, changed.revision)
        assertEquals(5, requireNotNull(store.active.first()).allShots.single().physicalArrowNumber)
        val removeOperation = UUID.randomUUID().toString()
        saved(repo.removeShot(changed.id, changed.revision, removeOperation))
        assertTrue(saved(repo.removeShot(changed.id, changed.revision, removeOperation)).replayed)
        assertTrue(current().allShots.isEmpty())
        assertNull(store.addNumbered(endId, null, 9, 4, addOperation))
        assertTrue(current().allShots.isEmpty())
        val replacement = requireNotNull(store.addNumbered(endId, null, 8, 5))
        store.undoInserted(replacement.id, endId, UUID.randomUUID().toString())
        assertTrue(current().allShots.isEmpty())
    }

    @Test fun fullArchiveRoundTripPreservesNumbersAndUnnumberedShots() = runBlocking(Dispatchers.IO) {
        val initial = start()
        val endId = initial.currentEnd!!.end.id
        saved(repo.numeric(endId, 9, physicalArrowNumber = 4))
        saved(repo.numeric(endId, 8))
        saved(repo.numericX(endId, physicalArrowNumber = 7))
        finish()
        val original = requireNotNull(repo.details(initial.session.id))
        val folder = File(context.cacheDir, "verification-numbered-archive-${UUID.randomUUID()}").apply { check(mkdirs()) }
        val equipment = Room.inMemoryDatabaseBuilder(context, EquipmentDatabase::class.java).build()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            val preferences = UserPreferences(PreferenceDataStoreFactory.create(scope = scope, produceFile = { File(folder, "test.preferences_pb") }))
            val archive = JournalArchive(context, db, equipment, preferences, File(folder, "files"), File(folder, "staging"))
            val exported = archive.export()
            val prepared = archive.prepare(exported.file)
            val restored = Room.databaseBuilder(context, JournalDatabase::class.java, prepared.journalFile.absolutePath).build()
            try {
                val roundTrip = requireNotNull(restored.journalDao().details(initial.session.id))
                assertEquals(original, roundTrip)
                assertEquals(listOf(4, null, 7), roundTrip.allShots.map { it.physicalArrowNumber })
                assertEquals(listOf(4, null, 7), roundTrip.presentation().allShots.map { it.physicalArrowNumber })
            } finally {
                restored.close()
            }
        } finally {
            equipment.close()
            scope.coroutineContext[Job]!!.cancelAndJoin()
            check(folder.canonicalFile.parentFile == context.cacheDir.canonicalFile && folder.name.startsWith("verification-numbered-archive-"))
            folder.deleteRecursively()
        }
    }

    private fun plan(raw: String? = snapshot()) = BlockPlan(18.0, 800, equipmentSnapshotJson = raw, targetProfileId = "wa-outdoor-full-v1")

    private fun snapshot(arrowsId: String = "numbered-arrows", count: Int = 12): String {
        val bow = EquipmentItem(id = "numbered-bow", kind = "bow", name = "Bow", category = "barebow")
        val arrows = EquipmentItem(id = arrowsId, kind = "arrows", name = "Arrows", numberedCount = count)
        val kit = EquipmentItem(id = "numbered-kit-$arrowsId", kind = "setup", name = "Kit", bowId = bow.id, arrowsId = arrows.id)
        return equipmentSnapshot(kit, listOf(bow, arrows, kit))
    }

    private fun changedArrows(change: JSONObject.() -> Unit): String = JSONObject(snapshot()).apply {
        getJSONObject("arrows").change()
    }.toString()

    private suspend fun start(plan: BlockPlan = plan()): JournalDetails {
        saved(repo.start("Numbered arrows", plan))
        return current()
    }

    private suspend fun finish() {
        val current = current()
        saved(repo.complete(current.session.id, current.session.revision))
    }

    private suspend fun current(): JournalDetails = requireNotNull(repo.active.first())

    private fun saved(result: JournalWrite): JournalWrite.Saved {
        assertTrue("Expected a saved operation, received $result", result is JournalWrite.Saved)
        return result as JournalWrite.Saved
    }
}

package app.fableshot.android

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Collects the public presentation flows against an isolated journal, including real numbered writes. */
@RunWith(AndroidJUnit4::class)
class JournalPresentationFlowTest {
    private lateinit var db: JournalDatabase
    private lateinit var store: JournalPracticeStore
    private lateinit var activeId: String
    private lateinit var editableId: String
    private lateinit var otherHistoryId: String
    private lateinit var trashedId: String

    @Before fun prepare() = runBlocking(Dispatchers.IO) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        db = Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java).build()
        store = JournalPracticeStore(db)
        editableId = completed("История с правкой", 9)
        otherHistoryId = completed("Другая история", 8)
        trashedId = completed("Корзина", 7)
        store.delete(trashedId, operation())
        store.startPlan("Активная", numberedPlan(), operation())
        activeId = requireNotNull(store.active.first()).session.id
    }

    @After fun cleanup() {
        if (::db.isInitialized) db.close()
    }

    private fun operation() = UUID.randomUUID().toString()

    private fun numberedPlan(): BlockPlan {
        val arrows = EquipmentItem("flow-arrows", "arrows", "Шесть стрел", numberedCount=6)
        val setup = EquipmentItem("flow-setup", "setup", "Комплект", arrowsId=arrows.id)
        return BlockPlan(18.0, 400, equipmentSnapshotJson=equipmentSnapshot(setup,listOf(setup,arrows)),
            flexibleSeries=true, seriesPerRound=10, numberedArrows=true)
    }

    private suspend fun completed(title: String, points: Int): String {
        store.startPlan(title, numberedPlan(), operation())
        val current = requireNotNull(store.active.first())
        store.addNumbered(requireNotNull(current.currentEnd).end.id, null, points, 1, operation())
        store.complete(current.session.id, operation())
        return current.session.id
    }

    private class Emissions(scope: CoroutineScope, store: JournalPracticeStore) {
        val active = Channel<SessionDetails?>(Channel.UNLIMITED)
        val history = Channel<List<SessionSummary>>(Channel.UNLIMITED)
        val trash = Channel<List<SessionSummary>>(Channel.UNLIMITED)
        private val jobs = listOf(
            scope.launch { store.active.collect { active.send(it) } },
            scope.launch { store.history.collect { history.send(it) } },
            scope.launch { store.trash.collect { trash.send(it) } },
        )

        suspend fun close() {
            jobs.forEach { it.cancel() }
            jobs.joinAll()
            active.close(); history.close(); trash.close()
        }
    }

    private suspend fun <T> Channel<T>.next(): T = withTimeout(10_000) { receive() }

    private suspend fun <T> Channel<T>.unchanged(label: String) {
        val extra = withTimeoutOrNull(500) { receiveCatching() }
        assertNull("Unchanged $label was emitted again: $extra", extra)
    }

    @Test fun activeHitAndNumberAssignmentReuseUnchangedHistoryCardsAndDoNotRepublishTrash() = runBlocking(Dispatchers.IO) {
        val observed = Emissions(this,store)
        try {
            val active = requireNotNull(observed.active.next())
            val history = observed.history.next()
            val trash = observed.trash.next()
            assertEquals(setOf(editableId,otherHistoryId,activeId),history.map { it.id }.toSet())
            assertEquals(listOf(trashedId),trash.map { it.id })
            val endId = requireNotNull(active.currentEnd).end.id
            val hit = requireNotNull(store.addNumbered(endId,TargetPoint(.03,.02),null,null,operation()))
            val withHit = requireNotNull(observed.active.next())
            assertEquals(hit.id,withHit.allShots.single().id)
            assertEquals(10,withHit.allShots.single().points)
            val historyWithHit = observed.history.next()
            for (id in listOf(editableId,otherHistoryId)) assertSame("Unchanged history card after active hit: $id",
                history.single { it.id == id },historyWithHit.single { it.id == id })
            assertEquals(1,historyWithHit.single { it.id == activeId }.shotCount)
            assertEquals(10,historyWithHit.single { it.id == activeId }.total)
            observed.trash.unchanged("trash after active hit")
            store.revise(hit.copy(physicalArrowNumber=4),operation())
            val numbered = requireNotNull(observed.active.next())
            assertEquals(4,numbered.allShots.single().physicalArrowNumber)
            assertEquals(hit.id,numbered.allShots.single().id)
            assertEquals(10,numbered.allShots.single().points)
            val historyWithNumber = observed.history.next()
            for (id in listOf(editableId,otherHistoryId)) assertSame("Unchanged history card after numbering: $id",
                history.single { it.id == id },historyWithNumber.single { it.id == id })
            assertEquals(1,historyWithNumber.single { it.id == activeId }.shotCount)
            assertEquals(10,historyWithNumber.single { it.id == activeId }.total)
            observed.trash.unchanged("trash after number assignment")
            observed.active.unchanged("active after its latest numbered value")
            observed.history.unchanged("history after its latest numbered value")
        } finally { observed.close() }
    }

    @Test fun completedEditTrashAndRestoreRemainObservableWithoutRepublishingTheActiveTraining() = runBlocking(Dispatchers.IO) {
        val observed = Emissions(this,store)
        try {
            val active = requireNotNull(observed.active.next())
            val history = observed.history.next()
            val trash = observed.trash.next()
            val original = requireNotNull(store.journal.details(editableId)).allShots.single()
            store.reviseJournal(original.copy(points=6,zoneCode="6",scoreSource="manual_edit"),operation())
            val edited = observed.history.next()
            assertEquals(6,edited.single { it.id == editableId }.total)
            assertNotSame(history.single { it.id == editableId },edited.single { it.id == editableId })
            assertSame(history.single { it.id == otherHistoryId },edited.single { it.id == otherHistoryId })
            assertSame(history.single { it.id == activeId },edited.single { it.id == activeId })
            assertEquals(1,edited.single { it.id == editableId }.shotCount)
            observed.active.unchanged("active after completed edit")
            observed.trash.unchanged("trash after completed edit")
            store.delete(editableId,operation())
            val afterTrash = observed.history.next()
            assertFalse(afterTrash.any { it.id == editableId })
            val moved = observed.trash.next()
            assertEquals(setOf(trashedId,editableId),moved.map { it.id }.toSet())
            assertEquals(6,moved.single { it.id == editableId }.total)
            store.restore(editableId,operation())
            val restored = observed.history.next()
            assertEquals(6,restored.single { it.id == editableId }.total)
            assertEquals("completed",restored.single { it.id == editableId }.state)
            assertEquals(trash,observed.trash.next())
            observed.active.unchanged("active after trash and restore")
            assertEquals(active,requireNotNull(store.active.first()))
        } finally { observed.close() }
    }
}

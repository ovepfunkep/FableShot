package app.fableshot.android

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.equipmentSnapshot
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.UUID

class PersonalRecordEventsTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private lateinit var db: JournalDatabase
    private lateinit var repo: JournalRepository
    private var clock = 1_793_700_000_000L

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(instrumentation.targetContext, JournalDatabase::class.java).build()
        repo = JournalRepository(db, now = { ++clock })
    }

    @After fun tearDown() = db.close()

    private suspend fun train(
        points: Int,
        plan: BlockPlan = BlockPlan(18.0, 400),
        ends: Int = 1,
        automatic: Boolean = false,
    ): String {
        val id = (repo.start("Тренировка", plan) as JournalWrite.Saved).sessionId
        repeat(ends) { index ->
            val end = repo.details(id)!!.currentEnd!!.end
            repeat(plan.arrows) { assertTrue(repo.numeric(end.id, points) is JournalWrite.Saved) }
            if (automatic || index < ends - 1) {
                val revision = repo.details(id)!!.currentEnd!!.end.revision
                assertTrue(repo.next(end.id, revision) is JournalWrite.Saved)
            }
        }
        if (!automatic) finish(id)
        return id
    }

    private suspend fun finish(id: String) {
        val revision = repo.details(id)!!.session.revision
        val operation = UUID.randomUUID().toString()
        assertFalse((repo.complete(id, revision, operation) as JournalWrite.Saved).replayed)
        assertTrue((repo.complete(id, revision, operation) as JournalWrite.Saved).replayed)
    }

    @Test fun onlyStrictComparableImprovementIsStoredAndClaimedOnce() = runBlocking(Dispatchers.IO) {
        val old = train(8)
        val dao = db.journalDao()
        dao.update(dao.session(old)!!.copy(sourceKind = "mytargets", completedAtMs = null, localDate = "2026-10-01"))
        train(8)
        train(10, BlockPlan(30.0, 400))
        assertTrue(repo.recordEvents.first().isEmpty())
        val improved = train(9, BlockPlan(18.0, 400, plannedEnds = 2), 2, automatic = true)
        val events = repo.recordEvents.first().associateBy { it.kind }
        assertEquals(setOf("series", "volume"), events.keys)
        val series = events.getValue("series")
        assertEquals(old, series.previousSessionId)
        assertEquals(improved, series.sessionId)
        assertEquals(24, series.previousValue)
        assertEquals(27, series.value)
        assertEquals(3, events.getValue("volume").previousValue)
        assertEquals(6, events.getValue("volume").value)
        val ids = events.values.map { it.id }
        val firstClaim = async { repo.claimRecordNotifications(ids) }
        val secondClaim = async { repo.claimRecordNotifications(ids) }
        val claims = firstClaim.await() + secondClaim.await()
        assertEquals(ids.size, claims.size)
        assertEquals(ids.toSet(), claims.map { it.id }.toSet())
        assertTrue(repo.claimRecordNotifications(ids).isEmpty())
        assertTrue(repo.recordEvents.first().all { it.notifiedAtMs != null })
    }

    @Test fun openingEditingAndFinishingAResumedWorkoutDoNotReplayHistoricalEvents() = runBlocking(Dispatchers.IO) {
        train(8)
        val improved = train(9)
        val event = repo.recordEvents.first().single()
        val shot = repo.details(improved)!!.allShots.first()
        assertTrue(repo.revise(shot.copy(points = 8, scoreSource = "manual_edit")) is JournalWrite.Saved)
        assertTrue(repo.claimRecordNotifications(listOf(event.id)).isEmpty())
        assertEquals(27, repo.recordEvents.first().single().value)
        assertTrue(repo.resume(improved, repo.details(improved)!!.session.revision) is JournalWrite.Saved)
        finish(improved)
        assertEquals(listOf(event.id), repo.recordEvents.first().map { it.id })
    }

    @Test fun completeRankUsesTheSameExerciseAndSelectedCategory() = runBlocking(Dispatchers.IO) {
        val bow = EquipmentItem(id = "record-bow", kind = "bow", name = "Баребоу", category = "barebow")
        val plan = BlockPlan(18.0, 400, arrows = 6, plannedEnds = 10,
            equipmentSnapshotJson = equipmentSnapshot(bow, listOf(bow)),
            targetProfileId = "wa-indoor-outer-v1", rankCategory = "female")
        val old = train(8, plan, 10, automatic = true)
        val improved = train(9, plan, 10, automatic = true)
        val rank = repo.recordEvents.first().single { it.kind == "rank" }
        assertEquals(old, rank.previousSessionId)
        assertEquals(improved, rank.sessionId)
        assertEquals(480, rank.previousValue)
        assertEquals(540, rank.value)
        assertTrue(rank.label.contains("КЛб(Ж)"))
    }

    @Test fun migratesRealVersionElevenSchemaWithoutBackfillingOrLosingRows() = runBlocking(Dispatchers.IO) {
        val context = instrumentation.targetContext
        val name = "verification-records-${UUID.randomUUID()}.db"
        val file = context.getDatabasePath(name)
        file.parentFile!!.mkdirs()
        val schema = instrumentation.context.assets.open("app.fableshot.android.data.journal.JournalDatabase/11.json")
            .bufferedReader().use { JSONObject(it.readText()).getJSONObject("database") }
        SQLiteDatabase.openOrCreateDatabase(file, null).use { old ->
            val entities = schema.getJSONArray("entities")
            for (index in 0 until entities.length()) {
                val entity = entities.getJSONObject(index)
                val table = entity.getString("tableName")
                old.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}", table))
                val indices = entity.optJSONArray("indices") ?: continue
                for (entry in 0 until indices.length()) {
                    old.execSQL(indices.getJSONObject(entry).getString("createSql").replace("\${TABLE_NAME}", table))
                }
            }
            val setup = schema.getJSONArray("setupQueries")
            for (index in 0 until setup.length()) old.execSQL(setup.getString(index))
            old.execSQL("""
                INSERT INTO sessions(id, title, createdAtMs, timeSource, state, kind, sourceKind, revision)
                VALUES ('before', 'Старая тренировка', 1, 'app_clock', 'completed', 'training', 'native', 4)
            """.trimIndent())
            old.version = 11
        }
        val migrated = Room.databaseBuilder(context, JournalDatabase::class.java, name)
            .addMigrations(MIGRATION_11_12,app.fableshot.android.data.journal.MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
        try {
            val dao = migrated.journalDao()
            assertEquals(16, migrated.openHelper.writableDatabase.version)
            assertEquals("Старая тренировка", dao.session("before")?.title)
            assertEquals(4L, dao.session("before")?.revision)
            assertTrue(dao.recordEvents().first().isEmpty())
            migrated.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use { assertFalse(it.moveToFirst()) }
        } finally {
            migrated.close()
            context.deleteDatabase(name)
        }
    }
}

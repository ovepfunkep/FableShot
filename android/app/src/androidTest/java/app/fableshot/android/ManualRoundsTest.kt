package app.fableshot.android

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.backup.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
import java.io.File

/** UUID or in-memory databases only; never opens either installed diary. */
class ManualRoundsTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun database()=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build()
    private fun plan(limit:Int?=10)=BlockPlan(18.0,400,3,flexibleSeries=true,seriesPerRound=limit)
    private suspend fun start(repo:JournalRepository,configuration:BlockPlan=plan()):String =
        (repo.start("Round fixture",configuration) as JournalWrite.Saved).sessionId

    @Test fun shortRoundHasNoInventedShotsAndItsNewBoundaryResetsAutomaticLimit()=runBlocking(Dispatchers.IO) {
        val db=database()
        try {
            val repo=JournalRepository(db)
            val id=start(repo,plan(2))
            val first=repo.details(id)!!.currentEnd!!.end.id
            repo.numeric(first,10)
            val before=repo.details(id)!!
            assertTrue(repo.startNextRound(id,before.session.revision) is JournalWrite.Saved)
            var details=repo.details(id)!!
            assertEquals(1,details.allShots.size)
            assertEquals(listOf(10),details.allShots.map { it.points })
            assertEquals(2,details.roundProgress().number)
            assertEquals(1,details.roundProgress().seriesNumber)
            assertEquals(2,details.trainingRounds().size)
            assertEquals("closed",details.trainingRounds().first().ends.single().end.state)
            assertEquals(3,details.trainingRounds().first().ends.single().end.plannedCount)
            assertTrue(details.currentEnd!!.end.startsRound)
            repeat(2) {
                val end=details.currentEnd!!.end.id
                repo.numeric(end,9)
                repo.next(end,repo.details(id)!!.currentEnd!!.end.revision)
                details=repo.details(id)!!
            }
            assertEquals(3,details.roundProgress().number)
            assertEquals(1,details.roundProgress().seriesNumber)
            assertEquals(listOf(1,2,1),details.trainingRounds().map { it.ends.size })
            assertEquals(3,details.allShots.size)
        } finally { db.close() }
    }

    @Test fun openEmptySeriesIsReusedAndRepeatedOrStaleRequestsCannotCreateEmptyRounds()=runBlocking(Dispatchers.IO) {
        val db=database()
        try {
            val repo=JournalRepository(db)
            val id=start(repo)
            val empty=repo.details(id)!!
            assertEquals(JournalWrite.Rejected(WriteIssue.INCOMPLETE),repo.startNextRound(id,empty.session.revision))
            repo.numeric(empty.currentEnd!!.end.id,8)
            repo.next(empty.currentEnd!!.end.id,repo.details(id)!!.currentEnd!!.end.revision)
            val before=repo.details(id)!!
            val result=repo.startNextRound(id,before.session.revision,"same-manual-round") as JournalWrite.Saved
            val after=repo.details(id)!!
            assertEquals(before.currentEnd!!.end.id,after.currentEnd!!.end.id)
            assertEquals(2,after.blocks.sumOf { it.ends.size })
            assertEquals(2,after.roundProgress().number)
            assertEquals(1,after.roundProgress().seriesNumber)
            val replay=repo.startNextRound(id,before.session.revision,"same-manual-round") as JournalWrite.Saved
            assertTrue(replay.replayed)
            assertEquals(result.id,replay.id)
            assertTrue(repo.startNextRound(id,before.session.revision) is JournalWrite.Conflict)
            assertEquals(JournalWrite.Rejected(WriteIssue.INCOMPLETE),repo.startNextRound(id,after.session.revision))
            assertEquals(after,repo.details(id))
        } finally { db.close() }
    }

    @Test fun failedBoundaryInsertRollsBackPlanClosureAndReceipt()=runBlocking(Dispatchers.IO) {
        val db=database()
        try {
            val repo=JournalRepository(db)
            val id=start(repo,BlockPlan(18.0,400,3,plannedEnds=20,roundCount=2))
            repo.numeric(repo.details(id)!!.currentEnd!!.end.id,10)
            val before=repo.details(id)!!
            db.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_boundary BEFORE INSERT ON ends WHEN NEW.startsRound=1 BEGIN SELECT RAISE(ABORT,'fixture'); END")
            assertTrue(runCatching {repo.startNextRound(id,before.session.revision,"retry-round")}.isFailure)
            assertEquals(before,repo.details(id))
            assertNull(db.journalDao().receipt("retry-round"))
            db.openHelper.writableDatabase.execSQL("DROP TRIGGER fail_boundary")
            assertTrue(repo.startNextRound(id,before.session.revision,"retry-round") is JournalWrite.Saved)
            assertTrue(repo.details(id)!!.rollingRounds)
            assertEquals(10,repo.details(id)!!.roundProgress().seriesLimit)
        } finally { db.close() }
    }

    @Test fun changingConditionsBeforeFirstArrowKeepsTheManualRoundBoundary()=runBlocking(Dispatchers.IO) {
        val db=database()
        try {
            val repo=JournalRepository(db)
            val id=start(repo)
            repo.numeric(repo.details(id)!!.currentEnd!!.end.id,9)
            repo.startNextRound(id,repo.details(id)!!.session.revision)
            val before=repo.details(id)!!
            assertTrue(repo.startBlock(id,plan().copy(distanceMeters=20.0),before.session.revision,true) is JournalWrite.Saved)
            val after=repo.details(id)!!
            assertEquals(2,after.roundProgress().number)
            assertTrue(after.currentEnd!!.end.startsRound)
            assertEquals(1,after.allShots.size)
            assertEquals(2,after.blocks.sumOf { it.ends.size })
        } finally { db.close() }
    }

    @Test fun rankPreviewReadsOnlySelectedRoundAndOriginalWholeTrainingIsUnchanged()=runBlocking(Dispatchers.IO) {
        val db=database()
        try {
            val repo=JournalRepository(db)
            val bow=EquipmentItem(kind="bow",name="Barebow fixture",category="barebow")
            val id=start(repo,plan().copy(equipmentSnapshotJson=equipmentSnapshot(bow,listOf(bow)), targetProfileId="wa-indoor-outer-v1"))
            val first=repo.details(id)!!.currentEnd!!.end.id
            repeat(3) { repo.point(first,TargetPoint(.01,.01)) }
            repo.startNextRound(id,repo.details(id)!!.session.revision)
            val second=repo.details(id)!!.currentEnd!!.end.id
            repo.numeric(second,6)
            val details=repo.details(id)!!
            assertEquals(36,details.allShots.sumOf { it.points })
            val preview=details.currentRoundDetails()
            assertEquals(listOf(second),preview.blocks.flatMap { it.ends }.map { it.end.id })
            assertEquals(6,preview.rankAssessment("male").evaluation!!.points)
            assertEquals(1,preview.rankAssessment("male").evaluation!!.entered)
            assertEquals(30,details.currentRoundDetails(first).rankAssessment("male").evaluation!!.points)
            assertEquals(4,details.allShots.size)
        } finally { db.close() }
    }

    @Test fun currentArchivePreservesManualBoundaryAndRejectsInvalidBoundaryValue()=runBlocking(Dispatchers.IO) {
        val db=database()
        val equipment=Room.inMemoryDatabaseBuilder(context,EquipmentDatabase::class.java).build()
        val folder=File(context.cacheDir,"verification-manual-round-archive-${UUID.randomUUID()}").apply { mkdirs() }
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        val preferences=UserPreferences(PreferenceDataStoreFactory.create(scope=scope,
            produceFile={File(folder,"test.preferences_pb")}))
        val archive=JournalArchive(context,db,equipment,preferences,folder)
        try {
            val repo=JournalRepository(db)
            val id=start(repo)
            repo.numeric(repo.details(id)!!.currentEnd!!.end.id,10)
            repo.startNextRound(id,repo.details(id)!!.session.revision)
            repo.numeric(repo.details(id)!!.currentEnd!!.end.id,7)
            val before=repo.details(id)!!
            val exported=archive.export()
            try {
                assertEquals(14,exported.manifest.envelope.formatVersion)
                assertEquals(16,exported.manifest.envelope.journalSchema)
                val prepared=archive.prepare(exported.file)
                val copy=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
                try {
                    val after=copy.journalDao().details(id)!!
                    assertEquals(before,after)
                    assertEquals(2,after.roundProgress().number)
                    assertEquals(listOf(1,1),after.trainingRounds().map { it.ends.size })
                } finally { copy.close();archive.discard(prepared.directory) }
            } finally { archive.discard(exported.file) }
            db.openHelper.writableDatabase.execSQL("UPDATE ends SET startsRound=2")
            val invalid=archive.export()
            try {
                try { archive.prepare(invalid.file);fail("Invalid boundary accepted") }
                catch(error:ArchiveInvalid) { assertEquals("invalid_round_boundary",error.reason) }
            } finally { archive.discard(invalid.file) }
        } finally {
            scope.coroutineContext[Job]!!.cancelAndJoin()
            equipment.close();db.close()
            check(folder.parentFile.canonicalFile==context.cacheDir.canonicalFile)
            folder.deleteRecursively()
        }
    }

    @Test fun schemaThirteenMigrationPreservesEveryOldFieldAndDefaultsAllBoundariesFalse()=runBlocking(Dispatchers.IO) {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val name="verification-round-boundary-${UUID.randomUUID()}.db"
        val file=context.getDatabasePath(name).also { it.parentFile!!.mkdirs() }
        val schema=instrumentation.context.assets.open("app.fableshot.android.data.journal.JournalDatabase/13.json")
            .bufferedReader().use { JSONObject(it.readText()).getJSONObject("database") }
        val entities=schema.getJSONArray("entities")
        val tables=(0 until entities.length()).map { entities.getJSONObject(it).getString("tableName") }
        val columns=linkedMapOf<String,List<String>>()
        val before=SQLiteDatabase.openOrCreateDatabase(file,null).use { old ->
            for(index in 0 until entities.length()) {
                val entity=entities.getJSONObject(index)
                val table=entity.getString("tableName")
                old.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}",table))
                val indices=entity.optJSONArray("indices")
                if(indices!=null)for(entry in 0 until indices.length())
                    old.execSQL(indices.getJSONObject(entry).getString("createSql").replace("\${TABLE_NAME}",table))
            }
            val setup=schema.getJSONArray("setupQueries")
            for(index in 0 until setup.length())old.execSQL(setup.getString(index))
            old.execSQL("INSERT INTO sessions(id,title,createdAtMs,startedAtMs,timeSource,state,kind,sourceKind,revision) VALUES ('old','Preserved fixture',1,1,'app_clock','active','training','native',7)")
            old.execSQL("INSERT INTO blocks VALUES ('b','old',0,'scored',18,'practice-full-10-v1',1,400,'{}',NULL,3,4)")
            old.execSQL("INSERT INTO ends VALUES ('e','b',0,3,'scored','open',1,NULL,9)")
            old.version=13
            tables.associateWith { table ->
                old.rawQuery("SELECT * FROM `$table`",null).use { cursor ->
                    columns[table]=cursor.columnNames.toList()
                    rows(cursor)
                }
            }
        }
        val migrated=Room.databaseBuilder(context,JournalDatabase::class.java,name).addMigrations(MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
        try {
            val sql=migrated.openHelper.writableDatabase
            assertEquals(16,sql.version)
            for(table in tables)assertEquals(table,before.getValue(table),
                rows(sql.query("SELECT ${columns.getValue(table).joinToString(",") { "`$it`" }} FROM `$table`")))
            assertFalse(migrated.journalDao().end("e")!!.startsRound)
            assertEquals(9L,migrated.journalDao().end("e")!!.revision)
            sql.query("PRAGMA foreign_key_check").use { assertFalse(it.moveToFirst()) }
        } finally { migrated.close();context.deleteDatabase(name) }
    }

    private fun rows(cursor:Cursor):List<String> = cursor.use {
        buildList { while(it.moveToNext())add((0 until it.columnCount).joinToString("|") { index ->
            if(it.isNull(index))"<null>" else it.getString(index)
        }) }.sorted()
    }
}

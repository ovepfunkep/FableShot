package app.fableshot.android

import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.UUID

/** Synthetic or explicitly named verified copy only. Never opens the live diary. */
class RoundMigrationTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun six(name:String)=FrameworkSQLiteOpenHelperFactory().create(
        SupportSQLiteOpenHelper.Configuration.builder(context).name(name).callback(object:SupportSQLiteOpenHelper.Callback(6) {
            override fun onCreate(db:SupportSQLiteDatabase) { error("A prepared fixture is required") }
            override fun onUpgrade(db:SupportSQLiteDatabase,oldVersion:Int,newVersion:Int) {
                require(oldVersion==1)
                MIGRATION_1_2.migrate(db)
                app.fableshot.android.importing.MIGRATION_2_3.migrate(db)
                MIGRATION_3_4.migrate(db);MIGRATION_4_5.migrate(db)
                app.fableshot.android.technique.MIGRATION_5_6.migrate(db)
            }
        }).build()
    )
    private fun snapshot(db:SupportSQLiteDatabase, columns:Map<String,List<String>>):Map<String,List<List<String?>>> = columns.mapValues { (table,fields) ->
        val projection=fields.joinToString { "`$it`" }
        db.query("SELECT $projection FROM `$table` ORDER BY $projection").use { cursor->
            buildList { while(cursor.moveToNext())add(fields.indices.map { if(cursor.isNull(it))null else cursor.getString(it) }) }
        }
    }
    private suspend fun migrate(name:String) {
        val old=six(name)
        val columns=app.fableshot.android.backup.ArchiveEnvelopeVerifier.journalTablesFor(6).associateWith { table ->
            old.writableDatabase.query("SELECT * FROM `$table` LIMIT 0").use { it.columnNames.toList() }
        }
        val before=snapshot(old.writableDatabase,columns)
        old.close()
        val db=Room.databaseBuilder(context,JournalDatabase::class.java,name).addMigrations(MIGRATION_6_7,app.fableshot.android.data.journal.MIGRATION_7_8,app.fableshot.android.data.journal.MIGRATION_8_9,app.fableshot.android.data.journal.MIGRATION_9_10,app.fableshot.android.data.journal.MIGRATION_10_11,app.fableshot.android.data.journal.MIGRATION_11_12,app.fableshot.android.data.journal.MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
        try {
            assertEquals(before,snapshot(db.openHelper.writableDatabase,columns))
            db.openHelper.writableDatabase.query("SELECT roundCount,rolling FROM session_plans").use {
                while(it.moveToNext()) { assertEquals(1,it.getInt(0));assertEquals(0,it.getInt(1)) }
            }
            db.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use { assertFalse(it.moveToFirst()) }
            val repo=JournalRepository(db)
            repo.active.first()?.let { assertTrue(repo.pause(it.session.id,it.session.revision) is JournalWrite.Saved) }
            assertTrue(repo.start("New rounds after migration",BlockPlan(18.0,600,plannedEnds=20,roundCount=2)) is JournalWrite.Saved)
            assertEquals(2,repo.active.first()!!.plans.single().roundCount)
        } finally { db.close() }
    }
    @Test fun v6FactsAndLegacyPlanSurviveWithOneRound()=runBlocking(Dispatchers.IO) {
        val name="fableshot-verification-round-${UUID.randomUUID()}.db"
        try {
            val legacy=Room.databaseBuilder(context,PracticeDatabase::class.java,name).build()
            val repo=PracticeRepository(legacy)
            repo.start("Legacy fixture",18.0,600,3)
            val active=repo.active.first()!!;val id=active.session.id
            repo.add(active.currentEnd!!.end.id,null,9);repo.complete(id);legacy.close()
            val helper=six(name)
            helper.writableDatabase.execSQL("INSERT INTO session_plans(sessionId,plannedEnds) VALUES(?,20)",arrayOf(id))
            helper.close()
            migrate(name)
        } finally { context.deleteDatabase(name) }
    }
    @Test fun verifiedV6CopyMigratesWithoutChangingAnyExistingFact()=runBlocking(Dispatchers.IO) {
        val name=InstrumentationRegistry.getArguments().getString("roundBackupFixture")
        assumeTrue(name!=null)
        require(name!!.matches(Regex("fableshot-verification-round-copy-[a-zA-Z0-9-]+\\.db")))
        require(context.getDatabasePath(name).isFile)
        try { migrate(name) } finally { context.deleteDatabase(name) }
    }
}

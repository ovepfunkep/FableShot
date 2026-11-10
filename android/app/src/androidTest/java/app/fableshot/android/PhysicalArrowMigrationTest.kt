package app.fableshot.android

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.JournalDatabase
import app.fableshot.android.data.journal.MIGRATION_12_13
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class PhysicalArrowMigrationTest {
    @Test fun migrationFromTwelvePreservesEveryOldRowAndAddsUnspecifiedSessionChoiceWithoutDefault() = runBlocking(Dispatchers.IO) {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val name="verification-numbering-migration-${UUID.randomUUID()}.db"
        val file=context.getDatabasePath(name)
        file.parentFile!!.mkdirs()
        val schema=instrumentation.context.assets.open("app.fableshot.android.data.journal.JournalDatabase/12.json")
            .bufferedReader().use {JSONObject(it.readText()).getJSONObject("database")}
        val entities=schema.getJSONArray("entities")
        val tables=(0 until entities.length()).map {entities.getJSONObject(it).getString("tableName")}
        val before=SQLiteDatabase.openOrCreateDatabase(file,null).use {old ->
            for(index in 0 until entities.length()) {
                val entity=entities.getJSONObject(index)
                val table=entity.getString("tableName")
                old.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}",table))
                val indices=entity.optJSONArray("indices") ?: continue
                for(entry in 0 until indices.length())
                    old.execSQL(indices.getJSONObject(entry).getString("createSql").replace("\${TABLE_NAME}",table))
            }
            val setup=schema.getJSONArray("setupQueries")
            for(index in 0 until setup.length())old.execSQL(setup.getString(index))
            old.execSQL("INSERT INTO sessions(id,title,createdAtMs,timeSource,state,kind,sourceKind,revision) VALUES ('legacy','Before numbering',1,'app_clock','completed','training','native',4)")
            old.execSQL("INSERT INTO session_plans(sessionId,plannedEnds,roundCount,rolling) VALUES ('legacy',20,2,0)")
            old.version=12
            tables.associateWith {table ->rows(old.rawQuery("SELECT * FROM `$table`",null))}
        }
        val migrated=Room.databaseBuilder(context,JournalDatabase::class.java,name).addMigrations(MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
        try {
            val sqlite=migrated.openHelper.writableDatabase
            assertEquals(16,sqlite.version)
            for(table in tables)assertEquals(table,before.getValue(table),rows(sqlite.query("SELECT * FROM `$table`")))
            assertEquals(4L,migrated.journalDao().session("legacy")!!.revision)
            assertNull(migrated.journalDao().session("legacy")!!.numberedArrows)
            sqlite.query("PRAGMA table_info(sessions)").use {cursor ->
                var found=false
                while(cursor.moveToNext())if(cursor.getString(1)=="numberedArrows") {
                    found=true
                    assertEquals("INTEGER",cursor.getString(2))
                    assertEquals(0,cursor.getInt(3))
                    assertTrue(cursor.isNull(4))
                }
                assertTrue(found)
            }
            sqlite.query("PRAGMA foreign_key_check").use {assertFalse(it.moveToFirst())}
        } finally {
            migrated.close()
            context.deleteDatabase(name)
        }
    }

    private fun rows(cursor: Cursor): List<String> = cursor.use {
        val columns=(0 until it.columnCount).filterNot {index ->it.getColumnName(index) in setOf("numberedArrows","startsRound","shaftDiameterMm")}
        buildList {
            while(it.moveToNext())add(columns.joinToString("|") {index ->if(it.isNull(index))"<null>" else it.getString(index)})
        }.sorted()
    }
}

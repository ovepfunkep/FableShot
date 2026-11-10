package app.fableshot.android

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class ArrowRoundMigrationTest {
    @Test fun fifteenToSixteenPreservesEveryOldColumnAndDoesNotInferArrowLimits()=runBlocking(Dispatchers.IO) {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val name="verification-arrow-round-migration-${UUID.randomUUID()}.db"
        val file=context.getDatabasePath(name).also {it.parentFile!!.mkdirs()}
        val schema=instrumentation.context.assets.open("app.fableshot.android.data.journal.JournalDatabase/15.json")
            .bufferedReader().use {JSONObject(it.readText()).getJSONObject("database")}
        val entities=schema.getJSONArray("entities")
        val tables=(0 until entities.length()).map {entities.getJSONObject(it).getString("tableName")}
        val columns=linkedMapOf<String,List<String>>()
        val before=SQLiteDatabase.openOrCreateDatabase(file,null).use {old ->
            for(index in 0 until entities.length()) {
                val entity=entities.getJSONObject(index)
                val table=entity.getString("tableName")
                old.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}",table))
                val indices=entity.optJSONArray("indices") ?: continue
                for(entry in 0 until indices.length())old.execSQL(indices.getJSONObject(entry).getString("createSql").replace("\${TABLE_NAME}",table))
            }
            val setup=schema.getJSONArray("setupQueries")
            for(index in 0 until setup.length())old.execSQL(setup.getString(index))
            old.execSQL("INSERT INTO sessions(id,title,createdAtMs,startedAtMs,timeSource,state,kind,sourceKind,revision) VALUES ('legacy','Before arrow limit',1,1,'app_clock','completed','training','native',7)")
            old.execSQL("INSERT INTO blocks VALUES ('b','legacy',0,'scored',18,'practice-full-10-v1',1,400,?,NULL,3,4)",
                arrayOf(TargetCatalog.practice.snapshot(400)))
            old.execSQL("INSERT INTO session_plans VALUES ('legacy',20,2,0)")
            old.execSQL("INSERT INTO ends VALUES ('e','b',0,3,'scored','closed',1,2,9,1)")
            old.execSQL("INSERT INTO shots VALUES ('s','e',0,9,'9',9,?,0.11,0,'main','target_computed','manual_target','known',NULL,1,2,5,NULL)",
                arrayOf(TargetCatalog.practice.rule))
            old.version=15
            tables.associateWith {table ->old.rawQuery("SELECT * FROM `$table`",null).use {cursor ->
                columns[table]=cursor.columnNames.toList();rows(cursor)
            }}
        }
        val migrated=Room.databaseBuilder(context,JournalDatabase::class.java,name).addMigrations(MIGRATION_15_16).build()
        try {
            val sqlite=migrated.openHelper.writableDatabase
            assertEquals(16,sqlite.version)
            for(table in tables)assertEquals(table,before.getValue(table),
                rows(sqlite.query("SELECT ${columns.getValue(table).joinToString(",") {"`$it`"}} FROM `$table`")))
            val plan=migrated.journalDao().plan("legacy")!!
            assertNull(plan.roundArrowLimit);assertEquals(20,plan.plannedEnds);assertEquals(2,plan.roundCount)
            assertFalse(plan.rolling);assertEquals(10,plan.seriesLimit)
            sqlite.query("PRAGMA table_info(session_plans)").use {cursor ->
                var found=false
                while(cursor.moveToNext())if(cursor.getString(1)=="roundArrowLimit") {
                    found=true;assertEquals("INTEGER",cursor.getString(2));assertEquals(0,cursor.getInt(3))
                    assertEquals("NULL",cursor.getString(4))
                }
                assertTrue(found)
            }
            sqlite.query("PRAGMA foreign_key_check").use {assertFalse(it.moveToFirst())}
        } finally {migrated.close();context.deleteDatabase(name)}
    }

    private fun rows(cursor:Cursor):List<String> = cursor.use {
        buildList {while(it.moveToNext())add((0 until it.columnCount).joinToString("|") {index ->
            if(it.isNull(index))"<null>" else it.getString(index)
        })}.sorted()
    }
}

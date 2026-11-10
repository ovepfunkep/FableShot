package app.fableshot.android

import androidx.room.*
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import app.fableshot.android.importing.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.util.UUID

class ImportMigrationTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun old(name:String):SQLiteDatabase {
        val file=context.getDatabasePath(name).also {it.parentFile!!.mkdirs()}
        val db=SQLiteDatabase.openOrCreateDatabase(file,null)
        if(db.version==0) {
            // Historic fixtures must use their historic schema, never today's evolving Room entities.
            val schema=InstrumentationRegistry.getInstrumentation().context.assets
                .open("app.fableshot.android.data.journal.JournalDatabase/2.json").bufferedReader()
                .use {JSONObject(it.readText()).getJSONObject("database")}
            val entities=schema.getJSONArray("entities")
            for(index in 0 until entities.length()) {
                val entity=entities.getJSONObject(index);val table=entity.getString("tableName")
                db.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}",table))
                val indices=entity.optJSONArray("indices") ?: continue
                for(entry in 0 until indices.length())db.execSQL(indices.getJSONObject(entry).getString("createSql").replace("\${TABLE_NAME}",table))
            }
            val setup=schema.getJSONArray("setupQueries")
            for(index in 0 until setup.length())db.execSQL(setup.getString(index))
            db.version=2
        }
        require(db.version==2)
        return db
    }
    private fun rows(cursor:Cursor):List<List<String?>> = cursor.use {
        buildList {while(it.moveToNext())add((0 until it.columnCount).map {column ->if(it.isNull(column))null else it.getString(column)})}
    }
    private fun next(name:String,migration:Migration=MIGRATION_2_3)=Room.databaseBuilder(context,JournalDatabase::class.java,name).addMigrations(migration,MIGRATION_3_4,app.fableshot.android.data.journal.MIGRATION_4_5,app.fableshot.android.technique.MIGRATION_5_6,app.fableshot.android.data.journal.MIGRATION_6_7,app.fableshot.android.data.journal.MIGRATION_7_8,app.fableshot.android.data.journal.MIGRATION_8_9,app.fableshot.android.data.journal.MIGRATION_9_10,app.fableshot.android.data.journal.MIGRATION_10_11,app.fableshot.android.data.journal.MIGRATION_11_12,app.fableshot.android.data.journal.MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
    @Test fun additiveMigrationPreservesFactsCountsAndReceiptsExactly()=runBlocking(Dispatchers.IO) {
        val name="fableshot-verification-import-migration-${UUID.randomUUID()}.db"
        val source=old(name)
        try {
            source.execSQL("INSERT INTO sessions VALUES ('fixture-session','Migration fixture',1234,1234,NULL,NULL,NULL,'app_clock','active','training','native',1,NULL)")
            source.execSQL("INSERT INTO blocks VALUES ('fixture-block','fixture-session',0,'scored',18,'practice-full-10-v1',1,600,?,NULL,3,1)",arrayOf(practiceSnapshot(600)))
            source.execSQL("INSERT INTO ends VALUES ('fixture-end','fixture-block',0,3,'scored','open',NULL,NULL,1)")
            source.execSQL("INSERT INTO shots VALUES ('fixture-shot','fixture-end',0,10,'10',10,'practice-point-10-v1',0,0,'main','target_computed','manual_target','known',NULL,1234,NULL,1)")
            source.execSQL("INSERT INTO mutation_receipts VALUES ('fixture-operation','fixture-session','append','fixture-hash','fixture-shot',1,1234)")
            val tables=listOf("sessions","blocks","ends","shots","unscored_counts","mutation_receipts")
            val columns=tables.associateWith {table ->source.rawQuery("SELECT * FROM `$table` LIMIT 0",null).use {it.columnNames.toList()}}
            fun snapshot(query:(String)->Cursor)=columns.mapValues {(table,names) ->
                rows(query("SELECT ${names.joinToString(",") {"`$it`"}} FROM `$table` ORDER BY 1"))
            }
            val before=snapshot {source.rawQuery(it,null)};source.close()
            val db=next(name)
            try {
                assertEquals(before,snapshot {db.openHelper.writableDatabase.query(it)})
                assertEquals("fixture-shot",db.journalDao().receipt("fixture-operation")!!.resultId)
                assertTrue(db.importDao().groups().isEmpty())
                db.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use{assertFalse(it.moveToFirst())}
                assertEquals(16,db.openHelper.writableDatabase.version)
                assertTrue(db.achievementDao().enrollments().isEmpty())
                assertTrue(db.achievementDao().grants().isEmpty())
            }finally{db.close()}
            val reopen=next(name);try{assertEquals(before,snapshot {reopen.openHelper.writableDatabase.query(it)})}finally{reopen.close()}
        }finally{source.close();context.deleteDatabase(name)}
    }
    @Test fun failureAfterNewTablesRollsBackToReadableVersionTwo()=runBlocking(Dispatchers.IO) {
        val name="fableshot-verification-import-rollback-${UUID.randomUUID()}.db"
        val source=old(name)
        try {
            source.execSQL("INSERT INTO sessions VALUES ('fixture-session','Rollback fixture',1234,1234,NULL,NULL,NULL,'app_clock','active','training','native',1,NULL)");source.close()
            val fault=object:Migration(2,3){override fun migrate(db:SupportSQLiteDatabase){MIGRATION_2_3.migrate(db);throw IllegalStateException("injected provenance failure")}}
            val fail=next(name,fault)
            try{try{fail.openHelper.writableDatabase;fail("Migration fault swallowed")}catch(e:Exception){assertTrue(e.toString().contains("injected provenance failure"))}}finally{fail.close()}
            val restored=old(name)
            try{assertEquals(2,restored.version);restored.rawQuery("SELECT title FROM sessions WHERE id='fixture-session'",null).use {it.moveToFirst();assertEquals("Rollback fixture",it.getString(0))}}finally{restored.close()}
        }finally{source.close();context.deleteDatabase(name)}
    }
}

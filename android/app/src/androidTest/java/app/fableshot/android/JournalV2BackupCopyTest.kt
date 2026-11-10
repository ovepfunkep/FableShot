package app.fableshot.android

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.JournalDatabase
import app.fableshot.android.data.journal.MIGRATION_3_4
import app.fableshot.android.importing.MIGRATION_2_3
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.security.MessageDigest

class JournalV2BackupCopyTest {
    @Test fun verifiedVersionTwoCopyKeepsEveryCoreValueAfterAdditiveMigration()=runBlocking(Dispatchers.IO) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name=InstrumentationRegistry.getArguments().getString("backupFixtureName")
        assumeTrue(name!=null)
        require(name!!.matches(Regex("fableshot-verification-backup-v2-[a-zA-Z0-9-]+\\.db")))
        val file=context.getDatabasePath(name);require(file.isFile)
        val tables=listOf("sessions","blocks","ends","shots","unscored_counts","mutation_receipts")
        val columns=linkedMapOf<String,List<String>>()
        fun hashes(database:SQLiteDatabase):Map<String,String> =tables.associateWith{table->
            val fields=columns[table]?.joinToString(",") {"`$it`"} ?: "*"
            if(table !in columns)database.rawQuery("SELECT * FROM `$table` LIMIT 0",null).use {columns[table]=it.columnNames.toList()}
            val hash=MessageDigest.getInstance("SHA-256")
            database.rawQuery("SELECT $fields FROM $table ORDER BY 1",null).use{cursor->while(cursor.moveToNext())for(index in 0 until cursor.columnCount){val text=if(cursor.isNull(index))"n;"else cursor.getString(index).let{"s${it.toByteArray(Charsets.UTF_8).size}:$it"};hash.update(text.toByteArray(Charsets.UTF_8))}}
            hash.digest().joinToString(""){"%02x".format(it)}
        }
        val before=SQLiteDatabase.openDatabase(file.path,null,SQLiteDatabase.OPEN_READONLY).use{assertEquals(2,it.version);hashes(it)}
        val migrated=Room.databaseBuilder(context,JournalDatabase::class.java,name).addMigrations(MIGRATION_2_3,MIGRATION_3_4,app.fableshot.android.data.journal.MIGRATION_4_5,app.fableshot.android.technique.MIGRATION_5_6,app.fableshot.android.data.journal.MIGRATION_6_7,app.fableshot.android.data.journal.MIGRATION_7_8,app.fableshot.android.data.journal.MIGRATION_8_9,app.fableshot.android.data.journal.MIGRATION_9_10,app.fableshot.android.data.journal.MIGRATION_10_11,app.fableshot.android.data.journal.MIGRATION_11_12,app.fableshot.android.data.journal.MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
        try {
            migrated.openHelper.writableDatabase
            val after=SQLiteDatabase.openDatabase(file.path,null,SQLiteDatabase.OPEN_READONLY).use{assertEquals(16,it.version);hashes(it)}
            assertTrue("Core table hashes differ",before==after)
            assertTrue(migrated.importDao().groups().isEmpty())
            migrated.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use{assertFalse(it.moveToFirst())}
        }finally{migrated.close();context.deleteDatabase(name)}
    }
}

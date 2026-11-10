package app.fableshot.android

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.ArchiveEnvelopeVerifier
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Only accepts a separately transferred verified v7 copy, never a live diary path. */
class RankAssignmentMigrationTest {
    @Test fun verifiedVersionSevenCopyPreservesEveryExistingFact()=runBlocking(Dispatchers.IO) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name=InstrumentationRegistry.getArguments().getString("backupFixtureName")
        assumeTrue(name!=null)
        require(name!!.matches(Regex("fableshot-verification-backup-v7-[a-zA-Z0-9-]+\\.db")))
        val file=context.getDatabasePath(name);require(file.isFile)
        val columns=linkedMapOf<String,List<String>>()
        fun snapshot(query:(String)->Cursor)=ArchiveEnvelopeVerifier.journalTablesFor(7).associateWith { table ->
            val fields=columns[table]?.joinToString(",") {"`$it`"} ?: "*"
            query("SELECT $fields FROM `$table` ORDER BY 1").use { c ->
                columns.putIfAbsent(table,c.columnNames.toList())
                buildList {while(c.moveToNext())add((0 until c.columnCount).map { if(c.isNull(it))null else "${c.getType(it)}:${c.getString(it)}" })}
            }
        }
        val before=SQLiteDatabase.openDatabase(file.path,null,SQLiteDatabase.OPEN_READONLY).use { db ->
            assertEquals(7,db.version);snapshot {db.rawQuery(it,null)}
        }
        val migrated=Room.databaseBuilder(context,JournalDatabase::class.java,name).addMigrations(MIGRATION_7_8,app.fableshot.android.data.journal.MIGRATION_8_9,app.fableshot.android.data.journal.MIGRATION_9_10,app.fableshot.android.data.journal.MIGRATION_10_11,app.fableshot.android.data.journal.MIGRATION_11_12,app.fableshot.android.data.journal.MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
        try {
            assertEquals(16,migrated.openHelper.writableDatabase.version)
            assertEquals(before,snapshot {migrated.openHelper.writableDatabase.query(it)})
            assertTrue(migrated.rankAssignmentDao().observe().first().isEmpty())
            assertTrue(migrated.achievementDao().enrollments().isEmpty())
            assertTrue(migrated.achievementDao().grants().isEmpty())
            migrated.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use {assertFalse(it.moveToFirst())}
        } finally {migrated.close();context.deleteDatabase(name)}
    }
}

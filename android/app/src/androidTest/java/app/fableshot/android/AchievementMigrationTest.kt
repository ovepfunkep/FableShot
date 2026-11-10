package app.fableshot.android

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.ArchiveEnvelopeVerifier
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class AchievementMigrationTest {
    @Test fun verifiedVersionNineCopyKeepsEveryOldFieldAndIssuesNoRetrospectiveAwards() = runBlocking(Dispatchers.IO) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val source = File(context.getExternalFilesDir("verification"), "achievement-migration-v9.db")
        require(source.isFile) { "Push the verified isolated v9 fixture before running this test" }
        val name = "fableshot-verification-achievement-${UUID.randomUUID()}.db"
        val copy = context.getDatabasePath(name)
        copy.parentFile!!.mkdirs(); source.copyTo(copy)
        val columns=linkedMapOf<String,List<String>>()
        fun snapshot(query: (String) -> Cursor) = ArchiveEnvelopeVerifier.journalTablesFor(9).associateWith { table ->
            val fields=columns[table]?.joinToString(",") {"`$it`"} ?: "*"
            query("SELECT $fields FROM `$table` ORDER BY 1").use { cursor ->
                columns.putIfAbsent(table,cursor.columnNames.toList())
                buildList {
                while (cursor.moveToNext()) add((0 until cursor.columnCount).map { index ->
                    if (cursor.isNull(index)) null else "${cursor.getType(index)}:${cursor.getString(index)}"
                })
            } }
        }
        val before = SQLiteDatabase.openDatabase(copy.path, null, SQLiteDatabase.OPEN_READONLY).use { old ->
            assertEquals(9, old.version); snapshot { old.rawQuery(it, null) }
        }
        val migrated = Room.databaseBuilder(context, JournalDatabase::class.java, name).addMigrations(MIGRATION_9_10,app.fableshot.android.data.journal.MIGRATION_10_11,app.fableshot.android.data.journal.MIGRATION_11_12,app.fableshot.android.data.journal.MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
        try {
            assertEquals(16, migrated.openHelper.writableDatabase.version)
            assertEquals(before, snapshot { migrated.openHelper.writableDatabase.query(it) })
            assertTrue(migrated.achievementDao().enrollments().isEmpty())
            assertTrue(migrated.achievementDao().grants().isEmpty())
            migrated.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use { assertFalse(it.moveToFirst()) }
            migrated.openHelper.writableDatabase.query("PRAGMA integrity_check").use { assertTrue(it.moveToFirst()); assertEquals("ok", it.getString(0)) }
        } finally { migrated.close(); context.deleteDatabase(name) }
    }
}

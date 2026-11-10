package app.fableshot.android

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Optional local-only fixture. Neither this test nor its arguments name the primary diary. */
@RunWith(AndroidJUnit4::class)
class JournalBackupCopyTest {
    @Test fun verifiedCopyMigratesAndAcceptsNewWritesWithoutChangingLegacyRows()=runBlocking(Dispatchers.IO) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name=InstrumentationRegistry.getArguments().getString("backupFixtureName")
        assumeTrue(name!=null)
        require(name!!.matches(Regex("fableshot-verification-backup-[a-zA-Z0-9-]+\\.db")))
        require(context.getDatabasePath(name).isFile)
        val legacy=Room.databaseBuilder(context,PracticeDatabase::class.java,name).build()
        val before=try { legacy.practiceDao().observeHistory().first().map { requireNotNull(legacy.practiceDao().details(it.id)) } } finally { legacy.close() }
        val migrated=Room.databaseBuilder(context,JournalDatabase::class.java,name).addMigrations(MIGRATION_1_2,app.fableshot.android.importing.MIGRATION_2_3,MIGRATION_3_4,app.fableshot.android.data.journal.MIGRATION_4_5,app.fableshot.android.technique.MIGRATION_5_6,app.fableshot.android.data.journal.MIGRATION_6_7,app.fableshot.android.data.journal.MIGRATION_7_8,app.fableshot.android.data.journal.MIGRATION_8_9,app.fableshot.android.data.journal.MIGRATION_9_10,app.fableshot.android.data.journal.MIGRATION_10_11,app.fableshot.android.data.journal.MIGRATION_11_12,app.fableshot.android.data.journal.MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
        try {
            val repo=JournalRepository(migrated)
            for (old in before) {
                val saved=requireNotNull(repo.details(old.session.id))
                assertEquals(old.session.title,saved.session.title)
                assertEquals(old.session.startedAt,saved.session.startedAtMs)
                assertEquals(old.session.completedAt,saved.session.completedAtMs)
                assertEquals(old.session.state,saved.session.state)
                assertEquals(old.allShots.map { listOf(it.id,it.endId,it.inputIndex,it.points,it.x,it.y,it.createdAt,it.revision.toLong()) },
                    saved.allShots.map { listOf(it.id,it.endId,it.inputIndex,it.points,it.x,it.y,it.createdAtMs,it.revision) })
                assertEquals(old.orderedEnds.map { it.end.id },saved.currentBlock!!.orderedEnds.map { it.end.id })
            }
            val active=repo.active.first()
            if(active!=null) assertTrue(repo.pause(active.session.id,active.session.revision) is JournalWrite.Saved)
            assertTrue(repo.start("Post-migration fixture",BlockPlan(18.0,600)) is JournalWrite.Saved)
            val created=repo.active.first()!!
            assertTrue(repo.point(created.currentEnd!!.end.id,app.fableshot.android.domain.TargetPoint(.01,.02)) is JournalWrite.Saved)
            assertEquals(10,repo.active.first()!!.allShots.single().points)
            migrated.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use { assertFalse(it.moveToFirst()) }
        } finally { migrated.close();context.deleteDatabase(name) }
    }
}


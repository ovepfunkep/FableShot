package app.fableshot.android

import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class JournalMigrationTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun filename()="fableshot-verification-migration-${UUID.randomUUID()}.db"
    private fun old(name:String)=Room.databaseBuilder(context,PracticeDatabase::class.java,name).build()
    private fun next(name:String,migration:Migration=MIGRATION_1_2)=Room.databaseBuilder(context,JournalDatabase::class.java,name).addMigrations(migration,app.fableshot.android.importing.MIGRATION_2_3,MIGRATION_3_4,app.fableshot.android.data.journal.MIGRATION_4_5,app.fableshot.android.technique.MIGRATION_5_6,app.fableshot.android.data.journal.MIGRATION_6_7,app.fableshot.android.data.journal.MIGRATION_7_8,app.fableshot.android.data.journal.MIGRATION_8_9,app.fableshot.android.data.journal.MIGRATION_9_10,app.fableshot.android.data.journal.MIGRATION_10_11,app.fableshot.android.data.journal.MIGRATION_11_12,app.fableshot.android.data.journal.MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()

    @Test fun migrationPreservesIdentitiesScoresUnknownsAndClosedState()=runBlocking(Dispatchers.IO) {
        val name=filename();val legacy=old(name)
        try {
            val repo=PracticeRepository(legacy)
            repo.start("Fixture complete",18.0,600,3)
            var before=requireNotNull(repo.active.first());val completeId=before.session.id
            val firstEnd=before.currentEnd!!.end.id
            repo.add(firstEnd,TargetPoint(0.0,0.0),null)
            val manual=requireNotNull(repo.add(firstEnd,null,9));repo.revise(manual.copy(points=7,origin="manual"))
            repo.add(firstEnd,null,0);repo.next(firstEnd)
            val secondEnd=requireNotNull(repo.active.first()).currentEnd!!.end.id
            repo.add(secondEnd,TargetPoint(1.1,-.2),null);repo.complete(completeId)
            before=requireNotNull(repo.details(completeId))
            repo.start("Fixture active",30.0,800,6)
            val activeBefore=requireNotNull(repo.active.first())
            legacy.close()
            val migrated=next(name)
            try {
                val saved=requireNotNull(migrated.journalDao().details(completeId))
                assertEquals(before.session.id,saved.session.id);assertEquals("completed",saved.session.state)
                assertEquals(before.session.completedAt,saved.session.completedAtMs)
                assertNull(saved.session.timeZoneId);assertNull(saved.session.localDate)
                assertEquals(1,saved.blocks.size)
                val block=saved.blocks.single().block
                assertEquals(18.0,block.distanceMeters!!,0.0);assertEquals(600,block.targetDiameterMm)
                assertNotNull(block.targetSnapshotJson);assertNull(block.equipmentSnapshotJson)
                assertEquals(before.orderedEnds.map{it.end.id},saved.currentBlock!!.orderedEnds.map{it.end.id})
                assertTrue(saved.currentBlock!!.orderedEnds.all{it.end.state=="closed"})
                assertTrue(saved.currentBlock!!.orderedEnds.all{it.end.createdAtMs==null&&it.end.closedAtMs==null})
                assertEquals(before.allShots.map{it.id},saved.allShots.map{it.id})
                assertEquals(listOf(10,7,0,0),saved.allShots.map{it.points})
                assertEquals(before.allShots.map{it.revision.toLong()},saved.allShots.map{it.revision})
                assertEquals(before.allShots.map{it.createdAt},saved.allShots.map{it.createdAtMs})
                assertNull(saved.allShots[2].x);assertEquals(0.0,saved.allShots[0].x!!,0.0)
                assertEquals(1.1,saved.allShots[3].x!!,0.0);assertEquals("manual_edit",saved.allShots[1].scoreSource)
                assertTrue(saved.allShots.all{it.automaticPoints==null})
                val current=requireNotNull(migrated.journalDao().active().first())
                assertEquals(activeBefore.session.id,current.session.id);assertEquals(6,current.currentEnd!!.end.plannedCount)
                assertTrue(current.allShots.isEmpty())
                migrated.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use{assertFalse(it.moveToFirst())}
            } finally {migrated.close()}
            val reopened=next(name)
            try{assertEquals(listOf(10,7,0,0),reopened.journalDao().details(completeId)!!.allShots.map{it.points})}finally{reopened.close()}
        } finally {legacy.close();context.deleteDatabase(name)}
    }

    @Test fun emptyDatabaseMigratesWithoutInventedSessions()=runBlocking(Dispatchers.IO) {
        val name=filename();val legacy=old(name)
        try {
            legacy.openHelper.writableDatabase;legacy.close()
            val migrated=next(name)
            try{assertNull(migrated.journalDao().active().first());assertTrue(migrated.journalDao().history().first().isEmpty())}finally{migrated.close()}
        }finally{legacy.close();context.deleteDatabase(name)}
    }

    @Test fun unsupportedSourceFailsWithoutChangingOriginalDatabase()=runBlocking(Dispatchers.IO) {
        val name=filename();val legacy=old(name)
        try {
            val repo=PracticeRepository(legacy);repo.start("Unknown profile",18.0,600,3)
            val id=repo.active.first()!!.session.id
            legacy.openHelper.writableDatabase.execSQL("UPDATE sessions SET profileId='not-supported' WHERE id=?",arrayOf<Any?>(id));legacy.close()
            val migrated=next(name)
            try{try{migrated.openHelper.writableDatabase;fail("Unsupported profile silently accepted")}catch(e:Exception){assertTrue(e.toString().contains("Unsupported legacy session"))}}finally{migrated.close()}
            val restored=old(name)
            try{assertEquals("not-supported",restored.practiceDao().details(id)!!.session.profileId);assertEquals(1,restored.openHelper.writableDatabase.version)}finally{restored.close()}
        }finally{legacy.close();context.deleteDatabase(name)}
    }

    @Test fun injectedFailureAfterRebuildRollsBackAllDdlAndData()=runBlocking(Dispatchers.IO) {
        val name=filename();val legacy=old(name)
        try {
            val repo=PracticeRepository(legacy);repo.start("Rollback fixture",18.0,600,3)
            val initial=repo.active.first()!!;repo.add(initial.currentEnd!!.end.id,null,10)
            val before=repo.active.first()!!;legacy.close()
            val fault=object:Migration(1,2){override fun migrate(db:SupportSQLiteDatabase){MIGRATION_1_2.migrate(db);throw IllegalStateException("injected migration failure")}}
            val failing=next(name,fault)
            try{try{failing.openHelper.writableDatabase;fail("Injected failure was swallowed")}catch(e:Exception){assertTrue(e.toString().contains("injected migration failure"))}}finally{failing.close()}
            val restored=old(name)
            try{assertEquals(before.allShots,restored.practiceDao().details(before.session.id)!!.allShots);assertEquals(1,restored.openHelper.writableDatabase.version)}finally{restored.close()}
            val successful=next(name)
            try{assertEquals(1,successful.journalDao().details(before.session.id)!!.blocks.size)}finally{successful.close()}
        }finally{legacy.close();context.deleteDatabase(name)}
    }
}


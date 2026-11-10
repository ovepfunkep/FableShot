package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.WriteGate
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class DiaryNotesRepositoryTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun standaloneNotePersistsWithoutInventingTrainingAndChecksRevisions()=runBlocking {
        val name="fableshot-verification-notes-${UUID.randomUUID()}.db"
        val db=Room.databaseBuilder(context,JournalDatabase::class.java,name).build()
        val saved=try {
            val repo=DiaryNoteRepository(db)
            val draft=DiaryNote(body="Личная заметка\nБез тренировки",tagsJson=NoteTags.encode("Техника, техника, club"),place="Fixture range")
            val original=repo.save(draft)
            assertEquals(original,repo.save(draft));assertTrue(db.journalDao().history().first().isEmpty())
            val changed=repo.save(original.copy(feeling="Recorded by user"))
            try {repo.save(original.copy(body="Stale overwrite"));fail()}catch(_:DiaryNoteConflict){}
            changed
        }finally {db.close()}
        val reopened=Room.databaseBuilder(context,JournalDatabase::class.java,name).build()
        try {
            val repo=DiaryNoteRepository(reopened)
            assertEquals(listOf(saved),repo.notes.first())
            assertEquals(listOf("Техника","club"),NoteTags.decode(saved.tagsJson))
            repo.remove(saved);repo.remove(saved)
            assertTrue(repo.notes.first().isEmpty());assertNotNull(reopened.diaryNoteDao().get(saved.id)!!.deletedAtMs)
        }finally {reopened.close();context.deleteDatabase(name)}
    }

    @Test fun noteLinksMustBelongTogetherAndPhysicalSourceRemovalKeepsText()=runBlocking {
        val db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build()
        try {
            val journal=JournalRepository(db)
            journal.start("Source",BlockPlan(18.0,400))
            val source=journal.active.first()!!
            val repo=DiaryNoteRepository(db)
            val note=repo.save(DiaryNote(sessionId=source.session.id,blockId=source.currentBlock!!.block.id,endId=source.currentEnd!!.end.id,body="Series observation"))
            assertEquals(listOf(note),repo.notes(NoteScope(source.session.id)).first())
            try {repo.save(DiaryNote(sessionId="missing",blockId=source.currentBlock!!.block.id,body="Wrong source"));fail()}catch(_:IllegalArgumentException){}
            db.openHelper.writableDatabase.execSQL("DELETE FROM sessions WHERE id=?",arrayOf(source.session.id))
            val detached=repo.notes.first().single()
            assertNull(detached.sessionId);assertNull(detached.blockId);assertNull(detached.endId)
            assertEquals(note.body,detached.body)
            db.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use {assertFalse(it.moveToFirst())}
        }finally {db.close()}
    }

    @Test fun invalidEmptyDateTagsAndRetiredWritersCannotChangeFacts()=runBlocking {
        val db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build()
        try {
            val gate=WriteGate();val repo=DiaryNoteRepository(db,gate)
            for(note in listOf(DiaryNote(),DiaryNote(tagsJson="[ ]"),DiaryNote(body="Text",localDate="2026-02-30"),
                DiaryNote(body="Text",tagsJson="[1]"),DiaryNote(body="Text",blockId="without-session"))) {
                try {repo.save(note);fail("Invalid note saved")}catch(_:IllegalArgumentException){}
            }
            assertTrue(repo.notes.first().isEmpty())
            gate.retire { }
            try {repo.save(DiaryNote(body="Text"));fail()}catch(_:IllegalStateException){}
            assertTrue(repo.notes.first().isEmpty())
        }finally {db.close()}
    }
}

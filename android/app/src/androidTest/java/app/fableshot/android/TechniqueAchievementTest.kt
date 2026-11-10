package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.WriteGate
import app.fableshot.android.data.journal.JournalDatabase
import app.fableshot.android.data.journal.JournalPracticeStore
import app.fableshot.android.technique.TechniqueRepository
import app.fableshot.android.technique.TechniqueText
import app.fableshot.android.technique.TechniqueVersion
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class TechniqueAchievementTest {
    private lateinit var db: JournalDatabase
    private val gate = WriteGate()

    @Before fun open() {
        db = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,
            JournalDatabase::class.java).build()
    }

    @After fun close() { db.close() }

    private fun text(description: String) = TechniqueText(title = "Натяжение", description = description, phases = emptyList())

    private suspend fun TechniqueRepository.publishText(id: String, text: TechniqueText,
        count: Boolean = true): TechniqueVersion {
        val expected = requireNotNull(db.techniqueDao().document(id)).draftJson
        return publish(id, expected, text.json(), countForAchievements = count)
    }

    private suspend fun grant(rule: String) = db.achievementDao().grant("$rule:global")

    @Test fun oldVersionsDraftsAndEmptyPublicationsDoNotAward() = runBlocking(Dispatchers.IO) {
        val old = TechniqueRepository(db, gate)
        val id = old.create(text("Старое указание"))
        val oldVersion = old.publishText(id, text("Старое указание"))
        val oldLatest = old.publishText(id, text("Старая редакция"))
        val live = JournalPracticeStore(db, gate).techniques
        val duplicate = live.publishText(id, text("Старая редакция"))
        assertEquals(oldLatest.number + 1, duplicate.number)
        assertNull(db.journalDao().receipt("technique_publish:${duplicate.id}"))
        val empty = live.create(text(""))
        live.publishText(empty, text(""))
        val draft = text("Новый черновик")
        live.draft(id, requireNotNull(db.techniqueDao().document(id)).draftJson, draft.json())
        assertTrue(db.achievementDao().grants().isEmpty())

        val first = live.publishText(id, draft)
        assertEquals("technique_publish:${first.id}", grant("MIND03")?.batchId)
        assertNull(grant("MIND04"))
        assertEquals(1, db.techniqueDao().achievementPublicationFingerprints(id).size)

        val restored = live.publishText(id, TechniqueText.parse(oldVersion.payloadJson), count = false)
        assertNull(db.journalDao().receipt("technique_publish:${restored.id}"))
        assertNull(grant("MIND04"))
        Unit
    }

    @Test fun twoDistinctNewPublicationsMustBelongToTheSameCard() = runBlocking(Dispatchers.IO) {
        val live = JournalPracticeStore(db, gate).techniques
        val firstText = text("Плечо остаётся низко")
        val first = live.create(firstText)
        val version = live.publishText(first, firstText)
        val duplicate = live.publishText(first, firstText)
        assertEquals(version.number + 1, duplicate.number)
        assertNull(db.journalDao().receipt("technique_publish:${duplicate.id}"))
        val cosmetic = firstText.copy(description = "  Плечо  остаётся низко ", discussed = "2026-11-04", change = "Уточнил дату")
        val metadataVersion = live.publishText(first, cosmetic)
        assertNull(db.journalDao().receipt("technique_publish:${metadataVersion.id}"))

        val other = live.create(text("Проверь стойку"))
        live.publishText(other, text("Проверь стойку"))
        assertNull(grant("MIND04"))
        assertEquals(1, db.techniqueDao().achievementPublicationFingerprints(first).size)

        val reopened = JournalPracticeStore(db, gate).techniques
        val revision = reopened.publishText(first, text("Плечо низко, локоть движется назад"))
        assertEquals("technique_publish:${revision.id}", grant("MIND04")?.batchId)
        assertEquals(2, db.techniqueDao().achievementPublicationFingerprints(first).size)

        reopened.publishText(first, firstText)
        assertEquals(2, db.techniqueDao().achievementPublicationFingerprints(first).size)
        assertEquals("technique_publish:${revision.id}", grant("MIND04")?.batchId)
        Unit
    }

    @Test fun failureRollsBackPublicationAndItsReceipt() = runBlocking(Dispatchers.IO) {
        var attempted: String? = null
        val repo = TechniqueRepository(db, gate) { _, operationId ->
            attempted = operationId
            error("Fixture failure after saving the publication receipt")
        }
        val original = text("Первая инструкция")
        val id = repo.create(original)
        val before = db.techniqueDao().document(id)
        try {
            repo.publishText(id, text("Новая инструкция"))
            fail("Publication must fail when the achievement transaction fails")
        } catch (_: IllegalStateException) {
        }
        assertNull(db.techniqueDao().latest(id))
        assertNull(db.journalDao().receipt(requireNotNull(attempted)))
        assertEquals(before, db.techniqueDao().document(id))
        Unit
    }
}

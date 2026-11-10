package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.importing.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.UUID

class MyTargetsEquipmentImportTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var folder: File
    private lateinit var diary: JournalDatabase
    private lateinit var gear: EquipmentDatabase
    private lateinit var importer: MyTargetsImporter

    @Before fun prepare() {
        folder = File(context.cacheDir, "verification-mt-equipment-${UUID.randomUUID()}").apply { mkdirs() }
        diary = Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java).build()
        gear = Room.inMemoryDatabaseBuilder(context, EquipmentDatabase::class.java).build()
        importer = MyTargetsImporter(diary, File(folder, "files"), File(folder, "stage"), equipmentDb = gear)
    }

    @After fun cleanup() {
        diary.close()
        gear.close()
        check(folder.canonicalFile.parentFile == context.cacheDir.canonicalFile)
        folder.deleteRecursively()
    }

    private fun choices(preview: MyTargetsPreview, snapshot: String? = null) = preview.groups.map { group ->
        ImportChoice(group.key, group.blocks.flatMap { it.ends }.map { it.key }.toSet(),
            suggestedMappings(group).map { it.copy(equipmentSnapshotJson = snapshot ?: it.equipmentSnapshotJson) })
    }

    @Test fun zipGearCreatesSelectableLinkedKitsAndReplayKeepsStableIdsAndUserEdits() = runBlocking(Dispatchers.IO) {
        val zip = myTargetsZipFixture(folder) { db ->
            db.execSQL("INSERT INTO Bow VALUES(2,'Unlinked compound bow',1,'30 lb')")
        }
        val source = importer.stage(zip.inputStream())
        val preview = importer.analyze(source)
        val operation = UUID.randomUUID().toString()
        importer.commit(source, preview.fileHash, choices(preview), operationId = operation)
        val cards = gear.equipmentDao().all()
        assertEquals(4, cards.size)
        val bow = cards.single { it.name == "Synthetic bow" }
        val arrows = cards.single { it.kind == "arrows" }
        val kit = cards.single { it.kind == "setup" }
        assertEquals("barebow", bow.category)
        assertEquals(25.0, bow.drawWeightLb!!, 0.0)
        assertEquals("compound", cards.single { it.name == "Unlinked compound bow" }.category)
        assertEquals(800, arrows.spine)
        assertEquals(bow.id, kit.bowId)
        assertEquals(arrows.id, kit.arrowsId)
        assertTrue(kit in selectableEquipment(cards))
        val imported = JournalRepository(diary).history.first()
        assertTrue(imported.all {
            val snapshot = JSONObject(it.blocks.single().block.equipmentSnapshotJson!!)
            snapshot.getJSONObject("selection").getString("id") == kit.id &&
                snapshot.getJSONObject("bow").getString("id") == bow.id
        })
        val repository = EquipmentRepository(gear)
        repository.save(bow.copy(name = "My renamed bow"))
        val editedCards = gear.equipmentDao().all()
        assertTrue(importer.commit(source, preview.fileHash, choices(preview), operationId = operation).replayed)
        assertEquals(editedCards.toSet(), gear.equipmentDao().all().toSet())
    }

    @Test fun explicitlyAssignedLocalKitIsKept() = runBlocking(Dispatchers.IO) {
        val repository = EquipmentRepository(gear)
        val bow = repository.save(EquipmentItem(kind = "bow", name = "My existing bow", category = "barebow"))
        val kit = repository.save(EquipmentItem(kind = "setup", name = "My existing kit", bowId = bow.id))
        val snapshot = repository.snapshot(kit.id)
        val source = importer.stage(myTargetsZipFixture(folder).inputStream())
        val preview = importer.analyze(source)
        importer.commit(source, preview.fileHash, choices(preview, snapshot))
        assertTrue(JournalRepository(diary).history.first().all {
            it.blocks.single().block.equipmentSnapshotJson == snapshot
        })
        assertEquals(0, importer.restoreImportedEquipment())
        assertEquals(kit, gear.equipmentDao().item(kit.id))
    }

    @Test fun absentSourceGearDoesNotInventCards() = runBlocking(Dispatchers.IO) {
        val zip = myTargetsZipFixture(folder) { db ->
            db.execSQL("UPDATE Training SET bowId=NULL,arrowId=NULL")
            db.execSQL("DELETE FROM Bow")
            db.execSQL("DELETE FROM Arrow")
        }
        val source = importer.stage(zip.inputStream())
        val preview = importer.analyze(source)
        importer.commit(source, preview.fileHash, choices(preview))
        assertTrue(gear.equipmentDao().all().isEmpty())
        assertTrue(JournalRepository(diary).history.first().all {
            JSONObject(it.blocks.single().block.equipmentSnapshotJson!!).getJSONObject("selection").getString("kind") == "source"
        })
    }

    @Test fun earlierImportRestoresSourceGearOnceWithoutChangingShots() = runBlocking(Dispatchers.IO) {
        val earlier = MyTargetsImporter(diary, File(folder, "files"), File(folder, "stage"))
        val source = earlier.stage(myTargetsZipFixture(folder).inputStream())
        val preview = earlier.analyze(source)
        earlier.commit(source, preview.fileHash, choices(preview))
        val before = JournalRepository(diary).history.first()
        assertTrue(gear.equipmentDao().all().isEmpty())
        assertEquals(2, importer.restoreImportedEquipment())
        val recovered = JournalRepository(diary).history.first()
        assertEquals(before.flatMap { it.allShots }, recovered.flatMap { it.allShots })
        assertTrue(recovered.all {
            JSONObject(it.blocks.single().block.equipmentSnapshotJson!!).getJSONObject("selection").getString("kind") == "setup"
        })
        val cards = gear.equipmentDao().all()
        assertEquals(3, cards.size)
        assertEquals(0, importer.restoreImportedEquipment())
        assertEquals(cards.toSet(), gear.equipmentDao().all().toSet())
        assertEquals(recovered, JournalRepository(diary).history.first())
    }

    @Test fun failureAfterPublishingGearRollsBackNewCardsAndDiaryFacts() = runBlocking(Dispatchers.IO) {
        val source = importer.stage(myTargetsZipFixture(folder).inputStream())
        val preview = importer.analyze(source)
        diary.openHelper.writableDatabase.execSQL(
            "CREATE TRIGGER reject_import_receipt BEFORE INSERT ON mutation_receipts " +
                "WHEN NEW.kind='import_mytargets' BEGIN SELECT RAISE(ABORT,'synthetic receipt rejection'); END",
        )
        try {
            importer.commit(source, preview.fileHash, choices(preview))
            fail("Synthetic receipt failure was ignored")
        } catch (_: android.database.sqlite.SQLiteException) {
            assertTrue(gear.equipmentDao().all().isEmpty())
            assertTrue(JournalRepository(diary).history.first().isEmpty())
        }
    }
}

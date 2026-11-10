package app.fableshot.android

import android.database.sqlite.SQLiteDatabase
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import app.fableshot.android.data.EquipmentDatabase
import app.fableshot.android.data.UserPreferences
import app.fableshot.android.data.progressConditionGroups
import app.fableshot.android.backup.JournalArchive
import app.fableshot.android.importing.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.util.UUID
import java.util.zip.GZIPInputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Synthetic fixtures only; the optional supplied backup is read from a separate cache directory. */
class MyTargetsArchiveReaderTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var root: File
    private lateinit var database: JournalDatabase
    private lateinit var importer: MyTargetsImporter

    @Before fun setup() {
        root = File(context.cacheDir, "verification-mytargets-zip-${UUID.randomUUID()}").apply { mkdirs() }
        database = Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java).build()
        importer = MyTargetsImporter(database, File(root, "files"), File(root, "stage")) { 1234567890L }
    }

    @After fun cleanup() {
        database.close()
        check(root.canonicalFile.parentFile == context.cacheDir.canonicalFile && root.name.startsWith("verification-mytargets-zip-"))
        root.deleteRecursively()
    }

    private suspend fun staged(file: File) = importer.stage(file.inputStream())
    private fun choices(preview: MyTargetsPreview, duplicate: Boolean = false) = preview.groups.map { group ->
        ImportChoice(group.key, group.blocks.flatMap { it.ends }.map { it.key }.toSet(), suggestedMappings(group),
            allowPossibleDuplicate = duplicate)
    }

    @Test fun explicitTrainingIdsSavedScoresAndUnfilledSlotsReachExistingTransactionWithoutNativeAwards() = runBlocking(Dispatchers.IO) {
        val source = staged(myTargetsZipFixture(root))
        val preview = importer.analyze(source)
        assertEquals("zip", preview.sourceFormat)
        assertEquals(2, preview.groups.size)
        assertTrue(preview.groups.none { it.ambiguousBoundary || !it.canImport })
        assertEquals(6, preview.groups.sumOf { it.shotCount })
        assertEquals(43, preview.groups.sumOf { it.points })
        assertEquals(3, preview.skippedEmptySlots)
        assertEquals(1, preview.ignoredAttachments)
        assertEquals(6, suggestedMappings(preview.groups.first()).single().arrowsPerEnd)
        assertEquals(18.0, suggestedMappings(preview.groups.first()).single().distanceMeters!!, 0.0)
        assertEquals(400, suggestedMappings(preview.groups.first()).single().diameterMm)
        assertEquals("barebow", suggestedMappings(preview.groups.first()).single().bowCategory)
        val operation = UUID.randomUUID().toString()
        val result = importer.commit(source, preview.fileHash, choices(preview), operationId = operation)
        assertEquals(6, result.shotCount)
        assertEquals(2, result.sessionIds.size)
        val imported = JournalRepository(database).history.first()
        assertEquals(43, imported.sumOf { it.allShots.sumOf { shot -> shot.points } })
        assertEquals(1, imported.flatMap { it.allShots }.count { it.zoneCode == "M" })
        assertEquals(1, imported.flatMap { it.allShots }.count { it.zoneCode == "X" })
        assertTrue(imported.all { it.session.sourceKind == "mytargets" && it.session.timeSource == "source_date_only" })
        assertTrue(imported.flatMap { it.allShots }.all { it.scoreSource == "imported" && it.automaticPoints == null })
        assertTrue(database.achievementDao().enrollments().isEmpty())
        assertEquals(listOf("APP01"), database.achievementDao().grants().map { it.ruleId })
        val partial = imported.first { it.blocks.single().block.defaultArrowsPerEnd == 6 }.blocks.single().ends.single()
        assertEquals(3, partial.shots.size)
        assertFalse(partial.full)
        val snapshot = JSONObject(imported.first().blocks.single().block.equipmentSnapshotJson!!)
        assertEquals("barebow", snapshot.getJSONObject("bow").getString("category"))
        assertEquals("Synthetic bow", snapshot.getJSONObject("bow").getString("name"))
        imported.forEach { detail -> detail.blocks.forEach { block ->
            val target = JSONObject(block.block.targetSnapshotJson!!)
            assertEquals("mytargets-zip-v27", target.getString("sourceFormat"))
            assertTrue(target.getString("sourceRoundKey").startsWith("t"))
        } }
        val batch = database.importDao().batchById(result.batchId)!!
        assertEquals(MyTargetsArchiveReader.PARSER_VERSION, batch.parserVersion)
        assertArrayEquals(source.readBytes(), GZIPInputStream(File(File(root, "files"), batch.rawSourcePath).inputStream()).use { it.readBytes() })
        assertTrue(importer.commit(source, preview.fileHash, choices(preview), operationId = operation).replayed)
        assertTrue(importer.inventory(preview).alreadyRecords.isNotEmpty())
        try {
            importer.commit(source, preview.fileHash, choices(preview))
            fail("Exact source duplicated")
        } catch (error: ImportRejected) { assertEquals("already_imported_records", error.code) }
    }

    @Test fun partialArchiveSelectionThenRemainingSourceAndCancellationKeepDurableProvenance() = runBlocking(Dispatchers.IO) {
        val source = staged(myTargetsZipFixture(root))
        val preview = importer.analyze(source)
        val first = importer.commit(source, preview.fileHash, choices(preview).take(1))
        try {
            importer.commit(source, preview.fileHash, choices(preview).drop(1), onProgress = { throw CancellationException("fixture") })
            fail("Cancellation ignored")
        } catch (_: CancellationException) { }
        assertEquals(3, JournalRepository(database).history.first().sumOf { it.allShots.size })
        val second = importer.commit(source, preview.fileHash, choices(preview).drop(1))
        assertEquals(first.batchId, second.batchId)
        assertEquals(6, database.importDao().rows(first.batchId).size)
        assertEquals(2, JournalRepository(database).history.first().size)
    }

    @Test fun sourceRoundsStayDistinctInDiaryAndAggregateByConditionsInProgress() = runBlocking(Dispatchers.IO) {
        val source = staged(myTargetsZipFixture(root, modify = { sourceDb ->
            sourceDb.execSQL("INSERT INTO Round VALUES(3,1,0,3,'18.0 m',0,0,'40.0 cm')")
            sourceDb.execSQL("INSERT INTO End VALUES(3,3,0,1,'12:00:00',9,1)")
            sourceDb.execSQL("INSERT INTO Shot VALUES(10,3,0,.1,.1,2,NULL)")
        }))
        val preview = importer.analyze(source)
        assertEquals(2, preview.groups.size)
        assertEquals(2, preview.groups.first { it.key == "t1" }.blocks.size)
        val result = importer.commit(source, preview.fileHash, choices(preview))
        val sessions = result.sessionIds.map { JournalRepository(database).details(it)!! }
        val imported = sessions.first { it.blocks.size == 2 }
        val keys = imported.blocks.map { JSONObject(it.block.targetSnapshotJson!!).getString("sourceRoundKey") }
        assertEquals(setOf("t1:r1", "t1:r3"), keys.toSet())
        assertEquals(4, imported.allShots.size)

        val group = progressConditionGroups(sessions.map { it.summary() }).single()
        assertTrue(group.label.contains("Indoor"))
        assertTrue(group.label.contains("Synthetic bow"))
        assertEquals(2, group.rows.size)
        assertEquals(7, group.rows.sumOf { it.scoredCount })
        assertEquals(52, group.rows.sumOf { it.total })
        val firstTraining = group.rows.single { it.id == imported.session.id }
        assertEquals(34, firstTraining.total)
        assertEquals(4, firstTraining.journalMeta!!.zoneCounts!!.sum())
        assertTrue(group.rows.all { it.journalMeta?.positions != null })

        val other = sessions.single { it.blocks.size == 1 }
        val round = other.blocks.single()
        val nativeId = UUID.randomUUID().toString()
        val native = other.copy(
            session = other.session.copy(id = nativeId, sourceKind = "native"),
            blocks = listOf(round.copy(block = round.block.copy(
                sessionId = nativeId,
                targetSnapshotJson = app.fableshot.android.domain.TargetCatalog.indoor.snapshot(400),
            ))),
        )
        val combined = progressConditionGroups(sessions.map { it.summary() } + native.summary()).single()
        assertEquals(3, combined.rows.size)
        assertEquals(10, combined.rows.sumOf { it.scoredCount })
        fun withConditions(block: JournalBlock) = other.copy(blocks = listOf(round.copy(block = block))).summary()
        val otherEquipment = JSONObject(round.block.equipmentSnapshotJson!!).apply {
            getJSONObject("bow").put("id", "fixture-distinct-bow")
        }.toString()
        val otherProfile = "mytargets-source-10-fixture-six-ring"
        val otherTarget = JSONObject(round.block.targetSnapshotJson!!).apply {
            put("profileId", otherProfile)
            put("rawTargetLabel", "WA 6 Ring (40.0 cm)")
            put("scoringRuleVersion", "mytargets-source-scores-v1")
            put("maxPoints", 10)
        }.toString()
        val groups = progressConditionGroups(listOf(
            imported.summary(),
            withConditions(round.block.copy(equipmentSnapshotJson = otherEquipment)),
            withConditions(round.block.copy(distanceMeters = 50.0)),
            withConditions(round.block.copy(targetProfileId = otherProfile, targetSnapshotJson = otherTarget)),
        ))
        assertEquals(4, groups.size)
        assertEquals(4, groups.map { it.label }.distinct().size)
        assertTrue(groups.any { it.label.startsWith("50 м ·") })
        assertTrue(groups.any { it.label.contains("WA 6 Ring") })
    }

    @Test fun csvAndZipOverlapIsWarnedWithoutGuessingOrOverwritingPreviousImport() = runBlocking(Dispatchers.IO) {
        val csv = File(root, "source.csv").apply { writeText(myTargetsMatchingCsv()) }
        val stagedCsv = staged(csv)
        val csvPreview = importer.analyze(stagedCsv)
        val csvChoice = choices(csvPreview).map { it.copy(mappings = it.mappings.map { mapping -> mapping.copy(scaleConfirmed = true) }) }
        importer.commit(stagedCsv, csvPreview.fileHash, csvChoice)
        val zip = staged(myTargetsZipFixture(root))
        val preview = importer.analyze(zip)
        val inventory = importer.inventory(preview)
        assertTrue(inventory.possibleEndFingerprints.isNotEmpty())
        try {
            importer.commit(zip, preview.fileHash, choices(preview))
            fail("Overlap silently imported")
        } catch (error: ImportRejected) { assertEquals("possible_duplicate", error.code) }
        assertEquals(1, JournalRepository(database).history.first().size)
        assertEquals(6, importer.commit(zip, preview.fileHash, choices(preview, duplicate = true)).shotCount)
    }

    @Test fun unsafeDuplicateTruncatedUnknownVersionAndInconsistentFactsNeverCreateDiaryRows() = runBlocking(Dispatchers.IO) {
        val normal = myTargetsZipFixture(root)
        val normalized = File(root, "test-normalized.zip")
        val aliases = MyTargetsZipEnvelope.normalize(normal, normalized, 2000) {}
        val databaseAlias = aliases.entries.single { it.value == "data.db" }.key
        val bytes = java.util.zip.ZipFile(normalized).use { zip -> zip.getInputStream(zip.getEntry(databaseAlias)).readBytes() }
        suspend fun rejects(file: File, code: String? = null) {
            try { importer.analyze(staged(file)); fail("Invalid archive accepted") }
            catch (error: Exception) {
                if (error is CancellationException) throw error
                if (code != null) assertEquals(code, (error as ImportRejected).code)
            }
            assertTrue(JournalRepository(database).history.first().isEmpty())
        }
        fun zip(name: String, values: List<Pair<String, ByteArray>>) = File(root, name).apply {
            ZipOutputStream(outputStream()).use { output -> values.forEach { (path, data) ->
                output.putNextEntry(ZipEntry(path)); output.write(data); output.closeEntry()
            } }
        }
        rejects(zip("unsafe.zip", listOf("../data.db" to bytes)), "archive_unsafe_path")
        rejects(zip("duplicate.zip", listOf("/data.db" to bytes, "data.db" to bytes)), "archive_duplicate_entry")
        rejects(File(root, "truncated.zip").apply { writeBytes(normal.readBytes().copyOf(100)) })
        rejects(myTargetsZipFixture(root, version = 28), "archive_schema_unsupported")
        val inconsistent = myTargetsZipFixture(root, incorrectTotal = true)
        val preview = importer.analyze(staged(inconsistent))
        assertTrue(preview.groups.any { it.issues.any { issue -> issue.code == "archive_series_totals_mismatch" && issue.blocking } })
        try {
            val source = staged(inconsistent)
            importer.commit(source, preview.fileHash, choices(preview))
            fail("Inconsistent series imported")
        } catch (error: ImportRejected) { assertEquals("invalid_selected_rows", error.code) }
    }

    @Test fun unknownTargetRemainsBlockingInsteadOfInventingScores() = runBlocking(Dispatchers.IO) {
        val source = staged(myTargetsZipFixture(root, target = 99))
        val preview = importer.analyze(source)
        assertTrue(preview.groups.all { it.issues.any { issue -> issue.code == "unsupported_archive_target" && issue.blocking } })
        try { importer.commit(source, preview.fileHash, choices(preview)); fail("Unknown target imported") }
        catch (error: ImportRejected) { assertEquals("invalid_selected_rows", error.code) }
    }

    @Test fun unknownStyleOrRingIsBlockingAndNullRingIsNeverReadAsACentreHit() = runBlocking(Dispatchers.IO) {
        for ((mutation, issue) in listOf(
            "UPDATE Round SET targetScoringStyleIndex=9" to "unsupported_archive_target",
            "UPDATE Shot SET scoringRing=99 WHERE id=1" to "invalid_archive_score",
        )) {
            val source = staged(myTargetsZipFixture(root, modify = { it.execSQL(mutation) }))
            val preview = importer.analyze(source)
            assertTrue(preview.groups.any { it.issues.any { value -> value.code == issue && value.blocking } })
        }
        val source = staged(myTargetsZipFixture(root, modify = { it.execSQL("UPDATE Shot SET scoringRing=NULL WHERE id=1") }))
        try { importer.analyze(source); fail("NULL ring became an X") }
        catch (error: ImportRejected) { assertEquals("archive_invalid_facts", error.code) }
        assertTrue(JournalRepository(database).history.first().isEmpty())
    }

    @Test fun zipSourceStillSurvivesTheUnchangedFullDiaryArchiveContract() = runBlocking(Dispatchers.IO) {
        val source = staged(myTargetsZipFixture(root))
        val preview = importer.analyze(source)
        val result = importer.commit(source, preview.fileHash, choices(preview))
        val equipment = Room.inMemoryDatabaseBuilder(context, EquipmentDatabase::class.java).build()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            val preferences = UserPreferences(PreferenceDataStoreFactory.create(scope = scope,
                produceFile = { File(root, "archive.preferences_pb") }))
            val archive = JournalArchive(context, database, equipment, preferences, File(root, "files"), File(root, "archive-stage"))
            val exported = archive.export()
            val prepared = archive.prepare(exported.file)
            val restored = Room.databaseBuilder(context, JournalDatabase::class.java, prepared.journalFile.path).build()
            try {
                val batch = restored.importDao().batchById(result.batchId)!!
                assertEquals(MyTargetsArchiveReader.PARSER_VERSION, batch.parserVersion)
                val raw = File(prepared.directory, batch.rawSourcePath)
                assertArrayEquals(source.readBytes(), GZIPInputStream(raw.inputStream()).use { it.readBytes() })
                assertEquals(6, JournalRepository(restored).history.first().sumOf { it.allShots.size })
                assertTrue(restored.achievementDao().enrollments().isEmpty())
            } finally { restored.close(); archive.discard(prepared.directory); archive.discard(exported.file) }
        } finally { equipment.close(); scope.coroutineContext[Job]!!.cancelAndJoin() }
    }

    @Test fun providedBackupIsReadOnlyAndHasTheVerifiedAggregateCounts() = runBlocking(Dispatchers.IO) {
        val fixtures = context.getExternalFilesDir("verification")!!
        val file = File(fixtures, "mytargets-backup-fixture.zip")
        Assume.assumeTrue(file.isFile)
        require(file.canonicalFile.parentFile == fixtures.canonicalFile)
        val preview = importer.analyze(staged(file))
        assertEquals(58, preview.groups.size)
        assertEquals(3885, preview.groups.sumOf { it.shotCount })
        assertEquals(33055, preview.groups.sumOf { it.points })
        assertEquals(210, preview.skippedEmptySlots)
        assertTrue(preview.groups.none { it.ambiguousBoundary || !it.canImport })
        assertTrue(JournalRepository(database).history.first().isEmpty())
        val source = staged(file)
        val result = importer.commit(source, preview.fileHash, choices(preview))
        assertEquals(58, result.sessionIds.size)
        assertEquals(3885, result.shotCount)
        assertEquals(33055, JournalRepository(database).history.first().sumOf { it.allShots.sumOf { shot -> shot.points } })
        assertTrue(database.achievementDao().enrollments().isEmpty())
        assertEquals(setOf("APP01"), database.achievementDao().grants().map { it.ruleId }.toSet())
    }

    @Test fun providedCsvKeepsItsWarningsAndTheZipOverlapIsExplicit() = runBlocking(Dispatchers.IO) {
        val fixtures = context.getExternalFilesDir("verification")!!
        val file = File(fixtures, "mytargets-csv-fixture.csv")
        val zipFile = File(fixtures, "mytargets-backup-fixture.zip")
        Assume.assumeTrue(file.isFile && zipFile.isFile)
        require(file.canonicalFile.parentFile == fixtures.canonicalFile && zipFile.canonicalFile.parentFile == fixtures.canonicalFile)
        val csv = importer.analyze(staged(file))
        assertEquals(4065, csv.groups.sumOf { it.shotCount })
        assertEquals(32765, csv.groups.sumOf { it.points })
        assertEquals(55, csv.groups.count { it.ambiguousBoundary })
        val source = staged(zipFile)
        val archive = importer.analyze(source)
        importer.commit(source, archive.fileHash, choices(archive))
        val inventory = importer.inventory(csv)
        assertTrue(inventory.possibleEndFingerprints.isNotEmpty())
        assertTrue(inventory.alreadyRecords.isEmpty())
    }
}

internal fun myTargetsZipFixture(folder: File, version: Int = 27, incorrectTotal: Boolean = false, target: Int = 0,
    modify: (SQLiteDatabase) -> Unit = {}): File {
    val source = File(folder, "synthetic-${UUID.randomUUID()}.db")
    SQLiteDatabase.openOrCreateDatabase(source, null).use { db ->
        db.version = version
        db.execSQL("CREATE TABLE Training(id INTEGER PRIMARY KEY,title TEXT,date TEXT,standardRoundId INTEGER,bowId INTEGER,arrowId INTEGER,indoor INTEGER)")
        db.execSQL("CREATE TABLE Round(id INTEGER PRIMARY KEY,trainingId INTEGER,`index` INTEGER,shotsPerEnd INTEGER,distance TEXT,targetId INTEGER,targetScoringStyleIndex INTEGER,targetDiameter TEXT)")
        db.execSQL("CREATE TABLE End(id INTEGER PRIMARY KEY,roundId INTEGER,`index` INTEGER,exact INTEGER,saveTime TEXT,reachedPoints INTEGER,shotCount INTEGER)")
        db.execSQL("CREATE TABLE Shot(id INTEGER PRIMARY KEY,endId INTEGER,`index` INTEGER,x REAL,y REAL,scoringRing INTEGER,arrowNumber TEXT)")
        db.execSQL("CREATE TABLE Bow(id INTEGER PRIMARY KEY,name TEXT,type INTEGER,drawWeight TEXT)")
        db.execSQL("CREATE TABLE Arrow(id INTEGER PRIMARY KEY,name TEXT,spine TEXT)")
        db.execSQL("CREATE TABLE StandardRound(id INTEGER PRIMARY KEY,name TEXT)")
        db.execSQL("INSERT INTO Bow VALUES(1,'Synthetic bow',3,'25 lb')")
        db.execSQL("INSERT INTO Arrow VALUES(1,'Synthetic arrows','800')")
        db.execSQL("INSERT INTO StandardRound VALUES(1,'Synthetic practice')")
        for (id in 1..2) {
            db.execSQL("INSERT INTO Training VALUES(?,'Synthetic practice','2026-11-03',1,1,1,0)", arrayOf(id))
            db.execSQL("INSERT INTO Round VALUES(?,?,0,?,'18.0 m',?,0,'40.0 cm')", arrayOf(id, id, if (id == 1) 6 else 3, target))
            db.execSQL("INSERT INTO End VALUES(?,?,0,1,?,?,3)", arrayOf(id, id, if (id == 1) "10:00:00" else "11:00:00", if (id == 1) if (incorrectTotal) 999 else 25 else 18))
        }
        val rings = listOf(2, 0, 5, -2, -2, -2, -1, 1, 3)
        rings.forEachIndexed { index, ring ->
            val first = index < 6
            db.execSQL("INSERT INTO Shot VALUES(?,?,?,?,?,?,NULL)", arrayOf(index + 1, if (first) 1 else 2,
                if (first) index else index - 6, if (ring < 0) 0.0 else .01, if (ring < 0) 0.0 else .02, ring))
        }
        modify(db)
    }
    val targetZip = File(folder, "synthetic-${UUID.randomUUID()}.zip")
    ZipOutputStream(targetZip.outputStream()).use { output ->
        output.putNextEntry(ZipEntry("/data.db")); source.inputStream().use { it.copyTo(output) }; output.closeEntry()
        output.putNextEntry(ZipEntry("/img-synthetic.jpg")); output.write(byteArrayOf(1, 2, 3)); output.closeEntry()
    }
    source.delete()
    return targetZip
}

internal fun myTargetsMatchingCsv(): String {
    fun quoted(values: List<String>) = values.joinToString(";") { "\"${it.replace("\"", "\"\"")}\"" }
    val rows = listOf("9", "X", "6").map { score -> quoted(listOf("Synthetic practice", "2026-11-03", "Synthetic practice", "Outdoor",
        "Synthetic bow", "Synthetic arrows", "1", "18m", "WA Full (40cm)", "1", "10:00:00", score, "", ".01", ".02")) }
    return quoted(MyTargetsReader.HEADERS) + "\n" + rows.joinToString("\n", postfix = "\n")
}

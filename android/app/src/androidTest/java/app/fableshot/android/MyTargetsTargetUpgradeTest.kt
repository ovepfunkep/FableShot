package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.importing.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class MyTargetsTargetUpgradeTest {
    @Test fun retainedArchiveNormalizesOldTargetsAndExactCoordinatesOnceWithoutChangingScores() = runBlocking(Dispatchers.IO) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val root = File(context.cacheDir, "target-upgrade-${UUID.randomUUID()}").apply { mkdirs() }
        val db = Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java).build()
        try {
            val importer = MyTargetsImporter(db, File(root, "files"), File(root, "stage"))
            val file = importer.stage(myTargetsZipFixture(root).inputStream())
            val preview = importer.analyze(file)
            val choices = preview.groups.map { group ->
                ImportChoice(group.key, group.blocks.flatMap { it.ends }.map { it.key }.toSet(), suggestedMappings(group))
            }
            val result = importer.commit(file, preview.fileHash, choices)
            val journal = db.journalDao()
            val imported = result.sessionIds.map { journal.details(it)!! }
            assertTrue(imported.flatMap { it.blocks }.all { it.block.verifiedTarget() == TargetCatalog.indoor })
            val originalScores = imported.flatMap { it.allShots }.associate { it.id to (it.points to it.zoneCode) }
            val expectedPositions = imported.flatMap { it.allShots }.filter { it.positionStatus == "known" }
                .associate { it.id to (it.x to it.y) }
            assertTrue(expectedPositions.isNotEmpty())
            for (details in imported) for (block in details.blocks) {
                val source = JSONObject(block.block.targetSnapshotJson!!).getJSONObject("sourceTargetSnapshot")
                val oldId = "mytargets-source-10-upgrade-fixture"
                source.put("profileId", oldId)
                db.openHelper.writableDatabase.execSQL(
                    "UPDATE blocks SET targetProfileId=?,targetSnapshotJson=? WHERE id=?",
                    arrayOf(oldId, source.toString(), block.block.id),
                )
                for (shot in block.ends.flatMap { it.shots }) {
                    if (shot.positionStatus == "known") journal.update(shot.copy(
                        y = -shot.y!!, faceId = null, positionStatus = "unverified",
                    ))
                }
            }
            assertEquals(imported.sumOf { it.blocks.size }, importer.normalizeImportedTargets())
            val normalized = result.sessionIds.map { journal.details(it)!! }
            assertEquals(originalScores, normalized.flatMap { it.allShots }.associate { it.id to (it.points to it.zoneCode) })
            assertEquals(expectedPositions, normalized.flatMap { it.allShots }.filter { it.positionStatus == "known" }
                .associate { it.id to (it.x to it.y) })
            assertTrue(normalized.flatMap { it.blocks }.all { it.block.verifiedTarget() == TargetCatalog.indoor })
            assertEquals(imported.map { it.session }, normalized.map { it.session })
            assertEquals(0, importer.normalizeImportedTargets())
            assertTrue(db.achievementDao().enrollments().isEmpty())
        } finally {
            db.close()
            check(root.canonicalFile.parentFile == context.cacheDir.canonicalFile)
            root.deleteRecursively()
        }
    }

    @Test fun knownScoringStylesAndReducedFacesUseNativeProfilesAndScreenYIsFlipped() {
        fun conditions(target: Int, style: Int) = MyTargetsConditions(
            "1", "18m", "WA Full (40cm)", "", "", 18.0, 400,
            sourceTargetId = target, sourceScoringStyle = style,
        )
        assertEquals(TargetCatalog.indoor, myTargetsProfile(conditions(0, 0), 400))
        assertEquals(TargetCatalog.compound, myTargetsProfile(conditions(0, 2), 400))
        assertEquals(TargetCatalog.indoorFive, myTargetsProfile(conditions(2, 0), 400))
        assertEquals(TargetCatalog.indoorFiveCompound, myTargetsProfile(conditions(2, 2), 600))
        assertNull(myTargetsProfile(conditions(99, 0), 400))
        val row = MyTargetsRow("g", "b", "e", 1, 1, 9, "9", null, .1, .1, .1, .1, "unverified", emptyList())
        val point = myTargetsPoint(row, "zip")!!
        assertEquals(.1, point.x, 0.0)
        assertEquals(-.1, point.y, 0.0)
        assertEquals(.8, myTargetsPoint(row.copy(x = .8, points = 10), "csv")!!.x, 0.0)
        assertNull(myTargetsPoint(row.copy(x = 0.0, y = 0.0, points = 10), "csv"))
    }
}

package app.fableshot.android

import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.DiaryRuntime
import app.fableshot.android.data.journal.JournalShot
import app.fableshot.android.data.journal.verifiedTarget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.UUID

/** Optional real-export rehearsal. Receives verified copies, and never opens the installed diary. */
class MyTargetsDiaryCopyTest {
    @Test fun copiedDiaryUpgradePreservesEveryScoreAndNativeTraining() = runBlocking(Dispatchers.IO) {
        val args = InstrumentationRegistry.getArguments()
        val name = args.getString("mytargetsCopy")
        assumeTrue("A verified copy is supplied explicitly for this integration check", name != null)
        require(name!!.matches(Regex("[a-zA-Z0-9-]+")))
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.cacheDir, "mytargets-copy-$name")
        require(directory.canonicalFile.parentFile == context.cacheDir.canonicalFile)
        require(File(directory, "journal.db").isFile && File(directory, "equipment.db").isFile)
        val runtime = DiaryRuntime(context, UUID.randomUUID().toString(), directory)
        try {
            // Read through Room before invoking the upgrade so preservation is checked independently.
            val before = runtime.repository.journal.history.first()
            assertTrue(before.any { it.session.sourceKind == "mytargets" })
            val allScores = before.flatMap { it.allShots }.associate { it.id to it.protectedScore() }
            val native = before.filter { it.session.sourceKind != "mytargets" }
            runtime.warmUp()
            runtime.importer.normalizeImportedTargets()
            val after = runtime.repository.journal.history.first()
            assertEquals(before.map { it.session }.toSet(), after.map { it.session }.toSet())
            assertEquals(allScores, after.flatMap { it.allShots }.associate { it.id to it.protectedScore() })
            assertEquals(native.toSet(), after.filter { it.session.sourceKind != "mytargets" }.toSet())
            assertTrue(after.filter { it.session.sourceKind == "mytargets" }.flatMap { it.blocks }
                .any { it.block.verifiedTarget() != null })
            assertTrue(after.flatMap { it.allShots }.count { it.positionStatus == "known" } >
                before.flatMap { it.allShots }.count { it.positionStatus == "known" })
            assertEquals(0, runtime.importer.normalizeImportedTargets())
            runtime.journal.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use { assertFalse(it.moveToFirst()) }
        } finally { runtime.close() }
    }
}

private fun JournalShot.protectedScore(): List<Any?> =
    listOf(id, endId, inputIndex, points, zoneCode, automaticPoints, automaticRuleVersion,
        scoreSource, physicalArrowNumber, createdAtMs, updatedAtMs, revision)

package app.fableshot.android

import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.DiaryRuntime
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.UUID

class VerificationSamplesTest {
    @Test fun reviewExamplesAreCompleteIdempotentAndKeepExistingDiaryRows() = runBlocking(Dispatchers.IO) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "verification-samples-" + UUID.randomUUID()).apply { mkdirs() }
        val runtime = DiaryRuntime(context, UUID.randomUUID().toString(), folder)
        try {
            runtime.warmUp()
            val own = (runtime.repository.journal.start("Моя тренировка", BlockPlan(18.0, 400)) as JournalWrite.Saved).sessionId
            val before = runtime.repository.journal.details(own)
            seedVerificationDiary(runtime, updateOnly = true)
            assertTrue(runtime.repository.journal.history.first().none { it.session.title.startsWith("Демо ·") })
            seedVerificationDiary(runtime)
            val first = runtime.repository.journal.history.first()
            val demos = first.filter { it.session.title.startsWith("Демо ·") }
            assertEquals(7, demos.size)
            val dates = demos.map { LocalDate.parse(it.session.localDate) }.sorted()
            assertEquals(7, dates.distinct().size)
            assertEquals(41L, ChronoUnit.DAYS.between(dates.first(), dates.last()))
            assertEquals(360, demos.sumOf { it.allShots.size })
            assertEquals(before, runtime.repository.journal.details(own))
            assertTrue(demos.all { it.session.state == "completed" })
            assertTrue(demos.filter { it.currentBlock!!.block.mode == "scored" }
                .all { it.numberedArrowsEnabled(it.currentBlock!!.block) })
            assertEquals(45, demos.single { it.session.title.contains("без оценки") }.blocks.sumOf { it.ends.sumOf { end -> end.volume } })
            val sample = demos.single { it.session.title.contains("пять рядом") }
            val analysis = physicalArrowAnalysis(listOf(sample)).single()
            assertEquals(6, analysis.arrows.size)
            assertTrue(analysis.arrows.single { it.number == 6 }.centerOffsetMm!! >
                analysis.arrows.filter { it.number != 6 }.maxOf { it.centerOffsetMm!! } + 50)
            assertTrue(demos.any { it.blocks.single().baselines.singleOrNull()?.status == "ready" })
            assertEquals(1, runtime.journal.achievementDao().enrollments().size)
            seedVerificationDiary(runtime)
            assertEquals(first, runtime.repository.journal.history.first())
            runtime.journal.openHelper.writableDatabase.query("PRAGMA foreign_key_check").use { assertFalse(it.moveToFirst()) }
        } finally {
            runtime.close()
            check(folder.canonicalFile.parentFile == context.cacheDir.canonicalFile)
            folder.deleteRecursively()
        }
    }
}

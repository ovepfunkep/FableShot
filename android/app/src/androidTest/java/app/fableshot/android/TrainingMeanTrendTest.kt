package app.fableshot.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import android.graphics.Bitmap

class TrainingMeanTrendTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    private fun fixture(): JournalDetails {
        val session = JournalSession("mean-session", "Все раунды", 1, 1, state = "completed")
        fun block(id: String, ordinal: Int, distance: Double, mode: String = "scored") =
            JournalBlock(id, session.id, ordinal, mode, distance, PRACTICE_PROFILE, 1, 400,
                practiceSnapshot(400), null, 3)
        fun end(block: JournalBlock, ordinal: Int, scores: List<Int>, role: String = "scored", count: Int? = null): JournalEndDetails {
            val id = "${block.id}-end-$ordinal"
            val shots = scores.mapIndexed { index, score ->
                JournalShot("$id-shot-$index", id, index, score, if (score == 0) "M" else score.toString(),
                    null, null, null, null, null, "numeric_entry", "none", "unknown", null, 1)
            }
            return JournalEndDetails(JournalEnd(id, block.id, ordinal, 3, role, "closed"), shots,
                count?.let { listOf(JournalCount(id, it, 1, 1)) } ?: emptyList())
        }
        val first = block("start", 0, 18.0)
        val countOnly = block("counts", 1, 18.0, "count_only")
        val last = block("finish", 2, 30.0)
        return JournalDetails(session, listOf(
            JournalBlockDetails(first, listOf(end(first, 0, listOf(10, 0)), end(first, 1, listOf(10, 10, 10), "warmup"))),
            JournalBlockDetails(countOnly, listOf(end(countOnly, 0, emptyList(), count = 3))),
            JournalBlockDetails(last, listOf(end(last, 0, listOf(9, 9, 9)), end(last, 1, emptyList()))),
        ), listOf(SessionPlan(session.id, 4, 2)))
    }

    @Test fun meansUseActualArrowsAndKeepRoundBoundariesAndCountOnlyGaps() {
        val details = fixture()
        val points = trainingMeanTrendPoints(details)
        assertEquals(2, points.size)
        assertEquals(listOf(5.0, 9.0), points.map { it.mean })
        assertEquals(listOf(2, 3), points.map { it.enteredCount })
        assertEquals(listOf(1 to 1, 2 to 1), points.map { it.round to it.series })
        assertNotEquals(points.first().segment, points.last().segment)
        assertEquals(listOf(0, 2), points.map { it.chronology })
        val unknownTarget = details.copy(blocks = details.blocks.map { block ->
            block.copy(block = block.block.copy(targetProfileId = "unverified-source", targetSnapshotJson = "{}"))
        })
        assertEquals(listOf(5.0, 9.0), trainingMeanTrendPoints(unknownTarget).map { it.mean })
    }

    @Test fun tappingSelectsARealSeriesAndLeavesTheSummaryAreaStable() {
        val details = fixture()
        ui.setContent { FableTheme(UserSettings(animations = false)) { Surface { TrainingMeanTrendCard(details) } } }
        ui.onNodeWithTag("training-mean-value").assertTextEquals("9,0")
        val height = ui.onNodeWithTag("training-mean-selection").fetchSemanticsNode().boundsInRoot.height
        val chart = ui.onNodeWithTag("training-mean-chart").fetchSemanticsNode().boundsInRoot
        val previous = ui.onNodeWithTag("training-mean-prev").fetchSemanticsNode().boundsInRoot
        val next = ui.onNodeWithTag("training-mean-next").fetchSemanticsNode().boundsInRoot
        assertTrue(previous.right <= chart.left)
        assertTrue(next.left >= chart.right)
        assertEquals(chart.center.y, previous.center.y, 1f)
        assertEquals(chart.center.y, next.center.y, 1f)
        ui.onNodeWithTag("training-mean-chart").performTouchInput { click(Offset(12f, centerY)) }
        ui.onNodeWithTag("training-mean-value").assertTextEquals("5,0")
        ui.onNodeWithTag("training-mean-count").assertTextEquals("2")
        ui.onNodeWithTag("training-mean-series").assertTextEquals("Раунд 1 · серия 1")
        ui.onAllNodesWithText("Раунд 1 · серия 1").assertCountEquals(1)
        ui.onAllNodesWithContentDescription("О графике среднего балла").assertCountEquals(1)
        assertEquals(height, ui.onNodeWithTag("training-mean-selection").fetchSemanticsNode().boundsInRoot.height, 1f)
        ui.onNodeWithTag("training-mean-next").performClick()
        ui.onNodeWithTag("training-mean-series").assertTextEquals("Раунд 2 · серия 1")
        capture("mean-normal.png")
    }

    @Test fun reportScopeSelectionDoesNotFilterTheWholeTrainingChartAtLargeFont() {
        val details = fixture()
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                FableTheme(UserSettings(animations = false)) {
                    Surface(Modifier.fillMaxSize()) { JournalReportScreen(details) }
                }
            }
        }
        fun chart() = ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("training-mean-chart"))
        chart()
        ui.onNodeWithTag("training-mean-chart").assertContentDescriptionEquals("Средний балл всех зачётных серий, шкала от 0 до 10")
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("report-block-0"))
        ui.onNodeWithTag("report-block-0").performClick()
        chart()
        ui.onNodeWithTag("training-mean-chart").performTouchInput { click(Offset(12f, centerY)) }
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("training-mean-value"))
        ui.onNodeWithTag("training-mean-value").assertTextEquals("5,0")
        ui.onNodeWithTag("training-mean-next").performScrollTo().assertIsDisplayed().performClick()
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("training-mean-value"))
        ui.onNodeWithTag("training-mean-value").assertTextEquals("9,0")
        capture("mean-large-font.png")
    }

    @Test fun emptyChartKeepsOneHeadingHelpWithoutEmptySelectionControls() {
        val source = fixture()
        val empty = source.copy(blocks = source.blocks.map { block ->
            block.copy(ends = block.ends.map { it.copy(shots = emptyList()) })
        })
        ui.setContent { FableTheme(UserSettings(animations = false)) { Surface { TrainingMeanTrendCard(empty) } } }
        ui.onNodeWithTag("training-mean-empty").assertExists()
        ui.onNodeWithTag("training-mean-chart").assertDoesNotExist()
        ui.onNodeWithTag("training-mean-selection").assertDoesNotExist()
        ui.onAllNodesWithContentDescription("О графике среднего балла").assertCountEquals(1)
        ui.onNodeWithContentDescription("О графике среднего балла").performClick()
        ui.onNodeWithText("Каждая точка — серия, включая неполную.", substring = true).assertExists()
    }

    private fun capture(name: String) {
        val directory = requireNotNull(ui.activity.getExternalFilesDir("verification"))
        directory.mkdirs()
        File(directory, name).outputStream().use {
            ui.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}

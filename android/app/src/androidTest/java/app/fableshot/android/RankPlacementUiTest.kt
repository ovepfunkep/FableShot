package app.fableshot.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.equipmentSnapshot
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Normal-width render fixtures only; no diary, database or persistent settings are opened. */
class RankPlacementUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val width = mutableStateOf(360f)
    private val disabled = mutableStateOf(emptySet<String>())
    private val hidden = mutableStateOf(false)
    private var roundSelections = 0
    private var seriesSelections = 0

    @Before fun requireUnlockedFocusedActivity() {
        assertFalse("Unlock the device before UI verification",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    private fun fixture(): JournalDetails {
        val bow = EquipmentItem(id = "placement-bow", kind = "bow", name = "Fixture", category = "recurve")
        val profile = TargetCatalog.indoor
        val block = JournalBlock("block", "session", 0, "scored", 18.0, profile.id, 1, 400,
            profile.snapshot(400), equipmentSnapshot(bow, listOf(bow)), 3)
        val ends = listOf(10, 9).mapIndexed { number, points ->
            val end = JournalEnd("e$number", "block", number, 3, state = "closed")
            JournalEndDetails(end, (0..2).map { input ->
                JournalShot("shot$number-$input", end.id, input, points, "$points", null, null,
                    null, null, null, "numeric_entry", "none", "unknown", null, 1_000)
            }, emptyList())
        }
        return JournalDetails(JournalSession("session", "Fixture", 1_000, 1_000),
            listOf(JournalBlockDetails(block, ends)),
            listOf(SessionPlan("session", 0, rolling = true, roundArrowLimit = 30)))
    }

    private fun mountSummary() {
        val details = fixture()
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1f),
                LocalRankPreferences provides RankPreferences("male")) {
                FableTheme(UserSettings(animations = false, disabledStatistics = disabled.value)) {
                    Surface(Modifier.requiredWidth(width.value.dp).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing)) {
                        Column {
                            TrainingSummary(
                                round = TrainingSummaryMetric("1", "57/60", "9,5", "300/300"),
                                series = TrainingSummaryMetric("2", "27/30", "9,0", "30/30"),
                                hideScores = hidden.value,
                                onRounds = { roundSelections++ }, onSeries = { seriesSelections++ },
                                roundRank = { StageRankBadge(details, details.roundRank("male", "e1"), tag = "placement-round-rank") },
                                seriesRank = { StageRankBadge(details, details.seriesRank("male", "e1"), tag = "placement-series-rank") },
                            )
                        }
                    }
                }
            }
        }
    }

    private fun capture(tag: String, name: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.getExternalFilesDir("verification"), "rank-placement")
        check(folder.mkdirs() || folder.isDirectory)
        File(folder, name).outputStream().use { output ->
            assertTrue(ui.onNodeWithTag(tag).captureToImage().asAndroidBitmap()
                .compress(Bitmap.CompressFormat.PNG, 100, output))
        }
    }

    private fun assertRankBesideMetrics(metricTag: String, rankTag: String) {
        val score = ui.onNodeWithTag("$metricTag-score", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val average = ui.onNodeWithTag("$metricTag-average", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val rank = ui.onNodeWithTag(rankTag, useUnmergedTree = true).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        assertTrue("Rank must sit to the right of the points", rank.left >= score.right)
        assertTrue("Rank must share the vertical band occupied by points and average", rank.top < score.bottom)
        assertTrue("Rank must overlap the average row", rank.bottom > average.top)
        assertEquals("Rank must not create another row below the average", average.bottom, rank.bottom, 1f)
        val level = ui.onNodeWithTag("$rankTag-level", useUnmergedTree = true).assertTextEquals("I").fetchSemanticsNode().boundsInRoot
        val category = ui.onNodeWithTag("$rankTag-class", useUnmergedTree = true).assertTextEquals("КЛ(М)").fetchSemanticsNode().boundsInRoot
        assertTrue("Level and class occupy two compact lines", level.bottom <= category.top + 1f)
    }

    @Test fun bothNormalWidthsKeepRankInTheMetricCornerWithoutAddingHeight() {
        mountSummary()
        for (normalWidth in listOf(360f, 400f)) {
            ui.runOnIdle { width.value = normalWidth; disabled.value = emptySet() }
            ui.onNodeWithTag("training-summary-cards").assertExists()
            assertRankBesideMetrics("round", "placement-round-rank")
            assertRankBesideMetrics("end", "placement-series-rank")
            val withRanks = ui.onNodeWithTag("training-summary").fetchSemanticsNode().boundsInRoot
            capture("training-summary", "summary-${normalWidth.toInt()}.png")
            ui.runOnIdle { disabled.value = setOf(StatisticFeature.Norms.wire) }
            ui.onNodeWithTag("placement-round-rank", useUnmergedTree = true).assertDoesNotExist()
            ui.onNodeWithTag("placement-series-rank", useUnmergedTree = true).assertDoesNotExist()
            val withoutRanks = ui.onNodeWithTag("training-summary").fetchSemanticsNode().boundsInRoot
            assertEquals("Embedded rank must not add a separate strip", withoutRanks.height, withRanks.height, 1f)
        }
    }

    @Test fun rankRemainsAnIndependentActionAndRespectsHiddenScoresAndStatisticFlags() {
        mountSummary()
        ui.onNodeWithTag("placement-round-rank", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("rank-sheet").assertExists()
        ui.onNodeWithText("57 очков · 6 из 30 стрел").assertExists()
        ui.runOnIdle { assertEquals(0, roundSelections); assertEquals(0, seriesSelections) }
        dismissTestSheet(ui)
        ui.onNodeWithTag("placement-series-rank", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("rank-sheet").assertExists()
        ui.onNodeWithText("27 очков · 3 из 30 стрел").assertExists()
        ui.runOnIdle { assertEquals(0, roundSelections); assertEquals(0, seriesSelections) }
        dismissTestSheet(ui)
        ui.onNodeWithTag("training-rounds-open").performClick()
        ui.onNodeWithTag("training-series-open").performClick()
        ui.runOnIdle { assertEquals(1, roundSelections); assertEquals(1, seriesSelections) }

        ui.runOnIdle { disabled.value = setOf(StatisticFeature.Result.wire) }
        ui.onNodeWithTag("round-score", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("round-average", useUnmergedTree = true).assertExists()
        ui.onNodeWithTag("placement-round-rank", useUnmergedTree = true).assertExists()
        ui.runOnIdle { disabled.value = setOf(StatisticFeature.Average.wire) }
        ui.onNodeWithTag("round-score", useUnmergedTree = true).assertExists()
        ui.onNodeWithTag("round-average", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("placement-round-rank", useUnmergedTree = true).assertExists()
        ui.runOnIdle { hidden.value = true; disabled.value = emptySet() }
        ui.onNodeWithTag("round-score", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("round-average", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("placement-round-rank", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("placement-series-rank", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("training-rounds-open").assertHasClickAction()
        ui.onNodeWithTag("training-series-open").assertHasClickAction()
    }

    @Test fun roundReportKeepsCaptionAndRankOnTheSameHeaderRow() {
        val details = fixture()
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1f),
                LocalRankPreferences provides RankPreferences("male")) {
                FableTheme(UserSettings(animations = false, disabledStatistics = disabled.value)) {
                    Surface(Modifier.requiredWidth(width.value.dp).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing)) {
                        LazyColumn(Modifier.fillMaxSize().testTag("placement-report"), contentPadding = PaddingValues(20.dp)) {
                            journalReportOverview(details, onEnd = {}, canEditShots = false, canEditCounts = false)
                        }
                    }
                }
            }
        }
        for (normalWidth in listOf(360f, 400f)) {
            ui.runOnIdle { width.value = normalWidth }
            ui.onNodeWithTag("placement-report").performScrollToNode(hasTestTag("report-round-1"))
            val caption = ui.onNodeWithTag("report-round-total-1").fetchSemanticsNode().boundsInRoot
            val rank = ui.onNodeWithTag("report-round-rank-1", useUnmergedTree = true).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
            assertTrue("The rank belongs beside the round caption", rank.left >= caption.right)
            assertEquals("Caption and rank share one header row", caption.center.y, rank.center.y, 1f)
            capture("placement-report", "report-${normalWidth.toInt()}.png")
        }
        ui.onNodeWithTag("report-round-rank-1", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("rank-sheet").assertExists()
        ui.onNodeWithText("57 очков · 6 из 30 стрел").assertExists()
        dismissTestSheet(ui)
        ui.runOnIdle { disabled.value = setOf(StatisticFeature.Norms.wire) }
        ui.onNodeWithTag("report-round-rank-1", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("report-round-total-1").assertTextContains("57/60", substring = true)
    }
}

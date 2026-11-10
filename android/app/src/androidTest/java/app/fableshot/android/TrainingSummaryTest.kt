package app.fableshot.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Render-only fixtures: never opens the personal diary or changes device display settings. */
class TrainingSummaryTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val configuration = mutableStateOf(360f to 1f)
    private val hidden = mutableStateOf(false)
    private val filled = mutableStateOf(false)
    private val disabledStatistics = mutableStateOf(emptySet<String>())
    private var openedRounds = 0
    private var openedSeries = 0

    private fun details(): JournalDetails {
        val id = "summary-fixture"
        val bow = EquipmentItem(id = "summary-bow", kind = "bow", name = "Fixture", category = "barebow")
        val block = JournalBlock("summary-block", id, 0, "scored", 18.0, "wa-indoor-outer-v1", 1, 400,
            null, equipmentSnapshot(bow, listOf(bow)), 3)
        val end = JournalEnd("summary-end", block.id, 0, 3)
        val shots = if (!filled.value) emptyList() else (0..2).map { index ->
            JournalShot("summary-shot-$index", end.id, index, 9, "9", null, null, .15, 0.0,
                "main", "target_computed", "manual_target", "known", null, 1793685600000)
        }
        return JournalDetails(JournalSession(id, "Fixture", 1793685600000, 1793685600000, state = "active"),
            listOf(JournalBlockDetails(block, listOf(JournalEndDetails(end, shots, emptyList())))),
            plans = listOf(SessionPlan(id, 20, 2)))
    }

    private fun mount() {
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, configuration.value.second),
                LocalRankPreferences provides RankPreferences("male")) {
                FableTheme(UserSettings(animations = false, disabledStatistics = disabledStatistics.value)) {
                    Surface(Modifier.requiredWidth(configuration.value.first.dp).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing)) {
                        Column {
                            TrainingSummary(
                                TrainingSummaryMetric("1/2", if (filled.value) "211/300" else "0/300", if (filled.value) "7,0" else "—", "300/300"),
                                TrainingSummaryMetric("1/10", if (filled.value) "27/30" else "0/30", if (filled.value) "9,0" else "—", "30/30"),
                                hidden.value,
                                onRounds = { openedRounds++ },
                                onSeries = { openedSeries++ },
                            ) { column -> SportRankPanel(details(), compact = true, summaryColumn = column) }
                        }
                    }
                }
            }
        }
    }

    private fun capture(name: String) {
        ui.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val folder = File(instrumentation.targetContext.getExternalFilesDir("verification"), "achievements-v171").apply { mkdirs() }
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            File(folder, name).outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        } finally { bitmap.recycle() }
    }

    private fun assertTextFits(text: String) {
        val layouts = mutableListOf<TextLayoutResult>()
        val node = hasText(text) and SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult)
        ui.onAllNodes(node, useUnmergedTree = true)[0].performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertTrue("Text must retain its readable size and fit: $text", layouts.isNotEmpty())
        assertTrue("Text clipped at large font: $text config=${configuration.value}, summary=" +
            ui.onNodeWithTag("training-summary").fetchSemanticsNode().boundsInRoot + " " +
            layouts.joinToString { "size=${it.size}, paragraph=${it.multiParagraph.width}x${it.multiParagraph.height}, lines=${it.lineCount}, " +
                "right=${it.getLineRight(0)}, bottom=${it.getLineBottom(0)}, constraints=${it.layoutInput.constraints}, " +
                "font=${it.layoutInput.style.fontSize}/${it.layoutInput.style.lineHeight}, width=${it.didOverflowWidth}, height=${it.didOverflowHeight}" },
            layouts.all { !it.didOverflowWidth && !it.didOverflowHeight })
    }

    @Test fun twoCardsAndRankRowKeepTheirGridWhenScoresAndRankChange() {
        mount()
        ui.onNodeWithTag("training-summary-cards").assertExists()
        val before = ui.onNodeWithTag("training-summary").fetchSemanticsNode().boundsInRoot
        ui.runOnIdle { filled.value = true }
        val after = ui.onNodeWithTag("training-summary").fetchSemanticsNode().boundsInRoot
        assertEquals(before, after)
        val round = ui.onNodeWithTag("round-score", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val series = ui.onNodeWithTag("end-score", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val rank = ui.onNodeWithTag("rank-level", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue(round.right < series.left)
        assertEquals(round.top, series.top, .5f)
        assertTrue(rank.top >= series.bottom)
        capture("summary-standard.png")
        ui.onNodeWithTag("rank-details").performClick()
        ui.onNodeWithTag("rank-sheet").assertExists()
        ui.onNodeWithTag("open-rank-grid").performScrollTo().performClick()
        ui.onNodeWithText("Разрядная сетка").assertExists()
    }

    @org.junit.Ignore("Иван 10.11: экстремальный системный масштаб исключён из поддержки и критериев готовности")
    @Test fun narrowLargeTextStacksRankWithoutShrinkingOrClippingData() {
        configuration.value = 280f to 1.5f
        filled.value = true
        mount()
        for (scale in listOf(1.5f, 2f)) {
            ui.runOnIdle { configuration.value = 280f to scale }
            ui.onNodeWithTag("training-summary-stacked").assertExists()
            capture("summary-280-font${(scale * 100).toInt()}.png")
            for (text in listOf("Раунд", "Серия", "211/300", "27/30", "7,0", "9,0")) assertTextFits(text)
            ui.onNodeWithTag("rank-details").assertIsDisplayed()
        }
    }

    @Test fun explicitHideRemovesResultsLabelsAndSemanticsAndReleasesSpace() {
        filled.value = true
        mount()
        val before = ui.onNodeWithTag("training-summary").fetchSemanticsNode().boundsInRoot
        ui.runOnIdle { hidden.value = true }
        val after = ui.onNodeWithTag("training-summary").fetchSemanticsNode().boundsInRoot
        assertTrue(after.height < before.height)
        ui.onNodeWithTag("round-number", useUnmergedTree = true).assertTextEquals("1/2")
        ui.onNodeWithTag("end-number", useUnmergedTree = true).assertTextEquals("1/10")
        for (tag in listOf("round-score", "round-average", "end-score", "end-average", "rank-details"))
            ui.onNodeWithTag(tag, useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithText("Средний").assertDoesNotExist()
    }

    @Test fun statisticFlagsHideScoreAverageAndNormsIndependently() {
        filled.value = true
        mount()
        ui.runOnIdle {
            disabledStatistics.value = setOf(StatisticFeature.Result.wire, StatisticFeature.Norms.wire)
        }
        ui.onNodeWithTag("end-score", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("end-average", useUnmergedTree = true).assertTextEquals("Средний 9,0")
        ui.onNodeWithTag("rank-details", useUnmergedTree = true).assertDoesNotExist()

        ui.runOnIdle { disabledStatistics.value = setOf(StatisticFeature.Average.wire) }
        ui.onNodeWithTag("end-score", useUnmergedTree = true).assertTextEquals("27/30")
        ui.onNodeWithTag("end-average", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("rank-details", useUnmergedTree = true).assertExists()

        ui.runOnIdle {
            disabledStatistics.value = setOf(StatisticFeature.Result.wire, StatisticFeature.Average.wire, StatisticFeature.Norms.wire)
        }
        ui.onNodeWithTag("training-summary-cards").assertDoesNotExist()
        ui.onNodeWithTag("round-number", useUnmergedTree = true).assertTextEquals("1/2")
        ui.onNodeWithTag("end-number", useUnmergedTree = true).assertTextEquals("1/10")
        ui.onNodeWithTag("rank-details", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun roundAndSeriesTilesKeepSeparateActionsInNormalLargeAndHiddenLayouts() {
        mount()
        for ((width, scale) in listOf(360f to 1f, 280f to 2f)) {
            ui.runOnIdle { configuration.value = width to scale }
            for (scoresHidden in listOf(false, true)) {
                ui.runOnIdle { hidden.value = scoresHidden }
                val roundsBefore = openedRounds
                val seriesBefore = openedSeries
                ui.onNodeWithTag("training-rounds-open").assertHasClickAction().performClick()
                ui.runOnIdle {
                    assertEquals(roundsBefore + 1, openedRounds)
                    assertEquals(seriesBefore, openedSeries)
                }
                ui.onNodeWithTag("training-series-open").assertHasClickAction().performClick()
                ui.runOnIdle { assertEquals(seriesBefore + 1, openedSeries) }
            }
        }
    }
}

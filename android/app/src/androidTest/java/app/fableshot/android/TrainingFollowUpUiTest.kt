package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.HabitualTraining
import app.fableshot.android.data.equipmentSnapshot
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Compose-only fixtures. No repository, preferences store or installed diary is opened. */
class TrainingFollowUpUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Before fun requireUnlockedFocusedActivity() {
        assertFalse("Unlock the device before running UI verification",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    private fun openOptions() {
        ui.onNodeWithTag("conditions-options").performScrollTo().performClick()
        ui.onNodeWithTag("conditions-options-sheet").assertExists()
    }

    private fun closeOptions() {
        ui.onNodeWithTag("conditions-options-done").performScrollTo().performClick()
        ui.onNodeWithTag("conditions-options-sheet").assertDoesNotExist()
    }

    private fun assertPlan(plan: BlockPlan, arrows: Int? = null, series: Int? = null) {
        assertTrue(plan.valid())
        assertTrue(plan.flexibleSeries)
        assertNull(plan.plannedEnds)
        assertEquals(1, plan.roundCount)
        assertEquals(3, plan.arrows)
        assertEquals(arrows, plan.roundArrowLimit)
        assertEquals(series, plan.seriesPerRound)
    }

    @Test fun newConditionsDefaultToThirtyArrowsAndSaveEverySelectedLimitMode() {
        val outputs = mutableListOf<BlockPlan>()
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                JournalSetupScreen(busy = false) { _, plan -> outputs += plan }
            }
        } }
        ui.onNodeWithTag("conditions-options").assertTextContains("30 стрел", substring = true)
        ui.onNodeWithTag("distance-18").performScrollTo().performClick()
        ui.onNodeWithTag("diameter-40").performScrollTo().performClick()
        ui.onNodeWithTag("start-training").assertIsDisplayed().assertIsEnabled().performClick()
        ui.runOnIdle { assertPlan(outputs.single(), arrows = 30) }

        openOptions()
        ui.onNodeWithTag("volume-arrows").performScrollTo().assertIsSelected()
        ui.onNodeWithTag("round-arrows-field").assertTextContains("30")
        ui.onNodeWithTag("round-arrows-60").performScrollTo().performClick().assertIsSelected()
        closeOptions()
        ui.onNodeWithTag("conditions-options").assertTextContains("60 стрел", substring = true)
        ui.onNodeWithTag("start-training").performClick()
        ui.runOnIdle { assertPlan(outputs.last(), arrows = 60) }

        openOptions()
        ui.onNodeWithTag("volume-fixed").performScrollTo().performClick().assertIsSelected()
        ui.onNodeWithTag("volume-ends").performScrollTo().performTextReplacement("7")
        ui.onNodeWithTag("round-arrows-field").assertDoesNotExist()
        closeOptions()
        ui.onNodeWithTag("conditions-options").assertTextContains("7 серий", substring = true)
        ui.onNodeWithTag("start-training").performClick()
        ui.runOnIdle { assertPlan(outputs.last(), series = 7) }

        openOptions()
        ui.onNodeWithTag("volume-free").performScrollTo().performClick().assertIsSelected()
        ui.onNodeWithTag("volume-ends").assertDoesNotExist()
        ui.onNodeWithTag("round-arrows-field").assertDoesNotExist()
        closeOptions()
        ui.onNodeWithTag("conditions-options").assertTextContains("Без ограничения", substring = true)
        ui.onNodeWithTag("start-training").performClick()
        ui.runOnIdle {
            assertEquals(4, outputs.size)
            assertPlan(outputs.last())
        }

        // Switching units preserves each entered choice without leaking the other limit into BlockPlan.
        openOptions()
        ui.onNodeWithTag("volume-arrows").performScrollTo().performClick()
        ui.onNodeWithTag("round-arrows-field").assertTextContains("60")
        ui.onNodeWithTag("volume-fixed").performScrollTo().performClick()
        ui.onNodeWithTag("volume-ends").assertTextContains("7")
    }

    @Test fun existingSeriesAndArrowPlansKeepTheirSavedModeWhenReopened() {
        val source = mutableStateOf(HabitualTraining.block(BlockPlan(18.0, 400)).copy(id = "old-series"))
        val savedArrows = mutableStateOf<Int?>(null)
        var result: BlockPlan? = null
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                JournalSetupScreen(false, initial = source.value, newSession = true,
                    initialSeriesPerRound = 10, initialRoundArrowLimit = savedArrows.value,
                ) { _, plan -> result = plan }
            }
        } }
        ui.onNodeWithTag("conditions-options").assertTextContains("10 серий", substring = true)
        ui.onNodeWithTag("start-training").assertIsEnabled().performClick()
        ui.runOnIdle { assertPlan(requireNotNull(result), series = 10) }
        ui.runOnIdle {
            savedArrows.value = 60
            source.value = source.value.copy(id = "saved-arrow-plan")
        }
        ui.onNodeWithTag("conditions-options").assertTextContains("60 стрел", substring = true)
        openOptions()
        ui.onNodeWithTag("volume-arrows").performScrollTo().assertIsSelected()
        closeOptions()
        ui.onNodeWithTag("start-training").performClick()
        ui.runOnIdle { assertPlan(requireNotNull(result), arrows = 60) }
    }

    private fun rankFixture(): JournalDetails {
        val bow = EquipmentItem(id = "fixture-bow", kind = "bow", name = "Fixture", category = "recurve")
        val target = TargetCatalog.indoor
        val block = JournalBlock("block", "session", 0, "scored", 18.0, target.id, 1, 400,
            target.snapshot(400), equipmentSnapshot(bow, listOf(bow)), 3)
        val ends = listOf(10, 4, 8, 8).mapIndexed { number, points ->
            val end = JournalEnd("e$number", block.id, number, 3, state = "closed",
                revision = 11L + number, startsRound = number == 2)
            JournalEndDetails(end, (0..2).map { input ->
                JournalShot("shot$number-$input", end.id, input, points, "$points", null, null,
                    null, null, null, "numeric_entry", "none", "unknown", null, 1_000)
            }, emptyList())
        }
        return JournalDetails(JournalSession("session", "Fixture", 1_000, 1_000, revision = 7),
            listOf(JournalBlockDetails(block, ends)),
            listOf(SessionPlan("session", 0, rolling = true, roundArrowLimit = 30)))
    }

    private fun mountRanks(width: Float = 360f, fontScale: Float = 1f): JournalDetails {
        val details = rankFixture()
        val selected = mutableStateOf("e0")
        val roundsOpen = mutableStateOf(false)
        val seriesOpen = mutableStateOf(false)
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale),
                LocalRankPreferences provides RankPreferences("male")) {
                FableTheme(UserSettings(animations = false)) {
                    Surface(Modifier.requiredWidth(width.dp).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing)) {
                        Column {
                            val progress = details.roundProgress(selected.value)
                            val end = progress.ends.first { it.end.id == selected.value }
                            val roundShots = progress.ends.flatMap { it.shots }
                            val roundPoints = roundShots.sumOf { it.points }
                            val seriesPoints = end.shots.sumOf { it.points }
                            TrainingSummary(
                                round = TrainingSummaryMetric(progress.number.toString(), "$roundPoints/${roundShots.size * 10}",
                                    averageNumber(roundPoints.toDouble() / roundShots.size), "300/300"),
                                series = TrainingSummaryMetric(progress.seriesNumber.toString(), "$seriesPoints/30",
                                    averageNumber(seriesPoints.toDouble() / end.shots.size), "30/30"),
                                hideScores = false, onRounds = { roundsOpen.value = true },
                                onSeries = { seriesOpen.value = true },
                                roundRank = { StageRankBadge(details, details.roundRank("male", selected.value),
                                    Modifier.fillMaxWidth(), tag = "follow-up-round-rank") },
                                seriesRank = { StageRankBadge(details, details.seriesRank("male", selected.value),
                                    Modifier.fillMaxWidth(), tag = "follow-up-series-rank") },
                            )
                        }
                        if (roundsOpen.value) TrainingRoundsSheet(details, false,
                            onDismiss = { roundsOpen.value = false }, onSelectEnd = { selected.value = it },
                            onNewRound = {}, allowNewRound = false)
                        if (seriesOpen.value) TrainingSeriesSheet(details, selected.value, false,
                            onDismiss = { seriesOpen.value = false }, onSelectEnd = { selected.value = it })
                    }
                }
            }
        }
        return details
    }

    private fun assertRanks(roundNumber: Int, round: String, seriesNumber: Int, series: String) {
        ui.onNodeWithTag("follow-up-round-rank", useUnmergedTree = true).assertIsDisplayed()
            .assertContentDescriptionEquals("Раунд $roundNumber: прогноз разряда $round (КЛ(М))")
        ui.onNodeWithTag("follow-up-series-rank", useUnmergedTree = true).assertIsDisplayed()
            .assertContentDescriptionEquals("Серия $seriesNumber: прогноз разряда $series (КЛ(М))")
    }

    @Test fun roundAndSeriesRanksUseSeparateSamplesAndSurviveRealSelectorChanges() {
        val details = mountRanks()
        val initialShots = details.allShots
        assertRanks(1, "I юн.", 1, "I")
        ui.onNodeWithTag("follow-up-series-rank", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("training-series-sheet").assertDoesNotExist()
        ui.onNodeWithTag("rank-sheet").assertExists()
        ui.onNodeWithText("30 очков · 3 из 30 стрел").assertExists()
        dismissTestSheet(ui)
        ui.onNodeWithTag("follow-up-round-rank", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("training-rounds-sheet").assertDoesNotExist()
        ui.onNodeWithTag("rank-sheet").assertExists()
        ui.onNodeWithText("42 очков · 6 из 30 стрел").assertExists()
        dismissTestSheet(ui)

        ui.onNodeWithTag("training-series-open").performClick()
        ui.onNodeWithTag("training-select-series-2").performClick()
        assertRanks(1, "I юн.", 2, "ниже порога")
        ui.onNodeWithTag("training-rounds-open").performClick()
        ui.onNodeWithTag("training-round-2").performClick()
        assertRanks(2, "II", 2, "II")
        ui.onNodeWithTag("training-rounds-open").performClick()
        ui.onNodeWithTag("training-round-1").performClick()
        assertRanks(1, "I юн.", 2, "ниже порога")
        ui.onNodeWithTag("training-series-open").performClick()
        ui.onNodeWithTag("training-select-series-1").performClick()
        assertRanks(1, "I юн.", 1, "I")
        ui.runOnIdle { assertEquals(initialShots, details.allShots) }
    }

    @org.junit.Ignore("Иван 10.11: экстремальный системный масштаб исключён из поддержки и критериев готовности")
    @Test fun rankBadgesRemainInsideTheirTilesAtNarrowLargeFont() {
        mountRanks(width = 280f, fontScale = 2f)
        ui.onNodeWithTag("training-summary-stacked").assertExists()
        assertRanks(1, "I юн.", 1, "I")
        val round = ui.onNodeWithTag("follow-up-round-rank", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val series = ui.onNodeWithTag("follow-up-series-rank", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("Each rank belongs to its own stacked tile", round.bottom <= series.top)
        ui.onNodeWithTag("follow-up-series-rank", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("rank-sheet").assertExists()
        ui.onNodeWithTag("training-series-sheet").assertDoesNotExist()
    }

    @Test fun removingSeriesRequiresConfirmationAndPassesItsOwnRevision() {
        val details = rankFixture()
        val open = mutableStateOf(true)
        val removals = mutableListOf<Pair<String, Long>>()
        var selected: String? = null
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            if (open.value) TrainingSeriesSheet(details, "e0", false, onDismiss = { open.value = false },
                onSelectEnd = { selected = it }, onRemoveEnd = { id, revision -> removals += id to revision })
        } }
        ui.onNodeWithTag("remove-series-1").performClick()
        ui.onNodeWithText("Удалить серию?").assertExists()
        ui.onNodeWithText("3 стрел.", substring = true).assertExists()
        ui.runOnIdle { assertTrue(removals.isEmpty()); assertNull(selected) }
        ui.onNodeWithText("Отмена").performClick()
        ui.onNodeWithTag("training-series-sheet").assertExists()
        ui.runOnIdle { assertTrue(removals.isEmpty()) }
        ui.onNodeWithTag("remove-series-1").performClick()
        ui.onNodeWithTag("confirm-remove-series").performClick()
        ui.onNodeWithTag("training-series-sheet").assertDoesNotExist()
        ui.runOnIdle {
            assertEquals(listOf("e0" to 11L), removals)
            assertNull(selected)
            assertEquals(12, details.allShots.size)
        }
    }

    @Test fun removingRoundRequiresConfirmationAndPassesWholeSessionRevision() {
        val details = rankFixture()
        val open = mutableStateOf(true)
        val removals = mutableListOf<Triple<String, String, Long>>()
        var selected: String? = null
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            if (open.value) TrainingRoundsSheet(details, false, onDismiss = { open.value = false },
                onSelectEnd = { selected = it }, onNewRound = {}, allowNewRound = false,
                onRemoveRound = { sessionId, endId, revision -> removals += Triple(sessionId, endId, revision) })
        } }
        ui.onNodeWithTag("remove-round-1").performClick()
        ui.onNodeWithText("Удалить раунд 1?").assertExists()
        ui.onNodeWithText("2 серий · 6 стрел.", substring = true).assertExists()
        ui.runOnIdle { assertTrue(removals.isEmpty()); assertNull(selected) }
        ui.onNodeWithText("Отмена").performClick()
        ui.onNodeWithTag("training-rounds-sheet").assertExists()
        ui.runOnIdle { assertTrue(removals.isEmpty()) }
        ui.onNodeWithTag("remove-round-1").performClick()
        ui.onNodeWithTag("confirm-remove-round").performClick()
        ui.onNodeWithTag("training-rounds-sheet").assertDoesNotExist()
        ui.runOnIdle {
            assertEquals(listOf(Triple("session", "e0", 7L)), removals)
            assertNull(selected)
            assertEquals(12, details.allShots.size)
        }
    }
}

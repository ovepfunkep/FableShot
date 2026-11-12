package app.fableshot.android

import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** In-memory callbacks only: this fixture never opens a journal or writes user settings. */
class SeriesSelectionUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val shown = mutableStateOf(true)
    private val hidden = mutableStateOf(false)
    private val disabled = mutableStateOf(emptySet<String>())
    private val selected = mutableListOf<String>()
    private val removed = mutableListOf<Pair<String, Long>>()
    private var dismissals = 0

    @Before fun requireUnlockedFocusedActivity() {
        assertFalse("Unlock the device before UI verification",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    private fun fixture(countOnly: Boolean = false): JournalDetails {
        val profile = TargetCatalog.indoor
        val block = JournalBlock("block", "session", 0, if (countOnly) "count_only" else "scored",
            18.0, profile.id, 1, 400, profile.snapshot(400), null, 6)
        val ends = listOf(listOf(9, 0), listOf(8, 8)).mapIndexed { number, points ->
            val end = JournalEnd("e$number", "block", number, 6, revision = 19L + number)
            val shots = if (countOnly) emptyList() else points.mapIndexed { input, value ->
                JournalShot("shot$number-$input", end.id, input, value, if (value == 0) "M" else value.toString(),
                    null, null, null, null, null, "numeric_entry", "none", "unknown", null, 1_000)
            }
            val counts = if (countOnly) listOf(JournalCount(end.id, 5 + number, 1_000, 1_000)) else emptyList()
            JournalEndDetails(end, shots, counts)
        }
        return JournalDetails(JournalSession("session", "Fixture", 1_000, 1_000),
            listOf(JournalBlockDetails(block, ends)),
            listOf(SessionPlan("session", 0, rolling = true, roundArrowLimit = 30)))
    }

    private fun mount(countOnly: Boolean = false, allowRemoval: Boolean = false, emptyFirst: Boolean = false) {
        val original = fixture(countOnly)
        val details = if (!emptyFirst) original else original.copy(blocks=original.blocks.map { block ->
            block.copy(ends=block.ends.mapIndexed { index,end -> if(index==0)end.copy(shots=emptyList()) else end })
        })
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1f)) {
                FableTheme(UserSettings(animations = false, disabledStatistics = disabled.value)) {
                    Surface {
                        if (shown.value) TrainingSeriesSheet(details, "e0", false,
                            onDismiss = { dismissals++; shown.value = false },
                            onSelectEnd = { selected += it }, hideScores = hidden.value,
                            onRemoveEnd = if (allowRemoval) { id, revision -> removed += id to revision } else null)
                    }
                }
            }
        }
    }

    @Test fun cardShowsActualResultAverageAndVolumeAndSelectionDoesNotRemoveSeries() {
        mount()
        ui.onNodeWithTag("training-select-series-1").assertIsDisplayed().assertHasClickAction()
        ui.onNodeWithTag("training-current-series-1", useUnmergedTree = true).assertTextEquals("Текущая")
        ui.onNodeWithTag("training-current-series-2", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("training-series-result-1", useUnmergedTree = true).assertTextEquals("9/20 очков · средний 4,5")
        ui.onNodeWithTag("training-series-volume-1", useUnmergedTree = true).assertTextEquals("Стрел: 2")
        ui.onNodeWithTag("remove-series-1", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithText("9/60", substring = true).assertDoesNotExist()
        ui.onNodeWithTag("training-select-series-2").performClick()
        ui.onNodeWithTag("training-series-sheet").assertDoesNotExist()
        ui.runOnIdle {
            assertEquals(listOf("e1"), selected)
            assertTrue(removed.isEmpty())
            assertEquals(1, dismissals)
        }
    }

    @Test fun trashIsAnIndependentConfirmedActionAndPassesTheSelectedRevision() {
        mount(allowRemoval = true)
        ui.onNodeWithTag("remove-series-1", useUnmergedTree = true).performClick()
        ui.onNodeWithText("Удалить серию?").assertExists()
        ui.onNodeWithText("2 стрел.", substring = true).assertExists()
        ui.runOnIdle {
            assertTrue(removed.isEmpty())
            assertTrue(selected.isEmpty())
            assertEquals(0, dismissals)
        }
        ui.onNodeWithText("Отмена").performClick()
        ui.onNodeWithTag("training-series-sheet").assertExists()
        ui.runOnIdle { assertTrue(removed.isEmpty()); assertTrue(selected.isEmpty()) }
        ui.onNodeWithTag("remove-series-1", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("confirm-remove-series").performClick()
        ui.onNodeWithTag("training-series-sheet").assertDoesNotExist()
        ui.runOnIdle {
            assertEquals(listOf("e0" to 19L), removed)
            assertTrue(selected.isEmpty())
            assertEquals(1, dismissals)
        }
    }

    @Test fun resultAverageAndVolumeRespectTheirFlagsAndHiddenScores() {
        mount()
        ui.runOnIdle { disabled.value = setOf(StatisticFeature.Result.wire) }
        ui.onNodeWithTag("training-series-result-1", useUnmergedTree = true).assertTextEquals("средний 4,5")
        ui.onNodeWithTag("training-series-volume-1", useUnmergedTree = true).assertTextEquals("Стрел: 2")
        ui.runOnIdle { disabled.value = setOf(StatisticFeature.Average.wire) }
        ui.onNodeWithTag("training-series-result-1", useUnmergedTree = true).assertTextEquals("9/20 очков")
        ui.runOnIdle { hidden.value = true; disabled.value = emptySet() }
        ui.onNodeWithTag("training-series-result-1", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("training-series-volume-1", useUnmergedTree = true).assertTextEquals("Стрел: 2")
        ui.onNodeWithTag("training-current-series-1", useUnmergedTree = true).assertTextEquals("Текущая")
        ui.runOnIdle { disabled.value = setOf(StatisticFeature.Volume.wire) }
        ui.onNodeWithTag("training-series-result-1", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("training-series-volume-1", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("training-select-series-1").assertHasClickAction()
    }

    @Test fun emptyScoredSeriesShowsZeroMaximumAndUnknownAverage() {
        mount(emptyFirst=true)
        ui.onNodeWithTag("training-series-result-1",useUnmergedTree=true).assertTextEquals("0/0 очков · средний —")
        ui.onNodeWithTag("training-series-volume-1",useUnmergedTree=true).assertTextEquals("Стрел: 0")
    }

    @Test fun countOnlySeriesShowsActualVolumeWithoutInventedPointsOrAverage() {
        mount(countOnly = true)
        ui.onNodeWithTag("training-series-volume-1", useUnmergedTree = true).assertTextEquals("Стрел: 5")
        ui.onNodeWithTag("training-series-volume-2", useUnmergedTree = true).assertTextEquals("Стрел: 6")
        ui.onNodeWithTag("training-series-result-1", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("training-series-result-2", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithText("очков", substring = true).assertDoesNotExist()
        ui.onNodeWithText("средний", substring = true).assertDoesNotExist()
        ui.runOnIdle { disabled.value = setOf(StatisticFeature.Volume.wire) }
        ui.onNodeWithTag("training-series-volume-1", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("training-current-series-1", useUnmergedTree = true).assertTextEquals("Текущая")
    }
}

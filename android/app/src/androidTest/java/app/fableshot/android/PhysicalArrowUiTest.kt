package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.key
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class PhysicalArrowUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Before fun requireUnlockedFocusedActivity() {
        assertFalse("UI verification requires the user to unlock the device.",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    private fun open(tag: String = "physical-arrow-choice") {
        ui.onNodeWithTag(tag).performClick()
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("physical-arrow-buttons").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun applyNumber(value: Int) {
        ui.onNodeWithTag("physical-arrow-buttons").performScrollToNode(hasTestTag("physical-arrow-quick-$value"))
        ui.onNodeWithTag("physical-arrow-quick-$value").performClick()
    }

    private fun fixture(number: Int? = null, withConfiguration: Boolean = true): JournalDetails {
        val arrows = EquipmentItem(id = "arrows", kind = "arrows", name = "Мои стрелы", numberedCount = 6)
        val kit = EquipmentItem(id = "kit", kind = "setup", name = "Комплект", arrowsId = arrows.id)
        val block = JournalBlock("block", "session", 0, "scored", 18.0, PRACTICE_PROFILE, 1, 400,
            practiceSnapshot(400), if (withConfiguration) equipmentSnapshot(kit, listOf(kit, arrows)) else null, 3)
        val end = JournalEnd("end", block.id, 0, 3)
        val shots = number?.let { listOf(JournalShot("old", end.id, 0, 9, "9", null, null,
            null, null, null, "numeric_entry", "none", "unknown", it, 1)) }.orEmpty()
        return JournalDetails(JournalSession("session", "Fixture", 1, 1),
            listOf(JournalBlockDetails(block, listOf(JournalEndDetails(end, shots, emptyList())))))
    }

    @Test fun numberGridDisablesUsedNumbersAndCanReachTheEntireSavedSetAtLargeFont() {
        val value = mutableStateOf<Int?>(null)
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                AppScale(UserSettings(useSystemScale = true)) {
                Surface { PhysicalArrowPicker(value.value, PhysicalArrowSet("set", "Большой набор", 1000),
                    setOf(2), { value.value = it }) }
                }
            }
        } }
        open()
        ui.onNodeWithTag("physical-arrow-quick-2").assertIsNotEnabled()
        ui.onNodeWithTag("physical-arrow-quick-1000").assertDoesNotExist()
        ui.onNodeWithTag("physical-arrow-number").assertDoesNotExist()
        ui.onNodeWithTag("physical-arrow-apply").assertDoesNotExist()
        ui.onNodeWithTag("physical-arrow-none").assertDoesNotExist()
        applyNumber(1000)
        ui.runOnIdle { assertEquals(1000, value.value) }
        ui.onNodeWithTag("physical-arrow-choice").assertTextContains("№ 1000", substring = true)
        open()
        applyNumber(1000)
        ui.runOnIdle { assertNull(value.value) }
    }

    @Test fun legacyNumberOutsideConfiguredSetCanBeKeptOrClearedWithoutOfferingOtherNumbers() {
        val value = mutableStateOf<Int?>(777)
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Surface {
                    PhysicalArrowPicker(value.value, PhysicalArrowSet("set", "Набор", 6),
                        setOf(2), { value.value = it })
                }
            }
        }
        open()
        ui.onNodeWithTag("physical-arrow-quick-777").assertIsEnabled()
            .assertContentDescriptionEquals("Стрела №777")
        ui.onNodeWithTag("physical-arrow-quick-2").assertIsNotEnabled()
        ui.onNodeWithTag("physical-arrow-quick-7").assertDoesNotExist()
        ui.onNodeWithTag("physical-arrow-quick-778").assertDoesNotExist()
        dismissTestSheet(ui)
        ui.runOnIdle { assertEquals(777, value.value) }
        open()
        applyNumber(777)
        ui.runOnIdle { assertNull(value.value) }
        open()
        ui.onNodeWithTag("physical-arrow-quick-777").assertDoesNotExist()
        ui.onNodeWithTag("physical-arrow-quick-7").assertDoesNotExist()
    }

    @Test fun activeEntryRequestsNumberAfterSavedHitAllowsRetrySkipAndNoReplay() {
        val journal = mutableStateOf(fixture())
        val failed = mutableStateOf(false)
        val generation = mutableStateOf(0)
        var failNumberSave = false
        var submittedNumber: Int? = null
        var sequence = 0
        fun append(endId: String, points: Int, position: TargetPoint?, number: Int?) {
            submittedNumber = number
            val current = journal.value.blocks.single()
            val end = current.ends.single()
            val shot = JournalShot("hit-${sequence++}", endId, end.shots.size, points,
                if (points == 0) "M" else points.toString(), null, null, position?.x, position?.y,
                if (position != null) "main" else null, "numeric_entry",
                if (position != null) "manual_target" else "none", if (position != null) "known" else "unknown", number, 1)
            journal.value = journal.value.copy(blocks = listOf(current.copy(ends = listOf(end.copy(shots = end.shots + shot)))))
        }
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { TargetOverlayHost(Modifier.fillMaxSize()) {
                key(generation.value) {
                ActivePractice(journal.value.presentation(), PracticeCommands({ _, _ -> error("Unnumbered callback") },
                    { _, _ -> error("Unnumbered callback") }, { updated ->
                        if (failNumberSave) failed.value = true
                        else {
                            failed.value = false
                            val block = journal.value.blocks.single()
                            val end = block.ends.single()
                            journal.value = journal.value.copy(blocks = listOf(block.copy(ends = listOf(end.copy(shots = end.shots.map {
                                if (it.id == updated.id) it.copy(physicalArrowNumber = updated.physicalArrowNumber, revision = it.revision + 1) else it
                            })))))
                        }
                    }, {}, {},
                    numberedPoint = { end, point, number -> append(end, 10, point, number) },
                    numberedNumeric = { end, score, number -> append(end, score, null, number) }),
                    false, false, {}, {}, saveFailed = failed.value)
                }
            } }
        } }
        ui.onNodeWithText("Тренировка", useUnmergedTree = true).assertIsDisplayed()
        val before = ui.onNodeWithTag("target-board").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithTag("physical-arrow-choice").assertDoesNotExist()
        ui.onNodeWithTag("target-input").performTouchInput { click(center) }
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("physical-arrow-picker").fetchSemanticsNodes().isNotEmpty() }
        ui.runOnIdle { assertNull(submittedNumber); assertNull(journal.value.allShots.single().physicalArrowNumber) }
        val savedPoint = journal.value.allShots.single()
        applyNumber(3)
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("physical-arrow-picker").fetchSemanticsNodes().isEmpty() }
        assertEquals(before, ui.onNodeWithTag("target-board").fetchSemanticsNode().boundsInRoot)
        ui.runOnIdle {
            assertEquals(savedPoint.copy(physicalArrowNumber = 3, revision = 2), journal.value.allShots.single())
            failNumberSave = true
        }
        ui.onNodeWithTag("miss").performClick()
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("physical-arrow-picker").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("physical-arrow-quick-3").assertIsNotEnabled()
        applyNumber(2)
        ui.onNodeWithTag("physical-arrow-save-error").assertExists()
        ui.runOnIdle { assertNull(journal.value.allShots.last().physicalArrowNumber); failNumberSave = false }
        applyNumber(2)
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("physical-arrow-picker").fetchSemanticsNodes().isEmpty() }
        ui.onNodeWithTag("miss").performClick()
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("physical-arrow-picker").fetchSemanticsNodes().isNotEmpty() }
        dismissTestSheet(ui)
        ui.runOnIdle { assertEquals(listOf(3, 2, null), journal.value.allShots.map { it.physicalArrowNumber }); generation.value++ }
        ui.onNodeWithTag("physical-arrow-picker").assertDoesNotExist()
    }

    @Test fun historyCanKeepOrClearLegacyNumberWhenArrowSetIsUnavailable() {
        val journal = fixture(777, withConfiguration = false)
        var saved: JournalShot? = null
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { TargetOverlayHost(Modifier.fillMaxSize()) {
                JournalShotEditor(journal, "old", false, { saved = it }, { _, _ -> }, {})
            } }
        } }
        ui.onNodeWithTag("report-edit-old").assertIsDisplayed().performClick()
        ui.onNodeWithTag("history-physical-arrow-choice").assertIsDisplayed().performClick()
        ui.onNodeWithTag("physical-arrow-keep").assertIsDisplayed().performClick()
        ui.onNodeWithTag("history-physical-arrow-choice").assertTextContains("№ 777", substring = true)
        ui.onNodeWithTag("history-physical-arrow-choice").performClick()
        ui.onNodeWithTag("physical-arrow-none").performClick()
        ui.onNodeWithTag("history-save-shot").assertIsDisplayed().assertIsEnabled().performClick()
        ui.runOnIdle {
            assertNull(requireNotNull(saved).physicalArrowNumber)
            assertEquals(9, saved?.points)
            assertNull(saved?.x)
        }
    }

    @Test fun disabledNumberingSkipsAutomaticPromptButStillAllowsEditingStoredNumber() {
        val initial = fixture(5)
        val journal = mutableStateOf(initial.copy(session = initial.session.copy(numberedArrows = false)))
        var saved: ShotEntity? = null
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { TargetOverlayHost(Modifier.fillMaxSize()) {
                ActivePractice(journal.value.presentation(), PracticeCommands({ _, _ -> }, { endId, score ->
                    val block = journal.value.blocks.single()
                    val end = block.ends.single()
                    val shot = end.shots.first().copy(id = "new", inputIndex = 1, points = score, zoneCode = "M", physicalArrowNumber = null)
                    assertEquals(end.end.id, endId)
                    journal.value = journal.value.copy(blocks = listOf(block.copy(ends = listOf(end.copy(shots = end.shots + shot)))))
                }, { saved = it }, {}, {}), false, false, {}, {})
            } }
        } }
        ui.onNodeWithTag("physical-arrow-choice").assertDoesNotExist()
        ui.onNodeWithTag("miss").performClick()
        ui.onNodeWithTag("physical-arrow-picker").assertDoesNotExist()
        ui.onNodeWithTag("shot-0").performClick()
        ui.onNodeWithTag("physical-arrow-choice").performClick()
        applyNumber(5)
        ui.onNodeWithTag("save-edit").performClick()
        ui.runOnIdle { assertNull(requireNotNull(saved).physicalArrowNumber); assertEquals(9, saved?.points) }
    }
}

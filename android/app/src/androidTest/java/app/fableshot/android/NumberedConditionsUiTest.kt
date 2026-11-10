package app.fableshot.android

import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class NumberedConditionsUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Before fun requireUnlockedFocusedActivity() {
        assertFalse("UI verification requires the user to unlock the device.",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    @Test fun savedKitSurvivesEmptyCatalogueAndNumberingDefaultsOnThenSavesOverride() {
        val arrows = EquipmentItem(id = "arrows", kind = "arrows", name = "Стрелы", numberedCount = 6)
        val kit = EquipmentItem(id = "kit", kind = "setup", name = "Сохранённый комплект", arrowsId = arrows.id)
        val snapshot = equipmentSnapshot(kit, listOf(kit, arrows))
        val block = mutableStateOf(JournalBlock("first", "session", 0, "scored", 18.0, PRACTICE_PROFILE, 1, 400,
            practiceSnapshot(400), snapshot, 3))
        val catalogue = mutableStateOf<List<EquipmentItem>>(emptyList())
        var result: BlockPlan? = null
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { JournalSetupScreen(false, initial = block.value, equipment = catalogue.value,
                newSession = false, initialNumbering = null) { _, plan -> result = plan } }
        } }
        ui.onNodeWithTag("conditions-equipment").assertTextContains(kit.name, substring = true)
        ui.onNodeWithTag("start-training").assertIsEnabled()
        ui.runOnIdle { catalogue.value = listOf(kit, arrows) }
        ui.onNodeWithTag("conditions-options").performClick()
        ui.onNodeWithTag("conditions-numbered-arrows").performScrollTo().assertIsOn().performClick().assertIsOff()
        ui.onNodeWithTag("conditions-options-done").performScrollTo().performClick()
        ui.onNodeWithTag("start-training").performClick()
        ui.runOnIdle { assertEquals(snapshot, result?.equipmentSnapshotJson); assertEquals(false, result?.numberedArrows) }

        val replacement = kit.copy(id = "another", name = "Другой сохранённый комплект")
        val otherSnapshot = equipmentSnapshot(replacement, listOf(replacement, arrows))
        ui.runOnIdle { catalogue.value = emptyList(); block.value = block.value.copy(id = "second", equipmentSnapshotJson = otherSnapshot) }
        ui.onNodeWithTag("conditions-equipment").assertTextContains(replacement.name, substring = true)
        ui.onNodeWithTag("start-training").performClick()
        ui.runOnIdle { assertEquals(otherSnapshot, result?.equipmentSnapshotJson); assertNull(result?.numberedArrows) }
    }

    @Test fun arrowAnalysisUsesAccessibleIconAndFavoriteIsToggleable() {
        val arrows = EquipmentItem(id = "arrows", kind = "arrows", name = "Стрелы", numberedCount = 6, favorite = true)
        val items = mutableStateOf(listOf(arrows))
        var opened: String? = null
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { EquipmentScreen(items.value, false, false, onArrowAnalysis = { opened = it }) { item, done ->
                items.value = listOf(item)
                done()
            } }
        } }
        ui.onNodeWithTag("equipment-tab-arrows").performClick()
        ui.onNodeWithTag("equipment-favorite-arrows").assertIsOn().performClick().assertIsOff()
        ui.onNodeWithText("Статистика по номерам").assertDoesNotExist()
        ui.onNodeWithContentDescription("Статистика по номерам стрел").assertIsDisplayed().performClick()
        ui.runOnIdle { assertEquals(arrows.id, opened) }
    }
}

package app.fableshot.android

import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.PhysicalArrowAnalysisGroup
import app.fableshot.android.data.journal.PhysicalArrowResult
import app.fableshot.android.ui.*
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test

class PhysicalArrowEquipmentUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun archivedArrowSetOpensItsOwnHistoryWithLargeText() {
        assertFalse("Unlock the phone for UI verification.",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        val set = EquipmentItem(id = "archived-arrows", kind = "arrows", name = "Клубные стрелы",
            numberedCount = 8, archived = true)
        val group = PhysicalArrowAnalysisGroup(set.id, set.name, "conditions", "18 м · 40 см",
            listOf(PhysicalArrowResult(7, 3, 9.0, 3, 2.0, 4.0)))
        val analysis = flowOf(listOf(group))
        var selected by mutableStateOf<String?>(null)
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 1.5f)) {
                FableTheme(UserSettings(animations = false)) {
                    if (selected == null) EquipmentScreen(listOf(set), false, false,
                        onArrowAnalysis = { selected = it }, onSave = { _, _ -> })
                    else PhysicalArrowHistoryScreen(requireNotNull(selected), analysis)
                }
            }
        }
        ui.onNodeWithTag("equipment-tab-arrows").performClick()
        ui.onNodeWithTag("equipment-show-archive").performClick()
        ui.onNodeWithTag("equipment-arrow-analysis-${set.id}").performScrollTo().performClick()
        ui.waitUntil(5_000) { selected == set.id }
        ui.onNodeWithTag("physical-arrow-history").assertExists()
        ui.onNodeWithTag("physical-arrow-details").performScrollTo().performClick()
        ui.onNodeWithTag("physical-arrow-7").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText(set.name).assertDoesNotExist()
    }
}

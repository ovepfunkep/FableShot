package app.fableshot.android

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.EquipmentEditor
import app.fableshot.android.ui.FableTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ShaftEquipmentUiTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()

    @Test fun diameterAcceptsDecimalMillimetresAndRejectsOutOfRangeValuesWithLargeText() {
        var saved:EquipmentItem?=null
        ui.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,fontScale=1.5f)) {
                FableTheme(UserSettings(animations=false)) {
                    EquipmentEditor(EquipmentItem(id="diameter-fixture",kind="arrows",name="Стрелы"),
                        emptyList(),false,false,onCancel={},onSave={saved=it})
                }
            }
        }
        val field=ui.onNodeWithTag("equipment-field-diameterMm")
        field.performScrollTo().assertIsDisplayed()
        field.performTextReplacement("20,1")
        ui.onNodeWithTag("equipment-save").performScrollTo().assertIsNotEnabled()
        field.performScrollTo().performTextReplacement("0")
        ui.onNodeWithTag("equipment-save").performScrollTo().assertIsNotEnabled()
        field.performScrollTo().performTextReplacement("6,4")
        ui.onNodeWithTag("equipment-save").performScrollTo().assertIsEnabled().performClick()
        ui.runOnIdle {assertEquals(6.4,saved!!.diameterMm!!,0.0)}
        field.performScrollTo().performTextClearance()
        ui.onNodeWithTag("equipment-save").performScrollTo().assertIsEnabled().performClick()
        ui.runOnIdle {assertNull(saved!!.diameterMm)}
    }
}

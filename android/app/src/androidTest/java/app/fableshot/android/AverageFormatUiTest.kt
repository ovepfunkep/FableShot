package app.fableshot.android

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.*
import org.junit.Rule
import org.junit.Test

class AverageFormatUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    @Test fun precisionChangesOnlyAverageDisplayAndKeepsCalculationsAndOtherUnits() {
        val settings = mutableStateOf(UserSettings(animations = false))
        ui.setContent { FableTheme(settings.value) { Surface { Column {
            Text(averageNumber(28.0 / 3), Modifier.testTag("mean"))
            Text(number(49.25), Modifier.testTag("millimeters"))
        } } } }
        ui.onNodeWithTag("mean").assertTextEquals("9,3")
        ui.runOnIdle { settings.value = settings.value.copy(averageHundredths = true) }
        ui.onNodeWithTag("mean").assertTextEquals("9,33")
        ui.onNodeWithTag("millimeters").assertTextEquals("49,3")
        ui.runOnIdle { settings.value = settings.value.copy(averageHundredths = false) }
        ui.onNodeWithTag("mean").assertTextEquals("9,3")
    }
}

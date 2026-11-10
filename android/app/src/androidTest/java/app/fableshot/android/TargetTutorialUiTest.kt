package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.*
import org.junit.Rule
import org.junit.Test

/** The tutorial owns temporary points only, and must judge them like its magnifier. */
class TargetTutorialUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun temporaryPointsAndEditsUseTheSameShaftRuleAsTheLens() {
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface(Modifier.requiredWidth(360.dp).fillMaxHeight()) {
                TargetOverlayHost { TargetTutorial({}, {}) }
            }
        } }
        fun place(x: Float) {
            ui.onNodeWithTag("target-input").performScrollTo().performTouchInput {
                click(Offset(centerX + minOf(width, height) * .44f * x, centerY))
            }
        }
        place(.11f)
        ui.onNodeWithTag("tutorial-shot-0").assertTextContains("10")
        repeat(2) { ui.onNodeWithTag("tutorial-next").performScrollTo().performClick() }
        ui.onNodeWithTag("tutorial-shot-0").performScrollTo().performClick()
        place(.21f)
        ui.onNodeWithTag("tutorial-shot-0").assertTextContains("9")
    }
}

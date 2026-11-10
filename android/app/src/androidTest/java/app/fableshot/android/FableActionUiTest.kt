package app.fableshot.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.FablePrimaryButton
import app.fableshot.android.ui.FableTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class FableActionUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun touchingAGlossaryWordInAnActionRunsTheActionWithoutOpeningHelp() {
        var clicks = 0
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            FablePrimaryButton("Кучность", { clicks++ })
        } }
        ui.onNodeWithText("Кучность").performTouchInput { click(center) }
        ui.runOnIdle { assertEquals(1, clicks) }
        ui.onAllNodes(isDialog()).assertCountEquals(0)
    }
}

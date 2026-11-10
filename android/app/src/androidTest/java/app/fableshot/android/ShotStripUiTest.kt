package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.ShotEntity
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ShotStripUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val count = mutableIntStateOf(6)
    private fun shots() = (0 until count.intValue).map { ShotEntity("shot-$it", "end", it, 10 - it % 5, null, null, "numeric", 1, 1) }
    private fun mount(onChoose: (ShotEntity?) -> Unit = {}) {
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface(Modifier.width(320.dp)) { ShotStrip(shots(), count.intValue, null, null, true, false, "end", onChoose) }
        } }
    }
    @Test fun sixColoredShotsFitOnePageAndEveryShotIsSelectable() {
        var selected: String? = null
        mount { selected = it?.id }
        ui.onNodeWithTag("shot-strip-scroll").assertDoesNotExist()
        repeat(6) { ui.onNodeWithTag("shot-$it").assertIsDisplayed().performClick(); assertEquals("shot-$it", selected) }
    }
    @Test fun moreThanSixScrollToLatestAndFadesFollowAvailableDirections() {
        count.intValue = 12
        mount()
        ui.onNodeWithTag("shot-11").assertIsDisplayed()
        ui.onNodeWithTag("shot-strip-fade-left").assertIsDisplayed()
        ui.onNodeWithTag("shot-strip-fade-right").assertDoesNotExist()
        ui.onNodeWithTag("shot-strip-scroll").performScrollToIndex(0)
        ui.onNodeWithTag("shot-0").assertIsDisplayed()
        ui.onNodeWithTag("shot-strip-fade-right").assertIsDisplayed()
        ui.onNodeWithTag("shot-strip-fade-left").assertDoesNotExist()
    }
}

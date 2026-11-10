package app.fableshot.android

import androidx.compose.runtime.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.UserSettings
import app.fableshot.android.domain.CountdownStatus
import app.fableshot.android.ui.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class PracticeTimerUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun largeTextAndRestoredDurationDraftRemainUsable() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        val timer = PracticeTimer(scope)
        val show = mutableStateOf(true)
        var saved: Pair<Int, Int>? = null
        withContext(Dispatchers.Main) {timer.bindSession("isolated-ui")}
        try {
            val restoration = StateRestorationTester(ui)
            restoration.setContent {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                    FableTheme(UserSettings(animations = false)) {
                        if (show.value) PracticeTimerWindow(timer, 120, 60, {series,rest -> saved = series to rest}, {show.value = false})
                    }
                }
            }
            ui.onNodeWithTag("timer-series-seconds").performScrollTo().performTextReplacement("75")
            ui.onNodeWithTag("timer-rest-seconds").performScrollTo().performTextReplacement("45")
            restoration.emulateSavedInstanceStateRestore()
            ui.onNodeWithTag("timer-series-seconds").assertTextContains("75")
            ui.onNodeWithTag("timer-save-durations").performScrollTo().assertIsDisplayed().performClick()
            ui.waitUntil(5000) {saved == (75 to 45)}
            ui.onNodeWithTag("timer-toggle").performScrollTo().assertIsDisplayed().performClick()
            ui.runOnIdle {assertEquals(CountdownStatus.Running, timer.state.value.countdown.status)}
            ui.onNodeWithTag("timer-toggle").performClick()
            ui.onNodeWithTag("timer-status").assertTextEquals("На паузе")
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            val folder = File(context.getExternalFilesDir("verification"), "timer").apply {mkdirs()}
            File(folder, "timer-large.png").outputStream().use {
                ui.onNodeWithTag("practice-timer-window").captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
            Unit
        } finally {
            ui.runOnIdle {show.value = false}
            scope.coroutineContext[Job]!!.cancelAndJoin()
        }
    }
}

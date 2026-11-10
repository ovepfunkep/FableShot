package app.fableshot.android

import android.content.res.Configuration
import android.util.DisplayMetrics
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fableshot.android.data.UserSettings
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.AppScale
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.SettingsScreen
import app.fableshot.android.ui.TargetBoard
import app.fableshot.android.ui.TargetOverlayHost
import app.fableshot.android.ui.standardAppDensity
import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog
import app.fableshot.android.ui.ScaledDialog
import app.fableshot.android.ui.ScaledModalBottomSheet
import app.fableshot.android.ui.ScaledDropdownMenu
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import kotlin.math.min

/** Composition-only fixtures: Android settings and installed diaries are never changed. */
class AppScaleUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val stableDensity = (DisplayMetrics.DENSITY_DEVICE_STABLE.takeIf { it > 0 }
        ?: DisplayMetrics.DENSITY_DEFAULT).toFloat() / DisplayMetrics.DENSITY_DEFAULT
    private val enlargedSystem = Density(stableDensity * 1.2f, 1.6f)

    @Test fun appearanceToggleRepaintsSizesAndPreservesTheOpenSettingsSection() {
        var settings by mutableStateOf(UserSettings(animations = false))
        var observedDensity: Density? = null
        var observedConfiguration: Configuration? = null
        var originalConfiguration: Configuration? = null
        ui.setContent {
            val configuration = LocalConfiguration.current
            CompositionLocalProvider(LocalDensity provides enlargedSystem) {
                AppScale(settings) {
                    val density = LocalDensity.current
                    val appConfiguration = LocalConfiguration.current
                    SideEffect {
                        observedDensity = density
                        originalConfiguration = configuration
                        observedConfiguration = appConfiguration
                    }
                    FableTheme(settings) {
                        Column(Modifier.fillMaxSize()) {
                            Box(Modifier.size(40.dp).testTag("scale-probe"))
                            Text("Масштаб", fontSize = 18.sp, lineHeight = 24.sp, modifier = Modifier.testTag("scale-text"))
                            SettingsScreen(settings, {}, {}, {}, {}, {}, {}, {},
                                onSystemScale = { settings = settings.copy(useSystemScale = it) })
                        }
                    }
                }
            }
        }
        val standardWidth = ui.onNodeWithTag("scale-probe").fetchSemanticsNode().boundsInRoot.width
        val standardTextHeight = ui.onNodeWithTag("scale-text").fetchSemanticsNode().boundsInRoot.height
        assertEquals(40f * stableDensity, standardWidth, 1f)
        ui.runOnIdle {
            assertEquals(1f, observedDensity!!.fontScale, 0f)
            assertSame(originalConfiguration, observedConfiguration)
        }
        ui.onNodeWithText("Оформление").performScrollTo().performClick()
        ui.onNodeWithTag("setting-system-scale").performScrollTo().assertIsOff()
            .performTouchInput { click(center) }
        ui.onNodeWithTag("setting-system-scale").assertIsOn()
        assertEquals(40f * enlargedSystem.density,
            ui.onNodeWithTag("scale-probe").fetchSemanticsNode().boundsInRoot.width, 1f)
        assertTrue(ui.onNodeWithTag("scale-text").fetchSemanticsNode().boundsInRoot.height > standardTextHeight)
        ui.runOnIdle {
            assertSame(enlargedSystem, observedDensity)
            assertSame(originalConfiguration, observedConfiguration)
        }
        ui.onNodeWithTag("setting-system-scale").performScrollTo().performTouchInput { click(center) }
        ui.onNodeWithTag("setting-system-scale").assertIsOff()
        assertEquals(standardWidth, ui.onNodeWithTag("scale-probe").fetchSemanticsNode().boundsInRoot.width, 1f)
    }

    @Test fun dialogUsesTheChosenScaleAndKeepsItsButtonTouchable() {
        var settings by mutableStateOf(UserSettings(animations = false))
        var open by mutableStateOf(true)
        var confirmed = false
        var draft by mutableStateOf("")
        ui.setContent {
            CompositionLocalProvider(LocalDensity provides enlargedSystem) {
                AppScale(settings) {
                    FableTheme(settings) {
                        if (open) AlertDialog(
                            onDismissRequest = { open = false },
                            text = {
                                Column {
                                    Box(Modifier.size(40.dp).testTag("dialog-scale-probe"))
                                    OutlinedTextField(draft, { draft = it }, Modifier.testTag("dialog-scale-draft"))
                                }
                            },
                            confirmButton = {
                                TextButton(onClick = { confirmed = true; open = false }, modifier = Modifier.testTag("dialog-scale-confirm")) {
                                    Text("Готово")
                                }
                            },
                        )
                    }
                }
            }
        }
        assertEquals(40f * stableDensity,
            ui.onNodeWithTag("dialog-scale-probe").fetchSemanticsNode().boundsInRoot.width, 1f)
        ui.onNodeWithTag("dialog-scale-draft").performTextInput("Памятка")
        ui.runOnIdle { settings = settings.copy(useSystemScale = true) }
        assertEquals(40f * enlargedSystem.density,
            ui.onNodeWithTag("dialog-scale-probe").fetchSemanticsNode().boundsInRoot.width, 1f)
        ui.onNodeWithTag("dialog-scale-draft").assertTextEquals("Памятка")
        ui.onNodeWithTag("dialog-scale-confirm").performTouchInput { click(center) }
        ui.runOnIdle { assertTrue(confirmed) }
        ui.onNodeWithTag("dialog-scale-probe").assertDoesNotExist()
    }

    @Test fun customDialogAndDropdownContentFollowBothScales() {
        var settings by mutableStateOf(UserSettings(animations = false))
        var dialog by mutableStateOf(true)
        var menu by mutableStateOf(false)
        var chosen = false
        ui.setContent {
            CompositionLocalProvider(LocalDensity provides enlargedSystem) {
                AppScale(settings) {
                    FableTheme(settings) {
                        Box(Modifier.fillMaxSize()) {
                            if (dialog) ScaledDialog(onDismissRequest = { dialog = false }) {
                                Box(Modifier.size(40.dp).testTag("custom-dialog-probe"))
                            }
                            ScaledDropdownMenu(menu, { menu = false }) {
                                Box(Modifier.size(40.dp).testTag("dropdown-scale-probe"))
                                TextButton({ chosen = true; menu = false }, Modifier.testTag("dropdown-scale-confirm")) {
                                    Text("Выбрать")
                                }
                            }
                        }
                    }
                }
            }
        }
        for (system in listOf(false, true)) {
            ui.runOnIdle { settings = settings.copy(useSystemScale = system) }
            val expected = 40f * if (system) enlargedSystem.density else stableDensity
            assertEquals(expected, ui.onNodeWithTag("custom-dialog-probe").fetchSemanticsNode().boundsInRoot.width, 1f)
        }
        ui.runOnIdle { dialog = false; menu = true }
        for (system in listOf(false, true)) {
            ui.runOnIdle { settings = settings.copy(useSystemScale = system) }
            val expected = 40f * if (system) enlargedSystem.density else stableDensity
            assertEquals(expected, ui.onNodeWithTag("dropdown-scale-probe").fetchSemanticsNode().boundsInRoot.width, 1f)
        }
        ui.onNodeWithTag("dropdown-scale-confirm").performTouchInput { click(center) }
        ui.runOnIdle { assertTrue(chosen) }
    }

    @OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
    @Test fun bottomSheetContentUsesBothScalesAndKeepsItsActionTouchable() {
        var settings by mutableStateOf(UserSettings(animations = false))
        var open by mutableStateOf(true)
        var confirmed = false
        ui.setContent {
            CompositionLocalProvider(LocalDensity provides enlargedSystem) {
                AppScale(settings) {
                    FableTheme(settings) {
                        if (open) ScaledModalBottomSheet(onDismissRequest = { open = false }) {
                            Box(Modifier.size(40.dp).testTag("sheet-scale-probe"))
                            TextButton({ confirmed = true; open = false }, Modifier.testTag("sheet-scale-confirm")) {
                                Text("Готово")
                            }
                        }
                    }
                }
            }
        }
        for (system in listOf(false, true)) {
            ui.runOnIdle { settings = settings.copy(useSystemScale = system) }
            val expected = 40f * if (system) enlargedSystem.density else stableDensity
            assertEquals(expected, ui.onNodeWithTag("sheet-scale-probe").fetchSemanticsNode().boundsInRoot.width, 1f)
        }
        ui.onNodeWithTag("sheet-scale-confirm").performTouchInput { click(center) }
        ui.runOnIdle { assertTrue(confirmed) }
    }

    @Test fun bothScalesKeepTargetCoordinatesAndMagnifierAlignedWithTheFinger() {
        var settings by mutableStateOf(UserSettings(animations = false))
        val points = mutableListOf<TargetPoint>()
        ui.setContent {
            CompositionLocalProvider(LocalDensity provides enlargedSystem) {
                AppScale(settings) {
                    FableTheme(settings) {
                        TargetOverlayHost(Modifier.fillMaxSize()) {
                            Column(Modifier.fillMaxSize().padding(top = 190.dp)) {
                                TargetBoard(Modifier.size(260.dp), "scale-test", "scale-test-end", emptyList(), null, true,
                                    points::add, viewportHeight = 260.dp)
                            }
                        }
                    }
                }
            }
        }
        for ((index, system) in listOf(false, true).withIndex()) {
            ui.runOnIdle { settings = settings.copy(useSystemScale = system) }
            val board = ui.onNodeWithTag("target-input")
            val bounds = board.fetchSemanticsNode().boundsInRoot
            board.performTouchInput {
                down(center)
                advanceEventTime(220)
                moveTo(center + Offset(width * .1f, 0f))
            }
            val lens = ui.onNodeWithTag("magnifier").fetchSemanticsNode().boundsInRoot
            val expectedDensity = if (system) enlargedSystem.density else stableDensity
            assertEquals(112f * expectedDensity, lens.width, 1f)
            assertEquals(bounds.left + bounds.width * .6f, lens.center.x, 1f)
            assertTrue(lens.bottom < bounds.center.y)
            board.performTouchInput { up() }
            ui.runOnIdle {
                assertEquals(index + 1, points.size)
                assertEquals(bounds.width * .1 / (min(bounds.width, bounds.height) * .44), points.last().x, .01)
                assertEquals(0.0, points.last().y, .01)
            }
            ui.onNodeWithTag("magnifier").assertDoesNotExist()
        }
    }

    @Test fun invalidStableDensityFallsBackToAValidScaleWithStandardText() {
        val fallback = standardAppDensity(Density(2.2f, 1.6f), stableDpi = 0)
        assertEquals(2.2f, fallback.density, 0f)
        assertEquals(1f, fallback.fontScale, 0f)
        assertEquals(1f, standardAppDensity(Density(Float.NaN, 1.6f), stableDpi = -1).density, 0f)
    }
}

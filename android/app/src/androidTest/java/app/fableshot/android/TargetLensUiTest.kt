package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.UserSettings
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Overlay-only fixtures. No diary, repository, display setting or real gesture is changed. */
class TargetLensUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val point = mutableStateOf(TargetPoint(.18, 0.0))
    private val diameter = mutableDoubleStateOf(6.0)
    private val fontScale = mutableFloatStateOf(1f)

    private fun mount() {
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale.floatValue)) {
                FableTheme(UserSettings(animations = false)) {
                    TargetOverlayHost(Modifier.fillMaxSize()) {
                        val lens = requireNotNull(LocalTargetLens.current)
                        val owner = remember { Any() }
                        val currentDensity = LocalDensity.current
                        val frame = with(currentDensity) {
                            TargetLensFrame(owner, Offset(160.dp.toPx(), 340.dp.toPx()), point.value,
                                300.dp.toPx(), emptyList(), null, null,
                                shaftDiameterMm = diameter.doubleValue, targetDiameterMm = 120)
                        }
                        SideEffect { lens.frame = frame }
                    }
                }
            }
        }
    }

    @Test fun scoreHeaderDoesNotResizeBetweenNineAndTenAndFitsAtLargeFont() {
        mount()
        for (scale in listOf(1f, 2f)) {
            ui.runOnIdle { fontScale.floatValue = scale; point.value = TargetPoint(.18, 0.0) }
            val header = ui.onNodeWithTag("magnifier-zone")
            val nine = header.fetchSemanticsNode().boundsInRoot
            ui.onNodeWithText("9").assertIsDisplayed()
            ui.runOnIdle { point.value = TargetPoint(.05, 0.0) }
            val ten = header.fetchSemanticsNode().boundsInRoot
            assertEquals(nine, ten)
            val layouts = mutableListOf<TextLayoutResult>()
            ui.onNodeWithText("10").assertIsDisplayed()
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertTrue(layouts.isNotEmpty())
            assertTrue("Lens score must fit at font scale $scale",
                layouts.all { !it.didOverflowWidth && !it.didOverflowHeight })
            val lens = ui.onNodeWithTag("magnifier").fetchSemanticsNode().boundsInRoot
            assertTrue(ten.bottom <= lens.top + 1f)
        }
    }

    @Test fun physicalShaftMarkerGrowsWithTheSavedDiameter() {
        point.value = TargetPoint(0.0, 0.0)
        mount()
        fun sample(): Int {
            val bitmap = ui.onNodeWithTag("magnifier").captureToImage().asAndroidBitmap()
            val offset = (bitmap.width * 22f / 112).toInt()
            return bitmap.getPixel(bitmap.width / 2 + offset, bitmap.height / 2)
        }
        val narrowShaft = sample()
        ui.runOnIdle { diameter.doubleValue = 12.0 }
        val wideShaft = sample()
        assertTrue("A wider physical shaft must cover more of the target face",
            android.graphics.Color.red(wideShaft) < android.graphics.Color.red(narrowShaft) * .8f)
    }
}

package app.fableshot.android

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.TargetBoard
import app.fableshot.android.ui.TargetOverlayHost
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Isolated view: never opens, changes or deletes the user's training database. */
@RunWith(AndroidJUnit4::class)
class TargetBoardGestureTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val points = mutableListOf<TargetPoint>()

    private fun board() = ui.onNodeWithTag("target-input")
    private fun mount(glass: Boolean = false, panMode: State<Boolean>? = null, onPanelClick: (() -> Unit)? = null) {
        ui.setContent {
            MaterialTheme {
              TargetOverlayHost(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().background(Color(0xFF172112)).padding(top = 220.dp)) {
                    Text("FableShot · gesture check", color = Color.White)
                    val selected = if (panMode?.value == false) "selected-shot" else null
                    val panOnly = panMode?.value ?: false
                    if (glass) TargetBoard(
                        Modifier.fillMaxWidth().testTag("test-board"), "gesture-test", "end-test", emptyList(), selected, !panOnly, points::add,
                        topContent = {
                            Box(Modifier.fillMaxWidth().height(60.dp)) {
                                if (onPanelClick != null) TextButton(onClick = onPanelClick, modifier = Modifier.testTag("glass-action")) { Text("SERIES 01") }
                                else Text("SERIES 01")
                            }
                        },
                        bottomContent = { Box(Modifier.fillMaxWidth().height(80.dp)) { Text("SCORE · 0 / 30") } },
                        panOnly = panOnly,
                    ) else TargetBoard(Modifier.size(300.dp).testTag("test-board"), "gesture-test", "end-test", emptyList(), selected, !panOnly, points::add, panOnly = panOnly)
                    Box(Modifier.fillMaxWidth().height(60.dp).background(Color(0xFFB83CBF)).testTag("below-board"))
                }
              }
            }
        }
    }

    private fun capture(name: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.getExternalFilesDir("verification"), name)
        file.outputStream().use { ui.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun touchingBackgroundDoesNotCreateShot() {
        mount()
        board().performTouchInput { click(Offset(2f, height-2f)) }
        ui.runOnIdle { assertTrue(points.isEmpty()) }
    }

    @Test fun quickSingleTapStillPlacesOneShot() {
        mount()
        board().performTouchInput { click(center) }
        ui.runOnIdle { assertEquals(1, points.size); assertEquals(10, app.fableshot.android.domain.TargetScoring.score(points.single())) }
    }

    @Test fun outerLineCutterCanBePlacedByItsCentreButBackgroundStaysInactive() {
        mount()
        board().performTouchInput { click(Offset(centerX + width * .44f * 1.01f, centerY)) }
        ui.runOnIdle {
            assertEquals(1, points.size)
            val point = points.single()
            assertTrue(point.x > 1.0)
            assertEquals(1, app.fableshot.android.domain.TargetCatalog.practice.scoreShaft(point, 6.0, 400).points)
        }
        board().performTouchInput { click(Offset(centerX + width * .44f * 1.04f, centerY)) }
        ui.runOnIdle { assertEquals(1, points.size) }
    }

    @Test fun panOnlyMovesAtOneTimesWithoutAimingAndSelectionEditsTheMovedTarget() {
        val panMode = mutableStateOf(true)
        mount(panMode = panMode)
        board().performTouchInput { click(center) }
        ui.runOnIdle { assertTrue(points.isEmpty()) }
        board().performTouchInput {
            down(center)
            advanceEventTime(220)
            moveTo(center + Offset(width * .25f, 0f))
        }
        ui.onNodeWithTag("magnifier").assertDoesNotExist()
        ui.runOnIdle { assertTrue(points.isEmpty()) }
        board().performTouchInput { up() }
        val moved = board().captureToImage().asAndroidBitmap()
        val movedCenter = moved.getPixel((moved.width * .75f).toInt(), (moved.height * .53f).toInt())
        val oldCenter = moved.getPixel(moved.width / 2, (moved.height * .53f).toInt())
        assertTrue("Dragged target centre must be yellow at 1×", android.graphics.Color.red(movedCenter) > 200 && android.graphics.Color.blue(movedCenter) < 120)
        assertTrue("Previous centre must move into the blue rings", android.graphics.Color.blue(oldCenter) > android.graphics.Color.red(oldCenter))
        ui.runOnIdle { panMode.value = false }
        board().performTouchInput {
            down(Offset(width * .75f, centerY))
            advanceEventTime(220)
            moveTo(Offset(width * .75f, height * .4f))
        }
        ui.onNodeWithTag("magnifier").assertExists()
        board().performTouchInput { up() }
        ui.runOnIdle {
            assertEquals(1, points.size)
            assertEquals(0.0, points.single().x, .01)
            assertEquals(.1 / .44, points.single().y, .01)
        }
    }

    @Test fun panOnlyKeepsZoomControlsAndGlassButtonsClickable() {
        val panMode = mutableStateOf(true)
        var panelClicks = 0
        mount(glass = true, panMode = panMode, onPanelClick = { panelClicks++ })
        ui.onNodeWithTag("glass-action").performTouchInput { click(center) }
        ui.onNodeWithText("+").performTouchInput { click(center) }
        ui.onNodeWithTag("target-zoom").assertTextEquals(ui.activity.getString(R.string.zoom_value, 1.5f))
        ui.onNodeWithTag("target-zoom").performTouchInput { click(center) }
        ui.onNodeWithTag("target-zoom").assertTextEquals(ui.activity.getString(R.string.zoom_value, 1f))
        ui.onNodeWithTag("magnifier").assertDoesNotExist()
        ui.runOnIdle {
            assertEquals(1, panelClicks)
            assertTrue(points.isEmpty())
        }
    }

    @Test fun staggeredPinchDoesNotFlashOrPlaceAShot() {
        mount()
        board().performTouchInput { down(0, center - Offset(60f, 0f)) }
        ui.onNodeWithTag("magnifier").assertDoesNotExist()
        board().performTouchInput {
            advanceEventTime(45); down(1, center + Offset(60f, 0f))
            advanceEventTime(180)
            moveTo(0, center - Offset(130f, 0f)); moveTo(1, center + Offset(130f, 0f))
        }
        ui.onNodeWithTag("magnifier").assertDoesNotExist()
        board().performTouchInput { up(0); advanceEventTime(180); moveTo(1, center); up(1) }
        ui.runOnIdle { assertTrue(points.isEmpty()) }
    }

    @Test fun secondFingerOnZoomButtonAlsoCancelsPlacement() {
        mount()
        val boardBounds = board().fetchSemanticsNode().boundsInRoot
        val zoomBounds = ui.onNodeWithTag("target-zoom").fetchSemanticsNode().boundsInRoot
        val button = zoomBounds.center - boardBounds.topLeft
        board().performTouchInput {
            down(0, center); advanceEventTime(30); down(1, button)
            advanceEventTime(200); moveTo(0, center - Offset(80f, 0f)); moveTo(1, button + Offset(20f, 0f))
            up(0); advanceEventTime(50); up(1)
        }
        ui.onNodeWithTag("magnifier").assertDoesNotExist()
        ui.runOnIdle { assertTrue(points.isEmpty()) }
    }

    @Test fun lensIsAlwaysAboveAndCanOverlayTheHeader() {
        mount()
        // Real stationary hold must work without requiring a move event.
        board().performTouchInput { down(Offset(centerX, height * .78f)) }
        ui.waitUntil(3_000) { ui.onAllNodesWithTag("magnifier").fetchSemanticsNodes().isNotEmpty() }
        val aboveLens = ui.onNodeWithTag("magnifier").fetchSemanticsNode().boundsInRoot
        val aboveBadge = ui.onNodeWithTag("magnifier-zone").fetchSemanticsNode().boundsInRoot
        assertTrue(aboveBadge.bottom <= aboveLens.top + 1f)
        capture("lens-above.png")
        board().performTouchInput { moveTo(Offset(centerX, height * .18f)) }
        val upperLens = ui.onNodeWithTag("magnifier").fetchSemanticsNode().boundsInRoot
        val upperBadge = ui.onNodeWithTag("magnifier-zone").fetchSemanticsNode().boundsInRoot
        val input = board().fetchSemanticsNode().boundsInRoot
        assertTrue(upperBadge.bottom <= upperLens.top + 1f)
        assertTrue(upperLens.bottom < input.top + input.height * .18f)
        assertTrue("Lens must escape the target viewport", upperLens.top < input.top)
        capture("lens-always-above.png")
        board().performTouchInput { up() }
        ui.runOnIdle { assertEquals(1, points.size) }
    }

    @Test fun lateSecondFingerCancelsExistingAimUntilEveryFingerLifts() {
        mount()
        board().performTouchInput { down(0, center); advanceEventTime(220); moveTo(0, center + Offset(5f, 0f)) }
        ui.onNodeWithTag("magnifier").assertExists()
        board().performTouchInput { down(1, center + Offset(100f, 0f)) }
        ui.onNodeWithTag("magnifier").assertDoesNotExist()
        board().performTouchInput { up(1); advanceEventTime(300); moveTo(0, center - Offset(20f, 0f)) }
        ui.onNodeWithTag("magnifier").assertDoesNotExist()
        board().performTouchInput { up(0) }
        ui.runOnIdle { assertTrue(points.isEmpty()) }
        board().performTouchInput { click(center) }
        ui.runOnIdle { assertEquals(1, points.size) }
    }

    @Test fun zoomedSceneStopsAtStageBoundary() {
        mount()
        repeat(5) { ui.onNodeWithText("+").performClick() }
        val image = ui.onNodeWithTag("below-board").captureToImage().asAndroidBitmap()
        // Only the scene's frosted slots may cover target content; unrelated UI stays outside.
        val purple = android.graphics.Color.rgb(184, 60, 191)
        for (y in listOf(1, image.height / 2, image.height - 2)) {
            for (x in listOf(1, image.width / 2, image.width - 2)) assertEquals(purple, image.getPixel(x, y))
        }
        capture("zoom-clipped.png")
        ui.runOnIdle { assertTrue(points.isEmpty()) }
    }

    @Test fun fullWidthZoomContinuesBehindBothGlassPanels() {
        mount(glass = true)
        val input = board().fetchSemanticsNode().boundsInRoot
        val root = ui.onRoot().fetchSemanticsNode().boundsInRoot
        assertEquals(root.left, input.left, 1f)
        assertEquals(root.right, input.right, 1f)
        fun panelPixel(tag: String): Int {
            val bitmap = ui.onNodeWithTag(tag).captureToImage().asAndroidBitmap()
            return bitmap.getPixel(bitmap.width / 2, bitmap.height * 3 / 4)
        }
        val beforeTop = panelPixel("target-top-panel")
        val beforeBottom = panelPixel("target-bottom-panel")
        repeat(3) { ui.onNodeWithText("+").performClick() }
        assertNotEquals(beforeTop, panelPixel("target-top-panel"))
        assertNotEquals(beforeBottom, panelPixel("target-bottom-panel"))
        capture("glass-panels.png")
        repeat(2) { ui.onNodeWithText("+").performClick() }
        val bitmap = board().captureToImage().asAndroidBitmap()
        // At 7.6x the yellow centre covers both screen edges, with no 300dp crop.
        for (x in listOf(1, bitmap.width - 2)) {
            val color = bitmap.getPixel(x, bitmap.height / 2)
            assertTrue(android.graphics.Color.red(color) > 200)
            assertTrue(android.graphics.Color.green(color) > 150)
            assertTrue(android.graphics.Color.blue(color) < 120)
        }
        capture("edge-to-edge-zoom.png")
        ui.runOnIdle { assertTrue(points.isEmpty()) }
    }

    @Test fun secondFingerOnGlassPanelCancelsPlacement() {
        mount(glass = true)
        val input = board().fetchSemanticsNode().boundsInRoot
        val stage = ui.onNodeWithTag("test-board").fetchSemanticsNode().boundsInRoot
        val localFinger = input.center - stage.topLeft
        ui.onNodeWithTag("test-board").performTouchInput {
            down(0, localFinger); advanceEventTime(40); down(1, Offset(localFinger.x, 20f))
            advanceEventTime(200); up(1); advanceEventTime(50); up(0)
        }
        ui.onNodeWithTag("magnifier").assertDoesNotExist()
        ui.runOnIdle { assertTrue(points.isEmpty()) }
    }
}


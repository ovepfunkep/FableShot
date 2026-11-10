package app.fableshot.android

import android.graphics.Bitmap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.SessionDetails
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Explicitly selected one method per run so force-stop can occur between runs. */
@RunWith(AndroidJUnit4::class)
class PersistenceSmokeTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val repo get() = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as FableShotApplication).repository
    private fun active(): SessionDetails? = runBlocking { repo.active.first() }
    private fun owned(): SessionDetails = requireNotNull(active()).also { assertEquals(TITLE, it.session.title) }
    private fun waitForScore(total: String) = ui.waitUntil(15_000) {
        ui.onAllNodesWithTag("end-score").fetchSemanticsNodes().any { node -> node.config.getOrElse(SemanticsProperties.Text) { emptyList() }.any { total in it.text } }
    }
    private fun click(tag: String) { ui.onNodeWithTag(tag).performScrollTo().performClick() }
    private fun capture(name: String) {
        val file = File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("verification"), name)
        file.outputStream().use { ui.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun createThreeShots() {
        // Never overwrite or delete an existing user session to make a test pass.
        assumeTrue("A user session is active; test intentionally skipped", active() == null)
        ui.waitUntil(15_000) { ui.onAllNodesWithTag("distance-10").fetchSemanticsNodes().isNotEmpty() }
        click("distance-10")
        click("diameter-60")
        ui.onNodeWithTag("title-field").performScrollTo().performTextInput(TITLE)
        click("start-training")
        ui.waitUntil(15_000) { ui.onAllNodesWithTag("mode-numbers").fetchSemanticsNodes().isNotEmpty() }
        click("mode-numbers")
        click("score-10"); click("score-9"); click("score-8")
        waitForScore("27")
        assertEquals(listOf(10, 9, 8), owned().allShots.map { it.points })
        assertTrue(owned().allShots.all { it.x == null && it.y == null })
        ui.onNodeWithTag("score-10").assertIsNotEnabled()
        capture("three-shots.png")
    }

    @Test fun verifyThreeShotsAfterRestartAndEditUndo() {
        ui.waitUntil(15_000) { ui.onAllNodesWithTag("end-score").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(listOf(10, 9, 8), owned().allShots.map { it.points })
        waitForScore("27")
        click("mode-numbers")
        click("shot-0"); click("score-7"); click("save-edit")
        waitForScore("24")
        assertEquals(listOf(7, 9, 8), owned().allShots.map { it.points })
        click("undo")
        waitForScore("27")
        assertEquals(listOf(10, 9, 8), owned().allShots.map { it.points })
        capture("restored-and-undo.png")
    }

    @Test fun magnifierAndTwoFingerZoom() {
        ui.waitUntil(15_000) { ui.onAllNodesWithTag("next-end").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(listOf(10, 9, 8), owned().allShots.map { it.points })
        click("next-end")
        ui.waitUntil(15_000) { active()?.currentEnd?.end?.number == 2 }
        click("mode-target")
        ui.onNodeWithTag("target-input").performScrollTo().performTouchInput { down(center); advanceEventTime(400); moveTo(center + Offset(8f, 5f)) }
        ui.onNodeWithTag("magnifier").assertExists()
        capture("magnifier.png")
        ui.onNodeWithTag("target-input").performTouchInput { up() }
        ui.waitUntil(15_000) { active()?.currentEnd?.shots?.size == 1 }
        assertTrue(owned().currentEnd!!.shots.single().x != null)
        ui.onNodeWithTag("target-input").performTouchInput {
            down(0, center - Offset(60f, 0f)); down(1, center + Offset(60f, 0f))
            advanceEventTime(100)
            moveTo(0, center - Offset(130f, 0f)); moveTo(1, center + Offset(130f, 0f))
            advanceEventTime(100); up(0); up(1)
        }
        assertEquals(1, owned().currentEnd!!.shots.size)
        val text = ui.onNodeWithTag("target-zoom").fetchSemanticsNode().config[SemanticsProperties.Text].joinToString { it.text }
        assertNotEquals(ui.activity.getString(R.string.zoom_value, 1f), text)
        capture("zoom.png")
        click("target-zoom")
        assertEquals(1, owned().currentEnd!!.shots.size)
    }

    companion object { const val TITLE = "FableShot-check" }
}

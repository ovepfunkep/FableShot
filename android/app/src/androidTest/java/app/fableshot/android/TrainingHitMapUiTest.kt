package app.fableshot.android

import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.File

class TrainingHitMapUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Before fun requireUnlockedFocusedActivity() {
        assertFalse("UI verification requires the user to unlock the device.",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    private fun fixture(): JournalDetails {
        val block = JournalBlock("block", "session", 0, "scored", 18.0, PRACTICE_PROFILE, 1, 400,
            practiceSnapshot(400), null, 3)
        val ends = (1..4).map { n ->
            val id = "end-$n"
            val positions = when (n) {
                1 -> listOf(TargetPoint(-.3, .1), TargetPoint(-.2, .1), TargetPoint(-.1, .1))
                2 -> listOf(TargetPoint(.4, .2), null, null)
                3 -> listOf(TargetPoint(.1, -.1), TargetPoint(.2, -.1), TargetPoint(.3, -.1))
                else -> listOf(null, null, null)
            }
            val shots = positions.mapIndexed { i, p ->
                val score = if (n == 2 && i == 2) 0 else 9
                JournalShot("$id-$i", id, i, score, if (score == 0) "M" else "9", null, null,
                    p?.x, p?.y, if (p == null) null else "main", "numeric_entry",
                    if (p == null) "none" else "manual_target", if (p == null) "unknown" else "known", null, 1)
            }
            JournalEndDetails(JournalEnd(id, block.id, n, 3, state = "closed"), shots, emptyList())
        }
        return JournalDetails(JournalSession("session", "Два раунда", 1, 1, state = "completed"),
            listOf(JournalBlockDetails(block, ends)), plans = listOf(SessionPlan("session", 4, 2)))
    }

    private fun select(id: String) {
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("training-map-select-series"))
        ui.onNodeWithTag("training-map-select-series").performClick()
        ui.onNodeWithTag("training-map-series-list").performScrollToNode(hasTestTag("training-map-series-$id"))
        ui.onNodeWithTag("training-map-series-$id").performClick()
    }

    private fun step(direction: String) {
        val tag = "training-map-$direction-series"
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag(tag))
        ui.onNodeWithTag(tag).performClick()
    }

    @Test fun selectedRoundSeriesFiltersCoordinatesAndCountsWithoutChangingCompositeScore() {
        val journal = fixture()
        ui.setContent { FableTheme(UserSettings(animations = false)) { Surface { JournalReportScreen(journal) } } }
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("report-result"))
        ui.onNode(hasTestTag("report-result-average") and hasAnyAncestor(hasTestTag("report-result"))).assertExists()
        ui.onNode(hasTestTag("report-result-grouping") and hasAnyAncestor(hasTestTag("report-result"))).assertExists()
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("cg3-card"))
        ui.onNodeWithTag("cg3-controls").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        ui.onNodeWithTag("cg3-profile-ScoreOnly").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        val cg3Before = ui.onNodeWithTag("cg3-total").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Text]
        assertFalse(cg3Before.single().text == "—")
        ui.onNodeWithTag("cg3-controls").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("training-map-coverage"))
        ui.onNodeWithTag("training-map-coverage").assertTextEquals("Координаты: 7 из 12 зачётных стрел")
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("geometry-heat"))
        ui.onNodeWithTag("geometry-heat").assertIsSelected()
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("training-map-series-controls"))
        val target=ui.onNodeWithTag("geometry-map").fetchSemanticsNode().boundsInRoot
        val controls=ui.onNodeWithTag("training-map-series-controls").fetchSemanticsNode().boundsInRoot
        val button=ui.onNodeWithTag("training-map-select-series").fetchSemanticsNode().boundsInRoot
        assertTrue("Series controls belong below the target",controls.top>=target.bottom)
        assertEquals("Series selection is centred under the target",target.center.x,button.center.x,1f)
        val folder=File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("verification"),"map-controls")
        check(folder.mkdirs()||folder.isDirectory)
        File(folder,"below-target.png").outputStream().use { output->
            assertTrue(ui.onRoot().captureToImage().asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG,100,output))
        }
        step("next")
        ui.onNodeWithTag("training-map-select-series").assertTextContains("Раунд 1 · Серия 1", substring = true)
        step("prev")
        ui.onNodeWithTag("training-map-select-series").assertTextContains("Все серии", substring = true)
        ui.onNodeWithTag("training-map-prev-series").assertIsNotEnabled()
        select("end-2")
        ui.onNodeWithTag("training-map-select-series").assertTextContains("Раунд 1 · Серия 2", substring = true)
        ui.onNodeWithTag("training-map-coverage").assertTextEquals("Координаты: 1 из 3 зачётных стрел")
        ui.onNodeWithTag("training-map-score").assertTextEquals("Очки: 18 · Стрелы: 3")
        ui.onNodeWithTag("training-map-missing").assertTextEquals("Промахи M: 1 · Без координат: 1")
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("training-map-offset"))
        ui.onNodeWithTag("training-map-offset").assertTextEquals("Смещение от центра: ${number(kotlin.math.hypot(.4, .2) * 200, 1)} мм")
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("geometry-points"))
        ui.onNodeWithTag("geometry-points").performClick().assertIsSelected()
        step("next")
        ui.onNodeWithTag("training-map-select-series").assertTextContains("Раунд 2 · Серия 1", substring = true)
        step("next")
        ui.onNodeWithTag("training-map-select-series").assertTextContains("Раунд 2 · Серия 2", substring = true)
        ui.onNodeWithTag("training-map-next-series").assertIsNotEnabled()
        ui.onNodeWithTag("training-map-coverage").assertTextEquals("Координаты: 0 из 3 зачётных стрел")
        ui.onNodeWithTag("training-map-unavailable").assertExists()
        ui.onNodeWithTag("geometry-map").assertDoesNotExist()
        select("all")
        ui.onNodeWithTag("training-map-select-series").assertTextContains("Все серии", substring = true)
        ui.onNodeWithTag("training-map-coverage").assertTextEquals("Координаты: 7 из 12 зачётных стрел")
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("geometry-points"))
        ui.onNodeWithTag("geometry-points").assertIsSelected()
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("cg3-card"))
        assertEquals(cg3Before, ui.onNodeWithTag("cg3-total").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Text])
        assertEquals(12, journal.allShots.size)
    }
}

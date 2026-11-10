package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import kotlin.math.abs
import kotlin.math.min

class SeriesEditorUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val block = JournalBlock("block", "session", 0, "scored", 18.0, PRACTICE_PROFILE,
        1, 400, practiceSnapshot(400), null, 3)
    private val end = JournalEnd("end", block.id, 0, 3, state = "closed")
    private val original = listOf(10, 9, 8).mapIndexed { index, score ->
        JournalShot("shot-$index", end.id, index, score, score.toString(), null, null,
            index * .12, .0, "main", "target_computed", "manual_target", "known", null, 1)
    }
    private val journal = mutableStateOf(JournalDetails(
        JournalSession("session", "Редактор · пример", 1, 1, state = "completed"),
        listOf(JournalBlockDetails(block, listOf(JournalEndDetails(end, original, emptyList()))))))
    private val saves = mutableListOf<JournalShot>()

    private fun mount(largeFont: Boolean = false) {
        ui.setContent {
            val current = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(current.density, if (largeFont) 1.5f else 1f)) {
                FableTheme(UserSettings(animations = false)) {
                    Surface(Modifier.requiredWidth(if (largeFont) 320.dp else 360.dp).fillMaxHeight()
                        .windowInsetsPadding(WindowInsets.safeDrawing)) {
                        TargetOverlayHost(Modifier.fillMaxSize()) {
                            JournalShotEditor(journal.value, original.first().id, false, { shot ->
                                saves += shot
                                journal.value = journal.value.copy(blocks = journal.value.blocks.map { entry ->
                                    entry.copy(ends = entry.ends.map { series ->
                                        series.copy(shots = series.shots.map {
                                            if (it.id == shot.id) shot.copy(revision = shot.revision + 1) else it
                                        })
                                    })
                                })
                            }, { _, _ -> }, {}, onNotes = {})
                        }
                    }
                }
            }
        }
    }

    @Test fun noArrowIsSelectedAndFooterStaysVisibleWithLargeFont() {
        mount(largeFont = true)
        original.forEach { ui.onNodeWithTag("report-edit-${it.id}").assertIsNotSelected() }
        ui.onNodeWithTag("history-close-editor").assertDoesNotExist()
        ui.onNodeWithTag("history-save-shot").assertIsDisplayed().assertIsNotEnabled()
        ui.onNodeWithTag("history-miss").assertIsNotEnabled()
        ui.onNodeWithTag("history-remove-shot").assertDoesNotExist()
        val notes = ui.onNodeWithTag("end-notes").fetchSemanticsNode().boundsInRoot
        val target = ui.onNodeWithTag("history-target-area").fetchSemanticsNode().boundsInRoot
        val footer = ui.onNodeWithTag("training-editor-footer").fetchSemanticsNode().boundsInRoot
        assertTrue(target.bottom <= footer.top)
        assertTrue(notes.top >= footer.top)
        val miss = ui.onNodeWithTag("history-miss").fetchSemanticsNode().boundsInRoot
        val save = ui.onNodeWithTag("history-save-shot").fetchSemanticsNode().boundsInRoot
        assertTrue(miss.right < save.left)
        assertTrue(abs(miss.center.y - save.center.y) < 1f)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.getExternalFilesDir("verification"), "series-editor-0.30.0-large.png")
        file.outputStream().use {
            ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun unselectedDragDoesNotEditAndExplicitSelectionCanBeSavedOrCleared() {
        mount()
        ui.onNodeWithTag("target-input").assertIsDisplayed().performTouchInput {
            swipe(center, center + Offset(36f, 20f), durationMillis = 400)
        }
        ui.onNodeWithTag("history-save-shot").assertIsNotEnabled()
        ui.onNodeWithTag("magnifier").assertDoesNotExist()
        assertTrue(saves.isEmpty())
        ui.onNodeWithTag("report-edit-shot-1").assertIsDisplayed().performClick().assertIsSelected()
        ui.onNodeWithTag("history-miss").assertIsDisplayed().performClick()
        ui.onNodeWithTag("history-save-shot").assertIsEnabled().performClick()
        ui.runOnIdle {
            assertEquals(1, saves.size)
            assertEquals("shot-1", saves.single().id)
            assertEquals(0, saves.single().points)
            assertEquals("M", saves.single().zoneCode)
            assertNull(saves.single().x)
            assertNull(saves.single().y)
            assertEquals(original.first(), journal.value.allShots.first())
        }
        ui.onNodeWithTag("history-save-shot").assertIsNotEnabled()
        ui.onNodeWithTag("report-edit-shot-1").assertIsDisplayed().performClick().assertIsNotSelected()
        ui.onNodeWithTag("history-miss").assertIsNotEnabled()
    }

    @Test fun numberOnlyEditPreservesAllLegacyNativeAndImportedScoringFacts() {
        val native = original[0].copy(points = 9, zoneCode = "9", x = .11, automaticPoints = 9,
            automaticRuleVersion = TargetCatalog.practice.rule, physicalArrowNumber = 777)
        val imported = original[1].copy(points = 8, zoneCode = "8", x = .11,
            scoreSource = "imported", positionSource = "imported", physicalArrowNumber = 888)
        journal.value = journal.value.copy(blocks = listOf(JournalBlockDetails(block,
            listOf(JournalEndDetails(end, listOf(native, imported), emptyList())))))
        mount()
        for (shot in listOf(native, imported)) {
            ui.onNodeWithTag("report-edit-${shot.id}").assertIsDisplayed().performClick()
            ui.onNodeWithTag("history-physical-arrow-choice").assertIsDisplayed().performClick()
            ui.onNodeWithTag("physical-arrow-none").performClick()
            ui.onNodeWithTag("history-save-shot").assertIsDisplayed().assertIsEnabled().performClick()
            ui.runOnIdle {
                assertEquals(shot.copy(physicalArrowNumber = null), saves.last())
                assertNull(saves.last().shaftDiameterMm)
            }
        }
        assertEquals(2, saves.size)
    }

    @Test fun movingAnImportedPointUsesTheTouchedShaftZoneAndKeepsTheCentre() {
        val imported = original[0].copy(points = 8, zoneCode = "8", x = .25,
            scoreSource = "imported", positionSource = "imported")
        journal.value = journal.value.copy(blocks = listOf(JournalBlockDetails(block,
            listOf(JournalEndDetails(end, listOf(imported), emptyList())))))
        mount()
        ui.onNodeWithTag("report-edit-${imported.id}").assertIsDisplayed().performClick()
        ui.onNodeWithTag("target-input").assertIsDisplayed().performTouchInput {
            click(center + Offset(min(width, height) * .44f * .11f, 0f))
        }
        ui.onNodeWithTag("history-edit-result").assertIsDisplayed().assertTextContains("10", substring = true)
        ui.onNodeWithTag("history-save-shot").assertIsDisplayed().assertIsEnabled().performClick()
        ui.runOnIdle {
            val saved = saves.single()
            assertEquals(10, saved.points)
            assertEquals("10", saved.zoneCode)
            assertEquals(.11, requireNotNull(saved.x), .00001)
            assertEquals(0.0, requireNotNull(saved.y), .00001)
            assertEquals("target_computed", saved.scoreSource)
            assertEquals("manual_target", saved.positionSource)
        }
    }
}

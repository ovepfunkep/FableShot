package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.ShotEntity
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Normal-size isolated UI fixtures: a full round must never accept another fact or advance itself. */
class RoundBoundaryFeedbackUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val block = JournalBlock("block","session",0,"scored",18.0,PRACTICE_PROFILE,
        1,400,practiceSnapshot(400),null,3)
    private val end = JournalEnd("end",block.id,0,3)
    private val shots = listOf(9,8,7).mapIndexed { index, points ->
        JournalShot("shot-$index",end.id,index,points,points.toString(),null,null,
            null,null,null,"numeric_entry","none","unknown",null,1)
    }
    private val journal = mutableStateOf(JournalDetails(JournalSession("session","Fixture",1,1),
        listOf(JournalBlockDetails(block,listOf(JournalEndDetails(end,shots,emptyList())))),
        plans=listOf(SessionPlan("session",0,rolling=true,roundArrowLimit=3))))
    private var appends = 0
    private var advances = 0
    private val updates = mutableListOf<ShotEntity>()
    private val highlighted = SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"Подсказка: следующий раунд")

    private fun mount(motion: Boolean = true) {
        ui.setContent {
            FableTheme(UserSettings(animations=motion)) {
                // Respect the user's system animator setting in production; this fixture controls motion explicitly.
                CompositionLocalProvider(LocalFableVisuals provides LocalFableVisuals.current.copy(motion=motion)) {
                    Surface(Modifier.requiredSize(360.dp,700.dp)) {
                        TargetOverlayHost(Modifier.fillMaxSize()) {
                            ActivePractice(journal.value.presentation(),PracticeCommands(
                                {_,_->appends++},{_,_->appends++},{updates+=it},{},{advances++}),false,false,{}, {})
                        }
                    }
                }
            }
        }
        ui.onNodeWithTag("next-end").assertIsDisplayed().assertIsEnabled()
        ui.mainClock.autoAdvance=false
    }

    @Test fun fullRoundTapHighlightsNextOnlyAfterReleaseAndKeepsBoundsAndFacts() {
        mount()
        val next = ui.onNodeWithTag("next-end")
        next.assertTextContains(ui.activity.getString(R.string.next_round))
        val before = next.fetchSemanticsNode().boundsInRoot
        fun borderPixel(): Int {
            val bitmap=next.captureToImage().asAndroidBitmap()
            return try { bitmap.getPixel(bitmap.width/2,(bitmap.height*3f/56).toInt()) } finally { bitmap.recycle() }
        }
        val normalBorder=borderPixel()
        ui.onNodeWithTag("target-input").performTouchInput { down(center) }
        next.assert(!highlighted)
        ui.onNodeWithTag("target-input").performTouchInput { up() }
        ui.mainClock.advanceTimeBy(128)
        next.assert(highlighted)
        assertNotEquals("Boundary hint must visibly change the action border",normalBorder,borderPixel())
        assertEquals(before,next.fetchSemanticsNode().boundsInRoot)
        ui.mainClock.advanceTimeBy(256)
        ui.onNodeWithTag("target-input").performTouchInput { click(center) }
        ui.mainClock.advanceTimeBy(352)
        next.assert(highlighted)
        ui.mainClock.advanceTimeBy(700)
        next.assert(!highlighted)
        ui.runOnIdle {
            assertEquals(3,journal.value.allShots.size)
            assertEquals(0,appends)
            assertEquals(0,advances)
            assertTrue(updates.isEmpty())
        }
        assertEquals(before,next.fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithTag("shot-0").performClick()
        ui.mainClock.advanceTimeBy(32)
        ui.onNodeWithTag("undo").performClick()
        ui.mainClock.advanceTimeBy(128)
        next.assert(!highlighted)
    }

    @Test fun editingAHitAtTheRoundLimitStillWorksWithoutNextRoundFeedback() {
        mount()
        ui.onNodeWithTag("shot-0").performClick()
        ui.mainClock.advanceTimeByFrame()
        ui.onNodeWithTag("shot-0").assertIsSelected()
        ui.onNodeWithTag("target-input").performTouchInput { click(center) }
        ui.mainClock.advanceTimeBy(128)
        ui.onNodeWithTag("save-edit").assert(!highlighted).assertIsEnabled().performClick()
        ui.mainClock.advanceTimeBy(128)
        ui.runOnIdle {
            assertEquals(1,updates.size)
            assertEquals(10,updates.single().points)
            assertEquals(0.0,updates.single().x!!,.0001)
            assertEquals(3,journal.value.allShots.size)
            assertEquals(0,appends)
            assertEquals(0,advances)
        }
        ui.onNodeWithTag("next-end").assert(!highlighted)
    }

    @Test fun disabledMotionDoesNotAnimateTheBoundaryFeedback() {
        mount(motion=false)
        ui.onNodeWithTag("target-input").performTouchInput { click(center) }
        ui.mainClock.advanceTimeBy(128)
        ui.onNodeWithTag("next-end").assert(!highlighted)
        ui.runOnIdle { assertEquals(0,appends);assertEquals(0,advances) }
    }

    @Test fun blockedDragPinchPanAndControlsNeverCountAsBlockedTaps() {
        var blocked = 0
        var entered = 0
        val panOnly = mutableStateOf(false)
        ui.setContent {
            MaterialTheme {
                TargetOverlayHost(Modifier.fillMaxSize()) {
                    TargetBoard(Modifier.size(300.dp),"gesture","end",emptyList(),null,false,
                        { entered++ },panOnly=panOnly.value,onBlockedTap={blocked++})
                }
            }
        }
        val board=ui.onNodeWithTag("target-input")
        board.performTouchInput { swipe(center,center+Offset(70f,0f),400) }
        board.performTouchInput {
            down(0,center-Offset(40f,0f));advanceEventTime(40);down(1,center+Offset(40f,0f))
            moveTo(0,center-Offset(80f,0f));moveTo(1,center+Offset(80f,0f))
            up(0);advanceEventTime(40);up(1)
        }
        ui.onNodeWithTag("target-zoom").performClick()
        ui.runOnIdle { panOnly.value=true }
        board.performTouchInput { click(center) }
        ui.runOnIdle { assertEquals(0,blocked);assertEquals(0,entered);panOnly.value=false }
        board.performTouchInput { down(center) }
        ui.runOnIdle { assertEquals(0,blocked) }
        board.performTouchInput { up() }
        ui.runOnIdle { assertEquals(1,blocked);assertEquals(0,entered) }
    }
}

package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/** Animation clock and object fixtures only; never opens an installed diary. */
class NumberedHitMotionTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private val journal=mutableStateOf(fixture())

    private fun fixture():JournalDetails {
        val bow=EquipmentItem("bow","bow","Лук",category="recurve")
        val arrows=EquipmentItem("arrows","arrows","Стрелы",numberedCount=6)
        val kit=EquipmentItem("kit","setup","Комплект",bowId=bow.id,arrowsId=arrows.id)
        val profile=TargetCatalog.indoor
        val block=JournalBlock("block","session",0,"scored",18.0,profile.id,1,400,
            profile.snapshot(400),equipmentSnapshot(kit,listOf(kit,bow,arrows)),3)
        val end=JournalEnd("end",block.id,0,3)
        val old=JournalShot("old",end.id,0,9,"9",null,null,.15,0.0,"main",
            "target_computed","manual_target","known",1,1)
        return JournalDetails(JournalSession("session","Fixture",1,1,numberedArrows=true),
            listOf(JournalBlockDetails(block,listOf(JournalEndDetails(end,listOf(old),emptyList())))))
    }

    private fun append(endId:String,point:TargetPoint?,number:Int?) {
        val entry=journal.value.currentEnd!!
        val shot=JournalShot("new",endId,entry.shots.size,10,"10",null,null,point?.x,point?.y,
            "main","target_computed","manual_target","known",number,2)
        journal.value=journal.value.copy(blocks=journal.value.blocks.map { block->
            block.copy(ends=block.ends.map { end->if(end.end.id==endId)end.copy(shots=end.shots+shot)else end })
        })
    }

    private fun update(value:ShotEntity) {
        journal.value=journal.value.copy(blocks=journal.value.blocks.map { block->
            block.copy(ends=block.ends.map { end->end.copy(shots=end.shots.map { shot->
                if(shot.id==value.id)shot.copy(physicalArrowNumber=value.physicalArrowNumber,revision=shot.revision+1)else shot
            }) })
        })
    }

    private fun mount(motion:Boolean) {
        ui.setContent {
            CompositionLocalProvider(LocalRankPreferences provides RankPreferences("male")) {
                FableTheme(UserSettings(animations=motion)) {
                    Surface(Modifier.requiredWidth(360.dp).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing)) {
                        TargetOverlayHost(Modifier.fillMaxSize()) {
                            ActivePractice(journal.value.presentation(),PracticeCommands(
                                point={e,p->append(e,p,null)},numeric={_,_->},update=::update,
                                undo={},next={},numberedPoint={e,p,n->append(e,p,n)}),
                                canUndo=false,busy=false,onStats={},onFinish={})
                        }
                    }
                }
            }
        }
        ui.waitForIdle()
    }

    private fun scorePixels():String {
        val bytes=ByteArrayOutputStream()
        ui.onNodeWithTag("end-score",useUnmergedTree=true).captureToImage().asAndroidBitmap()
            .compress(android.graphics.Bitmap.CompressFormat.PNG,100,bytes)
        return MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()).joinToString("") {"%02x".format(it)}
    }

    @Test fun valuesHaveIntermediateFramesBeforeNumberPromptAndSelectionClosesWithMotion() {
        ui.mainClock.autoAdvance=false
        mount(true)
        val before=ui.onNodeWithTag("training-editor-footer").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithTag("target-input").performTouchInput {click(center)}
        repeat(2) {ui.mainClock.advanceTimeByFrame()}
        ui.onNodeWithTag("end-score",useUnmergedTree=true).assertTextEquals("19/30")
        ui.onNodeWithTag("physical-arrow-picker").assertDoesNotExist()
        val frames=mutableSetOf<String>()
        repeat(4) {
            ui.mainClock.advanceTimeBy(32)
            frames+=scorePixels()
            ui.onNodeWithTag("physical-arrow-picker").assertDoesNotExist()
        }
        assertTrue("The numeric transition must contain multiple rendered intermediate states",frames.size>=3)
        assertEquals(before,ui.onNodeWithTag("training-editor-footer").fetchSemanticsNode().boundsInRoot)
        ui.mainClock.autoAdvance=true
        ui.waitUntil(5_000) {ui.onAllNodesWithTag("physical-arrow-picker").fetchSemanticsNodes().isNotEmpty()}
        ui.waitForIdle()
        ui.mainClock.autoAdvance=false
        ui.onNodeWithTag("physical-arrow-quick-2").performClick()
        repeat(2) {ui.mainClock.advanceTimeByFrame()}
        assertEquals(2,journal.value.allShots.last().physicalArrowNumber)
        ui.onNodeWithTag("physical-arrow-picker").assertExists()
        ui.mainClock.autoAdvance=true
        ui.waitUntil(5_000) {ui.onAllNodesWithTag("physical-arrow-picker").fetchSemanticsNodes().isEmpty()}
        assertEquals(listOf(9,10),journal.value.allShots.map {it.points})
    }

    @Test fun disablingMotionDoesNotRequireAdvancingAnimationClockToOpenOrFinishSelection() {
        ui.mainClock.autoAdvance=false
        mount(false)
        ui.onNodeWithTag("target-input").performTouchInput {click(center)}
        repeat(3) {ui.mainClock.advanceTimeByFrame()}
        ui.onNodeWithTag("physical-arrow-picker").assertExists()
        // Material's window entrance is independent; finish it before tapping its number.
        ui.mainClock.autoAdvance=true
        ui.waitForIdle()
        ui.mainClock.autoAdvance=false
        ui.onNodeWithTag("physical-arrow-quick-2").performClick()
        repeat(3) {ui.mainClock.advanceTimeByFrame()}
        ui.onNodeWithTag("physical-arrow-picker").assertDoesNotExist()
        assertEquals(2,journal.value.allShots.last().physicalArrowNumber)
    }
}

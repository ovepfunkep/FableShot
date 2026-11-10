package app.fableshot.android

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.*
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class JournalDesignTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private val page=mutableStateOf("setup")
    private val appearance=mutableStateOf(Appearance.Dark)
    private val fontScale=mutableFloatStateOf(1f)
    private val equipment=listOf(
        EquipmentItem(id="reference-bow",kind="bow",name="Клубный баребоу",category="barebow",drawWeightLb=24.0,revision=2),
        EquipmentItem(id="reference-arrows",kind="arrows",name="Carbon · 800",spine=800,revision=1),
        EquipmentItem(id="reference-setup",kind="setup",name="Мой тренировочный комплект",bowId="reference-bow",arrowsId="reference-arrows",favorite=true,revision=1),
    )
    private val block=JournalBlock("reference-block","reference-journal",0,"scored",18.0,PRACTICE_PROFILE,1,600,practiceSnapshot(600),equipmentSnapshot(equipment.last(),equipment),3)
    private val end=JournalEnd("reference-end",block.id,0,3,state="closed")
    private val shots=listOf(0.02 to 0.03,0.13 to 0.01,-0.02 to 0.08).mapIndexed{i,p->JournalShot("reference-shot-$i",end.id,i,if(i==1)9 else 10,if(i==1)"9"else"10",null,null,p.first,p.second,"main","target_computed","manual_target","known",null,1793257200000)}
    private val journal=JournalDetails(JournalSession("reference-journal","Вечерняя практика",1793257200000,1793257200000,state="completed"),listOf(JournalBlockDetails(block,listOf(JournalEndDetails(end,shots,emptyList())))))
    private val countBlock=block.copy(id="reference-count-block",mode="count_only",targetProfileId=null,targetProfileVersion=null,targetSnapshotJson=null)
    private val countEnd=JournalEnd("reference-count-end",countBlock.id,0,6)
    private val count=journal.copy(session=journal.session.copy(state="active"),blocks=listOf(JournalBlockDetails(countBlock,listOf(JournalEndDetails(countEnd,emptyList(),listOf(JournalCount(countEnd.id,4,1,1)))))))
    private fun mount() {
        ui.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,fontScale.floatValue)) {
                FableTheme(UserSettings(appearance=appearance.value,animations=false)) {
                    Surface(Modifier.fillMaxSize()) {TargetOverlayHost(Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                            Text("ДИЗАЙН · ПРИМЕР ДАННЫХ",Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp),style=MaterialTheme.typography.labelSmall)
                            ShellTopBar(page.value,"equipment",UserSettings(),{},{},{})
                            Box(Modifier.weight(1f)) {when(page.value){
                                "setup"->JournalSetupScreen(false,equipment=equipment){_,_->}
                                "equipment"->EquipmentScreen(equipment,false,false){_,_->}
                                "count"->CountPractice(count,false,{},{},{},{})
                                "report"->JournalReportScreen(journal,{})
                                "edit"->JournalShotEditor(journal,shots[1].id,false,{},{_,_->},{})
                            }}
                        }
                    }}
                }
            }
        }
    }
    private fun capture(name:String) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(context.getExternalFilesDir("verification"),"f03").apply{mkdirs()}
        File(directory,name).outputStream().use{ui.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG,100,it)}
    }
    @Test fun journalScreensHaveNativeReferencesInBothAppearances() {
        mount()
        for(mode in listOf(Appearance.Dark,Appearance.Light))for(route in listOf("setup","equipment","count","report","edit")) {
            ui.runOnIdle{appearance.value=mode;page.value=route};ui.waitForIdle();capture("$route-sport-${mode.wire}.png")
        }
    }
    @Test fun largerTextRetainsSetupAndCounterActions() {
        mount();ui.runOnIdle{fontScale.floatValue=1.5f};ui.waitForIdle()
        ui.onNodeWithTag("start-training").performScrollTo().assertIsDisplayed()
        capture("setup-large-text.png")
        ui.runOnIdle{page.value="count"};ui.waitForIdle()
        ui.onNodeWithTag("count-plus").performScrollTo().assertIsDisplayed().assertIsEnabled()
        capture("count-large-text.png")
    }

    @Test fun compactReportAndRankLabelFitNarrowScreenWithLargeText() {
        val scores=listOf(10,10,9,8,7,6)
        val scoredEnd=end.copy(plannedCount=6)
        val scoredShots=scores.mapIndexed { index, score ->
            shots.first().copy(id="large-shot-$index",inputIndex=index,points=score,zoneCode=score.toString())
        }
        val details=journal.copy(blocks=listOf(JournalBlockDetails(
            block.copy(targetDiameterMm=400,targetProfileId="wa-indoor-outer-v1"),
            listOf(JournalEndDetails(scoredEnd,scoredShots,emptyList())))))
        val showRank=mutableStateOf(false)
        ui.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,fontScale.floatValue),
                LocalRankPreferences provides RankPreferences("male")) {
                FableTheme(UserSettings(animations=false)) {
                    Surface(Modifier.requiredWidth(280.dp).fillMaxHeight()) {
                        if(showRank.value) Column(Modifier.padding(16.dp)) { SportRankPanel(details,compact=true) }
                        else JournalReportScreen(details,{})
                    }
                }
            }
        }
        for(scale in listOf(1.5f,2f)) {
            ui.runOnIdle {fontScale.floatValue=scale;showRank.value=false}
            ui.onNodeWithTag("report-end-${end.id}").assertIsDisplayed()
            val bounds=ui.onNodeWithTag("report-end-${end.id}").fetchSemanticsNode().boundsInRoot
            scores.indices.forEach { index ->
                val hit=ui.onNodeWithTag("report-hit-large-shot-$index",useUnmergedTree=true)
                hit.assertIsDisplayed()
                val rect=hit.fetchSemanticsNode().boundsInRoot
                org.junit.Assert.assertTrue(rect.left>=bounds.left && rect.right<=bounds.right)
            }
            capture("report-280-font${(scale*100).toInt()}.png")
            ui.runOnIdle {showRank.value=true}
            val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            ui.onNodeWithTag("rank-details").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(layouts) }
            org.junit.Assert.assertEquals(1,layouts.single().lineCount)
            org.junit.Assert.assertFalse(layouts.single().didOverflowWidth)
            ui.onNodeWithTag("rank-details").assertTextContains("КЛб(М)",substring=true)
        }
    }

    @Test fun unverifiedImportedShotDoesNotGetInventedGeometryOrNumericInput() {
        val unknown=journal.copy(blocks=listOf(JournalBlockDetails(
            block.copy(targetProfileId="mytargets-source-unknown",targetSnapshotJson=null),
            listOf(JournalEndDetails(end,listOf(shots.first().copy(points=7,zoneCode="7",positionStatus="unverified",positionSource="imported")),emptyList())))))
        var saved=false
        ui.setContent { FableTheme(UserSettings()) {
            JournalShotEditor(unknown,shots.first().id,false,{saved=true},{_,_->},{})
        } }
        ui.onNodeWithTag("history-target-unavailable").assertExists()
        ui.onNodeWithTag("target-input").assertDoesNotExist()
        ui.onNodeWithTag("history-mode-numbers").assertDoesNotExist()
        ui.onNodeWithTag("history-score-7").assertDoesNotExist()
        ui.onNodeWithTag("history-save-shot").assertIsNotEnabled()
        org.junit.Assert.assertFalse(saved)
        org.junit.Assert.assertEquals(7,unknown.allShots.single().points)
        org.junit.Assert.assertEquals("unverified",unknown.allShots.single().positionStatus)
    }
}

package app.fableshot.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.*
import app.fableshot.android.ui.*
import org.junit.*
import org.junit.Assert.*
import java.io.File

class CompositeScoreUiTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private val journal=mutableStateOf(fixture())
    private val warmupEnd get()=JournalEndDetails(JournalEnd("warmup","block",0,3,role="warmup",state="closed"),listOf(shot("warmup",0,0,.8,.8),shot("warmup",1,0,-.8,.8),shot("warmup",2,0,.8,-.8)),emptyList())
    private fun shot(end:String,i:Int,score:Int,x:Double?,y:Double?)=JournalShot("$end-shot-$i",end,i,score,if(score==0)"M"else score.toString(),null,null,x,y,if(x!=null)"main"else null,"numeric_entry",if(x!=null)"manual_target"else"none",if(x!=null)"known"else"unknown",null,1)
    private fun fixture(numeric:Boolean=false,partial:Boolean=false):JournalDetails {
        val b=JournalBlock("block","session",0,"scored",18.0,PRACTICE_PROFILE,1,600,practiceSnapshot(600),null,3)
        val ends=(1..3).map{index->val id="end-$index";val shots=listOf(shot(id,0,10,if(numeric)null else .095,if(numeric)null else .0),shot(id,1,10,if(numeric)null else .098,if(numeric)null else .002),shot(id,2,9,if(numeric)null else .105,if(numeric)null else -.001)).let{if(partial&&index==2)it.take(2)else it};JournalEndDetails(JournalEnd(id,b.id,index,3,state="closed"),shots,emptyList())}
        return JournalDetails(JournalSession("session","Сравнение групп",1,1,state="completed"),listOf(JournalBlockDetails(b,ends)))
    }
    private fun mount():StateRestorationTester {
        val restoration=StateRestorationTester(ui)
        restoration.setContent{FableTheme(UserSettings(appearance=Appearance.Dark,animations=false)){Surface{Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){Text("ДИЗАЙН · ПРИМЕР ДАННЫХ",Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp));Box(Modifier.weight(1f)){JournalReportScreen(journal.value)}}}}}
        return restoration
    }
    private fun cg3(){ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("cg3-card"))}
    private fun click(tag:String){
        if(tag=="cg3-explain"&&ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty())click("cg3-help")
        if(ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty()&&tag!="cg3-controls")click("cg3-controls")
        // Exercise accessible control actions independently of LazyColumn's item scroll estimates.
        ui.onNodeWithTag(tag).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick){it()}
    }
    @Test fun fullBreakdownAndSliceSurviveRecreationAndIgnoreFutureEnds() {
        val restoration=mount();cg3();ui.onNodeWithTag("cg3-total").assertTextEquals("101.49")
        click("cg3-slice-2");ui.onNodeWithTag("cg3-total").assertTextEquals("101.45")
        ui.onNodeWithTag("cg3-phase").assertDoesNotExist()
        restoration.emulateSavedInstanceStateRestore();cg3();ui.onNodeWithTag("cg3-total").assertTextEquals("101.45")
        val before=journal.value;val block=before.blocks.single();val last=block.ends.last();val future=last.copy(end=last.end.copy(id="future",ordinal=4),shots=last.shots.mapIndexed{i,s->s.copy(id="future-$i",endId="future",points=0,x=.9,y=.9)})
        ui.runOnIdle{journal.value=before.copy(blocks=listOf(block.copy(ends=block.ends+future)))}
        ui.onNodeWithTag("cg3-total").assertTextEquals("101.45")
    }
    @Test fun numericEntryNeedsExplicitProfileAndSingleEndDoesNotGetStability() {
        journal.value=fixture(numeric=true);mount();cg3()
        ui.onNodeWithTag("cg3-total").assertTextEquals("—");ui.onNodeWithTag("cg3-reason").assertTextContains("на мишени",substring=true)
        click("cg3-profile-ScoreOnly");ui.onNodeWithTag("cg3-total").assertTextEquals("101.67")
        click("cg3-single");ui.onNodeWithTag("cg3-total").assertTextEquals("—")
        click("cg3-cumulative");click("cg3-slice-2");ui.onNodeWithTag("cg3-total").assertTextEquals("—")
    }

    @Test fun missWithoutPositionKeepsStandardScoreWhileUnknownHitBlocksIt() {
        val source=fixture()
        val block=source.blocks.single()
        val ends=block.ends.map {entry ->
            entry.copy(shots=entry.shots.take(2)+shot(entry.end.id,2,0,null,null))
        }
        journal.value=source.copy(blocks=listOf(block.copy(ends=ends)))
        mount();cg3()
        ui.onNodeWithTag("cg3-total").assertTextEquals("71.59")
        ui.onNodeWithTag("cg3-reason").assertDoesNotExist()
        ui.runOnIdle {
            val first=ends.first()
            val unknown=first.copy(shots=first.shots.take(2)+shot(first.end.id,2,9,null,null))
            journal.value=source.copy(blocks=listOf(block.copy(ends=listOf(unknown)+ends.drop(1))))
        }
        ui.onNodeWithTag("cg3-total").assertTextEquals("—")
        ui.onNodeWithTag("cg3-reason").assertTextContains("попадания",substring=true)
    }
    @Test fun warmupAndUnusedNextEndStayExcludedAndPartialSeriesDoesNotBlockTheReport() {
        val base=journal.value;val block=base.blocks.single();val empty=JournalEndDetails(JournalEnd("unused",block.block.id,4,3),emptyList(),emptyList())
        journal.value=base.copy(blocks=listOf(block.copy(ends=listOf(warmupEnd)+block.ends+empty)))
        mount();cg3();ui.onNodeWithTag("cg3-total").assertTextEquals("101.49")
        ui.onNodeWithTag("report-warmup").assertDoesNotExist()
        ui.runOnIdle{journal.value=fixture(partial=true)}
        cg3();ui.onNodeWithTag("cg3-total").assertTextEquals("101.45")
        click("cg3-single");click("cg3-slice-2")
        ui.onNodeWithTag("cg3-total").assertDoesNotExist()
        ui.onNodeWithTag("cg3-reason").assertTextEquals("Нет полных серий в выбранном срезе")
        ui.onNodeWithTag("cg3-controls").assertExists()
        click("cg3-slice-1");ui.onNodeWithTag("cg3-total").assertTextEquals("101.45")
    }
    @Test fun noCompleteSeriesHidesTheCardUntilAnOpenSeriesIsFullyEntered() {
        val full = fixture()
        val partial = full.copy(blocks = full.blocks.map { block ->
            block.copy(ends = block.ends.map { it.copy(end = it.end.copy(state = "open"), shots = it.shots.take(2)) })
        })
        journal.value = partial
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { CompositeScoreCard(journal.value.blocks.single().scoringInput()) }
        } }
        ui.onNodeWithTag("cg3-card").assertDoesNotExist()
        ui.runOnIdle {
            val block = partial.blocks.single()
            journal.value = partial.copy(blocks = listOf(block.copy(ends = listOf(
                full.blocks.single().ends.first().copy(end = full.blocks.single().ends.first().end.copy(state = "open"))
            ) + block.ends.drop(1))))
        }
        ui.onNodeWithTag("cg3-card").assertExists()
        ui.onNodeWithTag("cg3-total").assertTextEquals("101.45")
    }
    @Test fun importedUnverifiedGeometryNeverReceivesStandardBonusAndViewIsInspectable() {
        val base=fixture(numeric=true);val b=base.blocks.single();val profile="mytargets-source-10-fixture"
        journal.value=base.copy(blocks=listOf(b.copy(block=b.block.copy(targetProfileId=profile,targetSnapshotJson="{\"profileId\":\"$profile\",\"scoringRuleVersion\":\"mytargets-source-scores-v1\",\"maxPoints\":10,\"geometryType\":\"unverified\"}"))))
        mount();cg3();ui.onNodeWithTag("cg3-reason").assertTextContains("не проверили",substring=true)
        click("cg3-profile-ScoreOnly");ui.onNodeWithTag("cg3-total").assertTextEquals("101.67")
        click("cg3-explain");ui.onNodeWithText("G = 100A + 5T").assertExists()
        click("cg3-explain");dismissTestSheet(ui);click("cg3-controls");cg3()
        val directory=File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("verification"),"cg3").apply{mkdirs()}
        File(directory,"score-only-sport-dark.png").outputStream().use{ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }
}

package app.fableshot.android
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*

class ProgressScoreUiTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private val versions=mutableStateOf(mapOf("past0" to 1L,"past1" to 1L,"past2" to 1L))
    private val block=JournalBlock("block","current",0,"scored",18.0,PRACTICE_PROFILE,1,600,practiceSnapshot(600),"{\"bow\":{\"category\":\"barebow\"}}",12)
    private val source=JSONArray((0..2).map{i->JSONObject().put("sessionId","past$i").put("revision",1).put("title","Past $i").put("count",12).put("sum",60).put("sourceKind","native")}).toString()
    private val baseline=ProgressBaseline("block","base","progress-pg1-v1",1000,1000,progressConditions(block),10,"ready",source,36,180)
    private fun fixture(saved:Boolean=true,closed:Boolean=true):JournalDetails {
        val end=JournalEnd("end","block",0,12,state=if(closed)"closed"else"open")
        val shots=(0..11).map{JournalShot("shot$it","end",it,10,"10",null,null,null,null,null,"numeric_entry","none","unknown",null,1001)}
        return JournalDetails(JournalSession("current","Current",1000,1000),listOf(JournalBlockDetails(block,listOf(JournalEndDetails(end,shots,emptyList())),if(saved)listOf(baseline)else emptyList())))
    }
    private fun mount(details:JournalDetails){ui.setContent{FableTheme(UserSettings(animations=false)){Surface{JournalReportScreen(details,sourceVersions=versions.value)}}};ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("pg1-card"))}
    @Test fun readyProgressStaysFrozenWhenSourceRevisionChanges(){
        mount(fixture());ui.onNodeWithTag("pg1-value").assertTextEquals("+100%")
        ui.onNodeWithText("База сравнения").assertDoesNotExist()
        ui.runOnIdle{versions.value=versions.value+mapOf("past0" to 2L)}
        ui.onNodeWithTag("pg1-value").assertTextEquals("+100%")
        ui.onNodeWithContentDescription("О прогрессе и базе сравнения").performClick()
        ui.onNodeWithText("Одно из базовых занятий изменено или удалено.", substring = true).assertExists()
        ui.onNodeWithText("Past 0", substring = true).assertExists()
        dismissTestSheet(ui)
        ui.onNodeWithTag("pg1-value").assertTextEquals("+100%")
    }
    @Test fun unavailableOrBuildingComparisonDoesNotCreateAnEmptyCard() {
        val selectedBaseline = mutableStateOf<ProgressBaseline?>(null)
        val input = fixture().blocks.single().scoringInput()
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { ProgressScoreCard(input, selectedBaseline.value) }
        } }
        ui.onNodeWithTag("pg1-card").assertDoesNotExist()
        ui.runOnIdle { selectedBaseline.value = baseline.copy(status = "building", sourceSessionsJson = "[]", scoredCount = 0, scoreSum = 0) }
        ui.onNodeWithTag("pg1-card").assertDoesNotExist()
        ui.onNodeWithText("Набираем базу", substring = true).assertDoesNotExist()
        ui.runOnIdle { selectedBaseline.value = baseline }
        ui.onNodeWithTag("pg1-value").assertTextEquals("+100%")
    }

    @Test fun availablePreliminaryComparisonKeepsItsValueAndExplainsTheBaseOnRequest() {
        val firstSource = JSONArray().put(JSONArray(source).getJSONObject(0)).toString()
        val preliminary = baseline.copy(status = "building", sourceSessionsJson = firstSource, scoredCount = 12, scoreSum = 60)
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { ProgressScoreCard(fixture().blocks.single().scoringInput(), preliminary) }
        } }
        ui.onNodeWithTag("pg1-value").assertTextEquals("+100%")
        ui.onNodeWithText("Предварительно").assertExists()
        ui.onNodeWithText("В базе:", substring = true).assertDoesNotExist()
        ui.onNodeWithContentDescription("О прогрессе и базе сравнения").performClick()
        ui.onNodeWithText("В базе: 1 занятий", substring = true).assertExists()
    }
}

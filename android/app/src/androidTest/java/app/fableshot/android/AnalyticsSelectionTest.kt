package app.fableshot.android
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.*
import app.fableshot.android.ui.*
import java.time.*
import org.junit.Rule
import org.junit.Test
class AnalyticsSelectionTest {
 @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
 private fun row(id:String,days:Long)=SessionSummary(id,id,LocalDate.now().minusDays(days).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli(),"completed",3,27,18.0,600,"practice-full-10-v1")
 @Test fun periodAndExplicitSelectionAffectSameDataset(){
  ui.setContent{FableTheme(UserSettings()){ProgressScreen(listOf(row("recent",0),row("old",40)))}}
  ui.onNodeWithText("Всё время").performClick()
  ui.onNodeWithTag("analytics-count").assertTextEquals("Завершённых занятий: 2")
  ui.onNodeWithTag("analytics-period-7").performClick();ui.onNodeWithTag("analytics-count").assertTextEquals("Завершённых занятий: 1")
  ui.onNodeWithTag("analytics-period-0").performClick()
  ui.onNodeWithTag("analytics-choose").performClick()
  ui.onNodeWithText("Снять выбор").performClick()
  ui.onNodeWithTag("analytics-session-recent").performClick()
  ui.onNodeWithTag("analytics-apply").performClick()
  ui.onNodeWithTag("analytics-count").assertTextEquals("Завершённых занятий: 1");ui.onNodeWithTag("analytics-reset").performClick();ui.onNodeWithTag("analytics-count").assertTextEquals("Завершённых занятий: 2")
 }
 @Test fun customDatesAreInclusiveAndInvalidRangeNeverShowsOldResults(){
  ui.setContent{FableTheme(UserSettings()){ProgressScreen(listOf(row("recent",0)))}}
  ui.onNodeWithText("Всё время").performClick()
  ui.onNodeWithTag("analytics-period--1").performScrollTo().performClick()
  val today=LocalDate.now().toString();ui.onNodeWithTag("analytics-from").performTextInput(today);ui.onNodeWithTag("analytics-to").performTextInput(today)
  ui.onNodeWithTag("analytics-count").assertTextEquals("Завершённых занятий: 1")
  ui.onNodeWithTag("analytics-from").performTextReplacement(LocalDate.now().plusDays(1).toString());ui.onNodeWithTag("analytics-count").assertTextEquals("Завершённых занятий: 0")
 }
}

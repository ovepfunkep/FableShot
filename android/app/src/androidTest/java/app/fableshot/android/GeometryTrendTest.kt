package app.fableshot.android
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.*
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.*
import org.junit.Rule
import org.junit.Test
class GeometryTrendTest {
 @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
 private fun row(id:String,x:Double,n:Int=3)=SessionSummary(id,id,1L,"completed",4,36,18.0,600,"practice-full-10-v1",JournalSummaryMeta(1,4,true,false,positions=List(n){TargetPoint(x,0.0)}))
 @Test fun zeroBaselineDoesNotCreatePercentageAndOffsetUsesMillimetres(){
  ui.setContent{FableTheme(UserSettings()){Column(Modifier.verticalScroll(rememberScrollState())){GeometryTrend(listOf(row("A",0.0),row("B",.1)))}}}
  ui.onNodeWithTag("geometry-trend-change").assertTextContains("без изменений",substring=true)
  ui.onNodeWithTag("geometry-trend-offset").performScrollTo().performClick().assertIsSelected()
  ui.onNodeWithTag("geometry-trend-latest").assertTextEquals("Последнее: ${number(30.0,1)} мм")
  ui.onNodeWithTag("geometry-trend-change").assertTextContains("увеличение на ${number(30.0,1)} мм",substring=true)
  ui.onAllNodesWithText("Изменение:",substring=true).assertCountEquals(0)
 }
 @Test fun onePointIsNotAValidTrendSample(){
  ui.setContent{FableTheme(UserSettings()){GeometryTrend(listOf(row("A",.1,1)))}}
  ui.onNodeWithTag("geometry-trend-empty").assertExists();ui.onNodeWithTag("geometry-trend-latest").assertDoesNotExist()
 }

 @Test fun selectedPointShowsItsActualMillimetresDateAndTrainingAtLargeFont(){
  val first=row("A",0.0).let{it.copy(title="Первая тренировка",journalMeta=it.journalMeta!!.copy(localDate="2026-10-01"))}
  val last=row("B",.1).let{it.copy(title="Вторая тренировка",journalMeta=it.journalMeta!!.copy(localDate="2026-11-04"))}
  ui.setContent{
   val density=LocalDensity.current
   CompositionLocalProvider(LocalDensity provides Density(density.density,2f)){
    FableTheme(UserSettings(animations=false)){Column(Modifier.verticalScroll(rememberScrollState())){GeometryTrend(listOf(first,last))}}
   }
  }
  ui.onNodeWithTag("geometry-trend-offset").performScrollTo().performClick().assertIsSelected()
  ui.onNodeWithTag("geometry-trend-scale").assertTextEquals("Шкала: 0–${number(30.0,1)} мм")
  ui.onNodeWithTag("geometry-trend-selected-value").assertTextEquals("${number(30.0,2)} мм")
  ui.onNodeWithTag("geometry-trend-selected-session").assertTextEquals("04.11.2026 · Вторая тренировка")
  ui.onNodeWithTag("geometry-trend-chart").performScrollTo().performTouchInput{click(Offset(12f,centerY))}
  ui.onNodeWithTag("geometry-trend-selected-value").assertTextEquals("${number(0.0,2)} мм")
  ui.onNodeWithTag("geometry-trend-selected-session").assertTextEquals("01.10.2026 · Первая тренировка")
  ui.onNodeWithTag("geometry-trend-next").performScrollTo().performClick()
  ui.onNodeWithTag("geometry-trend-selected-value").assertTextEquals("${number(30.0,2)} мм")
  ui.onNodeWithTag("geometry-trend-selected-session").assertTextEquals("04.11.2026 · Вторая тренировка")
 }
}

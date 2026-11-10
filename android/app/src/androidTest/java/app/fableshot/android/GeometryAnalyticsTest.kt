package app.fableshot.android
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Modifier
import app.fableshot.android.data.*
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.*
import org.junit.Rule
import org.junit.Test
class GeometryAnalyticsTest {
 @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
 private fun row(points:List<TargetPoint>?)=SessionSummary("a","A",1L,"completed",4,36,18.0,600,"practice-full-10-v1",JournalSummaryMeta(1,4,true,false,positions=points))
 @Test fun coverageAndMillimetresUseOnlyKnownPositions(){
  ui.setContent{FableTheme(UserSettings()){Column(Modifier.verticalScroll(rememberScrollState())){GeometryAnalytics(listOf(row(listOf(TargetPoint(.1,0.0),TargetPoint(.1,0.0),TargetPoint(.1,0.0)))))}}}
  ui.onNodeWithTag("geometry-coverage").assertTextEquals("Координаты: 3 из 4 зачётных стрел")
  ui.onNodeWithTag("geometry-rms").assertTextContains(number(0.0,1),substring=true)
  ui.onNodeWithTag("geometry-offset").assertTextContains(number(30.0,1),substring=true)
  ui.onNodeWithTag("geometry-heat").assertIsSelected()
  ui.onNodeWithText("75–100%").assertExists()
  ui.onNodeWithTag("geometry-points").performScrollTo().performClick()
  ui.onNodeWithTag("geometry-points").assertIsSelected()
  ui.onNodeWithTag("geometry-heat").performClick();ui.onNodeWithTag("geometry-map").assertExists()
 }
 @Test fun missingCoordinatesNeverBecomeZeroGrouping(){
  ui.setContent{FableTheme(UserSettings()){GeometryAnalytics(listOf(row(null)))}}
  ui.onNodeWithTag("geometry-unavailable").assertExists();ui.onNodeWithTag("geometry-rms").assertDoesNotExist();ui.onNodeWithTag("geometry-map").assertDoesNotExist()
 }
}

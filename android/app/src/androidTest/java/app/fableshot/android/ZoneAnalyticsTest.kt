package app.fableshot.android
import androidx.compose.ui.test.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.*
import app.fableshot.android.ui.*
import org.junit.Rule
import org.junit.Test
class ZoneAnalyticsTest {
 @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
 private fun row(id:String,counts:List<Int>,x:Int)=SessionSummary(id,id,1L,"completed",counts.sum(),counts.mapIndexed{i,n->i*n}.sum(),18.0,600,"practice-full-10-v1",JournalSummaryMeta(1,counts.sum(),true,false,localDate="2026-10-30",zoneCounts=counts,xCount=x))
 @Test fun ratesAreWeightedAndXDoesNotDoubleCountTens(){
  val a=row("A",List(11){if(it==10)1 else if(it==0)1 else 0},1)
  val b=row("B",List(11){if(it==10)4 else 0},0)
  ui.setContent{FableTheme(UserSettings()){androidx.compose.foundation.layout.Column(Modifier.verticalScroll(rememberScrollState())){ZoneAnalytics(listOf(a,b))}}}
  ui.onNodeWithTag("rate-total").assertTextContains("83,3",substring=true)
  ui.onNodeWithTag("rate-X").performScrollTo().performClick();ui.onNodeWithTag("rate-total").assertTextContains("16,7",substring=true)
  ui.onNodeWithTag("rate-M").performScrollTo().performClick();ui.onNodeWithTag("rate-total").assertTextContains("16,7",substring=true)
 }
}

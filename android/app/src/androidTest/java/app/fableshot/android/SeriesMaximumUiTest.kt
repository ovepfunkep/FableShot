package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Partial completed series are intentional: the saved plan is not the display maximum. */
class SeriesMaximumUiTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    @Before fun requireUnlockedActivity() {
        assertFalse("Unlock the device before UI verification",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        ui.waitUntil(5_000) {ui.activity.hasWindowFocus()}
    }
    private val block=JournalBlock("block","session",0,"scored",18.0,PRACTICE_PROFILE,1,400,
        practiceSnapshot(400),null,6)
    private val values=listOf(9,0)
    private val series=mutableStateOf(JournalEndDetails(JournalEnd("end","block",0,6,state="closed"),
        values.mapIndexed { i,points->JournalShot("s$i","end",i,points,if(points==0)"M"else"9",
            null,null,null,null,null,"numeric_entry","none","unknown",null,1) },emptyList()))

    private fun details()=JournalDetails(JournalSession("session","Fixture",1,1,state="completed"),
        listOf(JournalBlockDetails(block,listOf(series.value))))

    @Test fun completedReportUsesEnteredShotsRatherThanPlannedSlots() {
        ui.setContent {FableTheme(UserSettings(animations=false)) {
            Surface(Modifier.fillMaxSize()) {ReportScreen(details().presentation())}
        }}
        fun assertTotal(text:String) {
            ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("report-end-end"))
            ui.onNodeWithTag("report-series-total-end",useUnmergedTree=true).assertTextEquals(text)
        }
        assertTotal("9/20 · 4,5")
        ui.runOnIdle {series.value=series.value.copy(shots=series.value.shots.take(1))}
        assertTotal("9/10 · 9,0")
        ui.runOnIdle {assertEquals(6,series.value.end.plannedCount)}
    }

    @Test fun legacyPresentationUsesTheSameMaximumForPartialSeries() {
        val legacy=details().presentation().copy(journal=null)
        ui.setContent {FableTheme(UserSettings(animations=false)) {
            Surface(Modifier.fillMaxSize()) {ReportScreen(legacy)}
        }}
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("report-end-end"))
        ui.onNodeWithTag("legacy-series-total-end",useUnmergedTree=true).assertTextEquals("9 / 20")
        assertEquals(6,legacy.orderedEnds.single().end.plannedCount)
    }
}

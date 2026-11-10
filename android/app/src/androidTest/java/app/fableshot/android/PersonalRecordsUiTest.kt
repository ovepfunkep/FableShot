package app.fableshot.android

import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.domain.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class PersonalRecordsUiTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    @Test fun largeTextSearchAndRecordSourceRemainUsable() {
        val record=SeriesRecord(SeriesRecordConditions(18.0,400,"target",1,"snapshot",null,3),27,30,
            "session","end",1,null,0,1,1,"Учебная мишень","Комплект не указан")
        val source=SessionSummary("session","Fixture",0,"completed",3,27,18.0,400,"target",
            JournalSummaryMeta(1,3,true,false,seriesRecords=listOf(record)))
        var opened=false
        ui.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,2f)) {
                FableTheme(UserSettings(animations=false)) {Surface {PersonalRecordsScreen(listOf(source),{opened=true},{})}}
            }
        }
        ui.onNodeWithTag("records-search").performTextInput("неизвестный комплект")
        ui.onNodeWithText("Ничего не найдено").assertExists()
        ui.onNodeWithTag("records-search").performTextReplacement("18")
        ui.onNodeWithTag("series-record-end").performScrollTo().assertIsDisplayed().assertTextContains("27/30",substring=true).performClick()
        ui.runOnIdle {assertTrue(opened)}
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(context.getExternalFilesDir("verification"),"records").apply {mkdirs()}
        File(folder,"records-large.png").outputStream().use {
            ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)
        }
    }
}

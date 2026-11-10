package app.fableshot.android

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.BlockPlan
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.File

class ConditionsLayoutTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private var applied:BlockPlan?=null
    private var added=false
    private var edited:String?=null
    private val bow=EquipmentItem(id="conditions-bow",kind="bow",name="Лук",category="barebow")
    private val kit=EquipmentItem(id="conditions-kit",kind="setup",name="Основной",bowId=bow.id)

    @Before fun requireUnlocked() {
        val keyguard=ui.activity.getSystemService(android.app.KeyguardManager::class.java)
        assertFalse("Unlock the phone before UI verification",keyguard.isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    private fun mount(fontScale:Float=1f) {
        val equipment=listOf(bow,kit)
        val initial=HabitualTraining.block(BlockPlan(18.0,400,equipmentSnapshotJson=equipmentSnapshot(kit,equipment)))
        ui.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,fontScale)) {
                FableTheme(UserSettings()) {
                    Surface(Modifier.size(360.dp,640.dp)) {
                        JournalSetupScreen(false,initial,equipment,newSession=true,
                            onAddEquipment={added=true},onEditEquipment={edited=it.id},
                            presetTools=TrainingPresetTools(null,{},{},{}),
                        ) { _,plan->applied=plan }
                    }
                }
            }
        }
    }

    private fun capture(name:String) {
        val folder=File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("verification"),"conditions")
        check(folder.mkdirs()||folder.isDirectory)
        File(folder,name).outputStream().use { output->
            assertTrue(ui.onNodeWithTag("journal-setup").captureToImage().asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG,100,output))
        }
    }

    @Test fun standardScreenFitsAndNumericFieldsShareGridAndStyle() {
        mount()
        val distance=ui.onNodeWithTag("distance-field").fetchSemanticsNode().boundsInRoot
        val diameter=ui.onNodeWithTag("diameter-field").fetchSemanticsNode().boundsInRoot
        assertEquals(distance.top,diameter.top,.5f)
        assertEquals(distance.width,diameter.width,.5f)
        assertEquals(distance.height,diameter.height,.5f)
        val scroll=ui.onNodeWithTag("conditions-content").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
        assertEquals(0f,scroll.maxValue(),.5f)
        ui.onNodeWithTag("start-training").assertIsDisplayed().assertIsEnabled()
        ui.onNodeWithTag("conditions-equipment").assertTextContains("Основной")
        capture("compact.png")
        ui.onNodeWithTag("start-training").performClick()
        assertEquals(10,applied!!.seriesPerRound)
        assertEquals(18.0,applied!!.distanceMeters!!,0.0)
        assertEquals(400,applied!!.diameterMm)
    }

    @Test fun largeFontKeepsPrimaryVisibleAndOptionsAndEquipmentReachable() {
        mount(2f)
        ui.onNodeWithTag("start-training").assertIsDisplayed()
        val distance=ui.onNodeWithTag("distance-field").fetchSemanticsNode().boundsInRoot
        val diameter=ui.onNodeWithTag("diameter-field").fetchSemanticsNode().boundsInRoot
        assertEquals(distance.left,diameter.left,.5f)
        assertTrue(diameter.top>=distance.bottom)
        capture("large-font.png")
        ui.onNodeWithTag("conditions-options").performScrollTo().performClick()
        ui.onNodeWithTag("volume-free").performScrollTo().performClick()
        ui.onNodeWithTag("conditions-options-done").performScrollTo().performClick()
        ui.onNodeWithTag("equipment-edit-choice-${kit.id}").performScrollTo().performClick()
        assertEquals(kit.id,edited)
        ui.onNodeWithTag("conditions-equipment").performScrollTo().performClick()
        ui.onNodeWithTag("equipment-add-choice").performClick()
        assertTrue(added)
        ui.onNodeWithTag("start-training").performClick()
        assertTrue(applied!!.flexibleSeries)
        assertNull(applied!!.seriesPerRound)
    }
}

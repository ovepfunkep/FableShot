package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.BlockPlan
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** All data is in memory; the user's diary is never opened. */
class UxRedesignTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun homeAndNavigationAdaptToNarrowScreensAndLargeText() {
        var config by mutableStateOf(Triple(320f,1.3f,Appearance.Light))
        var starts=0
        var changes=0
        val kit=EquipmentItem(kind="setup",name="ИНСТИНКТИВ")
        val plan=BlockPlan(18.0,400,6,targetProfileId="wa-indoor-outer-v1",equipmentSnapshotJson=equipmentSnapshot(kit,listOf(kit)))
        val session=SessionSummary("responsive","Fixture",System.currentTimeMillis(),"completed",193,1737,18.0,400,"wa")
        ui.setContent {
            val density=androidx.compose.ui.platform.LocalDensity.current
            val settings=UserSettings(appearance=config.third,animations=false,displayName="Алексей")
            CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(density.density,config.second)) {
                FableTheme(settings) {
                    Surface(Modifier.width(config.first.dp).height(800.dp).testTag("adaptive-home-frame")) {
                        Column {
                            ShellTopBar("root","home",settings,{},{},{})
                            Box(Modifier.weight(1f)) { HomeScreen(listOf(session),null,settings,{},{},{},{},habitualPlan=plan,onQuickStart={starts++},onChangeConditions={changes++}) }
                            ShellNavigation("home") {}
                        }
                    }
                }
            }
        }
        for ((index,value) in listOf(Triple(320f,1.3f,Appearance.Light),Triple(360f,1.5f,Appearance.Light),Triple(280f,1.5f,Appearance.Light),Triple(320f,2f,Appearance.Light),Triple(400f,1f,Appearance.Dark)).withIndex()) {
            ui.runOnIdle { config=value }
            ui.onNodeWithTag("home-screen").performScrollToIndex(0)
            for(id in listOf("home","history","progress","equipment")) {
                val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
                ui.onNodeWithTag("nav-label-$id",useUnmergedTree=true).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(layouts) }
                val layout=layouts.single()
                assertEquals(1,layout.lineCount)
                assertTrue("Full navigation label must fit at $value",layout.getLineRight(0)<=layout.size.width+1f)
            }
            val titleLayouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            ui.onNodeWithText(if(index<4) "Тренировка" else "Привычная тренировка").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(titleLayouts) }
            assertTrue(titleLayouts.single().lineCount<=2)
            assertFalse(titleLayouts.single().isLineEllipsized(titleLayouts.single().lineCount-1))
            ui.onNodeWithText("Без памятки и фокуса").assertDoesNotExist()
            ui.onNodeWithTag("home-primary").performScrollTo().assertIsDisplayed().performClick()
            ui.onNodeWithTag("home-conditions").performScrollTo().assertIsDisplayed().performClick()
            if(index in listOf(0,2,3)) {
                val context=InstrumentationRegistry.getInstrumentation().targetContext
                val folder=File(context.getExternalFilesDir("verification"),"redesign").apply { mkdirs() }
                File(folder,"home-${value.first.toInt()}-font${(value.second*100).toInt()}.png").outputStream().use { ui.onNodeWithTag("adaptive-home-frame").captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG,100,it) }
            }
            ui.onNodeWithTag("home-screen").performScrollToNode(hasTestTag("home-week"))
            ui.onNodeWithTag("home-week").assertIsDisplayed()
        }
        assertEquals(5,starts);assertEquals(5,changes)
    }

    @Test fun slidingValuesFitLargeFontWithoutMovingTheirRow() {
        var value by mutableStateOf("За раунд: 9 / 24000")
        ui.setContent {
            val density = androidx.compose.ui.platform.LocalDensity.current
            CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(density.density, 1.5f)) {
                FableTheme(UserSettings(animations=false)) {
                    Surface { Column {
                        SlidingValue(value, Modifier.width(180.dp).testTag("fit-value"))
                        androidx.compose.material3.Text("Ниже", Modifier.testTag("below-value"))
                    } }
                }
            }
        }
        val before=ui.onNodeWithTag("below-value").fetchSemanticsNode().boundsInRoot
        ui.runOnIdle { value="За раунд: 24000 / 24000" }
        ui.onNodeWithTag("fit-value").assertTextEquals("За раунд: 24000 / 24000")
        assertEquals(before,ui.onNodeWithTag("below-value").fetchSemanticsNode().boundsInRoot)
        capture("sliding-large-font.png")
    }

    private fun capture(name: String) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(context.getExternalFilesDir("verification"),"redesign").apply { mkdirs() }
        File(folder,name).outputStream().use { ui.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG,100,it) }
    }

    @Test fun trainingShowsSeriesAndRoundAveragesIncludingMisses() {
        val session=SessionEntity("averages","Fixture",1,18.0,600,3)
        val previous=EndEntity("previous",session.id,1,3,true)
        val current=EndEntity("current",session.id,2,3)
        fun shot(id:String,end:String,index:Int,points:Int)=ShotEntity(id,end,index,points,null,null,"manual",1)
        val details=SessionDetails(session,listOf(
            EndWithShots(previous,listOf(shot("a",previous.id,0,10),shot("b",previous.id,1,8),shot("c",previous.id,2,9))),
            EndWithShots(current,listOf(shot("d",current.id,0,9),shot("miss",current.id,1,0))),
        ))
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface { TargetOverlayHost(Modifier.fillMaxSize()) { ActivePractice(details,PracticeCommands({_,_->},{_,_->},{},{},{}),false,false,{},{}) } }
        } }
        ui.onNodeWithTag("round-number").assertTextEquals("1")
        ui.onNodeWithTag("end-number").assertTextEquals("2")
        ui.onNodeWithTag("next-end").assertTextContains("Следующая серия")
        ui.onNodeWithTag("end-average").assertTextEquals("Средний 4,5")
        ui.onNodeWithTag("round-score").assertTextEquals("36")
        ui.onNodeWithTag("round-average").assertTextEquals("Средний 7,2")
        val points=ui.onNodeWithTag("end-score").fetchSemanticsNode().boundsInRoot
        val average=ui.onNodeWithTag("end-average").fetchSemanticsNode().boundsInRoot
        assertEquals(points.left,average.left,.5f)
        assertTrue(average.top>=points.bottom)
        capture("training-averages.png")
    }

    @Test fun habitualRoundPlanRoundTripsAndLegacyDefaultsToOne() {
        val plan=BlockPlan(18.0,600,3,plannedEnds=20,roundCount=2)
        val encoded=HabitualTraining.encode(plan)
        assertEquals(plan,HabitualTraining.decode(encoded))
        val legacy=org.json.JSONObject(encoded).apply { remove("rounds") }.toString()
        assertEquals(1,HabitualTraining.decode(legacy)!!.roundCount)
    }

    @Test fun arrowStatesUseOneConsistentShapeAndTrackEditing() {
        val session=SessionEntity("arrows","Fixture",1,18.0,600,3)
        val end=EndEntity("end",session.id,1,3)
        val shot=ShotEntity("shot",end.id,0,9,null,null,"manual",1)
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface { TargetOverlayHost(Modifier.fillMaxSize()) { ActivePractice(SessionDetails(session,listOf(EndWithShots(end,listOf(shot)))),PracticeCommands({_,_->},{_,_->},{},{},{}),false,false,{},{}) } }
        } }
        fun state(index:Int,value:String) = ui.onNodeWithTag("shot-$index").assert(
            SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,value)
        )
        state(0,"Введённая стрела");state(1,"Вводимая стрела");state(2,"Невведённая стрела")
        ui.onNodeWithTag("shot-0").performClick()
        state(0,"Вводимая стрела");state(1,"Невведённая стрела")
        capture("arrow-states.png")
    }

    @Test fun metricIconIsBesideStackedValueAndLabel() {
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface { MetricTile("42","стрел") }
        } }
        val value=ui.onNodeWithText("42").fetchSemanticsNode().boundsInRoot
        val label=ui.onNodeWithText("стрел").fetchSemanticsNode().boundsInRoot
        assertEquals(value.left,label.left,.5f)
        assertTrue(label.top>=value.bottom)
        capture("metric-row.png")
    }

    @Test fun longMetricLabelShrinksWithoutChangingCardHeight() {
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface { Row(Modifier.width(androidx.compose.ui.unit.Dp(360f))) {
                MetricTile("42","стрел",Modifier.weight(1f).testTag("short-metric"))
                MetricTile("42","Завершённых тренировок",Modifier.weight(1f).testTag("long-metric"))
            } }
        } }
        val short=ui.onNodeWithTag("short-metric").fetchSemanticsNode().boundsInRoot
        val long=ui.onNodeWithTag("long-metric").fetchSemanticsNode().boundsInRoot
        assertEquals(short.height,long.height,1f)
        val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        ui.onNodeWithText("Завершённых тренировок").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(layouts) }
        val layout=layouts.single()
        assertEquals(1,layout.lineCount)
        assertFalse("The complete label must remain visible", layout.isLineEllipsized(0)); assertTrue(layout.getLineRight(0) <= layout.size.width + .5f)
        capture("metric-single-line.png")
    }

    @Test fun historyDeletedFilterKeepsCardDetailsAndSearch() {
        val current = SessionSummary("current", "Current fixture", 1762000000000L, "completed", 3, 27, 18.0, 600, "wa")
        val removed = current.copy(id = "removed", title = "Deleted fixture", total = 24)
        val trash = mutableStateOf(listOf(removed))
        val history = mutableStateOf(listOf(current))
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { HistoryScreen(history.value, {}, {}, deletedSessions = trash.value, onRestore = {
                history.value = history.value + removed
                trash.value = emptyList()
            }) }
        } }
        ui.onNodeWithTag("session-current").assertExists()
        ui.onNodeWithTag("session-removed").assertDoesNotExist()
        ui.onNodeWithTag("history-filters").performClick()
        ui.onNodeWithTag("history-deleted").performClick()
        ui.onNodeWithTag("session-current").assertDoesNotExist()
        val card = ui.onNodeWithTag("session-removed")
        card.assertExists()
        ui.onNode(hasText("24") and hasAnyAncestor(hasTestTag("session-removed"))).assertExists()
        ui.onNode(hasText("/ 30") and hasAnyAncestor(hasTestTag("session-removed"))).assertExists()
        ui.onNode(hasText("18", substring = true) and hasAnyAncestor(hasTestTag("session-removed"))).assertExists()
        ui.onNodeWithTag("history-search").performTextReplacement("missing")
        card.assertDoesNotExist()
        ui.onNodeWithTag("history-search").performTextReplacement("Deleted")
        card.assertExists()
        ui.onNodeWithTag("restore-removed").performClick()
        card.assertDoesNotExist()
        ui.onNodeWithTag("history-current").performClick()
        card.assertExists()
        ui.onNodeWithTag("restore-removed").assertDoesNotExist()
    }

    @Test fun repeatedRegisteredTermHasTwoLinksAndSamePopup() {
        val phrase="Разброс RMS: 12 мм; Разброс RMS: 8 мм."
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface { app.fableshot.android.ui.Text(phrase) }
        } }
        val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        ui.onNodeWithText(phrase).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(layouts) }
        val result=layouts.single()
        assertEquals(2,result.layoutInput.text.getLinkAnnotations(0,phrase.length).size)
        val second=phrase.indexOf("Разброс RMS",1)
        val position=result.getBoundingBox(second).center
        ui.onNodeWithText(phrase).performTouchInput { click(position) }
        ui.onNodeWithText(GlossaryRegistry.definitions.getValue("Разброс RMS")).assertIsDisplayed()
    }

    @Test fun addEquipmentFollowsChoicesInSameRow() {
        val items=listOf(EquipmentItem(id="a",kind="setup",name="A"),EquipmentItem(id="b",kind="setup",name="B"))
        var added=false
        var edited=false
        val selected=mutableStateOf<String?>(null)
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface(Modifier.fillMaxWidth()) { Column {
                EquipmentChoice("Снаряжение",items,selected.value,{selected.value=it},onAdd={added=true},onEdit={edited=true})
            } }
        } }
        ui.onNodeWithTag("equipment-add-choice").performScrollTo()
        val add=ui.onNodeWithTag("equipment-add-choice").fetchSemanticsNode().boundsInRoot
        val last=ui.onNodeWithTag("equipment-select-b").fetchSemanticsNode().boundsInRoot
        assertTrue(add.left>=last.right)
        assertTrue(kotlin.math.abs(add.center.y-last.center.y)<24f)
        ui.onNodeWithTag("equipment-add-choice").performClick()
        ui.onNodeWithTag("equipment-edit-choice-a").assertDoesNotExist()
        ui.onNodeWithTag("equipment-select-a").performScrollTo().performClick()
        ui.onNodeWithTag("equipment-edit-choice-b").assertDoesNotExist()
        ui.onNodeWithTag("equipment-edit-choice-a").performScrollTo().performClick()
        ui.runOnIdle { assertTrue(added);assertTrue(edited) }
    }

    @Test fun glossaryWordOpensAndClosesSameContextualHelp() {
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface { GlossaryText("Фокус тренировки",mapOf("Фокус" to "Расстояния между попаданиями")) }
        } }
        ui.onNodeWithText("Расстояния между попаданиями").assertDoesNotExist()
        ui.onNodeWithText("Фокус тренировки").performTouchInput { click(androidx.compose.ui.geometry.Offset(10f,centerY)) }
        ui.onNodeWithText("Расстояния между попаданиями").assertIsDisplayed()
        dismissTestSheet(ui)
        ui.onNodeWithText("Фокус тренировки").assertIsDisplayed()
    }

    @Test fun settingsKeepsImportInDataSection() {
        var imported = false
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface(Modifier.fillMaxSize()) { SettingsScreen(UserSettings(), {}, {}, {}, {}, {}, {}, {}, onImport={imported=true}) }
        } }
        capture("settings.png")
        ui.onNodeWithTag("open-import").assertDoesNotExist()
        ui.onNodeWithText("Данные и перенос").performClick()
        ui.onNodeWithTag("open-import").performClick()
        ui.runOnIdle { assertTrue(imported) }
    }

    @Test fun contextualHelpClosesWithoutReplacingScreen() {
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface { Column { androidx.compose.material3.Text("Рабочий экран"); HelpButton("О кучности", "Понятное объяснение") } }
        } }
        ui.onNodeWithText("Понятное объяснение").assertDoesNotExist()
        ui.onNodeWithContentDescription("О кучности").performClick()
        ui.onNodeWithText("Понятное объяснение").assertIsDisplayed()
        dismissTestSheet(ui)
        ui.onNodeWithText("Рабочий экран").assertIsDisplayed()
    }

    @Test fun homeQuickStartAndChangeAreSeparateActions() {
        var starts=0
        var changes=0
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            Surface(Modifier.fillMaxSize()) { HomeScreen(emptyList(),null,UserSettings(),{},{},{},{},habitualPlan=BlockPlan(18.0,400),
                onQuickStart={starts++},onChangeConditions={changes++}) }
        } }
        capture("home-quick-start.png")
        ui.onNodeWithTag("home-primary").performClick()
        ui.onNodeWithText("Изменить условия").performClick()
        ui.runOnIdle { assertEquals(1,starts); assertEquals(1,changes) }
    }

    @Test fun presetRoundTripsAndRejectsUnknownVersion() {
        val plan=BlockPlan(18.0,400,6,plannedEnds=10)
        assertEquals(plan,HabitualTraining.decode(HabitualTraining.encode(plan)))
        assertNull(HabitualTraining.decode("{\"version\":99}"))
        assertNull(HabitualTraining.decode("broken"))
        assertEquals(18.0,HabitualTraining.block(plan).distanceMeters!!,0.0)
    }
    @Test fun archivedEquipmentRequiresNewChoice() {
        val bow=EquipmentItem(id="test-bow",kind="bow",name="Тестовый лук")
        val kit=EquipmentItem(id="test-kit",kind="setup",name="Комплект",bowId=bow.id)
        val all=listOf(bow,kit)
        val plan=BlockPlan(18.0,400,equipmentSnapshotJson=equipmentSnapshot(kit,all))
        assertNotNull(HabitualTraining.refreshEquipment(plan,all))
        assertNull(HabitualTraining.refreshEquipment(plan,listOf(bow.copy(archived=true),kit)))
        assertNull(HabitualTraining.refreshEquipment(plan,emptyList()))
        assertNotNull(HabitualTraining.refreshEquipment(plan,listOf(bow.copy(revision=bow.revision+1),kit)))
        assertNotNull(HabitualTraining.refreshEquipment(plan.copy(equipmentSnapshotJson=null),emptyList()))
        val legacy=plan.copy(equipmentSnapshotJson=equipmentSnapshot(bow,all))
        assertNull(HabitualTraining.refreshEquipment(legacy,all))
        assertEquals(legacy,HabitualTraining.decode(HabitualTraining.encode(legacy)))
    }

}

package app.fableshot.android

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.lifecycle.*
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.FableTheme
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class JournalShellTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private lateinit var db:JournalDatabase
    private lateinit var store:JournalPracticeStore
    private lateinit var equipmentDb:EquipmentDatabase
    private lateinit var equipment:EquipmentRepository
    private lateinit var prefs:UserPreferences
    private lateinit var prefsFile:File
    private lateinit var scope:CoroutineScope
    private val models=ViewModelStore()
    @Before fun prepare() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            ui.activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build();store=JournalPracticeStore(db)
        equipmentDb=Room.inMemoryDatabaseBuilder(context,EquipmentDatabase::class.java).build();equipment=EquipmentRepository(equipmentDb)
        prefsFile=File(context.filesDir,"verification-journal-shell-${UUID.randomUUID()}.preferences_pb")
        scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        prefs=UserPreferences(PreferenceDataStoreFactory.create(scope=scope,produceFile={prefsFile}))
        val keyguard=ui.activity.getSystemService(android.app.KeyguardManager::class.java)
        assertFalse("UI verification requires the user to unlock the device.",keyguard.isKeyguardLocked)
        ui.waitUntil(5_000) {ui.activity.hasWindowFocus()}
    }
    @After fun cleanup()=runBlocking {
        InstrumentationRegistry.getInstrumentation().runOnMainSync{models.clear()}
        scope.coroutineContext[Job]!!.cancelAndJoin();db.close();equipmentDb.close();prefsFile.delete();Unit
    }
    private fun mount(source:PracticeStore=store) {
        val owner=object:ViewModelStoreOwner{override val viewModelStore=models}
        val model=ViewModelProvider(owner,PracticeViewModel.Factory(source))[PracticeViewModel::class.java]
        ui.setContent { val read by prefs.state.collectAsState(initial=SettingsRead.Loading);FableTheme((read as? SettingsRead.Ready)?.value?:UserSettings()){PracticeShell(model,prefs,read,equipment)} }
    }
    private fun captureRoundScreen(name:String,tag:String?=null) {
        val folder=File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("verification"),"rounds").apply { mkdirs() }
        if(tag!=null) {
            File(folder,name).outputStream().use { ui.onNodeWithTag(tag).captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
        } else {
            ui.waitForIdle()
            val bitmap=requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
            try {
                File(folder,name).outputStream().use { assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)) }
            } finally { bitmap.recycle() }
        }
    }
    private fun tag(name:String)=ui.onNodeWithTag(name,useUnmergedTree=name in setOf("round-number","end-number","end-score","round-score","round-average","end-average"))
    private fun waitTag(name:String){try{ui.waitUntil(10_000){ui.onAllNodesWithTag(name).fetchSemanticsNodes().isNotEmpty()}}catch(e:Throwable){val roots=ui.onAllNodes(isRoot());throw AssertionError("Expected screen: $name\n"+roots.fetchSemanticsNodes().indices.joinToString("\n"){roots[it].printToString()},e)}}
    private fun click(name: String) {
        val option=name.startsWith("plan-")||name.startsWith("volume-")||name in setOf(
            "setup-technique","conditions-notes","conditions-timer","setting-hide-scores","classic-training-preset",
        )
        if(ui.onAllNodesWithTag("conditions-options-sheet").fetchSemanticsNodes().isNotEmpty()&&!option&&
            name!="conditions-options-done"&&name!="conditions-options") {
            tag("conditions-options-done").performScrollTo().performClick()
        }
        if(option&&ui.onAllNodesWithTag("conditions-options-sheet").fetchSemanticsNodes().isEmpty()&&
            ui.onAllNodesWithTag("journal-setup").fetchSemanticsNodes().isNotEmpty()) {
            tag("conditions-options").performScrollTo().performClick()
        }
        if(name=="equipment-add-choice"&&ui.onAllNodesWithTag("conditions-equipment-sheet").fetchSemanticsNodes().isEmpty()) {
            tag("conditions-equipment").performScrollTo().performClick()
        }
        if(name in setOf("session-pause","session-resume","session-repeat","session-rename","session-trash","session-notes") && ui.onAllNodesWithTag(name).fetchSemanticsNodes().isEmpty()) {
            ui.onNodeWithContentDescription("Действия тренировки").performClick()
        }
        if(!tag(name).isDisplayed()) tag(name).performScrollTo()
        tag(name).performClick()
    }
    private fun awaitFact(check:suspend()->Boolean){ui.waitUntil(10_000){runBlocking{check()}}}

    private fun aim(score:Int, xZone:Boolean=false) {
        val journal=runBlocking { store.journal.active.first() ?: store.journal.history.first().first() }
        val profile=journal.currentBlock!!.block.verifiedTarget()!!
        val index=profile.zones.indexOfFirst { if(xZone) it.code=="X" else it.points==score && it.code!="X" }
        require(index>=0)
        val radius=(profile.zones.getOrNull(index-1)?.outerRadius ?: 0.0).let { inner ->
            (inner+profile.zones[index].outerRadius)/2
        }
        val target=tag("target-input")
        if (!target.isDisplayed()) target.performScrollTo()
        target.performTouchInput {
            click(center+androidx.compose.ui.geometry.Offset((minOf(width,height)*.44*radius).toFloat(),0f))
        }
    }

    @Test fun missingBowTypeInReportOpensLinkedBowEditor() = runBlocking {
        prefs.finishOnboarding("skipped")
        prefs.rankCategory("male")
        val bow = equipment.save(EquipmentItem(kind = "bow", name = "Bow without type"))
        val kit = equipment.save(EquipmentItem(kind = "setup", name = "Training kit", bowId = bow.id))
        val snapshot = equipment.snapshot(kit.id)
        store.startPlan("Training without bow type", BlockPlan(18.0, 400, 3,
            equipmentSnapshotJson = snapshot, targetProfileId = "wa-indoor-outer-v1"))
        val training = requireNotNull(store.journal.active.first())
        store.add(requireNotNull(training.currentEnd).end.id, null, 8)
        store.complete(training.session.id)

        mount()
        waitTag("home-screen")
        click("nav-history")
        click("session-${training.session.id}")
        waitTag("journal-report")
        tag("report-screen").performScrollToNode(hasTestTag("rank-configure-bow"))
        click("rank-configure-bow")
        waitTag("equipment-editor")
        tag("rank-sheet").assertDoesNotExist()
        tag("equipment-name").assertTextContains(bow.name)
        click("bow-category-recurve")
        click("equipment-save")
        waitTag("journal-report")
        awaitFact { equipment.items.first().any { it.id == bow.id && it.category == "recurve" } }
        assertEquals(snapshot, store.journal.details(training.session.id)?.currentBlock?.block?.equipmentSnapshotJson)
        Unit
    }

    @Test fun rankSheetConnectsLabelsShowsPaceAndHidesReferenceUntilTapped()=runBlocking {
        prefs.rankCategory("male")
        val bow=EquipmentItem(kind="bow",name="Barebow fixture",category="barebow")
        val kit=EquipmentItem(kind="setup",name="Scale fixture",bowId=bow.id)
        store.startPlan("Scale fixture",BlockPlan(18.0,400,3,equipmentSnapshotJson=equipmentSnapshot(kit,listOf(bow,kit)),
            targetProfileId="wa-indoor-outer-v1",plannedEnds=40,roundCount=2))
        val end=store.journal.active.first()!!.currentEnd!!.end.id
        repeat(3) { store.add(end,null,9) }
        mount();waitTag("target-input")
        tag("training-round-rank").assertTextContains("КЛб(М)",substring=true).assertTextContains("МС",substring=true)
        val scoreBounds=ui.onNodeWithTag("end-score",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
        val roundBounds=ui.onNodeWithTag("round-score",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
        val paceBounds=tag("training-round-rank").fetchSemanticsNode().boundsInRoot
        assertTrue(roundBounds.right<scoreBounds.left)
        assertTrue(paceBounds.top>=scoreBounds.bottom)
        click("training-round-rank");waitTag("rank-sheet")
        tag("rank-headline").assertTextEquals("Разряд: МС")
        tag("rank-target-conditions").assertTextContains("40 см · Indoor · обычная десятка")
        ui.onNodeWithText("Следующий рубеж — МСМК").assertExists()
        ui.onNodeWithText("Прогноз полного упражнения: 540 очков").assertExists()
        ui.onNodeWithText("Категория сравнения").assertDoesNotExist()
        ui.onNodeWithText("приказу Минспорта",substring=true).assertDoesNotExist()
        val scale=tag("rank-scale").fetchSemanticsNode().boundsInRoot
        val labels=(0..5).map { tag("rank-label-$it").fetchSemanticsNode().boundsInRoot }
        assertTrue(labels.first().center.x>scale.left+scale.width*.6f)
        assertTrue(labels.last().center.x>scale.left+scale.width*.85f)
        labels.forEach { assertTrue(it.left>=scale.left && it.right<=scale.right) }
        labels.forEachIndexed { i,a -> labels.drop(i+1).forEach { b ->
            assertTrue(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top)
        } }
        captureRoundScreen("norms-sheet-revised.png","rank-sheet")
        click("rank-label-5")
        ui.onNodeWithText("Порог: 553 очков",substring=true).assertExists()
        ui.onNodeWithText("Закрыть").performClick()
        click("rank-help");ui.onNodeWithText("О нормативах").assertExists()
        ui.onNodeWithText("приказу Минспорта",substring=true).assertExists()
        ui.onNodeWithText("Закрыть").performClick()
        click("open-rank-grid");waitTag("rank-reference")
        tag("rank-grid-cell-26-0").assertTextEquals("553")
        click("rank-grid-category-female")
        tag("rank-grid-cell-26-0").assertTextEquals("549")
        assertEquals("male",(prefs.state.first { it is SettingsRead.Ready } as SettingsRead.Ready).value.rankCategory)
        click("rank-grid-bow-3d")
        tag("rank-grid-cell-44-0").assertTextEquals("920")
        captureRoundScreen("norms-full-grid.png","rank-reference")
        ui.onNodeWithContentDescription("Закрыть разрядную сетку").performClick()
        waitTag("rank-sheet")
        click("rank-change-category");click("rank-category-female")
        awaitFact { (prefs.state.first { it is SettingsRead.Ready } as SettingsRead.Ready).value.rankCategory=="female" }
        Unit
    }

    @Test fun reportShowsTrueRoundsAndCompactEndsBeforeAnalyticsAcrossConditionChanges()=runBlocking {
        val bow=EquipmentItem(kind="bow",name="Barebow",category="barebow")
        val kit=EquipmentItem(kind="setup",name="ИНСТИНКТИВ",bowId=bow.id)
        val snapshot=equipmentSnapshot(kit,listOf(bow,kit))
        store.startPlan("Round report",BlockPlan(18.0,400,6,equipmentSnapshotJson=snapshot,
            targetProfileId="wa-indoor-outer-v1",plannedEnds=4,roundCount=2))
        val first=store.journal.active.first()!!
        val firstEnd=first.currentEnd!!.end.id
        listOf(10,10,9,8,7,6).forEach { store.add(firstEnd,null,it) }
        store.block(first.session.id,BlockPlan(30.0,800,6,equipmentSnapshotJson=snapshot,targetProfileId="wa-outdoor-full-v1"),false)
        val secondEnd=store.journal.active.first()!!.currentEnd!!.end.id
        listOf(8,8,7,7,6,5).forEach { store.add(secondEnd,null,it) }
        store.next(secondEnd)
        val thirdEnd=store.journal.active.first()!!.currentEnd!!.end.id
        store.addX(thirdEnd,UUID.randomUUID().toString())
        listOf(0,9,8,7,6).forEach { store.add(thirdEnd,null,it) }
        store.complete(first.session.id)
        mount();waitTag("home-screen");click("nav-history");click("session-${first.session.id}");waitTag("journal-report")
        val reportConditions = hasAnyAncestor(hasTestTag("report-conditions"))
        ui.onNode(hasContentDescription("Дистанция: 18 м") and reportConditions).assertIsDisplayed()
        ui.onNode(hasContentDescription("Дистанция: 30 м") and reportConditions).assertIsDisplayed()
        ui.onNode(hasContentDescription("Мишень: 40 см", substring = true) and reportConditions).assertIsDisplayed()
        ui.onNode(hasContentDescription("Мишень: 80 см", substring = true) and reportConditions).assertIsDisplayed()
        ui.onAllNodes(hasContentDescription("Лук или комплект: Barebow") and reportConditions).assertCountEquals(2)
        tag("report-round-total-1").assertTextEquals("Раунд 1 · 91/120 · 7,6")
        ui.onNodeWithTag("report-series-total-$firstEnd",useUnmergedTree=true).assertTextEquals("50/60 · 8,3")
        ui.onNodeWithTag("report-series-total-$secondEnd",useUnmergedTree=true).assertTextEquals("41/60 · 6,8")
        captureRoundScreen("report-compact-rounds.png")
        tag("report-screen").performScrollToNode(hasTestTag("report-round-total-2"))
        tag("report-round-total-2").assertTextEquals("Раунд 2 · 40/120 · 6,7")
        ui.onNodeWithTag("report-series-total-$thirdEnd",useUnmergedTree=true).assertTextEquals("40/60 · 6,7")
        val saved=store.journal.details(first.session.id)!!
        ui.onNodeWithTag("report-hit-${saved.allShots.first { it.zoneCode=="X" }.id}",useUnmergedTree=true).assertTextEquals("X")
        ui.onNodeWithTag("report-hit-${saved.allShots.first { it.points==0 }.id}",useUnmergedTree=true).assertTextEquals("M")
        click("report-end-$thirdEnd");waitTag("history-shot-editor")
        tag("report-end-editor").assertDoesNotExist()
        click("report-edit-${saved.allShots.last().id}")
        aim(10);click("history-save-shot")
        awaitFact { store.journal.details(first.session.id)!!.allShots.last().points==10 }
        ui.waitUntil(10_000) {
            ui.onAllNodes(hasTestTag("report-edit-${saved.allShots.last().id}") and hasText("10")).fetchSemanticsNodes().isNotEmpty()
        }
        ui.runOnIdle { ui.activity.onBackPressedDispatcher.onBackPressed() }
        waitTag("journal-report");tag("report-screen").performScrollToNode(hasTestTag("report-round-total-2"))
        tag("report-round-total-2").assertTextEquals("Раунд 2 · 44/120 · 7,3")
        Unit
    }

    @Test fun setupCardCreatesAndSelectsComponentsWithoutLosingDraft()=runBlocking {
        mount();waitTag("onboarding-screen");click("onboard-skip");waitTag("home-screen")
        click("nav-equipment");waitTag("equipment-screen");click("equipment-tab-setup");click("equipment-add")
        tag("equipment-name").performTextInput("Мой комплект")
        ui.onNodeWithContentDescription("Добавить лук").performClick()
        tag("equipment-name").performTextInput("Не сохранять")
        ui.onNodeWithText("Отмена").performScrollTo().performClick()
        tag("equipment-name").assertTextContains("Мой комплект")
        assertTrue(equipment.items.first().isEmpty())
        ui.onNodeWithContentDescription("Добавить лук").performClick()
        tag("equipment-name").performTextInput("Новый лук");click("bow-category-barebow");click("equipment-save")
        awaitFact { equipment.items.first().any { it.kind=="bow" } }
        val bow=equipment.items.first().single()
        tag("equipment-name").assertTextContains("Мой комплект")
        tag("equipment-select-${bow.id}").assertIsSelected()
        ui.onNodeWithContentDescription("Добавить стрелы").performClick()
        tag("equipment-name").performTextInput("Новые стрелы");click("equipment-save")
        awaitFact { equipment.items.first().any { it.kind=="arrows" } }
        val arrows=equipment.items.first().single { it.kind=="arrows" }
        tag("equipment-name").assertTextContains("Мой комплект")
        tag("equipment-select-${arrows.id}").assertIsSelected()
        click("equipment-save");waitTag("equipment-screen")
        val saved=equipment.items.first().single { it.kind=="setup" }
        assertEquals("Мой комплект",saved.name);assertEquals(bow.id,saved.bowId);assertEquals(arrows.id,saved.arrowsId)
        Unit
    }

    @Test fun componentCreatedFromTrainingSetupReturnsToSelectedKit()=runBlocking {
        mount();waitTag("onboarding-screen");click("onboard-skip");waitTag("home-screen")
        click("home-primary");waitTag("journal-setup");click("equipment-add-choice")
        tag("equipment-name").performTextInput("Комплект из условий")
        ui.onNodeWithContentDescription("Добавить лук").performClick()
        tag("equipment-name").performTextInput("Лук из условий");click("bow-category-recurve");click("equipment-save")
        awaitFact { equipment.items.first().any { it.kind=="bow" } }
        tag("equipment-name").assertTextContains("Комплект из условий")
        click("equipment-save");waitTag("journal-setup")
        val kit=equipment.items.first().single { it.kind=="setup" }
        tag("equipment-select-${kit.id}").assertIsSelected()
        assertEquals(equipment.items.first().single { it.kind=="bow" }.id,kit.bowId)
        Unit
    }

    @Test fun rankCategoryIsExplicitAndPersistsWithoutBlockingTraining()=runBlocking {
        val bow=EquipmentItem(kind="bow",name="Category fixture",category="barebow")
        store.startPlan("Category fixture",BlockPlan(18.0,400,3,
            equipmentSnapshotJson=equipmentSnapshot(bow,listOf(bow)),targetProfileId="wa-indoor-outer-v1"))
        mount();waitTag("target-input")
        val bounds=tag("target-board").fetchSemanticsNode().boundsInRoot
        click("training-round-rank");waitTag("rank-sheet")
        ui.onNodeWithText("Выбери категорию сравнения").assertExists()
        click("rank-category-female")
        awaitFact { (prefs.state.first { it is SettingsRead.Ready } as SettingsRead.Ready).value.rankCategory=="female" }
        assertEquals("female",prefs.archiveSnapshot()["rank_category_v1"]!!.second)
        dismissTestSheet(ui)
        aim(10)
        awaitFact { store.journal.active.first()!!.allShots.size==1 }
        assertEquals(bounds,tag("target-board").fetchSemanticsNode().boundsInRoot)
        aim(9);awaitFact { store.journal.active.first()!!.allShots.size==2 }
        tag("end-score").assertTextEquals("19/30")
        assertEquals(bounds,tag("target-board").fetchSemanticsNode().boundsInRoot)
        captureRoundScreen("norms-live.png")
        Unit
    }

    @Test fun normsShowLivePaceAndWholeTwoRoundResult()=runBlocking {
        prefs.rankCategory("male")
        val bow=EquipmentItem(kind="bow",name="Rank fixture",category="recurve")
        store.startPlan("Norms two rounds",BlockPlan(18.0,400,3,
            equipmentSnapshotJson=equipmentSnapshot(bow,listOf(bow)),plannedEnds=20,
            targetProfileId="wa-indoor-outer-v1",roundCount=2))
        val id=store.journal.active.first()!!.session.id
        repeat(19) { n ->
            val end=store.journal.active.first()!!.currentEnd!!.end.id
            repeat(3) { store.add(end,null,if(n==0) 10 else 8) }
            store.next(end)
        }
        val preparedAwards=store.journal.achievements.board.first().awards
        store.journal.achievements.claimNotifications(preparedAwards.map {it.key})
        mount();waitTag("target-input")
        captureRoundScreen("training-header-f.png")
        tag("training-round-rank").assertExists()
        tag("round-number").assertTextEquals("2/2")
        tag("end-number").assertTextEquals("10/10")
        click("training-round-rank");waitTag("rank-sheet")
        tag("rank-remaining").assertExists()
        dismissTestSheet(ui)
        repeat(3) { n -> aim(8);awaitFact { store.journal.active.first()!!.allShots.size==58+n } }
        click("next-end");waitTag("journal-report")
        tag("report-screen").performScrollToNode(hasTestTag("rank-card"))
        tag("rank-card").assertExists()
        tag("rank-scale").assertExists()
        ui.onNodeWithText("По очкам: II").assertExists()
        assertEquals(id,store.journal.history.first().single().session.id)
        assertEquals(486,store.journal.details(id)!!.allShots.sumOf { it.points })
        captureRoundScreen("norms-report.png")
        Unit
    }

    @Test fun manualFinishFailureStaysInTrainingAndRetryOpensCorrectReport()=runBlocking {
        store.start("Finish retry",18.0,400,3)
        val active=store.journal.active.first()!!
        store.add(active.currentEnd!!.end.id,null,9)
        var fail=true
        val source=object:PracticeStore by store {
            override suspend fun complete(id:String,operationId:String) {
                if(fail)throw IOException("injected finish failure")
                store.complete(id,operationId)
            }
        }
        mount(source);waitTag("target-input")
        click("finish-training");click("finish-confirm")
        ui.waitUntil(10_000) { ui.onAllNodesWithText("Повторить").fetchSemanticsNodes().isNotEmpty() }
        tag("target-input").assertExists();tag("journal-report").assertDoesNotExist()
        fail=false;ui.onNodeWithText("Повторить").performClick();waitTag("journal-report")
        assertEquals("completed",store.journal.details(active.session.id)!!.session.state)
        Unit
    }

    @Test fun longEndSwitchingArrowSavesPreviousDraft()=runBlocking {
        store.start("Long end fixture",18.0,400,12)
        val journal=store.journal.active.first()!!
        val end=journal.currentEnd!!.end.id
        store.add(end,null,9)
        store.add(end,null,8)
        mount();waitTag("target-input")
        click("shot-0");aim(10);click("shot-1")
        awaitFact { store.journal.active.first()!!.allShots.first().points==10 }
        aim(7);click("save-edit")
        awaitFact { store.journal.active.first()!!.allShots[1].points==7 }
        val closedBounds=ui.onNodeWithTag("arrow-panel").fetchSemanticsNode().boundsInRoot
        val targetBounds=ui.onNodeWithTag("target-input").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithContentDescription("Все стрелы серии").performClick()
        ui.onNodeWithText("Все стрелы серии").assertIsDisplayed()
        val openBounds=ui.onNodeWithTag("arrow-panel").fetchSemanticsNode().boundsInRoot
        assertTrue(openBounds.top<closedBounds.top)
        assertTrue(kotlin.math.abs(openBounds.bottom-closedBounds.bottom)<1f)
        assertEquals(targetBounds,ui.onNodeWithTag("target-input").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithTag("shot-11").performScrollTo().assertExists()
        captureRoundScreen("arrow-slots-twelve.png")
        Unit
    }

    @Test fun editsUndoPartialAndChangedConditionsUseIndependentBlocks()=runBlocking {
        store.start("Journal UI fixture",18.0,600,3)
        val initial=store.journal.active.first()!!;val end=initial.currentEnd!!.end.id
        store.add(end,null,10);store.add(end,null,9)
        mount();waitTag("target-input")
        click("shot-0");aim(7);click("save-edit")
        awaitFact{store.journal.active.first()!!.allShots.first().points==7}
        click("undo");awaitFact{store.journal.active.first()!!.allShots.first().points==10}
        click("warmup-toggle");awaitFact{store.journal.active.first()!!.currentEnd!!.end.role=="warmup"}
        click("close-partial");ui.onNodeWithText("Закрыть эту серию?").assertExists()
        click("partial-confirm")
        awaitFact{store.journal.active.first()!!.currentBlock!!.ends.size==2}
        click("change-conditions");waitTag("journal-setup")
        click("distance-30");click("diameter-80");click("start-training")
        awaitFact{store.journal.active.first()!!.blocks.size==2}
        val after=store.journal.active.first()!!
        assertEquals(18.0,after.orderedBlocks.first().block.distanceMeters!!,0.0)
        assertEquals(600,after.orderedBlocks.first().block.targetDiameterMm)
        assertEquals(30.0,after.currentBlock!!.block.distanceMeters!!,0.0)
        assertEquals(3,after.currentEnd!!.end.plannedCount)
        assertEquals(listOf(10,9),after.allShots.map{it.points})
        click("statistics");waitTag("journal-report");tag("report-block-1").assertExists()
        click("report-block-0");click("report-warmup")
        ui.onNodeWithText("19",substring=false).assertExists()
        Unit
    }

    @Test fun countOnlyCanStartAndFinishWithoutInventingShots() {
        mount();waitTag("onboarding-screen");click("onboard-skip");waitTag("home-screen");click("home-primary")
        waitTag("journal-setup");click("plan-count_only");click("start-training");waitTag("count-practice")
        repeat(3){i->click("count-plus");awaitFact{store.journal.active.first()!!.currentEnd!!.volume==i+1};ui.waitForIdle()}
        assertTrue(runBlocking{store.journal.active.first()!!.allShots.isEmpty()})
        click("finish-training");click("finish-confirm")
        awaitFact{store.journal.active.first()==null&&store.journal.history.first().single().session.state=="completed"}
        waitTag("journal-report")
        val summary=runBlocking{store.history.first().single()}
        assertEquals(3,summary.shotCount);assertEquals(0,summary.scoredCount);assertEquals(0,summary.total)
        ui.onNodeWithText("Без оценки",substring=false).assertExists()
        val savedEnd=runBlocking{store.journal.details(summary.id)!!.currentEnd!!.end}
        click("report-end-${savedEnd.id}");tag("history-count-field").performTextReplacement("2");click("history-count-save")
        awaitFact{store.journal.details(summary.id)!!.currentEnd!!.volume==2}
        assertTrue(runBlocking{store.journal.details(summary.id)!!.allShots.isEmpty()})
    }

    @Test fun configuredRoundsTransitionAndRepeatRetainsSettings()=runBlocking {
        mount();waitTag("onboarding-screen");click("onboard-skip");waitTag("home-screen");click("home-primary");waitTag("journal-setup")
        ui.onNodeWithText("Подготовка тренировки").assertDoesNotExist();ui.onNodeWithText("О мишени").assertDoesNotExist()
        click("distance-18");click("diameter-60");click("volume-fixed")
        tag("volume-rounds").assertDoesNotExist();tag("volume-ends").assertTextContains("10")
        tag("volume-ends").performTextReplacement("1");click("start-training");waitTag("target-input")
        tag("round-number").assertTextEquals("1");tag("end-number").assertTextEquals("1/1")
        repeat(3) { aim(10);awaitFact { store.journal.active.first()!!.allShots.size==it+1 } }
        tag("round-score").assertTextEquals("30/30");tag("next-end").assertTextContains("Следующий раунд")
        click("next-end");awaitFact { store.journal.active.first()!!.usedPlanEnds==1 && store.journal.active.first()!!.currentEnd!!.shots.isEmpty() }
        tag("round-number").assertTextEquals("2");tag("end-number").assertTextEquals("1/1");tag("round-score").assertTextEquals("0/30")
        tag("round-average").assertTextEquals("Средний —")
        click("practice-previous-series")
        tag("round-number").assertTextEquals("1");tag("miss").assertIsNotEnabled()
        click("practice-next-series")
        tag("round-number").assertTextEquals("2")
        aim(9);awaitFact { store.journal.active.first()!!.allShots.size==4 }
        tag("round-average").assertTextEquals("Средний 9,0")
        val id=store.journal.active.first()!!.session.id
        click("next-end");awaitFact { store.journal.active.first()!!.roundProgress().number==3 }
        click("finish-training");click("finish-confirm");waitTag("journal-report")
        assertEquals(4,store.journal.details(id)!!.allShots.size)
        click("session-resume");waitTag("target-input")
        awaitFact { store.journal.active.first()?.session?.id==id }
        tag("round-number").assertTextEquals("3")
        assertTrue(store.journal.details(id)!!.rollingRounds)
        Unit
    }

    @Test fun editingPreviousSeriesKeepsRankVisibleAndUndoScopedToThatSeries()=runBlocking {
        prefs.rankCategory("male")
        val bow=EquipmentItem(kind="bow",name="Barebow fixture",category="barebow")
        val kit=EquipmentItem(kind="setup",name="Training kit",bowId=bow.id)
        store.startPlan("Editable rounds",BlockPlan(18.0,400,equipmentSnapshotJson=equipmentSnapshot(kit,listOf(bow,kit)),
            targetProfileId="wa-indoor-outer-v1",seriesPerRound=10,flexibleSeries=true))
        val past=store.journal.active.first()!!.currentEnd!!.end.id
        repeat(3) { store.add(past,null,9) }
        store.next(past)
        val live=store.journal.active.first()!!.currentEnd!!.end.id
        mount();waitTag("target-input")
        aim(10);awaitFact { store.journal.active.first()!!.currentEnd!!.volume==1 }
        tag("training-round-rank").assertExists()
        click("practice-previous-series")
        tag("training-round-rank").assertExists()
        tag("miss").assertIsNotEnabled()
        click("shot-0");aim(8);click("save-edit")
        awaitFact { store.journal.active.first()!!.allShots.first().points==8 }
        click("shot-0");click("miss");click("save-edit")
        awaitFact { store.journal.active.first()!!.allShots.first().points==0 }
        click("undo");awaitFact { store.journal.active.first()!!.allShots.first().points==8 }
        click("undo");awaitFact { store.journal.active.first()!!.allShots.first().points==9 }
        click("shot-1");aim(7);click("save-edit")
        awaitFact { store.journal.active.first()!!.allShots[1].points==7 }
        click("practice-return-current")
        click("undo")
        awaitFact { store.journal.active.first()!!.currentEnd!!.volume==0 }
        val after=store.journal.active.first()!!
        assertEquals(live,after.currentEnd!!.end.id)
        assertEquals(listOf(9,7,9),after.allShots.map { it.points })
        Unit
    }

    @Test fun fixedPlanShowsRoundMaximumAndFinishLabel()=runBlocking {
        store.startPlan("Round maximum",BlockPlan(18.0,600,3,plannedEnds=1))
        val active=store.journal.active.first()!!
        for(points in listOf(10,9,0)) store.add(active.currentEnd!!.end.id,null,points)
        mount();waitTag("target-input")
        tag("round-score").assertTextEquals("19/30")
        tag("next-end").assertTextContains("Завершить тренировку")
        click("next-end");waitTag("journal-report")
        awaitFact { store.journal.history.first().single().session.state=="completed" }
        Unit
    }

    @Test fun fixedPlanCompletesAndRepeatRetainsVolume() {
        mount();waitTag("onboarding-screen");click("onboard-skip");waitTag("home-screen");click("home-primary");waitTag("journal-setup")
        click("plan-count_only");click("volume-fixed");tag("volume-ends").performTextReplacement("1");click("start-training")
        waitTag("count-practice");ui.onNodeWithText("Раунд 1 · Серия 1/1").assertExists()
        repeat(3){i->click("count-plus");awaitFact{store.journal.active.first()!!.currentEnd!!.volume==i+1};ui.waitForIdle()};click("next-end");ui.onNodeWithText("Раунд 2 · Серия 1/1").assertExists()
        click("finish-training");click("finish-confirm");waitTag("journal-report")
        val result=runBlocking{store.journal.history.first().single()};assertEquals(1,result.plans.single().seriesLimit);assertEquals(1,result.blocks.single().ends.size)
        click("session-repeat");waitTag("journal-setup")
        click("conditions-options");tag("volume-fixed").assertIsSelected();tag("volume-ends").assertTextContains("1");click("start-training");waitTag("count-practice")
        assertEquals(1,runBlocking{store.journal.active.first()!!.plans.single().seriesLimit})
    }

    @Test fun selectedTargetStartsWithItsOwnDiameterAndRepeatKeepsProfile() {
        mount();waitTag("onboarding-screen");click("onboard-skip");waitTag("home-screen");click("home-primary");waitTag("journal-setup")
        click("target-profile-choice");click("target-profile-wa-indoor-inner-v1");click("distance-18");click("start-training");waitTag("target-input")
        val active=runBlocking{store.journal.active.first()!!};assertEquals("wa-indoor-inner-v1",active.currentBlock!!.block.targetProfileId);assertEquals(400,active.currentBlock!!.block.targetDiameterMm)
        tag("score-X").assertDoesNotExist();aim(10);awaitFact{store.journal.active.first()!!.allShots.size==1}
        click("finish-training");click("finish-confirm");waitTag("journal-report");click("session-repeat");waitTag("journal-setup")
        tag("target-profile-choice").assertTextContains("Indoor · малая десятка");click("start-training");waitTag("target-input")
        assertEquals("wa-indoor-inner-v1",runBlocking{store.journal.active.first()!!.currentBlock!!.block.targetProfileId})
    }

    @Test fun outdoorXCanBeEnteredEditedAndUndone()=runBlocking {
        store.startPlan("Outdoor UI",BlockPlan(18.0,800,targetProfileId="wa-outdoor-full-v1"))
        mount();waitTag("target-input");aim(10,xZone=true);awaitFact{store.journal.active.first()!!.allShots.singleOrNull()?.zoneCode=="X"}
        tag("shot-0").assertTextContains("1 · X");click("shot-0");aim(9);click("save-edit");awaitFact{store.journal.active.first()!!.allShots.single().points==9}
        click("undo");awaitFact{store.journal.active.first()!!.allShots.single().zoneCode=="X"}
        click("undo");awaitFact{store.journal.active.first()!!.allShots.isEmpty()}
        Unit
    }

    @Test fun targetOnlyEditsOldNumericShotAndSupportsMissAndUndo()=runBlocking {
        store.startPlan("Target only",BlockPlan(18.0,800,targetProfileId="wa-outdoor-full-v1"))
        val end=store.journal.active.first()!!.currentEnd!!.end.id
        store.add(end,null,9)
        val original=store.journal.active.first()!!.allShots.single()
        mount();waitTag("target-input")
        tag("mode-numbers").assertDoesNotExist();tag("mode-target").assertDoesNotExist()
        tag("score-9").assertDoesNotExist()
        assertNull(store.journal.active.first()!!.allShots.single().x)
        click("shot-0");aim(7)
        assertEquals(original,store.journal.active.first()!!.allShots.single())
        click("save-edit")
        awaitFact { store.journal.active.first()!!.allShots.single().points==7 }
        val placed=store.journal.active.first()!!.allShots.single()
        assertEquals("target_computed",placed.scoreSource);assertEquals("known",placed.positionStatus)
        assertNotNull(placed.x)
        click("shot-0");click("miss");click("save-edit")
        awaitFact { store.journal.active.first()!!.allShots.single().points==0 }
        val missed=store.journal.active.first()!!.allShots.single()
        assertEquals("M",missed.zoneCode);assertNull(missed.x);assertNull(missed.y)
        click("undo");awaitFact { store.journal.active.first()!!.allShots.single().points==7 }
        click("miss");awaitFact { store.journal.active.first()!!.allShots.size==2 }
        assertEquals("M",store.journal.active.first()!!.allShots.last().zoneCode)
        click("undo");awaitFact { store.journal.active.first()!!.allShots.size==1 }
        Unit
    }

    @Test fun profileAndProgressOpenNormsAndPersonalBestFollowsTrashAndRestore()=runBlocking {
        prefs.rankCategory("male")
        val bow=EquipmentItem(kind="bow",name="Recurve fixture",category="recurve")
        val kit=EquipmentItem(kind="setup",name="Rank kit",bowId=bow.id)
        val plan=BlockPlan(18.0,400,3,targetProfileId="wa-indoor-outer-v1",
            equipmentSnapshotJson=equipmentSnapshot(kit,listOf(bow,kit)),plannedEnds=10)
        suspend fun training(title:String,score:Int):String {
            store.startPlan(title,plan)
            val id=store.journal.active.first()!!.session.id
            repeat(10) {
                val end=store.journal.active.first()!!.currentEnd!!.end.id
                repeat(3) {store.add(end,null,score)}
                store.next(end)
            }
            return id
        }
        val best=training("Personal best fixture",9)
        training("Previous result fixture",8)
        mount();waitTag("home-screen");click("open-profile");waitTag("profile-screen")
        click("profile-rank-results");waitTag("personal-ranks-screen")
        tag("personal-best-recurve-18-30-male").assertTextContains("270/300",substring=true)
        click("personal-rank-grid");waitTag("rank-reference")
        ui.onNodeWithContentDescription("Закрыть разрядную сетку").performClick()
        click("personal-best-recurve-18-30-male");waitTag("journal-report")
        ui.onNodeWithText("Personal best fixture").assertExists()
        click("session-trash");click("trash-confirm");waitTag("home-screen")
        click("nav-progress");click("progress-ranks");waitTag("personal-ranks-screen")
        tag("personal-best-recurve-18-30-male").assertTextContains("240/300",substring=true)
        click("page-back");click("nav-history");click("history-filters");click("history-deleted")
        click("restore-$best");awaitFact {store.trash.first().isEmpty()}
        click("open-profile");click("profile-rank-results");waitTag("personal-ranks-screen")
        tag("personal-best-recurve-18-30-male").assertTextContains("270/300",substring=true)
        captureRoundScreen("personal-rank-bests.png")
        Unit
    }

    @Test fun assignedRanksCanBeAddedReplacedEditedAndDeletedWithoutChangingTrainings()=runBlocking {
        prefs.finishOnboarding("skipped");prefs.rankCategory("male")
        mount();waitTag("home-screen");click("open-profile");waitTag("profile-screen")
        click("assigned-open");waitTag("assigned-history-sheet")
        click("assigned-add");waitTag("assigned-editor")
        click("assigned-discipline");click("assigned-choice-barebow")
        tag("assigned-date").performTextInput("2026-02-30");tag("assigned-save").assertIsNotEnabled()
        tag("assigned-date").performTextReplacement("2026-10-01")
        tag("assigned-issuer").performTextInput("Fixture club")
        click("assigned-save")
        awaitFact {store.rankAssignments.records.first().size==1}
        val first=store.rankAssignments.records.first().single()
        assertEquals("III",first.level);assertEquals("barebow",first.discipline)
        click("assigned-add");click("assigned-discipline");click("assigned-choice-barebow")
        click("assigned-level");click("assigned-choice-II");click("assigned-save")
        awaitFact {store.rankAssignments.records.first().size==2}
        val current=store.rankAssignments.records.first().single {it.current}
        assertEquals("II",current.level)
        waitTag("assigned-history-sheet")
        click("assigned-edit-${first.id}");click("assigned-level");click("assigned-choice-I");click("assigned-save")
        awaitFact {store.rankAssignments.records.first().single {it.id==first.id}.level=="I"}
        assertEquals(current.id,store.rankAssignments.records.first().single {it.current}.id)
        click("assigned-edit-${current.id}");click("assigned-delete");click("assigned-delete-confirm")
        awaitFact {store.rankAssignments.records.first().size==1}
        assertTrue(store.rankAssignments.records.first().none {it.current})
        assertTrue(store.history.first().isEmpty())
        captureRoundScreen("assigned-ranks-profile.png")
        Unit
    }

    @Test fun favoriteConditionsSaveApplyRenameAndDeleteWithoutStartingTraining()=runBlocking {
        prefs.finishOnboarding("skipped")
        val bow=equipment.save(EquipmentItem(kind="bow",name="Favorite bow",category="barebow"))
        equipment.save(EquipmentItem(kind="setup",name="Favorite kit",bowId=bow.id,favorite=true))
        mount();waitTag("home-screen");click("home-primary");waitTag("journal-setup")
        click("distance-18");click("diameter-40");click("volume-fixed")
        click("conditions-equipment")
        ui.onNodeWithText(ui.activity.getString(R.string.equipment_none)).performScrollTo().performClick()
        click("save-training-preset");tag("preset-name").performTextInput("Club 18");click("preset-save")
        awaitFact {(prefs.state.first {it is SettingsRead.Ready} as SettingsRead.Ready).value.trainingPresetsJson!=null}
        assertNull(store.journal.active.first())
        val raw=(prefs.state.first {it is SettingsRead.Ready} as SettingsRead.Ready).value.trainingPresetsJson
        val preset=TrainingPresets.decode(raw).single()
        assertNull(preset.plan.equipmentSnapshotJson)
        assertTrue(preset.plan.flexibleSeries);assertEquals(10,preset.plan.seriesPerRound)
        click("distance-30");click("volume-free")
        click("training-presets");click("preset-${preset.id}");waitTag("journal-setup")
        tag("distance-18").assertIsSelected()
        tag("conditions-equipment").assertTextContains(ui.activity.getString(R.string.equipment_none))
        click("conditions-options");tag("volume-fixed").assertIsSelected();tag("volume-ends").assertTextContains("10")
        click("distance-30");click("training-presets");click("preset-${preset.id}")
        tag("distance-18").assertIsSelected()
        assertNull(store.journal.active.first())
        click("training-presets");click("preset-rename-${preset.id}");tag("preset-name").performTextReplacement("Indoor six");click("preset-save")
        awaitFact {TrainingPresets.decode((prefs.state.first {it is SettingsRead.Ready} as SettingsRead.Ready).value.trainingPresetsJson).single().name=="Indoor six"}
        click("preset-delete-${preset.id}");click("preset-delete-confirm")
        awaitFact {TrainingPresets.decode((prefs.state.first {it is SettingsRead.Ready} as SettingsRead.Ready).value.trainingPresetsJson).isEmpty()}
        dismissTestSheet(ui)
        click("start-training");waitTag("target-input")
        val active=store.journal.active.first()!!
        assertEquals(3,active.currentEnd!!.end.plannedCount);assertEquals(10,active.plans.single().seriesLimit)
        assertNull(active.currentBlock!!.block.equipmentSnapshotJson)
        Unit
    }

    @Test fun notebookCreatesStandaloneContextSearchesTagsAndConfirmsDiscardAndDelete()=runBlocking {
        prefs.finishOnboarding("skipped")
        mount();waitTag("home-screen");click("nav-history");click("history-notes");waitTag("notebook-screen")
        click("note-add");waitTag("note-editor");tag("note-save").assertIsNotEnabled()
        tag("note-body").performTextInput("Заметка о личной технике")
        tag("note-tags").performTextInput("стойка, клуб")
        tag("note-date").performTextReplacement("2026-11-02")
        click("note-context");tag("note-place").performTextInput("Тир");tag("note-feeling").performTextInput("Со своих слов")
        click("note-save");awaitFact {store.notes.notes.first().size==1}
        val note=store.notes.notes.first().single()
        assertTrue(store.history.first().isEmpty());assertNull(note.sessionId)
        tag("note-search").performTextInput("#стойка");tag("note-${note.id}").assertExists()
        click("note-${note.id}");tag("note-body").performTextReplacement("Не сохранять")
        ui.onNodeWithContentDescription("Закрыть редактор заметки").performClick();click("note-discard")
        assertEquals(note.body,store.notes.notes.first().single().body)
        click("note-${note.id}");tag("note-body").assertTextContains(note.body);click("note-delete");click("note-delete-confirm")
        awaitFact {store.notes.notes.first().isEmpty()}
        assertTrue(store.history.first().isEmpty())
        Unit
    }

    @Test fun identicalConditionPartsDefaultToTheWholeTrainingInEveryChart()=runBlocking {
        fun reportNode(name:String):SemanticsNodeInteraction {tag("report-screen").performScrollToNode(hasTestTag(name));return tag(name)}
        val plan=BlockPlan(18.0,400,3,plannedEnds=20,roundCount=2)
        store.startPlan("Scope fixture",plan)
        val first=listOf(listOf(9,9,10),listOf(9,8,9),listOf(6,7,8))
        repeat(20) {index ->
            var active=store.journal.active.first()!!
            if(index==3) {
                store.block(active.session.id,BlockPlan(18.0,400,3),true)
                active=store.journal.active.first()!!
            }
            (first.getOrNull(index) ?: listOf(10,10,10)).forEach {score -> store.add(active.currentEnd!!.end.id,null,score)}
            store.next(active.currentEnd!!.end.id)
        }
        val completed=store.history.first().single()
        mount();waitTag("home-screen");click("nav-history");click("session-${completed.id}");waitTag("journal-report")
        tag("report-scope-coverage").assertDoesNotExist()
        reportNode("cg3-classic").assertTextContains("585",substring=true).assertTextContains("60",substring=true)
        reportNode("report-zones-total").assertTextContains("60",substring=true)
        reportNode("report-block-1").performScrollTo().performClick()
        tag("report-scope-coverage").assertDoesNotExist()
        reportNode("cg3-classic").assertTextContains("75",substring=true)
        reportNode("report-block-2").performScrollTo().performClick()
        tag("report-scope-coverage").assertDoesNotExist()
        reportNode("cg3-classic").assertTextContains("510",substring=true)
        reportNode("report-block-0").performScrollTo().performClick()
        reportNode("report-zones-total").assertTextContains("60",substring=true)
        captureRoundScreen("report-whole-training.png")
        assertEquals(60,store.journal.details(completed.id)!!.allShots.size)
        Unit
    }

    @Test fun switchingEditedShotsKeepsOptimisticPositionUntilTheSaveAcknowledges()=runBlocking {
        store.start("Pending edit fixture",18.0,400,3)
        val original=store.journal.active.first()!!
        repeat(2) {store.add(original.currentEnd!!.end.id,null,9)}
        val entered=CompletableDeferred<Unit>()
        val release=CompletableDeferred<Unit>()
        val delayed=object:PracticeStore by store {
            override suspend fun revise(value:ShotEntity,operationId:String):ShotEntity? {
                entered.complete(Unit);release.await();return store.revise(value,operationId)
            }
        }
        prefs.animations(false)
        try {
            mount(delayed);waitTag("target-input");click("shot-0");aim(10);click("shot-1")
            withTimeout(5000) {entered.await()}
            tag("shot-0").assertTextEquals("1 · 10")
            tag("end-score").assertTextContains("19",substring=true)
            assertEquals(9,store.journal.active.first()!!.allShots.first().points)
            release.complete(Unit)
            awaitFact {store.journal.active.first()!!.allShots.first().points==10}
            tag("shot-0").assertTextEquals("1 · 10")
        } finally {release.complete(Unit)}
        Unit
    }

    @Test fun recordsKeepComparableSeriesSeparateAndFollowTrashAndRestore()=runBlocking {
        suspend fun training(title:String,distance:Double,values:List<Int>):Pair<String,String> {
            store.start(title,distance,400,3)
            val active=store.journal.active.first()!!
            values.forEach {store.add(active.currentEnd!!.end.id,null,it)}
            store.complete(active.session.id)
            return active.session.id to active.currentEnd!!.end.id
        }
        val previous=training("Previous record fixture",18.0,listOf(8,8,8))
        val best=training("Best record fixture",18.0,listOf(9,9,9))
        val far=training("Other distance fixture",30.0,listOf(10,10,10))
        val partial=training("Partial fixture",18.0,listOf(10,10))
        prefs.animations(false)
        mount();waitTag("home-screen");click("open-profile");click("profile-records");waitTag("personal-records-screen")
        tag("series-record-${best.second}").assertExists()
        tag("series-record-${previous.second}").assertDoesNotExist()
        tag("series-record-${partial.second}").assertDoesNotExist()
        tag("series-record-${far.second}").performScrollTo().assertExists()
        captureRoundScreen("personal-records.png")
        click("series-record-${best.second}");waitTag("journal-report")
        ui.onNodeWithText("Best record fixture").assertExists()
        click("session-trash");click("trash-confirm");waitTag("home-screen")
        click("open-profile");click("profile-records");waitTag("personal-records-screen")
        tag("series-record-${previous.second}").assertExists()
        click("page-back");click("page-back");click("nav-history");click("history-filters");click("history-deleted")
        click("restore-${best.first}");awaitFact {store.trash.first().isEmpty()}
        click("open-profile");click("profile-records");waitTag("personal-records-screen")
        tag("series-record-${best.second}").assertExists()
        click("records-volume");tag("volume-record").performScrollTo().assertTextContains("3 стрел",substring=true)
        click("records-ranks");waitTag("personal-ranks-screen")
        assertEquals(101,store.history.first().sumOf {it.total})
        Unit
    }

    @Test fun savedNativeAchievementsFollowSourceHistoryAndCanBeHiddenWithoutRemovingManualCollection()=runBlocking {
        repeat(5) { index ->
            store.startPlan("Achievement fixture $index",BlockPlan(null,null,10,"count_only"))
            var active=store.journal.active.first()!!
            store.count(active.currentEnd!!.end.id,10)
            store.next(active.currentEnd!!.end.id)
            active=store.journal.active.first()!!
            store.count(active.currentEnd!!.end.id,10)
            store.complete(active.session.id)
        }
        prefs.animations(false)
        val board=store.journal.achievements.board.first()
        val sourceId=board.awards.single {it.ruleId=="START06"}.sessionId!!
        // This scenario opens the saved collection; fresh delivery has its own isolated banner tests.
        store.journal.achievements.claimNotifications(board.awards.map {it.key})
        mount();waitTag("home-screen");click("open-profile")
        tag("profile-achievements").performScrollTo().assertExists()
        click("profile-achievements-open");waitTag("achievements-screen")
        click("achievements-earned")
        ui.onNodeWithTag("achievement-earned-START06",useUnmergedTree=true).performScrollTo().assertExists()
        ui.onNodeWithTag("achievement-earned-START05",useUnmergedTree=true).performScrollTo().assertExists()
        captureRoundScreen("achievements-gallery.png")
        click("achievement-START06")
        click("achievement-source-START06");waitTag("journal-report")
        assertTrue(store.journal.details(sourceId)!=null)
        click("session-trash");click("trash-confirm");waitTag("home-screen")
        click("open-profile");click("profile-achievements-open");waitTag("achievements-screen")
        click("achievements-earned")
        ui.onNodeWithTag("achievement-earned-START01",useUnmergedTree=true).assertExists()
        tag("achievement-START06").assertDoesNotExist()
        tag("achievement-START05").assertDoesNotExist()
        click("page-back");click("page-back");click("open-settings")
        ui.onNodeWithText("Движение и отклик").performClick();click("setting-achievements")
        awaitFact {!(prefs.state.first() as SettingsRead.Ready).value.showAchievements}
        click("page-back");click("page-back");click("open-profile")
        tag("profile-achievements-list").assertDoesNotExist()
        ui.onAllNodesWithTag("profile-achievements-open").assertCountEquals(1)
        click("profile-achievements-open");waitTag("achievements-screen");click("achievements-all")
        tag("achievement-START01").assertExists()
        ui.onNodeWithTag("achievement-earned-START01",useUnmergedTree=true).assertExists()
        assertEquals(80,store.history.first().sumOf {it.shotCount})
        Unit
    }

    @Test fun nativeSavedEndDeliversBannerAndKeepsAwardsInAutomaticReportWithoutReplay()=runBlocking {
        fun captureDisplay(name:String) {
            ui.waitForIdle()
            val instrumentation=InstrumentationRegistry.getInstrumentation()
            val folder=File(instrumentation.targetContext.getExternalFilesDir("verification"),"achievements-v2").apply {mkdirs()}
            val bitmap=requireNotNull(instrumentation.uiAutomation.takeScreenshot())
            try {
                File(folder,name).outputStream().use {output->
                    assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output))
                }
            } finally {bitmap.recycle()}
        }
        fun waitNoBanner() {
            ui.waitUntil(10_000) {ui.onAllNodesWithTag("achievement-banner").fetchSemanticsNodes().isEmpty()}
        }
        prefs.animations(false)
        val bow=EquipmentItem(kind="bow",name="Achievement barebow fixture",category="barebow")
        val kit=EquipmentItem(kind="setup",name="Achievement setup fixture",bowId=bow.id)
        store.startPlan("Native achievement fixture",BlockPlan(18.0,400,3,
            equipmentSnapshotJson=equipmentSnapshot(kit,listOf(bow,kit)),targetProfileId="wa-indoor-outer-v1"))
        val active=store.journal.active.first()!!
        val sessionId=active.session.id
        val endId=active.currentEnd!!.end.id
        mount();waitTag("target-input")
        repeat(3) {store.add(endId,null,10)}
        waitTag("achievement-banner")
        captureDisplay("arrow-slots.png")
        click("next-end")
        waitTag("achievement-banner")
        tag("achievement-banner-additional").assertTextContains("+1",substring=true)
        val endAwards=store.journal.achievements.board.first().awards.filter {it.sessionId==sessionId&&it.valid}
        assertTrue(endAwards.any {it.ruleId=="HIT01"&&it.scope=="barebow"&&it.endId==endId})
        assertTrue(endAwards.any {it.ruleId=="START02"&&it.scope=="barebow"})
        assertTrue(endAwards.any {it.ruleId=="START03"&&it.scope=="barebow"})
        captureDisplay("native-banner.png")
        click("achievement-banner-additional");waitTag("achievement-details")
        tag("achievement-detail-group-hits.ten:barebow").assertExists()
        tag("achievement-detail-group-hits.no-miss:barebow").assertDoesNotExist()
        captureDisplay("native-details.png")
        tag("achievement-details").performScrollToNode(hasText("Десятка, мы знакомы?"))
        ui.onNodeWithText("Десятка, мы знакомы?").assertIsDisplayed()
        tag("achievement-details").performScrollToIndex(0)
        click("achievement-details-close");waitNoBanner()
        click("finish-training");click("finish-confirm");waitTag("journal-report")
        waitTag("achievement-banner")
        tag("achievement-banner").performTouchInput {swipeLeft()}
        waitNoBanner()
        awaitFact {store.journal.achievements.board.first().awards.filter {it.sessionId==sessionId&&it.valid}.all {it.notifiedAtMs!=null}}
        tag("report-screen").performScrollToNode(hasTestTag("training-achievements"))
        tag("training-achievements").assertIsDisplayed()
        assertEquals("completed",store.journal.details(sessionId)!!.session.state)
        assertEquals(3,store.journal.details(sessionId)!!.allShots.size)
        click("page-back");waitTag("home-screen");click("nav-history");click("session-$sessionId");waitTag("journal-report")
        tag("report-screen").performScrollToNode(hasTestTag("training-achievements"))
        tag("training-achievements").assertIsDisplayed()
        ui.mainClock.advanceTimeBy(600)
        tag("achievement-banner").assertDoesNotExist()
        Unit
    }

    @Test fun hiddenScoresKeepRealShotsAndLayoutWhileExplicitReportsStillShowResults()=runBlocking {
        store.start("Concentration fixture",18.0,400,3)
        prefs.animations(false)
        mount();waitTag("target-input")
        val originalBounds=tag("target-board").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithContentDescription("Условия тренировки").performClick()
        click("setting-hide-scores");click("page-back");waitTag("target-input")
        assertTrue(tag("target-board").fetchSemanticsNode().boundsInRoot.height>originalBounds.height)
        repeat(3) {aim(9)}
        awaitFact {store.journal.active.first()!!.allShots.size==3}
        tag("shot-0").assertTextEquals("1 · ✓")
        tag("end-score").assertDoesNotExist()
        tag("end-average").assertDoesNotExist()
        tag("round-score").assertDoesNotExist()
        tag("round-average").assertDoesNotExist()
        tag("training-round-rank").assertDoesNotExist()
        assertEquals(27,store.journal.active.first()!!.allShots.sumOf {it.points})
        captureRoundScreen("hidden-scores.png")
        click("statistics");waitTag("journal-report")
        val source=store.journal.active.first()!!
        tag("report-end-${source.currentEnd!!.end.id}").performScrollTo().assertTextContains("27",substring=true)
        click("session-pause");waitTag("home-screen");click("open-settings")
        ui.onNodeWithText("Тренировка").performClick()
        tag("setting-hide-scores").assertIsOn().performClick()
        awaitFact {!(prefs.state.first() as SettingsRead.Ready).value.hideCurrentScores}
        assertEquals(27,store.journal.details(source.session.id)!!.allShots.sumOf {it.points})
        Unit
    }

    @Test fun timerUsesSavedDurationsContinuesInBackgroundAndKeepsTargetUsable()=runBlocking {
        store.start("Timer fixture",18.0,400,3)
        prefs.timerDurations(120, 60)
        mount();waitTag("target-input");click("practice-timer-open");waitTag("practice-timer-window")
        tag("timer-series-seconds").performScrollTo().performTextReplacement("90")
        tag("timer-rest-seconds").performTextReplacement("45")
        click("timer-save-durations")
        awaitFact {(prefs.state.first() as SettingsRead.Ready).value.seriesTimerSeconds==90}
        click("timer-toggle");tag("timer-status").assertTextEquals("Идёт отсчёт · серия")
        ui.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        ui.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        waitTag("timer-status");tag("timer-status").assertTextEquals("Идёт отсчёт · серия")
        click("timer-phase-Rest");click("timer-confirm-phase")
        tag("timer-status").assertTextEquals("Готов к запуску")
        tag("timer-remaining").assertTextContains("00:45")
        click("practice-timer-close");aim(9)
        awaitFact {store.journal.active.first()!!.allShots.size==1}
        ui.onNodeWithContentDescription("Условия тренировки").performClick()
        click("conditions-timer");waitTag("practice-timer-window")
        tag("timer-rest-seconds").assertTextContains("45")
        captureRoundScreen("timer-default.png","practice-timer-window")
        Unit
    }

    @Test fun reportAndConditionsCreateNotesBoundToActualSeriesOrConditionGroup()=runBlocking {
        store.start("Linked note fixture",18.0,400,3)
        val source=store.journal.active.first()!!
        store.add(source.currentEnd!!.end.id,null,9)
        mount();waitTag("target-input")
        ui.onNodeWithContentDescription("Условия тренировки").performClick();waitTag("journal-setup")
        click("conditions-notes");waitTag("notes-window");click("note-add")
        tag("note-body").performTextInput("Наблюдение об условиях");click("note-save")
        awaitFact {store.notes.notes.first().size==1}
        assertEquals(source.currentBlock!!.block.id,store.notes.notes.first().single().blockId)
        ui.onNodeWithContentDescription("Закрыть заметки").performClick();click("page-back");waitTag("target-input")
        click("statistics");waitTag("journal-report")
        click("report-end-${source.currentEnd!!.end.id}");waitTag("history-shot-editor");click("end-notes");waitTag("notes-window");click("note-add")
        tag("note-body").performTextInput("Наблюдение о серии");click("note-save")
        awaitFact {store.notes.notes.first().size==2}
        val series=store.notes.notes.first().single {it.endId!=null}
        assertEquals(source.session.id,series.sessionId);assertEquals(source.currentEnd!!.end.id,series.endId)
        ui.onNodeWithContentDescription("Закрыть заметки").performClick()
        ui.runOnIdle { ui.activity.onBackPressedDispatcher.onBackPressed() };waitTag("journal-report")
        click("session-notes");waitTag("notes-window")
        tag("note-${series.id}").assertExists()
        assertEquals(1,store.journal.active.first()!!.allShots.size)
        captureRoundScreen("notes-linked-series.png","notes-window")
        Unit
    }

    @Test fun techniqueCanBeCreatedUsedAndKeepsPublishedVersion() {
        assertTrue(runBlocking(Dispatchers.IO){store.techniques.library.first().isEmpty()})
        mount()
        waitTag("onboarding-screen")
        click("onboard-skip")
        waitTag("home-screen")
        click("open-profile");waitTag("profile-screen");click("profile-technique")
        waitTag("technique-library")
        click("technique-create");waitTag("technique-editor");tag("technique-title").performTextReplacement("Памятка UI")
        click("technique-add-step-0");tag("technique-step-short").performTextInput("Мой фокус")
        click("technique-step-done")
        click("technique-publish");waitTag("technique-library")
        val document=runBlocking(Dispatchers.IO){store.techniques.library.first().single()};val version=document.latest!!
        click("technique-read-${document.document.id}");waitTag("technique-reader");ui.onNodeWithText("Мой фокус").assertExists()
        ui.onNodeWithText("Закрыть",useUnmergedTree=false).performClick();waitTag("profile-screen");click("page-back");waitTag("home-screen");click("home-primary");waitTag("journal-setup");click("setup-technique");waitTag("technique-library");click("technique-read-${document.document.id}");waitTag("technique-reader")
        tag("technique-focus-1").performScrollTo().performTextInput("Мой фокус");click("technique-apply");waitTag("journal-setup");click("distance-18");click("diameter-60");click("start-training");waitTag("target-input")
        val active=runBlocking(Dispatchers.IO){store.journal.active.first()!!};assertEquals(version.id,runBlocking(Dispatchers.IO){store.techniques.uses(active.session.id).first().single().versionId})
        ui.onNodeWithContentDescription("Алгоритмы и фокус").performClick();waitTag("technique-library");click("technique-read-${document.document.id}");waitTag("technique-reader");ui.onNodeWithText("Закрыть").performClick();waitTag("target-input");assertTrue(runBlocking(Dispatchers.IO){store.journal.active.first()!!.allShots.isEmpty()})
        Unit
    }

    @Test fun readFailureOffersRetryWithoutPretendingDiaryIsEmpty() {
        var broken=true
        val failing=object:PracticeStore by store { override val active=flow { if(broken)throw IOException("injected read failure");emitAll(store.active) } }
        mount(failing)
        ui.waitUntil(10_000){ui.onAllNodesWithText("Дневник не удалось открыть").fetchSemanticsNodes().isNotEmpty()}
        tag("onboarding-screen").assertDoesNotExist()
        broken=false;ui.onNodeWithText("Повторить").performClick();waitTag("onboarding-screen")
        assertTrue(runBlocking{store.history.first().isEmpty()})
    }

    @Test fun catalogCardCanBeCreatedSelectedAndLaterEditedWithoutRewritingSession()=runBlocking {
        prefs.rankCategory("male")
        val bow=equipment.save(EquipmentItem(kind="bow",name="Fixture bow",category="barebow"))
        val arrows=equipment.save(EquipmentItem(kind="arrows",name="Fixture arrows"))
        val kit=equipment.save(EquipmentItem(kind="setup",name="Fixture kit",bowId=bow.id,arrowsId=arrows.id))
        mount();waitTag("onboarding-screen");click("onboard-skip");waitTag("home-screen")
        click("nav-equipment");waitTag("equipment-screen")
        click("equipment-edit-${bow.id}");waitTag("equipment-editor")
        ui.onNodeWithContentDescription("Как это работает?").assertDoesNotExist()
        ui.onNodeWithText("Отмена").performScrollTo().performClick();waitTag("equipment-screen")
        click("equipment-tab-arrows");tag("equipment-edit-${arrows.id}").assertExists()
        click("equipment-tab-setup");tag("equipment-edit-${kit.id}").assertExists()
        click("nav-home");waitTag("home-screen");click("home-primary");waitTag("journal-setup")
        tag("equipment-select-${bow.id}").assertDoesNotExist();tag("equipment-select-${arrows.id}").assertDoesNotExist()
        tag("equipment-edit-choice-${kit.id}").assertDoesNotExist()
        click("equipment-select-${kit.id}")
        click("equipment-edit-choice-${kit.id}");waitTag("equipment-editor")
        click("equipment-edit-choice-${bow.id}");tag("equipment-name").assertTextContains("Fixture bow")
        click("bow-category-recurve");click("equipment-save")
        awaitFact { equipment.items.first().single { it.id==bow.id }.category=="recurve" }
        tag("equipment-name").assertTextContains("Fixture kit")
        click("equipment-edit-choice-${arrows.id}");tag("equipment-name").performTextReplacement("Edited arrows");click("equipment-save")
        awaitFact { equipment.items.first().single { it.id==arrows.id }.name=="Edited arrows" }
        click("equipment-save");waitTag("journal-setup")
        tag("equipment-select-${kit.id}").assertIsSelected()
        click("target-profile-choice");click("target-profile-wa-indoor-outer-v1");click("distance-18");click("start-training");waitTag("target-input")
        val active=store.journal.active.first()!!
        val snapshot=active.currentBlock!!.block.equipmentSnapshotJson!!
        val json=org.json.JSONObject(snapshot)
        assertEquals("setup",json.getJSONObject("selection").getString("kind"))
        assertEquals(bow.id,json.getJSONObject("bow").getString("id"))
        assertEquals("recurve",json.getJSONObject("bow").getString("category"))
        aim(9);awaitFact { store.journal.active.first()!!.allShots.size==1 }
        assertEquals("КМС",store.journal.active.first()!!.rankAssessment("male").evaluation!!.pace!!.label)
        val currentBow=equipment.items.first().single { it.id==bow.id }
        equipment.save(currentBow.copy(category="compound"))
        assertEquals(snapshot,store.journal.active.first()!!.currentBlock!!.block.equipmentSnapshotJson)
        assertEquals("КМС",store.journal.active.first()!!.rankAssessment("male").evaluation!!.pace!!.label)
        Unit
    }

    @Test fun legacyIndividualEquipmentRequiresExplicitKitChoiceForRepeat()=runBlocking {
        val bow=EquipmentItem(kind="bow",name="Legacy bow",category="barebow")
        store.startPlan("Legacy",BlockPlan(18.0,400,3,equipmentSnapshotJson=equipmentSnapshot(bow,listOf(bow))))
        val original=store.journal.active.first()!!
        store.add(original.currentEnd!!.end.id,null,9)
        store.complete(original.session.id)
        mount();waitTag("home-screen");click("nav-history");click("session-${original.session.id}");waitTag("journal-report")
        click("session-repeat");waitTag("journal-setup")
        tag("equipment-select-@snapshot").assertDoesNotExist()
        tag("start-training").assertIsNotEnabled()
        ui.onNodeWithText("Не выбрано",substring=false).performScrollTo().performClick()
        tag("start-training").assertIsEnabled()
        assertEquals(original.currentBlock!!.block.equipmentSnapshotJson,store.journal.details(original.session.id)!!.currentBlock!!.block.equipmentSnapshotJson)
        Unit
    }

    @Test fun importOpensOverSettingsAndReturnsWithoutNavigation()=runBlocking {
        store.start("Settings fixture",18.0,600,3)
        store.complete(store.journal.active.first()!!.session.id)
        mount();waitTag("home-screen");click("open-settings")
        ui.onNodeWithText("Данные и перенос").performClick()
        ui.onNodeWithText("Все настройки").assertDoesNotExist()
        ui.onNodeWithText("Корзина").assertDoesNotExist()
        click("open-import");waitTag("import-sheet")
        ui.onNodeWithContentDescription("Закрыть импорт").performClick()
        waitTag("settings-screen");tag("open-import").assertExists()
        click("page-back")
        ui.onNodeWithText("Движение и отклик").assertExists()
        Unit
    }

    @Test fun completedShotCanBeEditedRemovedAndSessionRestoredFromTrash()=runBlocking {
        store.start("History fixture",18.0,600,6)
        val initial=store.journal.active.first()!!;val end=initial.currentEnd!!.end.id
        for(score in listOf(10,9,8))store.add(end,null,score)
        val before=store.journal.active.first()!!;store.complete(before.session.id)
        val middle=before.allShots[1]
        mount();waitTag("home-screen");click("nav-history");waitTag("history-screen");click("session-${before.session.id}");waitTag("journal-report")
        tag("report-screen").performScrollToNode(hasTestTag("report-end-$end"))
        click("report-end-$end");waitTag("history-shot-editor")
        val first = before.allShots.first()
        before.allShots.forEach { tag("report-edit-${it.id}").assertIsNotSelected() }
        click("report-edit-${middle.id}");tag("report-edit-${middle.id}").assertIsSelected()
        aim(7)
        tag("history-edit-result").assertTextContains("7",substring=true)
        click("report-edit-${first.id}")
        try {awaitFact{store.journal.details(before.session.id)!!.allShots[1].points==7}}
        catch(error:Throwable) {
            captureRoundScreen("completed-editor-auto-save-diagnostic.png")
            throw AssertionError("Stored shots after autosave: ${store.journal.details(before.session.id)!!.allShots}\n"+
                ui.onRoot().printToString(),error)
        }
        tag("report-edit-${first.id}").assertIsSelected()
        assertEquals(7,store.journal.details(before.session.id)!!.allShots[1].points)
        click("report-edit-${middle.id}")
        aim(6);aim(7);click("history-save-shot")
        awaitFact{store.journal.details(before.session.id)!!.allShots[1].points==7}
        assertEquals(middle.id,store.journal.details(before.session.id)!!.allShots[1].id)
        waitTag("history-shot-editor")
        ui.waitUntil(10_000) {
            ui.onAllNodes(hasTestTag("report-edit-${middle.id}") and hasText("2 · 7")).fetchSemanticsNodes().isNotEmpty()
        }
        click("history-remove-shot");click("history-remove-confirm")
        awaitFact{store.journal.details(before.session.id)!!.allShots.size==2}
        val after=store.journal.details(before.session.id)!!
        assertEquals(listOf(10,8),after.allShots.map{it.points});assertEquals(listOf(0,1),after.allShots.map{it.inputIndex})
        waitTag("history-shot-editor")
        ui.waitUntil(10_000) { ui.onAllNodesWithTag("report-edit-${middle.id}").fetchSemanticsNodes().isEmpty() }
        tag("report-edit-${first.id}").assertIsNotSelected()
        ui.runOnIdle { ui.activity.onBackPressedDispatcher.onBackPressed() }
        waitTag("journal-report");click("session-rename");tag("rename-title").performTextReplacement("Renamed fixture");click("rename-confirm")
        awaitFact{store.journal.details(before.session.id)!!.session.title=="Renamed fixture"}
        click("session-trash");click("trash-confirm");awaitFact{store.history.first().isEmpty()}
        waitTag("home-screen");click("nav-history");waitTag("history-screen");click("history-filters");click("history-deleted")
        click("restore-${before.session.id}");awaitFact{store.trash.first().isEmpty()&&store.history.first().size==1}
        assertEquals(listOf(10,8),store.journal.details(before.session.id)!!.allShots.map{it.points})
        Unit
    }

    @Test fun homePracticeShowsFiveLatestFinishedSessionsWithActualAverages()=runBlocking {
        prefs.finishOnboarding("skipped")
        val recapIds = mutableListOf<String>()
        repeat(6) { index ->
            store.start("Recap fixture $index",18.0,600,3)
            val active=store.journal.active.first()!!
            recapIds += active.session.id
            store.add(active.currentEnd!!.end.id,null,8)
            store.complete(active.session.id)
            delay(3)
        }
        mount();waitTag("home-screen")
        tag("home-screen").performScrollToNode(hasTestTag("home-practice-horizontal"))
        assertEquals(5,ui.onAllNodesWithTag("home-practice-session").fetchSemanticsNodes().size)
        tag("home-practice-${recapIds.first()}").assertDoesNotExist()
        recapIds.drop(1).forEach { tag("home-practice-$it").assertExists() }
        ui.onNodeWithText("Recap fixture 0").assertDoesNotExist()
        ui.onAllNodesWithTag("home-practice-right-arrow").assertCountEquals(1)
        val latestCard = hasAnyAncestor(hasTestTag("home-practice-${recapIds.last()}"))
        ui.onNode(latestCard and hasText("8/10"), useUnmergedTree = true).assertExists()
        ui.onNode(latestCard and hasText("8,0"), useUnmergedTree = true).assertExists()
        Unit
    }

    @Test fun pauseResumeAndRepeatRetainConditionsAndConfirmedShots()=runBlocking {
        store.start("Pause fixture",30.0,800,6)
        var session=store.journal.active.first()!!;store.add(session.currentEnd!!.end.id,null,9)
        val before=store.journal.active.first()!!
        mount();waitTag("target-input");click("statistics");waitTag("journal-report");click("session-pause")
        awaitFact{store.journal.active.first()==null}
        waitTag("home-screen");click("nav-history");waitTag("history-screen");click("session-${before.session.id}");waitTag("journal-report");click("session-resume")
        awaitFact{store.journal.active.first()?.session?.id==before.session.id};waitTag("target-input")
        assertEquals(before.allShots,store.journal.active.first()!!.allShots)
        click("finish-training");click("finish-confirm");awaitFact{store.journal.active.first()==null}
        waitTag("home-screen");click("nav-history");waitTag("history-screen");click("session-${before.session.id}");waitTag("journal-report");click("session-repeat");waitTag("journal-setup")
        tag("distance-field").assertTextContains("30")
        tag("plan-arrows").assertDoesNotExist()
        assertNull(store.journal.active.first())
        Unit
    }
    @Test fun manualRoundUsesItsOwnRankAndScreenStaysAwakeAcrossTrainingTools()=runBlocking {
        prefs.rankCategory("male")
        val bow=EquipmentItem(kind="bow",name="Manual round bow",category="barebow")
        store.startPlan("Early round",BlockPlan(18.0,400,3,
            equipmentSnapshotJson=equipmentSnapshot(bow,listOf(bow)),flexibleSeries=true,seriesPerRound=10,targetProfileId="wa-indoor-outer-v1"))
        val id=store.journal.active.first()!!.session.id
        var end=store.journal.active.first()!!.currentEnd!!.end.id
        repeat(3){store.add(end,null,10)}
        val awards=store.journal.achievements.board.first().awards
        store.journal.achievements.claimNotifications(awards.map {it.key})
        mount();waitTag("target-input")
        fun awake(view:android.view.View):Boolean = view.keepScreenOn ||
            (view is android.view.ViewGroup && (0 until view.childCount).any { awake(view.getChildAt(it)) })
        ui.runOnIdle {assertTrue(awake(ui.activity.window.decorView))}
        click("training-rounds-open");waitTag("training-rounds-sheet")
        click("start-new-round");click("confirm-new-round")
        awaitFact {store.journal.active.first()!!.roundProgress().number==2}
        tag("round-number").assertTextEquals("2")
        assertEquals(3,store.journal.details(id)!!.allShots.size)
        end=store.journal.active.first()!!.currentEnd!!.end.id
        store.add(end,null,8)
        awaitFact {store.journal.active.first()!!.allShots.size==4}
        click("training-round-rank");waitTag("rank-sheet")
        ui.onNodeWithText("Средний: 8,00").assertExists()
        dismissTestSheet(ui)
        ui.onNodeWithContentDescription("Алгоритмы и фокус").performClick()
        ui.runOnIdle {assertTrue(awake(ui.activity.window.decorView))}
        ui.onNodeWithText("Закрыть",substring=false).performClick()
        prefs.keepAwake(false)
        ui.waitUntil(5_000) {!awake(ui.activity.window.decorView)}
        Unit
    }

}

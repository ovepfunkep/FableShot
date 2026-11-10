package app.fableshot.android

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.unit.dp
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.importing.*
import app.fableshot.android.ui.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.util.UUID

class MyTargetsImportUiTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private lateinit var db:JournalDatabase
    private lateinit var store:JournalPracticeStore
    private lateinit var importer:MyTargetsImporter
    private lateinit var files:File
    private lateinit var staging:File
    private lateinit var source:File
    private lateinit var restoration:StateRestorationTester
    private val instance=mutableIntStateOf(0)
    private val history=mutableStateOf(false)
    @Before fun prepare() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build();store=JournalPracticeStore(db)
        files=File(context.cacheDir,"verification-import-ui-files-${UUID.randomUUID()}").apply{mkdirs()}
        staging=File(context.cacheDir,"verification-import-ui-stage-${UUID.randomUUID()}").apply{mkdirs()}
        source=File(staging,"fixture.csv")
        InstrumentationRegistry.getInstrumentation().context.assets.open("mytargets-sample.csv").use{input->source.outputStream().use{input.copyTo(it)}}
        importer=MyTargetsImporter(db,files,staging){1234567890L}
    }
    @After fun cleanup(){db.close();val cache=InstrumentationRegistry.getInstrumentation().targetContext.cacheDir.canonicalFile;for(folder in listOf(files,staging)){check(folder.canonicalFile.parentFile==cache&&folder.name.startsWith("verification-import-ui-"));folder.deleteRecursively()}}
    private fun mount() {
        restoration=StateRestorationTester(ui)
        restoration.setContent {
            FableTheme(UserSettings(appearance=Appearance.Dark,animations=false)) {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                        Text("ДИЗАЙН · ПРИМЕР ДАННЫХ",Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp),style=MaterialTheme.typography.labelSmall)
                        if(history.value){val rows by store.history.collectAsState(initial=emptyList());HistoryScreen(rows,{},{})}
                        else key(instance.intValue){MyTargetsImportScreen(importer,emptyList(),{history.value=true},source)}
                    }
                }
            }
        }
    }
    private fun waitTag(tag:String){ui.waitUntil(10_000){ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()}}
    private fun awaitFact(check:suspend()->Boolean){ui.waitUntil(10_000){runBlocking{check()}}}
    private fun capture(name:String) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(context.getExternalFilesDir("verification"),"f04").apply{mkdirs()}
        File(directory,name).outputStream().use{ui.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG,100,it)}
    }
    @Test fun previewConfirmsFixtureAndShowsItsSourceDateInHistory()=runBlocking {
        store.start("Native isolated fixture",18.0,600,3);store.add(store.journal.active.first()!!.currentEnd!!.end.id,null,10)
        val before=store.journal.active.first()!!
        mount();waitTag("import-confirm");ui.onNodeWithTag("import-confirm").assertIsEnabled().assertTextContains("18",substring=true)
        capture("preview-sport-dark.png")
        ui.onNodeWithTag("import-confirm").performClick();waitTag("import-result")
        ui.onNodeWithText("Тренировок: 1 · стрел: 18").assertExists();capture("result-sport-dark.png")
        assertEquals(before,store.journal.active.first())
        val imported=store.history.first().single{it.id!=before.session.id}
        assertEquals("2020-01-02",imported.journalMeta!!.localDate)
        ui.onNodeWithTag("import-go-history").performClick();waitTag("history-screen")
        ui.onNodeWithTag("history-screen").performScrollToNode(hasTestTag("session-${imported.id}"))
        ui.onNodeWithTag("history-day-${imported.id}",useUnmergedTree=true).assertTextEquals("2")
        Unit
    }
    @Test fun selectionSurvivesRecreationAndRemainingSourceRowsImportOnlyOnce() {
        mount();waitTag("import-confirm")
        ui.onNodeWithTag("import-preview-list").performScrollToNode(hasText("Серии и условия"))
        ui.onNodeWithText("Серии и условия").performClick()
        val end="import-end-g0:b0:e5"
        ui.onNodeWithTag("import-preview-list").performScrollToNode(hasTestTag(end));ui.onNodeWithTag(end).performClick()
        ui.onNodeWithTag("import-confirm").assertTextContains("15",substring=true)
        restoration.emulateSavedInstanceStateRestore();waitTag("import-confirm")
        ui.onNodeWithTag("import-confirm").assertTextContains("15",substring=true).performClick();waitTag("import-result")
        ui.onNodeWithText("Тренировок: 1 · стрел: 15").assertExists()
        ui.runOnIdle{instance.intValue++};waitTag("import-confirm")
        ui.onNodeWithTag("import-confirm").assertTextContains("3",substring=true).assertIsEnabled().performClick();waitTag("import-result")
        awaitFact{store.journal.history.first().sumOf{it.allShots.size}==18}
        ui.runOnIdle{instance.intValue++};waitTag("import-confirm")
        ui.onNodeWithTag("import-confirm").assertIsNotEnabled().assertTextContains("0",substring=true)
        assertEquals(18,runBlocking{store.journal.history.first().sumOf{it.allShots.size}})
    }
    @Test fun unknownTargetExplainsDisabledImportAndAllowsExplicitBulkConfirmation() {
        source.writeText(source.readText().replace("WA Full", "WA 5 колец"))
        mount();waitTag("import-confirm")
        ui.onNodeWithTag("import-confirm").assertIsNotEnabled()
        ui.onNodeWithTag("import-end-g0:b0:e0").assertDoesNotExist()
        ui.onNodeWithText("Подтвердить исходные условия выбранных").performScrollTo().performClick()
        ui.onNodeWithTag("import-confirm").assertIsEnabled().performClick()
        waitTag("import-result")
        ui.onNodeWithText("Тренировок: 1 · стрел: 18").assertExists()
    }

    @Test fun zipUsesSourceTrainingBoundariesAndImportsOnlySavedShots() {
        source = runBlocking { importer.stage(myTargetsZipFixture(staging).inputStream()) }
        mount(); waitTag("import-confirm")
        ui.onNodeWithTag("import-confirm").assertIsEnabled().assertTextContains("6",substring=true)
        ui.onNodeWithText("ZIP MyTargets · границы тренировок взяты из архива").assertExists()
        ui.onNodeWithText("Незаполненных мест для стрел: 3. Они не считаются промахами и не переносятся.").assertExists()
        ui.onNodeWithTag("import-review-boundaries").assertDoesNotExist()
        ui.onNodeWithTag("import-confirm").performClick(); waitTag("import-result")
        ui.onNodeWithText("Тренировок: 2 · стрел: 6").assertExists()
        assertEquals(43,runBlocking { store.journal.history.first().sumOf { it.allShots.sumOf { shot -> shot.points } } })
    }

    @Test fun ambiguousCsvBoundariesHaveAnExplicitBatchDecisionThatSurvivesRecreation() {
        fun quote(values:List<String>)=values.joinToString(";") { "\"$it\"" }
        val records=listOf(1,2,1,2,1,2,1).mapIndexed { index,end -> quote(listOf("Boundary fixture","2026-11-03","Practice","Outdoor","","","1","18m","WA Full (40cm)",end.toString(),"10:00:0$end",if(index==6)"?"else"9","",".1",".1")) }
        source.writeText(quote(MyTargetsReader.HEADERS)+"\n"+records.joinToString("\n",postfix="\n"))
        mount(); waitTag("import-confirm")
        ui.onNodeWithTag("import-confirm").assertIsNotEnabled()
        ui.onNodeWithTag("import-preview-list").performScrollToNode(hasTestTag("import-review-boundaries"))
        ui.onNodeWithTag("import-review-boundaries").performClick()
        ui.onNodeWithTag("import-accept-boundaries").assertExists().performClick()
        ui.onNodeWithTag("import-confirm").assertIsEnabled()
        restoration.emulateSavedInstanceStateRestore(); waitTag("import-confirm")
        ui.onNodeWithTag("import-confirm").assertIsEnabled().performClick(); waitTag("import-result")
        ui.onNodeWithText("Тренировок: 3 · стрел: 6").assertExists()
        assertEquals(6,runBlocking { store.journal.history.first().sumOf { it.allShots.size } })
    }

    @Test fun brokenSourceShowsAnErrorWithoutCreatingHistory() {
        source.writeText("Title;Date\nnot a supported export")
        mount()
        ui.waitUntil(10_000){ui.onAllNodesWithText("Не удалось обработать CSV").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithTag("import-result").assertDoesNotExist();ui.onNodeWithTag("import-confirm").assertDoesNotExist()
        assertTrue(runBlocking{store.history.first().isEmpty()})
    }
    @Test fun completedPortionCanBeCancelledIntoTrashWithoutLosingItsArrows() {
        mount();waitTag("import-confirm");ui.onNodeWithTag("import-confirm").performClick();waitTag("import-result")
        ui.onNodeWithTag("import-undo").performClick();waitTag("import-undo-confirm");ui.onNodeWithTag("import-undo-confirm").performClick()
        ui.waitUntil(10_000){ui.onAllNodesWithText("Перенос отменён").fetchSemanticsNodes().isNotEmpty()}
        awaitFact{store.history.first().isEmpty()&&store.trash.first().size==1}
        assertEquals(18,runBlocking{store.journal.trashHistory.first().single().allShots.size})
        ui.runOnIdle{instance.intValue++};waitTag("import-confirm")
        ui.onNodeWithTag("import-confirm").assertIsNotEnabled()
        val trashNotice="Ранее перенесённые тренировки находятся в корзине. Верни их оттуда, чтобы не создавать копии."
        ui.onNodeWithTag("import-preview-list").performScrollToNode(hasText(trashNotice))
        ui.onNodeWithText(trashNotice).assertExists()
    }
}


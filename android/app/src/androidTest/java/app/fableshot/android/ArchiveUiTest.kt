package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.*
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.*
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.util.UUID

class ArchiveUiTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var folder:File
    private lateinit var journal:JournalDatabase
    private lateinit var equipment:EquipmentDatabase
    private lateinit var scope:CoroutineScope
    private lateinit var archive:JournalArchive
    private lateinit var exported:ExportedArchive
    @Before fun setup()=runBlocking(Dispatchers.IO) {
        folder=File(context.cacheDir,"verification-archive-ui-${UUID.randomUUID()}").apply{mkdirs()}
        journal=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build();equipment=Room.inMemoryDatabaseBuilder(context,EquipmentDatabase::class.java).build()
        scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        val prefs=UserPreferences(PreferenceDataStoreFactory.create(scope=scope,produceFile={File(folder,"test.preferences_pb")}))
        val repo=JournalRepository(journal);repo.start("Example",BlockPlan(18.0,600));repo.numeric(repo.active.first()!!.currentEnd!!.end.id,10)
        archive=JournalArchive(context,journal,equipment,prefs,File(folder,"files"),File(folder,"staging"));exported=archive.export();Unit
    }
    @After fun cleanup()=runBlocking(Dispatchers.IO){journal.close();equipment.close();scope.coroutineContext[Job]!!.cancelAndJoin();check(folder.canonicalFile.parentFile==context.cacheDir.canonicalFile&&folder.name.startsWith("verification-archive-ui-"));folder.deleteRecursively();Unit}
    private fun mount(restoration:StateRestorationTester,file:File) {restoration.setContent{FableTheme(UserSettings(appearance=Appearance.Dark,animations=false)){Surface{Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){Text("ДИЗАЙН · ПРИМЕР ДАННЫХ",Modifier.padding(12.dp));Box(Modifier.weight(1f)){ArchiveScreen(archive,file)}}}}}}
    private fun waitTag(tag:String){ui.waitUntil(10_000){ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()}}
    @Test fun verifiedPreviewSurvivesRecreationWithoutChangingDiary() {
        val restoration=StateRestorationTester(ui);mount(restoration,exported.file);waitTag("archive-preview")
        ui.onNodeWithTag("archive-screen").performScrollToNode(hasTestTag("archive-preview"))
        ui.onNodeWithText("Тренировок, включая корзину: 1").assertExists();ui.onNodeWithText("Отмеченных стрел: 1").assertExists()
        val directory=File(context.getExternalFilesDir("verification"),"archive").apply{mkdirs()}
        File(directory,"preview-sport-dark.png").outputStream().use{ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        restoration.emulateSavedInstanceStateRestore();waitTag("archive-preview")
        assertEquals(1,runBlocking{journal.journalDao().active().first()!!.allShots.size})
    }
    @Test fun brokenArchiveShowsErrorAndLeavesActionsAvailable() {
        exported.file.writeText("broken fixture")
        mount(StateRestorationTester(ui),exported.file);waitTag("archive-message")
        ui.onNodeWithTag("archive-export").assertIsEnabled();ui.onNodeWithTag("archive-check").assertIsEnabled()
        assertEquals(10,runBlocking{journal.journalDao().active().first()!!.allShots.single().points})
    }
    @Test fun replacementRequiresAcknowledgementAndCanReturnToPreviousDiary()=runBlocking(Dispatchers.IO) {
        val generations=DiaryGenerations(File(folder,"generations"));val directory=generations.newFolder()
        val prepared=archive.prepare(exported.file)
        for(name in listOf("journal.db","equipment.db"))File(prepared.directory,name).copyTo(File(directory,name))
        DiaryRuntime.writePreferences(context,File(directory,"preferences.preferences_pb"),prepared.preferences)
        archive.discard(prepared.directory);generations.seal(directory)
        File(directory.parentFile,"selection.json").writeText("{\"version\":1,\"current\":\"${directory.name}\",\"previous\":null}")
        val manager=DiaryManager(context,directory.parentFile!!)
        val source=manager.current.archive.stage(exported.file.inputStream())
        try {
            manager.current.preferences.displayName("Old profile")
            ui.setContent {
                val runtime by manager.runtime.collectAsState()
                key(runtime){FableTheme(UserSettings(appearance=Appearance.Dark,animations=false)){Surface{ArchiveScreen(runtime.archive,source,manager)}}}
            }
            waitTag("archive-preview")
            ui.onNodeWithTag("archive-screen").performScrollToNode(hasTestTag("archive-apply"));ui.onNodeWithTag("archive-apply").performClick()
            ui.onNodeWithTag("archive-apply-confirm").assertIsNotEnabled()
            assertEquals(directory.name,manager.current.id)
            ui.onNodeWithTag("archive-ack").performClick();ui.onNodeWithTag("archive-apply-confirm").assertIsEnabled().performClick()
            ui.waitUntil(10_000){manager.current.id!=directory.name}
            assertEquals("",(manager.current.preferences.state.first() as SettingsRead.Ready).value.displayName)
            waitTag("archive-undo")
            ui.waitUntil(10_000){ui.onAllNodes(hasTestTag("archive-undo") and isEnabled()).fetchSemanticsNodes().isNotEmpty()}
            ui.onNodeWithTag("archive-screen").performScrollToNode(hasTestTag("archive-undo"));ui.onNodeWithTag("archive-undo").performClick()
            waitTag("archive-ack")
            ui.onNodeWithTag("archive-ack").performClick();ui.onNodeWithTag("archive-apply-confirm").performClick()
            ui.waitUntil(10_000){manager.current.id==directory.name}
            assertEquals("Old profile",(manager.current.preferences.state.first() as SettingsRead.Ready).value.displayName)
        }finally{manager.current.archive.discard(source);manager.close()}
        Unit
    }
}

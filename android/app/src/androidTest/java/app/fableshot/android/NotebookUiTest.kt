package app.fableshot.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.unit.Density
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class NotebookUiTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    @Test fun unfinishedNoteSurvivesUiRestorationAndLargeTextCanSaveIt()=runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build()
        val repo=DiaryNoteRepository(db)
        val show=mutableStateOf(true)
        val scale=mutableFloatStateOf(1f)
        val restoration=StateRestorationTester(ui)
        try {
            restoration.setContent {
                val density=LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density,scale.floatValue)) {
                    FableTheme(UserSettings(animations=false)) {Surface(Modifier.fillMaxSize()) {if(show.value)NotebookScreen(repo)}}
                }
            }
            ui.onNodeWithTag("note-add").performClick()
            ui.onNodeWithTag("note-body").performTextInput("Сохраняемый черновик\nВторая строка")
            ui.onNodeWithTag("note-tags").performTextInput("клуб, техника")
            ui.onNodeWithTag("note-date").performTextReplacement("2026-11-02")
            restoration.emulateSavedInstanceStateRestore()
            ui.onNodeWithTag("note-body").assertTextContains("Сохраняемый черновик\nВторая строка")
            ui.onNodeWithTag("note-tags").assertTextContains("клуб, техника")
            ui.runOnIdle {scale.floatValue=2f}
            ui.onNodeWithTag("note-save").performScrollTo().assertIsDisplayed().assertIsEnabled()
            val directory=File(context.getExternalFilesDir("verification"),"notebook").apply {mkdirs()}
            File(directory,"note-restored-large.png").outputStream().use {ui.onNodeWithTag("note-editor").captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            ui.onNodeWithTag("note-save").performClick()
            ui.waitUntil(10_000) {runBlocking {repo.notes.first().size==1}}
            val saved=repo.notes.first().single()
            assertEquals("Сохраняемый черновик\nВторая строка",saved.body)
            assertEquals(listOf("клуб","техника"),NoteTags.decode(saved.tagsJson))
            assertNull(saved.sessionId);assertTrue(db.journalDao().history().first().isEmpty())
        } finally {ui.runOnIdle {show.value=false};ui.waitForIdle();db.close()}
    }
}

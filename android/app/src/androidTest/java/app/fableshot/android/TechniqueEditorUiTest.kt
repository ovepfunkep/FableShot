package app.fableshot.android

import androidx.compose.ui.platform.testTag

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Button
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.WriteGate
import app.fableshot.android.data.journal.JournalDatabase
import app.fableshot.android.technique.*
import app.fableshot.android.ui.FableTheme
import kotlinx.coroutines.*
import org.junit.*
import org.junit.Assert.*

/** Editor fixtures use an in-memory database; no installed diary is opened. */
class TechniqueEditorUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private lateinit var db: JournalDatabase
    private lateinit var repo: TechniqueRepository
    private lateinit var document: TechniqueDocument
    private val closed = mutableStateOf(false)

    @Before fun setup() = runBlocking(Dispatchers.IO) {
        db = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, JournalDatabase::class.java).build()
        repo = TechniqueRepository(db, WriteGate())
        val text = TechniqueText(title = "Моя техника", context = "Баребоу", phases = List(4) { phase ->
            TechniquePhase(id = "phase-$phase", title = "Фаза ${phase + 1}", steps = List(8) { index ->
                TechniqueStep(id = "step-$phase-$index", short = "Пункт ${index + 1}", detail = "Подробное объяснение",
                    children = "Первый подпункт\nВторой подпункт", question = "Вопрос тренеру")
            })
        })
        val id = repo.create(text)
        document = requireNotNull(db.techniqueDao().document(id))
        Unit
    }
    @After fun cleanup() { db.close() }
    private fun mount() {
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                TechniqueEditor(document, repo) { closed.value = true }
            }
        } }
    }

    @Test fun outlineDoesNotRenderEveryFieldAndPublicationPreservesUnopenedDetails() {
        mount()
        ui.onAllNodes(hasSetTextAction()).assertCountEquals(1)
        ui.onNodeWithTag("technique-publish").assertIsDisplayed()
        ui.onNodeWithTag("technique-step-phase-0-step-0-0").performScrollTo().performClick()
        ui.onNodeWithTag("technique-step-short").performTextReplacement("Новая подсказка")
        ui.onNodeWithTag("technique-step-detail").assertTextContains("Подробное объяснение")
        ui.onNodeWithTag("technique-step-done").performScrollTo().performClick()
        ui.onNodeWithTag("technique-publish").performClick()
        ui.waitUntil(10_000) { closed.value }
        val latest = runBlocking { requireNotNull(db.techniqueDao().latest(document.id)) }
        val saved = TechniqueText.parse(latest.payloadJson)
        assertEquals(1, latest.number)
        assertEquals("Новая подсказка", saved.phases.first().steps.first().short)
        assertEquals("Первый подпункт\nВторой подпункт", saved.phases.first().steps.first().children)
        assertEquals("Вопрос тренеру", saved.phases.first().steps.first().question)
        assertEquals(32, saved.phases.sumOf { it.steps.size })
        assertEquals("Баребоу", saved.context)
    }

    @Test fun pastedAlgorithmAppendsAndLeavingFlushesDraftWithoutPublishing() {
        mount()
        ui.onNodeWithTag("technique-paste").performClick()
        ui.onNodeWithTag("technique-paste-text").performTextReplacement("## После выстрела\n1. Выдохнуть\n2. Запомнить ощущение")
        ui.onNodeWithTag("technique-paste-apply").performClick()
        ui.onNodeWithTag("technique-editor-close").performClick()
        ui.waitUntil(10_000) { closed.value }
        val stored = runBlocking { requireNotNull(db.techniqueDao().document(document.id)) }
        val saved = TechniqueText.parse(stored.draftJson, true)
        assertEquals(5, saved.phases.size)
        assertEquals(34, saved.phases.sumOf { it.steps.size })
        assertEquals("После выстрела", saved.phases.last().title)
        assertNull(runBlocking { db.techniqueDao().latest(document.id) })
    }

    @Test fun rapidEditsExitReopenAndPublicationKeepTheLatestDraftWithoutConflict() {
        val editing = mutableStateOf(true)
        val current = mutableStateOf(document)
        var exits = 0
        ui.setContent {
            val scope = rememberCoroutineScope()
            FableTheme(UserSettings(animations = false)) {
                Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                    if (editing.value) TechniqueEditor(current.value, repo) {
                        exits++
                        editing.value = false
                    }
                    else Button(onClick = {
                        scope.launch {
                            current.value = requireNotNull(db.techniqueDao().document(document.id))
                            editing.value = true
                        }
                    }, modifier = Modifier.testTag("reopen-technique-editor")) {
                        app.fableshot.android.ui.Text("Открыть памятку")
                    }
                }
            }
        }
        ui.onNodeWithTag("technique-title").performTextReplacement("Первая правка")
        ui.mainClock.advanceTimeBy(250)
        ui.onNodeWithTag("technique-title").performTextReplacement("Вторая правка")
        ui.mainClock.advanceTimeBy(250)
        ui.onNodeWithTag("technique-title").performTextReplacement("Последняя правка")
        ui.onNodeWithTag("technique-editor-close").performClick()
        ui.waitUntil(10_000) { exits == 1 }
        val draft = runBlocking { requireNotNull(db.techniqueDao().document(document.id)) }
        assertEquals("Последняя правка", TechniqueText.parse(draft.draftJson, true).title)
        assertNull(runBlocking { db.techniqueDao().latest(document.id) })

        ui.onNodeWithTag("reopen-technique-editor").performClick()
        ui.waitUntil(10_000) { ui.onAllNodesWithTag("technique-title").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("technique-title").assertTextContains("Последняя правка")
        ui.onNodeWithTag("technique-title").performTextReplacement("Сохранённая версия")
        ui.onNodeWithTag("technique-publish").performClick()
        ui.waitUntil(10_000) { exits == 2 }
        val published = TechniqueText.parse(runBlocking { requireNotNull(db.techniqueDao().latest(document.id)) }.payloadJson)
        assertEquals("Сохранённая версия", published.title)
        assertEquals(32, published.phases.sumOf { it.steps.size })
        assertEquals("Вопрос тренеру", published.phases.first().steps.first().question)
    }
}

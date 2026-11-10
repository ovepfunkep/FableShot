package app.fableshot.android

import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.technique.*
import app.fableshot.android.ui.FableTheme
import kotlinx.coroutines.*
import org.junit.*
import java.io.File
import java.util.UUID

/** All bindings and preferences are isolated from the installed diary. */
class TechniqueSessionUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private lateinit var db: JournalDatabase
    private lateinit var repo: TechniqueRepository
    private lateinit var preferences: UserPreferences
    private lateinit var preferenceFile: File
    private lateinit var preferenceScope: CoroutineScope

    @Before fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        db = Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java).build()
        repo = TechniqueRepository(db, WriteGate())
        preferenceFile = File(context.filesDir, "technique-session-${UUID.randomUUID()}.preferences_pb")
        preferenceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        preferences = UserPreferences(PreferenceDataStoreFactory.create(scope = preferenceScope, produceFile = { preferenceFile }))
    }

    @After fun cleanup() = runBlocking {
        preferenceScope.coroutineContext[Job]!!.cancelAndJoin()
        db.close()
        preferenceFile.delete()
        Unit
    }

    private fun start(selection: TechniqueSelection? = null): JournalDetails = runBlocking(Dispatchers.IO) {
        val journal = JournalRepository(db)
        val started = journal.start("Тренировка", BlockPlan(18.0, 600, techniqueSelection = selection), "session-start") as JournalWrite.Saved
        requireNotNull(journal.details(started.id))
    }

    @Test fun emptyBindingsDisappearAndRemovingFocusDoesNotResurrectTheOldOne() {
        val source = start()
        val details = mutableStateOf(source)
        runBlocking(Dispatchers.IO) { repo.bind(source.session.id, TechniqueSelection(null)) }
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { TechniqueSession(repo, details.value, preferences) }
        } }
        ui.onNodeWithTag("session-technique").assertDoesNotExist()
        ui.runOnIdle { details.value = source.copy(session = source.session.copy(state = "completed")) }
        ui.onNodeWithTag("report-technique").assertDoesNotExist()
        ui.runOnIdle { details.value = source }
        runBlocking(Dispatchers.IO) { repo.bind(source.session.id, TechniqueSelection(null, "Свободный фокус")) }
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("session-technique").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithText("Свободный фокус").assertExists()
        runBlocking(Dispatchers.IO) { repo.bind(source.session.id, TechniqueSelection(null)) }
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("session-technique").fetchSemanticsNodes().isEmpty() }
        ui.onNodeWithText("Свободный фокус").assertDoesNotExist()
        ui.runOnIdle { details.value = source.copy(session = source.session.copy(state = "completed")) }
        ui.onNodeWithText("Техника и рефлексия · 1").assertExists().performClick()
        ui.onNodeWithText("Свободный фокус", substring = true).assertExists()
    }

    @Test fun aBoundMemoWithoutFocusShowsItsNameInsteadOfAnEmptyFocusPlaceholder() {
        val version = runBlocking(Dispatchers.IO) {
            val text = TechniqueText(title = "Личная памятка")
            val id = repo.create(text)
            val document = requireNotNull(db.techniqueDao().document(id))
            repo.publish(id, document.draftJson, text.json())
        }
        val details = start(TechniqueSelection(version.id))
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { TechniqueSession(repo, details, preferences) }
        } }
        ui.waitUntil(5_000) { ui.onAllNodesWithText("Личная памятка").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithText("Фокус тренировки").assertDoesNotExist()
        ui.onNodeWithTag("session-technique").assertExists()
    }
}

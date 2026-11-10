package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.ui.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.UUID
import java.io.File

/** Real writes use an in-memory journal; no installed diary, display setting or lock state is changed. */
class ActiveTrainingFollowUpTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private lateinit var db: JournalDatabase
    private lateinit var store: JournalPracticeStore
    private lateinit var sessionId: String
    private lateinit var model: PracticeViewModel
    private val models = ViewModelStore()

    @Before fun prepare() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertFalse("The user must unlock the device before UI verification.",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        db = Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java).build()
        store = JournalPracticeStore(db)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    @After fun cleanup() = runBlocking {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { models.clear() }
        if (::model.isInitialized) model.awaitStopped()
        if (::db.isInitialized) db.close()
    }

    private fun start(arrowsPerEnd: Int = 3, numbering: Boolean = true) = runBlocking(Dispatchers.IO) {
        val arrows = EquipmentItem("fixture-arrows", "arrows", "Номерные стрелы", numberedCount = 12)
        val bow = EquipmentItem("fixture-bow", "bow", "Классический лук", category = "recurve")
        val setup = EquipmentItem("fixture-setup", "setup", "Комплект", bowId = bow.id, arrowsId = arrows.id)
        store.startPlan("Изолированная тренировка", BlockPlan(18.0, 400, arrows = arrowsPerEnd,
            equipmentSnapshotJson = equipmentSnapshot(setup, listOf(setup, bow, arrows)),
            targetProfileId = TargetCatalog.indoor.id, flexibleSeries = true,
            numberedArrows = numbering, roundArrowLimit = 60, rankCategory = "male"), UUID.randomUUID().toString())
        sessionId = requireNotNull(store.active.first()).session.id
    }

    private fun current(): JournalDetails = runBlocking(Dispatchers.IO) { requireNotNull(store.journal.details(sessionId)) }

    private fun seed(points: Int, number: Int? = null) = runBlocking(Dispatchers.IO) {
        store.addNumbered(requireNotNull(store.journal.details(sessionId)?.currentEnd).end.id,
            null, points, number, UUID.randomUUID().toString())
    }

    private fun mount(width: Int = 360, height: Int = 720, font: Float = 1f) {
        val owner = object : ViewModelStoreOwner { override val viewModelStore = models }
        model = ViewModelProvider(owner, PracticeViewModel.Factory(store))[PracticeViewModel::class.java]
        ui.setContent {
            val density = LocalDensity.current
            val state by model.state.collectAsState()
            val pending by model.pending.collectAsState()
            val error by model.error.collectAsState()
            val undoable by model.undoableEnds.collectAsState()
            CompositionLocalProvider(LocalDensity provides Density(density.density, font),
                LocalRankPreferences provides RankPreferences("male")) {
                FableTheme(UserSettings(animations = false)) {
                    Surface(Modifier.requiredSize(width.dp, height.dp).windowInsetsPadding(WindowInsets.safeDrawing)
                        .testTag("follow-up-viewport")) {
                        TargetOverlayHost(Modifier.fillMaxSize()) {
                            state.active?.let { details ->
                                ActivePractice(details, PracticeCommands(model::point, model::numeric, model::update,
                                    model::undo, model::next, model::x, model::pointNumbered, model::numericNumbered,
                                    model::removeShot), details.currentEnd?.end?.id in undoable, pending > 0 || error != null,
                                    onStats = {}, onFinish = {}, saveFailed = error != null)
                            }
                        }
                    }
                }
            }
        }
        waitTag("target-input")
    }

    private fun waitTag(tag: String) {
        ui.waitUntil(10_000) { ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun waitFacts(predicate: (JournalDetails) -> Boolean) {
        ui.waitUntil(10_000) { predicate(current()) }
        ui.waitForIdle()
        assertNull("The UI command must finish without a storage error", model.error.value)
    }

    private fun capture(name: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.getExternalFilesDir("verification"), "follow-up-0.30.0").apply { mkdirs() }
        File(folder, name).outputStream().use {
            assertTrue(ui.onRoot().captureToImage().asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
        }
    }

    @Test fun dismissingNewHitNumberPromptLeavesEarlierNumberedHitEditable() {
        start()
        seed(9, 2)
        val original = current().allShots.single()
        mount()
        ui.onNodeWithTag("target-input").performTouchInput { click(center) }
        waitTag("physical-arrow-picker")
        waitFacts { it.allShots.size == 2 }
        dismissTestSheet(ui)
        ui.onNodeWithTag("shot-0").assertIsEnabled().performClick().assertIsSelected()
        ui.onNodeWithTag("miss").assertIsEnabled().performClick()
        ui.onNodeWithTag("save-edit").assertIsEnabled().performClick()
        waitFacts { it.allShots.first().points == 0 }
        val stored = current().allShots
        assertEquals(2, stored.size)
        assertEquals(original.id, stored.first().id)
        assertEquals(2, stored.first().physicalArrowNumber)
        assertEquals("M", stored.first().zoneCode)
        assertEquals(10, stored.last().points)
        assertNull(stored.last().physicalArrowNumber)
    }

    @Test fun selectedTopActionDeletesTheFactAndReindexesFollowingHits() {
        start()
        seed(10, 1); seed(9, 2); seed(8, 3)
        val before = current().allShots
        mount()
        ui.onNodeWithTag("shot-1").performClick().assertIsSelected()
        ui.onNodeWithTag("remove-selected-shot").assertIsEnabled().performClick()
        ui.onNodeWithTag("confirm-remove-selected-shot").performClick()
        waitFacts { it.allShots.size == 2 }
        val after = current().allShots
        assertEquals(listOf(before[0].id, before[2].id), after.map { it.id })
        assertEquals(listOf(0, 1), after.map { it.inputIndex })
        assertEquals(listOf(10, 8), after.map { it.points })
        assertEquals(listOf(1, 3), after.map { it.physicalArrowNumber })
        ui.onNodeWithTag("save-edit").assertDoesNotExist()
        ui.onNodeWithTag("next-end").assertIsEnabled()
    }

    @org.junit.Ignore("Иван 10.11: экстремальный системный масштаб исключён из поддержки и критериев готовности")
    @Test fun narrowLargeTextKeepsNextPinnedWhileLongStripAndSelectionChange() {
        start(arrowsPerEnd = 6, numbering = false)
        repeat(8) { seed(if (it == 0) 9 else 10) }
        mount(width = 280, height = 560, font = 2f)
        ui.onNodeWithTag("shot-strip-scroll").assertExists()
        ui.onNodeWithTag("next-end").assertIsDisplayed().assertIsEnabled()
        val viewport = ui.onNodeWithTag("follow-up-viewport").fetchSemanticsNode().boundsInRoot
        val footer = ui.onNodeWithTag("training-editor-footer").fetchSemanticsNode().boundsInRoot
        val next = ui.onNodeWithTag("next-end").fetchSemanticsNode().boundsInRoot
        val target = ui.onNodeWithTag("training-target-area").fetchSemanticsNode().boundsInRoot
        assertTrue("Footer extends below the effective viewport", footer.bottom <= viewport.bottom + 1f)
        assertTrue("Primary action is clipped at large text", next.top >= viewport.top && next.bottom <= viewport.bottom + 1f)
        val minimumTarget = with(ui.density) { 100.dp.toPx() }
        assertTrue("Enlarged summary must leave usable target space: $target", target.height >= minimumTarget)
        capture("training-280-font200.png")
        ui.onNodeWithTag("shot-strip-scroll").performScrollToIndex(0)
        ui.onNodeWithTag("shot-0").performClick().assertIsSelected()
        ui.onNodeWithTag("miss").performClick()
        ui.onNodeWithTag("save-edit").assertIsDisplayed().performClick()
        waitFacts { it.allShots.first().points == 0 }
        ui.onNodeWithTag("next-end").assertIsDisplayed().assertIsEnabled()
        assertEquals(footer, ui.onNodeWithTag("training-editor-footer").fetchSemanticsNode().boundsInRoot)
    }

    @Test fun roundAndSeriesBadgesOpenTheirOwnForecastSamples() {
        start(numbering = false)
        repeat(3) { seed(8) }
        val endId = current().currentEnd!!.end.id
        runBlocking(Dispatchers.IO) { store.next(endId, UUID.randomUUID().toString()) }
        seed(10)
        mount()
        capture("training-standard.png")
        ui.onNodeWithTag("training-round-rank").assertIsDisplayed().performClick()
        waitTag("rank-sheet")
        ui.onNodeWithText("34 очков · 4 из 60 стрел").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("Прогноз полного упражнения:", substring = true).performScrollTo().assertIsDisplayed()
        dismissTestSheet(ui)
        ui.onNodeWithTag("training-series-rank").assertIsDisplayed().performClick()
        waitTag("rank-sheet")
        ui.onNodeWithText("10 очков · 1 из 60 стрел").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("34 очков · 4 из 60 стрел").assertDoesNotExist()
    }
}

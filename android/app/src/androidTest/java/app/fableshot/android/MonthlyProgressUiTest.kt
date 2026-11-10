package app.fableshot.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.JournalSummaryMeta
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.UserSettings
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.ProgressResults
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import java.time.LocalDate
import java.time.ZoneId
import java.io.File
import java.time.format.DateTimeFormatter

class MonthlyProgressUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    private val today = LocalDate.now()
    private val wideGroup = listOf(TargetPoint(-.1, 0.0), TargetPoint(-.1, 0.0), TargetPoint(.1, 0.0), TargetPoint(.1, 0.0))
    private val tightGroup = List(4) { TargetPoint(0.0, 0.0) }

    private fun training(
        id: String,
        day: LocalDate?,
        score: Int,
        positions: List<TargetPoint>? = null,
        comparable: Boolean = true,
        state: String = "completed",
        scored: Int = 4,
    ) = SessionSummary(
        id = id,
        title = id,
        startedAt = (day ?: today).atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(),
        state = state,
        shotCount = 4,
        total = score,
        distanceMeters = 18.0,
        targetDiameterMm = 400,
        profileId = TargetCatalog.indoor.id,
        journalMeta = JournalSummaryMeta(
            blockCount = if (comparable) 1 else 2,
            scoredCount = scored,
            comparable = comparable,
            countOnly = scored == 0,
            conditionsKey = "18 m · 40 cm",
            localDate = day?.toString(),
            dateKnown = day != null,
            positions = positions,
        ),
    )

    private fun mount(sessions: List<SessionSummary>, fontScale: Float = 1f) {
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                FableTheme(UserSettings(animations = false)) {
                    Surface(Modifier.fillMaxSize()) { ProgressResults(sessions) }
                }
            }
        }
    }

    private fun show(tag: String): SemanticsNodeInteraction {
        ui.onNodeWithTag("progress-screen").performScrollToNode(hasTestTag(tag))
        return ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
    }

    private fun pan(label: String) {
        val actions = show("progress-trend-chart").fetchSemanticsNode().config[SemanticsActions.CustomActions]
        ui.runOnIdle { assertTrue(actions.single { it.label == label }.action()) }
    }

    private fun capture(name: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.getExternalFilesDir("verification"), "progress-0.25.0").apply { mkdirs() }
        File(folder, name).outputStream().use { output ->
            assertTrue(ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output))
        }
    }

    @Test fun scoreStartsAtLatestThirtyDaysAndContinuouslyReachesOlderWorkouts() {
        mount(listOf(
            training("Последняя", today, 28),
            training("Ранняя", today.minusDays(45), 32),
            training("Разные условия", today.minusDays(40), 36, comparable = false),
            training("Не завершена", today, 40, state = "active"),
            training("Без оценки", today, 0, scored = 0),
            training("Дата неизвестна", null, 40),
        ))
        show("progress-trend")
        ui.onNodeWithTag("monthly-progress-previous").assertDoesNotExist()
        ui.onNodeWithTag("monthly-progress-next").assertDoesNotExist()
        show("progress-trend-score").assertIsSelected()
        show("progress-trend-value").assertTextContains("7,0 / 10", substring = true)
        show("progress-trend-range").assertTextContains(today.format(DateTimeFormatter.ofPattern("dd.MM.yyyy")), substring = true)

        pan("Раньше на 30 дней")
        show("progress-trend-value").assertTextContains("9,0 / 10", substring = true)
        show("progress-trend-chart").performTouchInput { click(Offset(2f, centerY)) }
        show("progress-trend-value").assertTextContains("8,0 / 10", substring = true)
        capture("continuous-normal.png")

        pan("Позже на 30 дней")
        show("progress-trend-value").assertTextContains("7,0 / 10", substring = true)
        val currentRange = show("progress-trend-range").fetchSemanticsNode().config[SemanticsProperties.Text]
        show("progress-trend-chart").performTouchInput { swipeRight() }
        assertNotEquals(currentRange, show("progress-trend-range").fetchSemanticsNode().config[SemanticsProperties.Text])
    }

    @Test fun rmsUsesOnlyComparableTrainedGroupsAndASelectablePointReportsMillimetresAtLargeFont() {
        mount(listOf(
            training("Шире", today.minusDays(45), 32, wideGroup),
            training("Плотнее", today.minusDays(40), 34, tightGroup),
            training("Мало отметок", today.minusDays(37), 36, wideGroup.take(2)),
            training("Смешанные условия", today.minusDays(35), 38, wideGroup, comparable = false),
        ), fontScale = 1.6f)
        show("progress-trend-empty")
        show("progress-trend-chart")

        pan("Раньше на 30 дней")
        show("progress-trend-rms").performClick().assertIsSelected()
        show("progress-trend-value").assertTextContains("0,0 мм", substring = true)
        show("progress-trend-chart").performTouchInput { click(Offset(2f, centerY)) }
        show("progress-trend-value").assertTextContains("20,0 мм", substring = true)
        capture("continuous-large-font.png")
    }
}

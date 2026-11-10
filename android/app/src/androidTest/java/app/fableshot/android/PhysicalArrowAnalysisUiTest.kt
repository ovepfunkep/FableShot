package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.physicalArrowAnalysis
import app.fableshot.android.ui.*
import org.junit.Rule
import org.junit.Test

class PhysicalArrowAnalysisUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun cardSwitchesComparableConditionsAndHidesDetailsUntilRequested() {
        val groups = physicalArrowAnalysis(listOf(physicalArrowFixture(), physicalArrowFixture("other", "set-b", 30.0)))
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Surface { Column(Modifier.verticalScroll(rememberScrollState())) { PhysicalArrowAnalysisCard(groups) } }
            }
        }
        ui.onNodeWithTag("physical-arrow-1").assertDoesNotExist()
        ui.onNodeWithTag("physical-arrow-scope-1").performScrollTo().performClick()
            .assertIsSelected().assertTextContains(groups[1].conditionLabel)
        ui.onNodeWithText(groups[1].arrowsSetName).assertDoesNotExist()
        val details = ui.onNodeWithTag("physical-arrow-details")
        details.performScrollTo().performClick()
        ui.onNodeWithText("Стрела №1 · выстрелов 4").assertExists()
        ui.onNodeWithText("Отмечено на мишени", substring = true).assertDoesNotExist()
        ui.onNodeWithText("подтверждённым отметкам", substring = true).assertDoesNotExist()
        details.performScrollTo().performClick()
        ui.onNodeWithTag("physical-arrow-1").assertDoesNotExist()
    }

    @Test fun reportAnalysisFollowsSelectedReportScope() {
        val first = physicalArrowFixture()
        val original = first.blocks.single()
        val other = physicalArrowFixture("part", distance = 30.0).blocks.single()
        val otherEnd = other.ends.single()
        val second = other.copy(
            block = other.block.copy(sessionId = first.session.id, ordinal = 1),
            ends = listOf(otherEnd.copy(shots = otherEnd.shots.dropLast(1))),
        )
        val details = first.copy(blocks = listOf(original, second))
        ui.setContent {
            FableTheme(UserSettings(animations = false, averageHundredths = true)) {
                Surface(Modifier.fillMaxSize()) { JournalReportScreen(details) }
            }
        }
        val report = ui.onNodeWithTag("report-screen")
        fun assertMean(label: String) {
            val mean = hasText(label) and hasAnyAncestor(hasTestTag("physical-arrow-analysis"))
            report.performScrollToNode(mean)
            ui.onNode(mean).performScrollTo().assertIsDisplayed()
        }
        report.performScrollToNode(hasTestTag("physical-arrow-details"))
        ui.onNodeWithTag("physical-arrow-details").performScrollTo().performClick()
        assertMean("Средний балл 6,75")
        report.performScrollToNode(hasTestTag("report-block-1"))
        ui.onNodeWithTag("report-block-1").performScrollTo().assertIsDisplayed().performClick().assertIsSelected()
        ui.onNodeWithTag("report-scope-coverage").assertDoesNotExist()
        assertMean("Средний балл 9,00")
        ui.onNodeWithTag("physical-arrow-scope-1").assertDoesNotExist()
    }

    @Test fun mapTapAndNumberFilterKeepFrameAndShowOnlySelectedDetailsAtLargeFont() {
        val group = physicalArrowAnalysis(listOf(physicalArrowComparisonFixture())).single()
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                FableTheme(UserSettings(animations = false)) {
                    Surface { Column(Modifier.verticalScroll(rememberScrollState())) { PhysicalArrowAnalysisCard(listOf(group)) } }
                }
            }
        }
        val extent = physicalArrowMapExtent(group)
        val scale = "Масштаб ±${number(extent * 200, 1)} мм"
        val map = ui.onNodeWithTag("physical-arrow-map").performScrollTo().assertIsDisplayed()
            .assertContentDescriptionEquals("Общая мишень номерных стрел")
        map.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Все номера. $scale"))
        ui.onNodeWithTag("physical-arrow-show-hits").assertDoesNotExist()
        ui.onNodeWithTag("physical-arrow-map-coverage").assertDoesNotExist()
        val inset = 10 * ui.activity.resources.displayMetrics.density
        map.performTouchInput {
            val radius = ((minOf(width, height) / 2f - inset) / extent).toFloat()
            click(center + Offset(1.6f * radius, .3f * radius))
        }
        ui.onNodeWithTag("physical-arrow-filter-6").performScrollTo().assertIsSelected()
        map.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Стрела №6. $scale"))
        ui.onNodeWithTag("physical-arrow-details").performScrollTo().performClick()
        ui.onNodeWithTag("physical-arrow-6").performScrollTo().assertIsDisplayed()
        ui.onNodeWithTag("physical-arrow-1").assertDoesNotExist()
        ui.onNodeWithTag("physical-arrow-filter-all").performScrollTo().performClick()
        ui.onNodeWithTag("physical-arrow-1").assertExists()
        ui.onNodeWithTag("physical-arrow-6").assertExists()
        map.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Все номера. $scale"))
    }
}

package app.fableshot.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.JournalReportScreen
import org.junit.Rule
import org.junit.Test

class ReportStatisticsFlagsUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun hidingAverageUpdatesOpenReportWithoutRemovingOtherMetricsAndCanBeReversed() {
        val settings = mutableStateOf(UserSettings(animations = false))
        val journal = physicalArrowFixture()
        ui.setContent {
            FableTheme(settings.value) {
                Surface(Modifier.fillMaxSize()) { JournalReportScreen(journal) }
            }
        }
        ui.onNodeWithTag("report-screen").performScrollToNode(hasTestTag("report-result"))
        ui.onNodeWithTag("report-result-average").assertExists()
        ui.onNodeWithTag("report-result-grouping").assertExists()

        ui.runOnIdle { settings.value = settings.value.copy(disabledStatistics = setOf(StatisticFeature.Average.wire)) }
        ui.onNodeWithTag("report-result-average").assertDoesNotExist()
        ui.onNodeWithTag("report-result-grouping").assertExists()
        ui.onNodeWithTag("training-mean-trend").assertDoesNotExist()

        ui.runOnIdle { settings.value = settings.value.copy(disabledStatistics = emptySet()) }
        ui.onNodeWithTag("report-result-average").assertExists()
    }

    @Test fun hidingEveryStatisticLeavesConditionsWithoutEmptyStatisticsSections() {
        val settings = UserSettings(animations = false,
            disabledStatistics = StatisticFeature.entries.map { it.wire }.toSet())
        ui.setContent {
            FableTheme(settings) {
                Surface(Modifier.fillMaxSize()) { JournalReportScreen(physicalArrowFixture()) }
            }
        }
        ui.onNodeWithTag("report-conditions").assertIsDisplayed()
        for (tag in listOf("report-result", "cg3-card", "pg1-card", "training-hit-map-card",
            "physical-arrow-analysis", "training-mean-trend")) {
            ui.onNodeWithTag(tag).assertDoesNotExist()
        }
        ui.onNodeWithText("Подробная статистика").assertDoesNotExist()
        ui.onNodeWithText("Распределение попаданий").assertDoesNotExist()
    }
}

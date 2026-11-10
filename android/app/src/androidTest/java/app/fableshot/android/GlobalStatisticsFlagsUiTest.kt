package app.fableshot.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.JournalSummaryMeta
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.data.UserSettings
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.HomeScreen
import app.fableshot.android.ui.ProgressResults
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class GlobalStatisticsFlagsUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    private fun training(): SessionSummary {
        val today = LocalDate.now()
        return SessionSummary(
            "visibility-fixture", "Проверка видимости",
            today.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(),
            "completed", 4, 36, 18.0, 400, TargetCatalog.indoor.id,
            JournalSummaryMeta(
                blockCount = 1, scoredCount = 4, comparable = true, countOnly = false,
                localDate = today.toString(), positions = listOf(
                    TargetPoint(-.1, 0.0), TargetPoint(-.1, 0.0),
                    TargetPoint(.1, 0.0), TargetPoint(.1, 0.0),
                ),
            ),
        )
    }

    private fun showProgress(tag: String): SemanticsNodeInteraction {
        ui.onNodeWithTag("progress-screen").performScrollToNode(hasTestTag(tag))
        return ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
    }

    @Test fun allHiddenStatisticsAndReenabledGroupingChooseOnlyAllowedGraphMetrics() {
        var disabled by mutableStateOf(StatisticFeature.entries.map { it.wire }.toSet())
        val sessions = listOf(training())
        ui.setContent {
            FableTheme(UserSettings(animations = false, disabledStatistics = disabled)) {
                Surface(Modifier.fillMaxSize()) { ProgressResults(sessions) }
            }
        }
        ui.onNodeWithTag("statistics-hidden").assertIsDisplayed()
        ui.onNodeWithTag("progress-trend").assertDoesNotExist()

        ui.runOnIdle {
            disabled = disabled - StatisticFeature.ProgressTrend.wire - StatisticFeature.Grouping.wire
        }
        showProgress("progress-trend-rms").assertIsSelected()
        ui.onNodeWithTag("progress-trend-score").assertDoesNotExist()
        showProgress("progress-trend-value").assertTextContains("20,0 мм", substring = true)
        ui.onNodeWithTag("statistics-hidden").assertDoesNotExist()

        ui.runOnIdle { disabled = disabled - StatisticFeature.Average.wire }
        showProgress("progress-trend-score").assertIsSelected()
        showProgress("progress-trend-value").assertTextContains("9,0 / 10", substring = true)
    }

    @Test fun hidingHomeSummaryKeepsTrainingEntryAndHidingAllRecapMetricsRemovesPractice() {
        var disabled by mutableStateOf(setOf(StatisticFeature.Volume.wire))
        val sessions = listOf(training())
        ui.setContent {
            FableTheme(UserSettings(animations = false, disabledStatistics = disabled)) {
                Surface(Modifier.fillMaxSize()) {
                    HomeScreen(sessions, null, UserSettings(), {}, {}, {}, {})
                }
            }
        }
        ui.onNodeWithTag("home-all-time-totals").assertDoesNotExist()
        ui.onNodeWithTag("home-primary").assertIsDisplayed()
        ui.onNodeWithTag("home-screen").performScrollToNode(hasTestTag("home-week"))
        ui.onNodeWithTag("home-week").assertIsDisplayed()

        ui.runOnIdle {
            disabled = disabled + StatisticFeature.Result.wire + StatisticFeature.Average.wire
        }
        ui.onNodeWithTag("home-week").assertDoesNotExist()
        ui.onNodeWithTag("home-practice-horizontal").assertDoesNotExist()
        ui.onNodeWithTag("home-screen").performScrollToNode(hasTestTag("home-primary"))
        ui.onNodeWithTag("home-primary").assertIsDisplayed()
    }
}

package app.fableshot.android

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.JournalSummaryMeta
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.ZoneAnalytics
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class ZoneTrendUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    private fun training(id: String, day: LocalDate, zones: List<Int>, x: Int) = SessionSummary(
        id, id, day.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli(),
        "completed", zones.sum(), zones.mapIndexed { score, count -> score * count }.sum(),
        18.0, 400, "indoor",
        JournalSummaryMeta(1, zones.sum(), true, false, localDate = day.toString(), zoneCounts = zones, xCount = x),
    )

    @Test fun tappingRatePointShowsExactPercentageAndMetricSelectionChangesItAtLargeFont() {
        val today = LocalDate.now()
        val rows = listOf(
            training("Первая", today.minusDays(4), List(11) { if (it in listOf(0, 9, 10)) 1 else 0 }, 0),
            training("Последняя", today, List(11) { if (it == 10) 3 else 0 }, 2),
        )
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.6f)) {
                FableTheme(UserSettings(animations = false)) {
                    Column(Modifier.verticalScroll(rememberScrollState())) { ZoneAnalytics(rows) }
                }
            }
        }

        ui.onNodeWithTag("rate-selection").performScrollTo().assertTextContains("100,0%", substring = true)
        ui.onNodeWithTag("rate-chart").performScrollTo().performTouchInput { click(Offset(2f, centerY)) }
        ui.onNodeWithTag("rate-selection").assertTextContains("33,3%", substring = true)
        ui.onNodeWithTag("rate-X").performScrollTo().performClick().assertIsSelected()
        ui.onNodeWithTag("rate-chart").performScrollTo().performTouchInput { click(Offset(2f, centerY)) }
        ui.onNodeWithTag("rate-selection").assertTextContains("0,0%", substring = true)
        ui.onNodeWithTag("rate-M").performScrollTo().performClick().assertIsSelected()
        ui.onNodeWithTag("rate-chart").performScrollTo().performTouchInput { click(Offset(2f, centerY)) }
        ui.onNodeWithTag("rate-selection").assertTextContains("33,3%", substring = true)
    }
}

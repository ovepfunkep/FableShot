package app.fableshot.android

import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.SettingsScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class StatisticsSettingsUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun eachStatisticCanBeToggledAndResetAtLargeFont() {
        var disabled by mutableStateOf(setOf(StatisticFeature.Norms.wire))
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.6f)) {
                FableTheme(UserSettings(animations = false)) {
                    SettingsScreen(
                        UserSettings(disabledStatistics = disabled),
                        {}, {}, {}, {}, {}, {}, {},
                        onStatistic = { feature, visible ->
                            disabled = if (visible) disabled - feature.wire else disabled + feature.wire
                        },
                        onStatisticsReset = { disabled = emptySet() },
                    )
                }
            }
        }
        ui.onNodeWithText("Статистика").performScrollTo().performClick()
        StatisticFeature.entries.forEach { feature ->
            val toggle = ui.onNodeWithTag("statistic-${feature.wire}").performScrollTo()
            if (feature == StatisticFeature.Norms) toggle.assertIsOff() else toggle.assertIsOn()
        }
        ui.onNodeWithTag("statistic-${StatisticFeature.Average.wire}").performScrollTo().performClick().assertIsOff()
        assertEquals(setOf(StatisticFeature.Norms.wire, StatisticFeature.Average.wire), disabled)
        ui.onNodeWithTag("statistics-enable-all").performScrollTo().performClick()
        StatisticFeature.entries.forEach { feature ->
            ui.onNodeWithTag("statistic-${feature.wire}").performScrollTo().assertIsOn()
        }
        assertEquals(emptySet<String>(), disabled)
    }
}

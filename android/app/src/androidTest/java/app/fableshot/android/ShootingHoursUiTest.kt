package app.fableshot.android

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.TrackedTrainingTime
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.AppScale
import app.fableshot.android.ui.ShootingHoursCard
import app.fableshot.android.ui.TrainingTimeLabel
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*

class ShootingHoursUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun manualBaseCanBeEditedSeparatelyFromRecordedTimeAndReportKeepsKnownScope() {
        ui.setContent {
            var baseMinutes by remember { mutableLongStateOf(0) }
            FableTheme(UserSettings(animations = false)) {
                Surface {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        ShootingHoursCard(baseMinutes, 9 * 60_000L) { baseMinutes = it }
                        TrainingTimeLabel(TrackedTrainingTime(9 * 60_000L, null, true))
                    }
                }
            }
        }
        ui.onNodeWithTag("shooting-hours-edit").performClick()
        ui.onNodeWithTag("shooting-hours-base-hours").performTextReplacement("2")
        ui.onNodeWithTag("shooting-hours-base-minutes").performTextReplacement("60")
        ui.onNodeWithTag("shooting-hours-save").assertIsNotEnabled()
        ui.onNodeWithTag("shooting-hours-base-minutes").performTextReplacement("15")
        ui.onNodeWithTag("shooting-hours-save").assertIsEnabled().performClick()
        ui.onNodeWithTag("shooting-hours-total").assertTextEquals("2 ч 24 мин")
        ui.onNodeWithTag("shooting-hours-base").assertDoesNotExist()
        ui.onNodeWithTag("shooting-hours-recorded").assertDoesNotExist()
        ui.onNodeWithTag("report-training-time").assertTextEquals("9 мин")
            .assertContentDescriptionEquals("Учтённое время тренировки · 9 мин")
        ui.onNodeWithTag("shooting-hours-edit").performClick()
        ui.onNodeWithTag("shooting-hours-base").assertTextEquals("База вручную · 2 ч 15 мин")
        ui.onNodeWithTag("shooting-hours-recorded").assertTextEquals("Учтено в приложении · 9 мин")
    }

    @Test fun timerKeepsFullAccessibleMeaningWithoutRepeatingTheHeadingAtLargeFont() {
        ui.setContent {
            FableTheme(UserSettings(animations = false, useSystemScale = true)) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                    AppScale(UserSettings(useSystemScale = true)) {
                    Surface { Column {
                        ShootingHoursCard(120, 9 * 60_000L) {}
                        TrainingTimeLabel(TrackedTrainingTime(9 * 60_000L, null, false))
                    } }
                    }
                }
            }
        }
        ui.onNodeWithTag("shooting-hours-edit").assertIsDisplayed().performClick()
        ui.onNodeWithTag("shooting-hours-base-hours").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText(ui.activity.getString(R.string.cancel)).performClick()
        ui.onNodeWithTag("report-training-time").assertTextEquals("9 мин")
            .assertContentDescriptionEquals("Время тренировки · 9 мин")
    }

    @Test fun narrowHoursCardWrapsLongValueAndLabelAtTheRequestedLargeFont() {
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                AppScale(UserSettings(useSystemScale = true)) {
                    FableTheme(UserSettings(animations = false, useSystemScale = true)) {
                        Surface(Modifier.requiredWidth(280.dp)) {
                            Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
                                ShootingHoursCard(59_999_999, 0) {}
                            }
                        }
                    }
                }
            }
        }
        for ((text, expectedSize) in listOf("999999 ч 59 мин" to 28f, "Часы стрельбы" to 12f)) {
            val layouts = mutableListOf<TextLayoutResult>()
            val node = hasText(text) and SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult)
            ui.onAllNodes(node, useUnmergedTree = true)[0].performScrollTo()
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertTrue("Missing layout for $text", layouts.isNotEmpty())
            layouts.forEach { layout ->
                assertEquals("Font must retain its requested size: $text", expectedSize,
                    layout.layoutInput.style.fontSize.value, .01f)
                val details = "size=${layout.size}, paragraph=${layout.multiParagraph.width}x${layout.multiParagraph.height}, " +
                    "constraints=${layout.layoutInput.constraints}, lines=${layout.lineCount}"
                assertFalse("Text overflows its width: $text ($details)", layout.didOverflowWidth)
                assertFalse("Text overflows its height: $text ($details)", layout.didOverflowHeight)
            }
        }
        ui.onNodeWithTag("shooting-hours-edit").performScrollTo().assertIsDisplayed().performClick()
        ui.onNodeWithTag("shooting-hours-base-hours").performScrollTo().assertIsDisplayed()
    }
}

package app.fableshot.android

import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.AppReleases
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.ReleaseNotesHost
import app.fableshot.android.ui.ReleaseNotesSheet
import app.fableshot.android.ui.SettingsScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import kotlinx.coroutines.awaitCancellation
import java.io.File

class ReleaseNotesUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val latestHighlight = "В настройках можно выбрать показатели и графики, которые хочется видеть."
    private val arrowHighlight = "Попадания можно связывать с номером физической стрелы и сравнивать стрелы одного набора."

    private fun showHighlight(text: String) {
        val list = hasScrollAction() and hasAnyAncestor(hasTestTag("release-notes"))
        ui.onNode(list).performScrollToNode(hasText(text))
        ui.onNodeWithText(text).assertIsDisplayed()
    }

    @Test fun importantUpdateShowsOneCombinedDeltaThenAcknowledgesWithoutReplay() {
        val settings = mutableStateOf(UserSettings(onboardingVersion = 1, lastSeenReleaseCode = 45))
        val acknowledged = mutableListOf<Int>()
        ui.setContent {
            FableTheme(settings.value) {
                Surface {
                    ReleaseNotesHost(settings.value, existingInstallation = true, editionVersionCode = 54,
                        onAcknowledge = { code ->
                            acknowledged += code
                            settings.value = settings.value.copy(lastSeenReleaseCode = code)
                        })
                }
            }
        }
        ui.onAllNodesWithTag("release-notes").assertCountEquals(1)
        ui.onNodeWithTag("release-notes-range").assertTextEquals("0.21.0 → 0.26.1")
        val screenshot = File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir("verification"), "release-notes-0.26.1.png")
        screenshot.parentFile?.mkdirs()
        screenshot.outputStream().use { ui.onNodeWithTag("release-notes").captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        showHighlight(latestHighlight)
        showHighlight(arrowHighlight)
        ui.onNodeWithTag("release-notes-confirm").performClick()
        ui.waitUntil { acknowledged == listOf(54) }
        ui.onNodeWithTag("release-notes").assertDoesNotExist()
        ui.runOnIdle { settings.value = settings.value.copy(haptics = true) }
        ui.onNodeWithTag("release-notes").assertDoesNotExist()
        ui.runOnIdle { assertEquals(listOf(54), acknowledged) }
    }

    @Test fun cancelledAcknowledgementCannotHideUnseenChangesAfterRecreation() {
        val settings = UserSettings(onboardingVersion = 1, lastSeenReleaseCode = 52)
        var writes = 0
        val restoration = StateRestorationTester(ui)
        restoration.setContent {
            FableTheme(settings) {
                ReleaseNotesHost(settings, existingInstallation = true, editionVersionCode = 54,
                    onAcknowledge = { writes++; awaitCancellation() })
            }
        }
        ui.onNodeWithTag("release-notes-confirm").performClick()
        ui.waitUntil { writes == 1 }
        ui.onNodeWithTag("release-notes").assertDoesNotExist()
        restoration.emulateSavedInstanceStateRestore()
        ui.onNodeWithTag("release-notes").assertExists()
        ui.onNodeWithTag("release-notes-range").assertTextEquals("0.25.0 → 0.26.1")
    }

    @Test fun quietIntervalAndFreshInstallationAcknowledgeSilently() {
        val settings = mutableStateOf(UserSettings(onboardingVersion = 1, lastSeenReleaseCode = 42))
        val version = mutableStateOf(43)
        val existing = mutableStateOf(true)
        val acknowledged = mutableListOf<Int>()
        ui.setContent {
            FableTheme(settings.value) {
                ReleaseNotesHost(settings.value, existing.value, editionVersionCode = version.value,
                    onAcknowledge = { code ->
                        acknowledged += code
                        settings.value = settings.value.copy(lastSeenReleaseCode = code)
                    })
            }
        }
        ui.waitUntil { acknowledged == listOf(43) }
        ui.onNodeWithTag("release-notes").assertDoesNotExist()
        ui.runOnIdle {
            settings.value = UserSettings()
            existing.value = false
            version.value = 54
        }
        ui.waitUntil { acknowledged == listOf(43, 54) }
        ui.onNodeWithTag("release-notes").assertDoesNotExist()
    }

    @Test fun choosingPreviousVersionKeepsOnlyLaterHighlights() {
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                ReleaseNotesHost(UserSettings(onboardingVersion = 1), existingInstallation = true,
                    editionVersionCode = 54, onAcknowledge = {})
            }
        }
        showHighlight(arrowHighlight)
        val list = hasScrollAction() and hasAnyAncestor(hasTestTag("release-notes"))
        ui.onNode(list).performScrollToNode(hasTestTag("release-notes-previous"))
        ui.onNodeWithTag("release-notes-previous").performClick()
        ui.onNodeWithTag("release-previous-52").performClick()
        ui.onNodeWithTag("release-notes-range").assertTextEquals("0.25.0 → 0.26.1")
        showHighlight(latestHighlight)
        ui.onNodeWithText(arrowHighlight).assertDoesNotExist()
    }

    @Test fun settingsVersionOpensFullReleaseHistory() {
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                SettingsScreen(
                    settings = UserSettings(),
                    onStyle = {},
                    onAppearance = {},
                    onAnimations = {},
                    onHaptics = {},
                    onAwake = {},
                    onWelcome = {},
                    onTutorial = {},
                )
            }
        }
        ui.onNodeWithTag("settings-version").performClick()
        ui.onNodeWithText("История обновлений").assertIsDisplayed()
        val list = hasScrollAction() and hasAnyAncestor(hasTestTag("release-notes"))
        ui.onNode(list).performScrollToNode(hasTestTag("release-history-52"))
        ui.onNodeWithTag("release-history-52").assertIsDisplayed()
        ui.onNodeWithText("MyTargets становится своим").assertExists()
    }

    @Test fun fullHistoryOmitsMaintenanceOnlyVersions() {
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                ReleaseNotesSheet(
                    AppReleases.entries.filter { it.versionCode in setOf(48, 50, 54) },
                    onDismiss = {},
                    fullHistory = true,
                )
            }
        }
        ui.onNodeWithTag("release-history-54").assertIsDisplayed()
        ui.onNodeWithTag("release-history-48").assertDoesNotExist()
        ui.onNodeWithTag("release-history-50").assertDoesNotExist()
        ui.onNodeWithText("Достижения можно сбросить отдельно от тренировок и статистики.").assertIsDisplayed()
    }
}

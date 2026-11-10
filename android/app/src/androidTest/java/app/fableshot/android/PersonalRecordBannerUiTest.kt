package app.fableshot.android

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.PersonalRecordEvent
import app.fableshot.android.domain.AchievementRarity
import app.fableshot.android.domain.EarnedAchievement
import app.fableshot.android.ui.AchievementBannerHost
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.PersonalRecordReportCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class PersonalRecordBannerUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Before fun requireUnlockedFocusedActivity() {
        assertFalse("UI verification requires the user to unlock the device.",
            ui.activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    private fun awaitVisible(tag: String) {
        ui.waitUntil(5_000) {
            ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() && ui.onNodeWithTag(tag).isDisplayed()
        }
    }

    @Test fun recordLeadsTheSharedQueueAndComparisonSurvivesAcknowledgement() {
        val records = mutableStateOf<List<PersonalRecordEvent>>(emptyList())
        val awards = mutableStateOf<List<EarnedAchievement>>(emptyList())
        val recordsEnabled = mutableStateOf(true)
        val generation = mutableStateOf(0)
        var previousSession: String? = null
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Box(Modifier.fillMaxSize()) {
                    PersonalRecordReportCard(records.value, setOf("previous")) { previousSession = it }
                    key(generation.value) {
                        AchievementBannerHost(awards.value, enabled = true, onClaim = { ids ->
                            val fresh = awards.value.filter { it.key in ids && it.notifiedAtMs == null }
                            awards.value = awards.value.map {
                                if (it.key in ids) it.copy(notifiedAtMs = System.currentTimeMillis()) else it
                            }
                            fresh
                        }, recordEvents = records.value, recordsEnabled = recordsEnabled.value, onClaimRecords = { ids ->
                            val fresh = records.value.filter { it.id in ids && it.notifiedAtMs == null }
                            records.value = records.value.map {
                                if (it.id in ids) it.copy(notifiedAtMs = System.currentTimeMillis()) else it
                            }
                            fresh
                        })
                    }
                }
            }
        }
        val event = PersonalRecordEvent("new-record", "session", "series", 1, "18 м · 40 см", 27, 29,
            "previous", 2, System.currentTimeMillis())
        ui.runOnIdle {
            records.value = listOf(event)
            awards.value = listOf(EarnedAchievement("test:global", "test", "global", "Новая награда", "Реплика",
                "Условие", "test", AchievementRarity.Rare, 1, "session", null, null, event.recordedAtMs,
                "batch", null, true))
        }
        awaitVisible("personal-record-banner")
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
        ui.onNodeWithTag("personal-record-banner").performClick()
        awaitVisible("personal-record-details")
        ui.onNodeWithTag("personal-record-comparison").assertTextEquals("Было 27 → Стало 29")
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
        dismissTestSheet(ui)
        awaitVisible("achievement-banner")
        ui.onNodeWithTag("personal-record-banner").assertDoesNotExist()
        ui.onNodeWithTag("achievement-banner").performTouchInput { swipeLeft() }
        ui.runOnIdle { generation.value++ }
        ui.mainClock.advanceTimeBy(450)
        ui.onNodeWithTag("personal-record-banner").assertDoesNotExist()
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
        ui.onNodeWithTag("personal-record-new-record").performClick()
        awaitVisible("personal-record-details")
        ui.onNodeWithTag("personal-record-previous-session").performClick()
        ui.runOnIdle { assertEquals("previous", previousSession) }

        ui.runOnIdle {
            recordsEnabled.value = false
            records.value = records.value + event.copy(id = "hidden", recordedAtMs = System.currentTimeMillis())
        }
        ui.waitUntil(5_000) { records.value.last().notifiedAtMs != null }
        ui.runOnIdle { recordsEnabled.value = true }
        ui.mainClock.advanceTimeBy(450)
        ui.onNodeWithTag("personal-record-banner").assertDoesNotExist()
        ui.onNodeWithTag("personal-record-hidden").assertExists()
    }
}

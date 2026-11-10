package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Button
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.UserSettings
import app.fableshot.android.domain.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Synthetic receipts only: these scenarios never open the diary or a Room database. */
class AchievementV2UiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Before fun requireUnlockedFocusedActivity() {
        val keyguard = ui.activity.getSystemService(android.app.KeyguardManager::class.java)
        assertFalse("UI verification requires the user to unlock the device.", keyguard.isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    private fun award(index: Int, family: String = "group", scope: String = "barebow") = EarnedAchievement(
        key = "FIXTURE$index:$scope", ruleId = "FIXTURE$index", scope = scope,
        title = "Награда $index", flavor = "Маленькая победа", description = "Условие награды $index",
        family = family, rarity = AchievementRarity.entries[index % AchievementRarity.entries.size], priority = index,
        sessionId = "session", endId = "end", sourceDate = "2026-11-03",
        earnedAtMs = System.currentTimeMillis(), batchId = "batch", notifiedAtMs = null, valid = true,
    )

    private class BannerFixture {
        val awards = mutableStateOf<List<EarnedAchievement>>(emptyList())
        val enabled = mutableStateOf(true)
        val generation = mutableStateOf(0)
        val claims = mutableListOf<List<String>>()
        var targetClicks = 0
    }

    private fun mountBanner(): BannerFixture {
        val fixture = BannerFixture()
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Box(Modifier.fillMaxSize()) {
                    Button({ fixture.targetClicks++ }, Modifier.align(Alignment.BottomCenter).padding(24.dp).testTag("target-control")) {
                        app.fableshot.android.ui.Text("Продолжить ввод")
                    }
                    key(fixture.generation.value) {
                        AchievementBannerHost(fixture.awards.value, fixture.enabled.value, onClaim = { keys ->
                            fixture.claims += keys
                            val fresh = fixture.awards.value.filter { it.key in keys && it.notifiedAtMs == null }
                            fixture.awards.value = fixture.awards.value.map {
                                if (it.key in keys) it.copy(notifiedAtMs = System.currentTimeMillis()) else it
                            }
                            fresh
                        })
                    }
                }
            }
        }
        return fixture
    }

    private fun awaitBanner() {
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("achievement-banner").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("achievement-banner").assertIsDisplayed()
    }

    private fun awaitNoBanner() {
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("achievement-banner").fetchSemanticsNodes().isEmpty() }
    }

    private fun remainingFraction(): Float = ui.onNodeWithTag("achievement-banner-time", useUnmergedTree = true)
        .fetchSemanticsNode().config[SemanticsProperties.ProgressBarRangeInfo].current

    @Test fun sixNewRelatedAwardsShowBestPlusFiveAndAdditionalOpensOnlyThatGroup() {
        val fixture = mountBanner()
        ui.runOnIdle {
            fixture.awards.value = (0..5).map { award(it) } + award(1, "records").copy(key = "record:barebow", title = "Рекорд")
        }
        awaitBanner()
        ui.onNodeWithText("Награда 5").assertExists()
        ui.onNodeWithText("Ещё 1 достижение").assertExists()
        ui.onNodeWithTag("achievement-banner-additional").assertTextContains("+5", substring = true).performClick()
        ui.onNodeWithTag("achievement-detail-group-group:barebow").assertExists()
        ui.onNodeWithTag("achievement-detail-group-records:barebow").assertDoesNotExist()
        for (index in 0..4) {
            ui.onNodeWithTag("achievement-details").performScrollToNode(hasText("Награда $index"))
            ui.onNodeWithText("Награда $index").assertIsDisplayed()
        }
        ui.onNodeWithTag("achievement-details").performScrollToIndex(0)
        ui.onNodeWithTag("achievement-details-close").performClick()
        awaitBanner()
        ui.onNodeWithText("Рекорд").assertIsDisplayed()
        ui.onNodeWithTag("achievement-banner").performTouchInput { swipeLeft() }
        awaitNoBanner()
        ui.runOnIdle { assertEquals(7, fixture.awards.value.count { it.notifiedAtMs != null }) }
    }

    @Test fun uniqueFamiliesRotateEveryFourSecondsAndSwipeAdvancesImmediately() {
        val fixture = mountBanner()
        ui.runOnIdle {
            fixture.awards.value = listOf(award(5), award(0), award(3, "records"), award(1, scope = "compound"))
        }
        awaitBanner()
        ui.mainClock.autoAdvance = false
        ui.onNodeWithText("Награда 5").assertIsDisplayed()
        ui.onNodeWithText("Награда 0").assertDoesNotExist()
        ui.onNodeWithText("Ещё 2 достижения").assertExists()
        assertTrue(remainingFraction() > .85f)
        ui.mainClock.advanceTimeBy(2_800)
        ui.onNodeWithText("Награда 5").assertIsDisplayed()
        assertTrue(remainingFraction() in 0.05f..0.55f)
        ui.mainClock.advanceTimeBy(1_350)
        ui.onNodeWithText("Награда 3").assertIsDisplayed()
        ui.onNodeWithText("Награда 5").assertDoesNotExist()
        assertTrue(remainingFraction() > .85f)
        val actions = ui.onNodeWithTag("achievement-banner").fetchSemanticsNode().config[SemanticsActions.CustomActions]
        assertTrue(actions.any { it.label == "Следующее достижение" })
        ui.onNodeWithTag("achievement-banner").performTouchInput { swipeLeft() }
        val swipeFinishedAt = ui.mainClock.currentTime
        ui.waitUntil(5_000) {
            ui.mainClock.advanceTimeByFrame()
            ui.onAllNodesWithText("Награда 1").fetchSemanticsNodes().isNotEmpty() &&
                ui.onNodeWithText("Награда 1").isDisplayed()
        }
        assertTrue("Swipe must advance within 500 ms, without waiting for another display interval",
            ui.mainClock.currentTime - swipeFinishedAt < 500)
        ui.onNodeWithText("Награда 1").assertIsDisplayed()
        ui.onNodeWithText("Необычное · Блочный").assertExists()
        ui.onNodeWithTag("achievement-banner-additional").assertDoesNotExist()
        ui.mainClock.advanceTimeBy(4_200)
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
        ui.runOnIdle { assertEquals(4, fixture.awards.value.count { it.notifiedAtMs != null }) }
    }

    @Test fun laterUniqueAwardsJoinTheQueueWithoutReplacingTheCurrentOne() {
        val fixture = mountBanner()
        ui.runOnIdle { fixture.awards.value = listOf(award(3)) }
        awaitBanner()
        ui.mainClock.autoAdvance = false
        ui.runOnIdle { fixture.awards.value = fixture.awards.value + award(5, "records").copy(batchId = "later") }
        ui.mainClock.advanceTimeBy(500)
        ui.onNodeWithText("Награда 3").assertIsDisplayed()
        ui.onNodeWithText("Награда 5").assertDoesNotExist()
        ui.onNodeWithTag("achievement-banner").performTouchInput { swipeUp() }
        val swipeFinishedAt = ui.mainClock.currentTime
        ui.waitUntil(5_000) {
            ui.mainClock.advanceTimeByFrame()
            ui.onAllNodesWithText("Награда 5").fetchSemanticsNodes().isNotEmpty() &&
                ui.onNodeWithText("Награда 5").isDisplayed()
        }
        assertTrue("Swipe must advance within 500 ms, without waiting for another display interval",
            ui.mainClock.currentTime - swipeFinishedAt < 500)
        ui.onNodeWithText("Награда 5").assertIsDisplayed()
        ui.mainClock.advanceTimeBy(4_200)
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
    }

    @Test fun upAndLeftSwipesDismissWithoutMovingOrBlockingTheTarget() {
        val fixture = mountBanner()
        val before = ui.onNodeWithTag("target-control").fetchSemanticsNode().boundsInRoot
        ui.runOnIdle { fixture.awards.value = listOf(award(1)) }
        awaitBanner()
        assertEquals(before, ui.onNodeWithTag("target-control").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithTag("target-control").performTouchInput { click() }
        ui.runOnIdle { assertEquals(1, fixture.targetClicks) }
        ui.onNodeWithTag("achievement-banner").performTouchInput { swipeUp() }
        awaitNoBanner()
        ui.runOnIdle { fixture.awards.value = fixture.awards.value + award(2).copy(batchId = "later") }
        awaitBanner()
        ui.onNodeWithTag("achievement-banner").performTouchInput { swipeLeft() }
        awaitNoBanner()
        ui.runOnIdle { assertTrue(fixture.awards.value.all { it.valid && it.notifiedAtMs != null }) }
    }

    @Test fun claimedReceiptDoesNotReplayOnRecompositionOrHostRecreation() {
        val fixture = mountBanner()
        ui.runOnIdle { fixture.awards.value = listOf(award(2)) }
        awaitBanner()
        ui.onNodeWithTag("achievement-banner").performTouchInput { swipeLeft() }
        awaitNoBanner()
        ui.runOnIdle { fixture.enabled.value = false }
        ui.runOnIdle { fixture.enabled.value = true; fixture.generation.value++ }
        ui.waitForIdle()
        ui.mainClock.advanceTimeBy(600)
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
        ui.runOnIdle { assertEquals(1, fixture.claims.size) }
    }

    @Test fun holdingBannerPausesTimeoutAndAccessibleDismissRemainsAvailable() {
        val fixture = mountBanner()
        ui.runOnIdle { fixture.awards.value = listOf(award(2)) }
        awaitBanner()
        val actions = ui.onNodeWithTag("achievement-banner").fetchSemanticsNode().config[SemanticsActions.CustomActions]
        assertTrue(actions.any { it.label == "Скрыть достижение" })
        ui.mainClock.autoAdvance = false
        ui.mainClock.advanceTimeBy(1_000)
        ui.onNodeWithTag("achievement-banner").performTouchInput { down(center) }
        val heldFraction = remainingFraction()
        ui.mainClock.advanceTimeBy(5_000)
        ui.onNodeWithTag("achievement-banner").assertIsDisplayed()
        assertEquals(heldFraction, remainingFraction(), .001f)
        ui.onNodeWithTag("achievement-banner").performTouchInput { cancel() }
        ui.onNodeWithTag("achievement-details").assertDoesNotExist()
        ui.mainClock.advanceTimeBy(500)
        ui.onNodeWithTag("achievement-banner").assertIsDisplayed()
        ui.mainClock.advanceTimeBy(4_100)
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
    }

    @Test fun characterDefinitionPausesBannerUntilItsWindowRegainsFocus() {
        val fixture = mountBanner()
        val title = "Мерида бы кивнула"
        ui.runOnIdle { fixture.awards.value = listOf(award(2).copy(title = title)) }
        awaitBanner()
        ui.mainClock.autoAdvance = false
        ui.mainClock.advanceTimeBy(500)
        val layouts = mutableListOf<TextLayoutResult>()
        ui.onNodeWithText(title, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        ui.onNodeWithText(title, useUnmergedTree = true).performTouchInput { click(layouts.single().getBoundingBox(1).center) }
        val description = GlossaryRegistry.definitions.getValue("Мерида")
        // Dialog bounds depend on Android layout; virtual animation time alone cannot place its window.
        ui.waitUntil(5_000) {
            ui.mainClock.advanceTimeByFrame()
            ui.onAllNodesWithText(description).fetchSemanticsNodes().isNotEmpty() &&
                ui.onNodeWithText(description).isDisplayed()
        }
        ui.onNodeWithText(description).assertIsDisplayed()
        ui.waitUntil(5_000) { !ui.activity.hasWindowFocus() }
        ui.onNodeWithTag("achievement-details").assertDoesNotExist()
        ui.mainClock.advanceTimeBy(5_000)
        ui.onNodeWithTag("achievement-banner").assertExists()
        dismissTestSheet(ui)
        ui.waitUntil(5_000) {
            ui.mainClock.advanceTimeByFrame()
            ui.activity.hasWindowFocus()
        }
        ui.mainClock.advanceTimeBy(500)
        ui.onNodeWithTag("achievement-banner").assertIsDisplayed()
        ui.mainClock.advanceTimeBy(4_100)
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
    }

    @Test fun disabledBannerConsumesReceiptWithoutReplay() {
        val fixture = mountBanner()
        ui.runOnIdle { fixture.enabled.value = false; fixture.awards.value = listOf(award(2)) }
        ui.waitUntil(5_000) { fixture.awards.value.singleOrNull()?.notifiedAtMs != null }
        ui.runOnIdle { fixture.enabled.value = true }
        ui.mainClock.advanceTimeBy(600)
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
        ui.runOnIdle { assertTrue(fixture.awards.value.single().valid) }
    }

    @Test fun invalidatedReceiptCannotAppearBeforeDeliveryOrRemainInOpenDetails() {
        val fixture = mountBanner()
        ui.mainClock.autoAdvance = false
        ui.runOnIdle { fixture.awards.value = listOf(award(1)) }
        ui.mainClock.advanceTimeBy(64)
        ui.runOnIdle {
            assertNotNull(fixture.awards.value.single().notifiedAtMs)
            fixture.awards.value = fixture.awards.value.map { it.copy(valid = false) }
        }
        ui.mainClock.advanceTimeBy(500)
        ui.onNodeWithTag("achievement-banner").assertDoesNotExist()
        ui.mainClock.autoAdvance = true
        ui.runOnIdle { fixture.awards.value = fixture.awards.value + award(2).copy(batchId = "later") }
        awaitBanner()
        ui.onNodeWithText("Награда 1").assertDoesNotExist()
        ui.onNodeWithTag("achievement-banner").performClick()
        ui.onNodeWithTag("achievement-details").assertExists()
        ui.runOnIdle { fixture.awards.value = fixture.awards.value.map { it.copy(valid = false) } }
        awaitNoBanner()
        ui.onNodeWithTag("achievement-details").assertDoesNotExist()
        ui.runOnIdle { assertTrue(fixture.awards.value.all { it.notifiedAtMs != null }) }
    }

    @Test fun trainingReportUsesOnlyItsSavedAwardsAndOmitsEmptyBlock() {
        val awards = mutableStateOf<List<EarnedAchievement>>(emptyList())
        var opened: String? = null
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Surface { TrainingAchievementsCard(awards.value) { opened = it } }
            }
        }
        ui.onNodeWithTag("training-achievements").assertDoesNotExist()
        ui.runOnIdle { awards.value = (0..5).map { award(it) } + award(4).copy(key = "invalid", valid = false) }
        ui.onNodeWithTag("training-achievements").assertExists()
        ui.onNodeWithText("Награда 5").assertExists()
        ui.onNodeWithText("Мифическое · Баребоу").assertExists()
        ui.onNodeWithText("+5").assertExists().performClick()
        ui.onNodeWithTag("achievement-details").performScrollToNode(hasTestTag("achievement-source-FIXTURE5"))
        ui.onNodeWithTag("achievement-source-FIXTURE5").performClick()
        ui.runOnIdle { assertEquals("session", opened) }
    }

    @Test fun galleryFiltersSavedBowAwardsAndSeparatesCommonActions() {
        val barebow = award(3)
        val compound = award(2, scope = "compound")
        val global = award(1, "profile", "global")
        val awards = listOf(barebow, compound, global)
        val statuses = awards.map { award ->
            AchievementStatus(AchievementDefinition(award.ruleId, award.title, award.flavor, award.description,
                award.family, award.rarity, categorySpecific = award.scope != "global", priority = award.priority), award.scope, 1, award)
        }
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Surface { AchievementsScreen(emptyList(), AchievementBoard(statuses, awards, setOf("barebow", "compound"))) {} }
            }
        }
        ui.onNodeWithTag("achievement-scope-compound").performScrollTo().performClick()
        ui.onNodeWithTag("achievement-FIXTURE2").assertExists()
        ui.onNodeWithTag("achievement-FIXTURE3").assertDoesNotExist()
        ui.onNodeWithTag("achievement-FIXTURE1").assertDoesNotExist()
        ui.onNodeWithTag("achievement-scope-global").performScrollTo().performClick()
        ui.onNodeWithTag("achievement-FIXTURE1").assertExists()
        ui.onNodeWithTag("achievement-FIXTURE2").assertDoesNotExist()
        ui.onNodeWithTag("achievements-earned").performClick()
        ui.onNodeWithTag("achievement-FIXTURE1").assertExists()
    }
}

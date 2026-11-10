package app.fableshot.android

import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.domain.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class AchievementsUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Before fun requireUnlockedFocusedActivity() {
        val keyguard = ui.activity.getSystemService(android.app.KeyguardManager::class.java)
        assertFalse("UI verification requires the user to unlock the device.", keyguard.isKeyguardLocked)
        ui.waitUntil(5_000) { ui.activity.hasWindowFocus() }
    }

    private val source = SessionSummary("unknown-date", "Imported fixture", 1000, "completed", 100, 0, 0.0, 0,
        "count-only", JournalSummaryMeta(1, 0, false, true, dateKnown = false))

    @Test fun importedHistoryWithoutSavedAwardsDoesNotCreateACollection() {
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Surface { AchievementsScreen(listOf(source)) {} }
            }
        }
        ui.onNodeWithText("Здесь начинается новая коллекция").assertExists()
        ui.onNodeWithTag("achievement-earned-START01").assertDoesNotExist()
        ui.onNodeWithTag("achievement-earned-START06").assertDoesNotExist()
    }

    @Test fun largeTextKeepsCharacterDefinitionAndSavedSourceAccessible() {
        val definition = AchievementCatalog.byId.getValue("RANK05")
        val notice = "Считаются новые тренировки FableShot, импорт не участвует."
        val award = EarnedAchievement("RANK05:barebow", "RANK05", "barebow", definition.title,
            definition.flavor, definition.description + "\n" + notice, definition.family, definition.rarity, definition.priority,
            source.id, "end", null, Instant.parse("2026-11-03T06:15:00Z").toEpochMilli(), "fixture", 1, true)
        val board = AchievementBoard(listOf(AchievementStatus(definition, "barebow", 1, award)), listOf(award), setOf("barebow"))
        var opened: String? = null
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                FableTheme(UserSettings(animations = false)) {
                    Surface { AchievementsScreen(listOf(source), board = board) { opened = it.id } }
                }
            }
        }
        ui.onNodeWithTag("achievement-RANK05").performScrollTo()
        val layouts = mutableListOf<TextLayoutResult>()
        ui.onNodeWithText(definition.title, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        ui.onNodeWithText(definition.title, useUnmergedTree = true).performTouchInput { click(layouts.single().getBoundingBox(1).center) }
        ui.onNodeWithText(GlossaryRegistry.definitions.getValue("Мерида")).assertIsDisplayed()
        ui.onNodeWithTag("achievement-details").assertDoesNotExist()
        dismissTestSheet(ui)
        ui.onNodeWithTag("achievement-RANK05").performClick()
        ui.onNodeWithTag("achievement-details").performScrollToNode(hasTestTag("achievement-moment-RANK05"))
        val received = Instant.ofEpochMilli(award.earnedAtMs).atZone(ZoneId.systemDefault())
        ui.onNodeWithTag("achievement-moment-RANK05", useUnmergedTree = true)
            .assertTextEquals("Получено · ${received.format(DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm"))}")
        ui.onNodeWithText("Время получения", substring = true).assertDoesNotExist()
        ui.onNodeWithText(notice, substring = true).assertDoesNotExist()
        ui.onNodeWithTag("achievement-details").performScrollToNode(hasTestTag("achievement-source-RANK05"))
        ui.onNodeWithTag("achievement-source-RANK05").assertIsDisplayed().performClick()
        ui.runOnIdle { assertEquals(source.id, opened) }
        ui.onNodeWithTag("achievement-earned-RANK05", useUnmergedTree = true)
            .assertTextEquals("Получено · ${received.format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))}")
        assertTrue(award.description.contains(notice))
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(context.getExternalFilesDir("verification"),"achievements").apply {mkdirs()}
        File(folder,"achievements-large.png").outputStream().use {
            ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)
        }
    }

    @Test fun galleryShowsEarnedNextProgressAndLockedStepsWhileEarnedFilterKeepsFullDetails() {
        val first = AchievementDefinition("UI_FIRST", "Первая ступень", "Уже в коллекции", "Условие первой ступени",
            "ui.volume", AchievementRarity.Common, 10, priority = 1)
        val next = AchievementDefinition("UI_NEXT", "Ближайшая ступень", "Следующая цель", "Нужно 100 новых выстрелов",
            "ui.volume", AchievementRarity.Rare, 100, priority = 2)
        val far = AchievementDefinition("UI_FAR", "Дальняя ступень", "Позже", "Нужно 1000 новых выстрелов",
            "ui.volume", AchievementRarity.Mythic, 1000, priority = 3)
        val award = EarnedAchievement("UI_FIRST:global", first.id, "global", first.title, first.flavor, first.description,
            first.family, first.rarity, first.priority, null, null, null, System.currentTimeMillis(), "fixture", 1, true)
        val board = AchievementBoard(listOf(AchievementStatus(far, "global", 30),
            AchievementStatus(first, "global", 30, award), AchievementStatus(next, "global", 30)), listOf(award))
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Surface { AchievementsScreen(emptyList(), board) {} }
            }
        }
        ui.onNodeWithTag("achievement-UI_FIRST").assertExists()
        ui.onNodeWithTag("achievement-next-UI_NEXT", useUnmergedTree = true).assertExists()
        ui.onNodeWithText("Следующая ступень · В процессе").assertExists()
        ui.onNodeWithText("Прогресс: 30 / 100").assertExists()
        ui.onNodeWithTag("achievement-locked-UI_FAR", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("Закрыто · позже · Мифическое").assertExists()
        ui.onNodeWithTag("achievements-screen").performScrollToNode(hasTestTag("achievement-UI_FIRST"))
        ui.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val folder = File(instrumentation.targetContext.getExternalFilesDir("verification"), "achievements-v171").apply { mkdirs() }
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            File(folder, "gallery.png").outputStream().use { output ->
                assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output))
            }
        } finally { bitmap.recycle() }
        ui.onNodeWithTag("achievements-screen").performScrollToIndex(0)
        ui.onNodeWithTag("achievements-earned").performClick()
        ui.onNodeWithTag("achievement-UI_FIRST").assertExists()
        ui.onNodeWithTag("achievement-next-UI_NEXT", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("achievement-locked-UI_FAR", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("achievement-UI_FIRST").performClick()
        ui.onNodeWithTag("achievement-details").performScrollToNode(hasTestTag("achievement-detail-UI_NEXT"))
        ui.onNodeWithTag("achievement-detail-UI_NEXT").assertIsDisplayed()
        ui.onNodeWithText("В процессе").assertExists()
        ui.onNodeWithTag("achievement-details").performScrollToNode(hasTestTag("achievement-detail-UI_FAR"))
        ui.onNodeWithTag("achievement-detail-UI_FAR").assertIsDisplayed()
        ui.onNodeWithText("Закрыто · позже · Мифическое").assertExists()
    }
}

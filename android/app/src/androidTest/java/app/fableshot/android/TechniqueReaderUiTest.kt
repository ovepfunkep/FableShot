package app.fableshot.android

import androidx.compose.material3.Surface
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.UserSettings
import app.fableshot.android.technique.*
import app.fableshot.android.ui.FableTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TechniqueReaderUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    @Test fun readerNumbersEverySubpointAndKeepsOriginalIndicesInCompactMode() {
        val text = TechniqueText(title = "Памятка", phases = listOf(
            TechniquePhase(title = "Подготовка", steps = listOf(
                TechniqueStep(short = "Стойка", detail = "Первое\n\nВторое", children = "Третье\nЧетвёртое"),
                TechniqueStep(short = "Скрытый пункт", visible = false), TechniqueStep(short = "Завершить"))),
            TechniquePhase(title = "Выполнение", steps = listOf(TechniqueStep(short = "Поднять лук", children = "Пятый подпункт"))),
        ))
        val raw = text.json()
        val version = TechniqueVersion("numbered-version", "document", 1, 1, raw)
        ui.setContent { FableTheme(UserSettings(animations = false)) {
            Surface { TechniqueReader(version, onBack = {}, onApply = null, onRestore = null) }
        } }
        ui.onNodeWithText("1. Подготовка").assertExists()
        ui.onNodeWithText("1.1 Стойка").assertExists()
        listOf("1.1.1 Первое", "1.1.2 Второе", "1.1.3 Третье", "1.1.4 Четвёртое", "2.1.1 Пятый подпункт")
            .forEach { ui.onNodeWithText(it).assertExists() }
        ui.onNodeWithText("На тренировке · кратко").performClick()
        ui.onNodeWithText("1.1 Стойка").assertExists()
        ui.onNodeWithText("1.2 Скрытый пункт").assertDoesNotExist()
        ui.onNodeWithText("1.3 Завершить").assertExists()
        ui.onNodeWithText("1.1.1 Первое").assertDoesNotExist()
        ui.onNodeWithText("Следующая фаза").performScrollTo().performClick()
        ui.onNodeWithText("2. Выполнение").assertExists()
        ui.onNodeWithText("2.1 Поднять лук").assertExists()
        assertEquals(raw, version.payloadJson)
        assertEquals(text, TechniqueText.parse(raw))
    }
}

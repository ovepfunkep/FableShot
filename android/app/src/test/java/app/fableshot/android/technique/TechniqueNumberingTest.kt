package app.fableshot.android.technique

import org.junit.Assert.*
import org.junit.Test

class TechniqueNumberingTest {
    @Test fun everyNonblankDetailAndChildLineGetsOneConsecutiveSubpoint() {
        val step = TechniqueStep(short = "Стойка", detail = "Первое\n\nВторое\r\n ", children = "Третье\nЧетвёртое")
        assertEquals("2.3 Стойка", techniqueStepLabel(step, 2, 3))
        assertEquals(listOf("2.3.1 Первое", "2.3.2 Второе", "2.3.3 Третье", "2.3.4 Четвёртое"),
            techniqueSubpoints(step, 2, 3))
        assertEquals("Первое\n\nВторое\r\n ", step.detail)
        assertEquals("Третье\nЧетвёртое", step.children)
    }

    @Test fun displayPreservesAuthoredMeasurementsAndNumberLikeContent() {
        val step = TechniqueStep(short = "2.5 см", detail = "1.2.3 данные\n- Второе", children = "3) Третье")
        assertEquals("3.4 2.5 см", techniqueStepLabel(step, 3, 4))
        assertEquals(listOf("3.4.1 1.2.3 данные", "3.4.2 - Второе", "3.4.3 3) Третье"),
            techniqueSubpoints(step, 3, 4))
        assertEquals("2.5 см", step.short)
        assertEquals("1.2.3 данные\n- Второе", step.detail)
        assertEquals("2.5 см", techniqueListContent(" 2.5 см "))
        assertEquals("1.2.3 данные", techniqueListContent("1.2.3 данные"))
    }
}

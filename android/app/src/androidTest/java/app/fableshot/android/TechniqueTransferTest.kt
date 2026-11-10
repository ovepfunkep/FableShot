package app.fableshot.android

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.core.content.FileProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.export.TechniquePdf
import app.fableshot.android.technique.*
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File

class TechniqueTransferTest {
    private val text = TechniqueText(title = "Моя техника", context = "Баребоу", description = "Личная памятка",
        phases = listOf(TechniquePhase(id = "phase", title = "Подготовка", steps = listOf(
            TechniqueStep(id = "step", short = "Стойка", detail = "Спокойно встать", children = "Стопы\nПлечи",
                visible = false, question = "Проверить локоть")))), discussed = "2026-11-05", change = "Уточнил с тренером")

    @Test fun jsonRoundTripKeepsEveryAuthoredFieldAndRejectsInvalidInputWithoutDefaults() {
        assertEquals(text, TechniqueTransfer.decode(text.json()))
        assertEquals(text, TechniqueTransfer.read(ByteArrayInputStream(("\uFEFF" + text.json()).toByteArray())))
        listOf("", "{\"schema\":9}", text.json().replace("\"schema\":1", "\"schema\":999")).forEach { invalid ->
            try { TechniqueTransfer.decode(invalid); fail("Accepted invalid memo") } catch (_: Exception) { }
        }
        try { TechniqueTransfer.read(ByteArrayInputStream(ByteArray(TechniqueTransfer.MAX_BYTES + 1) { 65 })); fail("Accepted large file") }
        catch (_: IllegalArgumentException) { }
        try { TechniqueTransfer.read(ByteArrayInputStream(byteArrayOf(0xC3.toByte(), 0x28))); fail("Accepted invalid UTF-8") }
        catch (_: java.nio.charset.CharacterCodingException) { }
    }

    @Test fun pastedTextCreatesReadablePhasesAndPreservesLongTextWithoutSilentTruncation() {
        val decoded = TechniqueTransfer.fromText("# Моя памятка\n## Стойка\n1. Встать\nПояснение\n2. Поднять лук\n\n## Выпуск\n- Отпустить\nПроверить движение")
        assertEquals("Моя памятка", decoded.title)
        assertEquals(listOf("Стойка", "Выпуск"), decoded.phases.map { it.title })
        assertEquals(listOf("Встать", "Поднять лук"), decoded.phases.first().steps.map { it.short })
        assertEquals("Пояснение", decoded.phases.first().steps.first().detail)
        val long = "Очень длинный пункт ".repeat(20)
        val longStep = TechniqueTransfer.fromText(long).phases.single().steps.single()
        assertEquals("", longStep.short)
        assertEquals(long.trim(), longStep.detail)
        try { TechniqueTransfer.fromText("x".repeat(4001)); fail("Truncated long step") } catch (_: IllegalArgumentException) { }
        val exported = TechniqueTransfer.plainText(text)
        for (field in listOf("Стойка", "Спокойно встать", "Стопы", "Плечи", "Проверить локоть", "Уточнил с тренером")) assertTrue(exported.contains(field))
    }

    @Test fun hierarchicalTextRoundTripsWithoutDuplicatingNumbersOrCreatingPhantomSteps() {
        val source = text.copy(phases = text.phases + TechniquePhase(title = "Выполнение", steps = listOf(
            TechniqueStep(short = "Поднять лук", detail = "Первая строка\n\nВторая строка", children = "Подпункт"))))
        val rawJson = source.json()
        val exported = TechniqueTransfer.plainText(source)
        assertTrue(exported.contains("## 1. Подготовка\n1.1. Стойка\n1.1.1. Спокойно встать\n1.1.2. Стопы\n1.1.3. Плечи"))
        assertTrue(exported.contains("## 2. Выполнение\n2.1. Поднять лук\n2.1.1. Первая строка\n2.1.2. Вторая строка\n2.1.3. Подпункт"))
        var decoded = TechniqueTransfer.fromText(exported)
        repeat(3) {
            assertEquals(exported, TechniqueTransfer.plainText(decoded))
            assertEquals(listOf(1, 1), decoded.phases.map { phase -> phase.steps.size })
            assertEquals("Проверить локоть", decoded.phases.first().steps.single().question)
            assertFalse(decoded.phases.first().steps.single().visible)
            decoded = TechniqueTransfer.fromText(TechniqueTransfer.plainText(decoded))
        }
        assertEquals(rawJson, source.json())
        assertEquals(source, TechniqueTransfer.decode(rawJson))
    }

    @Test fun measurementsAndNumberLikeAuthoredTextSurviveThreeTextTransfers() {
        val source = text.copy(phases = listOf(TechniquePhase(title = "2.5 см", steps = listOf(
            TechniqueStep(short = "2.5 см", detail = "1.2.3 данные\n2.5 см",
                children = "1.2.3. данные\n3) подпункт")))))
        val rawJson = source.json()
        val exported = TechniqueTransfer.plainText(source)
        assertTrue(exported.contains("## 1. 2.5 см\n1.1. 2.5 см\n1.1.1. 1.2.3 данные\n1.1.2. 2.5 см"))
        var decoded = source
        repeat(3) {
            decoded = TechniqueTransfer.fromText(TechniqueTransfer.plainText(decoded))
            assertEquals(exported, TechniqueTransfer.plainText(decoded))
            assertEquals("2.5 см", decoded.phases.single().title)
            val step = decoded.phases.single().steps.single()
            assertEquals("2.5 см", step.short)
            assertEquals("1.2.3 данные\n2.5 см\n1.2.3. данные\n3) подпункт", step.detail)
        }
        assertEquals(rawJson, source.json())
        assertEquals(source, TechniqueTransfer.decode(rawJson))
        val pasted = TechniqueTransfer.fromText("# Размеры\n## 2.5 см\n2.5 см\n1.2.3 данные")
        assertEquals("2.5 см", pasted.phases.single().title)
        assertEquals("2.5 см", pasted.phases.single().steps.single().short)
        assertEquals("1.2.3 данные", pasted.phases.single().steps.single().detail)
    }

    @Test fun textRoundTripAcceptsBothFullSizedExplanationFieldsWithoutTruncatingThem() {
        val source = text.copy(phases = listOf(TechniquePhase(title = "Подготовка", steps = listOf(
            TechniqueStep(short = "Стойка", detail = "а".repeat(4000), children = "б".repeat(4000))))))
        val exported = TechniqueTransfer.plainText(source)
        val decoded = TechniqueTransfer.fromText(exported)
        assertEquals(exported, TechniqueTransfer.plainText(decoded))
        assertEquals(4000, decoded.phases.single().steps.single().detail.length)
        assertEquals(4000, decoded.phases.single().steps.single().children.length)
    }

    @Test fun fullExplanationPdfUsesReadableA4PagesAndExistingScopedProvider() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val long = text.copy(phases = List(6) { phase -> TechniquePhase(id = "phase-$phase", title = "Фаза ${phase + 1}",
            steps = List(8) { index -> text.phases.single().steps.single().copy(id = "step-$phase-$index",
                detail = "Подробное пояснение движения. Спокойно выполняем свой алгоритм, замечаем положение тела. ".repeat(6)) }) })
        val file = TechniquePdf.create(File(context.cacheDir, "reports"), long, "Версия 1",
            context.resources.getFont(R.font.manrope_400), context.resources.getFont(R.font.manrope_700))
        try {
            assertTrue(file.length() > 1000)
            val uri = FileProvider.getUriForFile(context, context.packageName + ".reports", file)
            assertTrue(context.contentResolver.openInputStream(uri)!!.use { it.read() } >= 0)
            PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { renderer ->
                assertTrue(renderer.pageCount > 2)
                renderer.openPage(0).use { page ->
                    assertEquals(595, page.width); assertEquals(842, page.height)
                    val bitmap = Bitmap.createBitmap(595, 842, Bitmap.Config.ARGB_8888)
                    try {
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        assertNotEquals(Color.TRANSPARENT, bitmap.getPixel(10, 10))
                        val folder = File(context.getExternalFilesDir("verification"), "technique-0.28.0").apply { mkdirs() }
                        File(folder, "memo-preview.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                        file.copyTo(File(folder, "memo-example.pdf"), overwrite = true)
                    } finally { bitmap.recycle() }
                }
            }
        } finally { file.delete() }
    }
}

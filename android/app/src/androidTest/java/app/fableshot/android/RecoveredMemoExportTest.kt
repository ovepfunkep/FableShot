package app.fableshot.android

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.export.TechniquePdf
import app.fableshot.android.technique.TechniqueText
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Optional local recovery input, explicitly pushed by the owner; never reads a live diary. */
class RecoveredMemoExportTest {
    @Test fun recoveredOwnerMemoParsesAndProducesCompleteReadablePdf() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.getExternalFilesDir("verification"), "owner-memo").apply { mkdirs() }
        val source = File(directory, "memo.json")
        assumeTrue("Local owner recovery input not staged", source.isFile)
        val memo = TechniqueText.parse(source.readText(Charsets.UTF_8), allowDraft = true)
        assertEquals(4, memo.phases.size)
        assertEquals(12, memo.phases.sumOf { it.steps.size })
        val file = TechniquePdf.create(directory, memo, "Восстановлено из скриншота 5 ноября 2026",
            context.resources.getFont(R.font.manrope_400), context.resources.getFont(R.font.manrope_700))
        file.copyTo(File(directory, "FableShot-моя-памятка.pdf"), overwrite = true)
        PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { renderer ->
            assertTrue(renderer.pageCount >= 1)
            repeat(renderer.pageCount) { index -> renderer.openPage(index).use { page ->
                val bitmap = Bitmap.createBitmap(page.width * 2, page.height * 2, Bitmap.Config.ARGB_8888)
                try {
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    File(directory, "page-${index + 1}.png").outputStream().use {
                        assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
                    }
                } finally { bitmap.recycle() }
            } }
        }
        file.delete()
    }
}

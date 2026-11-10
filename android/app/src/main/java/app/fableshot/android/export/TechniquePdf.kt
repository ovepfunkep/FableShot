package app.fableshot.android.export

import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import app.fableshot.android.technique.TechniqueText
import app.fableshot.android.technique.techniqueListContent
import app.fableshot.android.technique.techniqueStepLabel
import app.fableshot.android.technique.techniqueSubpoints
import java.io.File
import java.util.UUID

/** A4 reading copy with full explanations. It does not modify or publish the source memo. */
object TechniquePdf {
    fun create(directory: File, text: TechniqueText, versionLabel: String? = null,
        regular: Typeface = Typeface.DEFAULT, bold: Typeface = Typeface.DEFAULT_BOLD): File {
        TechniqueText.parse(text.json(), allowDraft = true)
        check(directory.isDirectory || directory.mkdirs())
        val output = File(directory, "FableShot-памятка-${UUID.randomUUID()}.pdf")
        val pdf = PdfDocument()
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        var page: PdfDocument.Page? = null
        var y = 0f
        var number = 0
        fun startPage() {
            page?.let(pdf::finishPage)
            number++
            page = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, number).create())
            val canvas = page!!.canvas
            canvas.drawColor(Color.WHITE)
            paint.typeface = bold; paint.textSize = 9f; paint.color = Color.rgb(77, 99, 45)
            canvas.drawText("FABLESHOT  /  МОЯ ТЕХНИКА", 42f, 28f, paint)
            paint.typeface = regular; paint.color = Color.GRAY
            canvas.drawText(number.toString(), 540f, 816f, paint)
            y = 58f
        }
        fun room(height: Float) { if (page == null || y + height > 785f) startPage() }
        fun paragraph(raw: String, size: Float = 11f, heavy: Boolean = false, indent: Float = 0f,
            color: Int = Color.rgb(26, 36, 30)) {
            raw.lines().forEach { source ->
                var rest = source.trim()
                if (rest.isEmpty()) { room(7f); y += 7f }
                while (rest.isNotEmpty()) {
                    paint.typeface = if (heavy) bold else regular; paint.textSize = size
                    var length = paint.breakText(rest, true, 511f - indent, null).coerceAtLeast(1)
                    if (length < rest.length) rest.lastIndexOf(' ', length - 1).takeIf { it > 0 }?.let { length = it }
                    room(size + 6f)
                    paint.typeface = if (heavy) bold else regular; paint.textSize = size; paint.color = color
                    page!!.canvas.drawText(rest.take(length), 42f + indent, y, paint)
                    y += size + 5f
                    rest = rest.drop(length).trimStart()
                }
            }
            y += 5f
        }
        try {
            startPage()
            paragraph(text.title.ifBlank { "Моя памятка" }, 24f, true)
            versionLabel?.let { paragraph(it, 9f, color = Color.GRAY) }
            if (text.context.isNotBlank()) paragraph(text.context, 11f, true)
            if (text.description.isNotBlank()) paragraph(text.description)
            text.phases.forEachIndexed { phaseIndex, phase ->
                room(80f)
                y += 10f
                paint.color = Color.rgb(198, 244, 61)
                page!!.canvas.drawRoundRect(42f, y - 16f, 47f, y + 8f, 2f, 2f, paint)
                val phaseNumber = phaseIndex + 1
                paragraph("$phaseNumber. ${techniqueListContent(phase.title).ifBlank { "Фаза" }}", 14f, true, 8f)
                y += 7f
                phase.steps.forEachIndexed { index, step ->
                    room(50f)
                    paragraph(techniqueStepLabel(step, phaseNumber, index + 1), 12f, true)
                    techniqueSubpoints(step, phaseNumber, index + 1).forEach { paragraph(it, indent = 16f) }
                    if (step.question.isNotBlank()) paragraph("Уточнить с тренером: ${step.question}", 10f, indent = 16f,
                        color = Color.rgb(112, 72, 32))
                    y += 8f
                }
            }
            if (text.discussed != null || text.change.isNotBlank()) {
                room(60f)
                text.discussed?.let { paragraph("Обсуждал с тренером: $it · личная отметка", 9f, color = Color.GRAY) }
                if (text.change.isNotBlank()) paragraph("Изменения версии: ${text.change}", 9f, color = Color.GRAY)
            }
            page?.let(pdf::finishPage); page = null
            output.outputStream().use(pdf::writeTo)
            return output
        } catch (error: Exception) { output.delete(); throw error }
        finally { page?.let(pdf::finishPage); pdf.close() }
    }
}

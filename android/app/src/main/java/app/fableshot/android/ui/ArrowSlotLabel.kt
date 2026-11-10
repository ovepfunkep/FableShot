package app.fableshot.android.ui

import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** The result is primary; the slot number remains a quiet visual and accessible locator. */
@Composable
internal fun ArrowSlotLabel(number: Int, result: String, physicalArrowNumber: Int? = null) {
    val tint = MaterialTheme.colorScheme.onSurface.copy(alpha = .12f)
    val paint = remember { Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD) } }
    Box(Modifier.fillMaxSize().clearAndSetSemantics {
        text = AnnotatedString("$number · $result" + (physicalArrowNumber?.let { " · физическая стрела №$it" } ?: ""))
    }) {
        Canvas(Modifier.fillMaxSize()) {
            val label = number.toString()
            val bounds = Rect()
            paint.color = tint.toArgb()
            paint.textSize = size.height
            paint.getTextBounds(label, 0, label.length, bounds)
            if (bounds.height() > 0) {
                // Fit the actual glyph, rather than its line box, to the slot's physical height.
                paint.textSize *= (size.height - 4.dp.toPx()).coerceAtLeast(0f) / bounds.height()
                paint.getTextBounds(label, 0, label.length, bounds)
                val baseline = (size.height - bounds.height()) / 2 - bounds.top
                drawIntoCanvas { it.nativeCanvas.drawText(label, -4.dp.toPx() - bounds.left, baseline, paint) }
            }
        }
        Text(result, Modifier.align(Alignment.Center), style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false)
        if (physicalArrowNumber != null) Text("№$physicalArrowNumber",
            Modifier.align(Alignment.TopEnd).padding(top = 2.dp), style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false)
    }
}

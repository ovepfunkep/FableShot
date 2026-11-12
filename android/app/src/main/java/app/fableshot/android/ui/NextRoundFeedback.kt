package app.fableshot.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

/** Draws inside the existing action bounds; a new tap replaces the previous pulse. */
@Composable
internal fun nextRoundFeedback(endId: String, pulseKey: Int): Modifier {
    val visuals = LocalFableVisuals.current
    val strength = remember(endId) { Animatable(0f) }
    LaunchedEffect(endId, pulseKey, visuals.motion) {
        strength.snapTo(0f)
        if (pulseKey > 0 && visuals.motion) {
            strength.animateTo(1f, tween(80))
            strength.animateTo(0f, tween(520))
        }
    }
    val visible by remember(endId) { derivedStateOf { strength.value > .01f } }
    return Modifier.semantics {
        if (visible) stateDescription = "Подсказка: следующий раунд"
    }.drawWithContent {
        drawContent()
        val alpha = strength.value
        if (alpha > 0f) {
            val inset = 3.dp.toPx()
            val borderSize = Size((size.width - inset * 2).coerceAtLeast(0f), (size.height - inset * 2).coerceAtLeast(0f))
            val radius = CornerRadius(15.dp.toPx())
            drawRoundRect(visuals.action.copy(alpha=.24f * alpha), Offset(inset,inset), borderSize, radius,
                style=Stroke(6.dp.toPx()))
            drawRoundRect(visuals.onAction.copy(alpha=.9f * alpha), Offset(inset,inset), borderSize, radius,
                style=Stroke(2.dp.toPx()))
        }
    }
}

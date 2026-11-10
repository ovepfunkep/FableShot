package app.fableshot.android.ui

import androidx.compose.animation.core.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance

/** Only the active arrow pulses; database busy state never changes its appearance. */
@Composable
internal fun arrowOutlineColor(entered: Boolean, entering: Boolean): Color {
    val light = if (MaterialTheme.colorScheme.surface.luminance() < .5f) Color(0xFFD5D8D6) else Color(0xFFA7AFAA)
    val grey = Color(0xFF65716A)
    if (!entering) return if (entered) light else grey
    if (!LocalFableVisuals.current.motion) return light
    val transition = rememberInfiniteTransition(label = "active arrow")
    val strength by transition.animateFloat(
        initialValue = .45f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(850), RepeatMode.Reverse), label = "arrow outline",
    )
    return lerp(grey, light, strength)
}

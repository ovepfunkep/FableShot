package app.fableshot.android.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.sp

/** Only the value moves; its measured row and accessibility value remain stable. */
@Composable
fun SlidingValue(
    value: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.labelLarge,
    color: Color = MaterialTheme.colorScheme.onSurface,
    alignment: Alignment = Alignment.CenterStart,
    byCharacter: Boolean = false,
) {
    val motion = LocalFableVisuals.current.motion
    val height = with(LocalDensity.current) { style.lineHeight.toDp() }
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val separator = value.indexOf(": ")
    val prefix = if (separator >= 0) value.substring(0, separator + 2) else ""
    val number = value.removePrefix(prefix)
    BoxWithConstraints(modifier.height(height).clipToBounds().clearAndSetSemantics { text = androidx.compose.ui.text.AnnotatedString(value) }, contentAlignment = alignment) {
        val available = constraints.maxWidth
        val fittedStyle = remember(value, style, available, density.fontScale) {
            val fittingText = if (byCharacter) value.map {if(it.isDigit()) '8' else it}.joinToString("") else value
            val measured = measurer.measure(fittingText, style = style, maxLines = 1, softWrap = false).size.width
            if (constraints.hasBoundedWidth && measured > available && measured > 0)
                style.copy(fontSize = (style.fontSize.value * (available - 2).coerceAtLeast(0) / measured).coerceAtLeast(4f).sp)
            else style
        }
        @Composable fun Moving(text: String) {
            AnimatedContent(text, transitionSpec = {
                val duration = if (motion) VALUE_MOTION_MILLIS else 0
                (slideInVertically(tween(duration)) { if (motion) it / 2 else 0 } + fadeIn(tween(duration)))
                    .togetherWith(slideOutVertically(tween(duration)) { if (motion) -it / 2 else 0 } + fadeOut(tween(duration)))
                    .using(null)
            }, label = "value") { text ->
                androidx.compose.material3.Text(text, style = fittedStyle, color = color, maxLines = 1, softWrap = false)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (byCharacter) {
                val digitWidth = remember(fittedStyle, density) {(0..9).maxOf {measurer.measure(it.toString(), fittedStyle, maxLines=1).size.width}}
                value.forEachIndexed {index, char -> key(index) {
                    if (char.isDigit()) Box(Modifier.width(with(density) {digitWidth.toDp()}), contentAlignment=Alignment.Center) {Moving(char.toString())}
                    else androidx.compose.material3.Text(char.toString(),style=fittedStyle,color=color,maxLines=1,softWrap=false)
                }}
            } else {
                if (prefix.isNotEmpty()) androidx.compose.material3.Text(prefix, style=fittedStyle,color=color,maxLines=1,softWrap=false)
                Moving(number)
            }
        }
    }
}

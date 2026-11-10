package app.fableshot.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** A1 feedback follows newly committed arrows, never a reopening of an old end. */
@Composable
fun tenChainFeedback(endId: String, points: List<Int>, index: Int, enabled: Boolean = true): Modifier {
    val motion = LocalFableVisuals.current.motion && enabled
    var seen by rememberSaveable(endId) { mutableIntStateOf(points.size) }
    val phase = remember(endId) { Animatable(1f) }
    val chain = points.takeWhile { it == 10 }.size
    val active = chain > 0 && chain == points.size
    LaunchedEffect(points.size, chain, motion) {
        val added = points.size > seen
        seen = points.size
        if (!motion || !active) phase.snapTo(1f)
        else if (added && chain <= 3) {
            phase.snapTo(0f)
            phase.animateTo(1f, tween(if(chain==1)900 else if(chain==2)650 else 1000))
        }
    }
    return Modifier.drawWithContent {
        drawContent()
        if (!motion || !active) return@drawWithContent
        val progress = phase.value
        if(chain==3 && index<3 && progress<1f) {
            val gold=Color(0xFFFFD882).copy(alpha=1f-progress)
            for(i in 0..7) {
                val angle=i*PI/4
                val distance=size.minDimension*(.1f+.4f*progress)
                drawCircle(gold,4f*(1f-progress),Offset(size.width/2+cos(angle).toFloat()*distance,size.height/2+sin(angle).toFloat()*distance))
            }
        }
    }
}

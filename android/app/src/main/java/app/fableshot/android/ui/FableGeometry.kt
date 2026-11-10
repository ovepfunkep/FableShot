package app.fableshot.android.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.currentCompositeKeyHash
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.DesignStyle

enum class GeometryPattern { Orbit, Cluster, Satellites, WideArcs, Constellation, OffsetRings }

/** Stable seeds vary decoration without random changes on recomposition. */
@Composable
fun Modifier.fableGeometry(
    style: DesignStyle = LocalFableVisuals.current.style,
    compact: Boolean = false,
    pattern: GeometryPattern? = null,
    seed: String? = null,
    tint: Color = MaterialTheme.colorScheme.primary,
): Modifier {
    val accent = tint
    val selected = pattern ?: GeometryPattern.entries[Math.floorMod(seed?.hashCode() ?: currentCompositeKeyHash, GeometryPattern.entries.size)]
    val opacity = if (style == DesignStyle.Minimal) .032f else .06f
    return drawBehind {
        clipRect {
            val stroke = Stroke(1.dp.toPx())
            val color = accent.copy(alpha = opacity)
            val unit = size.width * if (compact) .24f else .34f
            fun rings(x: Float, y: Float, radius: Float, count: Int = 3) {
                for (i in 1..count) drawCircle(color, radius * i / count, Offset(size.width*x,size.height*y), style=stroke)
            }
            when (selected) {
                GeometryPattern.Orbit -> {
                    rings(.9f,.15f,unit*2.1f)
                    rings(.12f,.86f,unit*.55f,2)
                    drawLine(color,Offset(size.width*.12f,size.height),Offset(size.width*.85f,0f),stroke.width)
                }
                GeometryPattern.Cluster -> {
                    rings(.2f,.7f,unit*1.2f,2)
                    rings(.65f,.8f,unit*.8f,2)
                    rings(.85f,.13f,unit*.36f,2)
                }
                GeometryPattern.Satellites -> {
                    rings(.78f,.45f,unit*1.5f,2)
                    listOf(.12f to .15f,.25f to .8f,.7f to .95f).forEach { (x,y) -> rings(x,y,unit*.22f,2) }
                }
                GeometryPattern.WideArcs -> {
                    rings(-.05f,.6f,unit*3.5f,4)
                    rings(.9f,.9f,unit*.5f,2)
                }
                GeometryPattern.Constellation -> {
                    val points=listOf(.1f to .2f,.45f to .1f,.82f to .4f,.65f to .85f,.15f to .75f)
                    points.zipWithNext().forEach { (a,b) ->
                        drawLine(color,Offset(size.width*a.first,size.height*a.second),Offset(size.width*b.first,size.height*b.second),stroke.width)
                    }
                    points.forEachIndexed { i,(x,y) -> rings(x,y,unit*(.15f+i*.04f),2) }
                }
                GeometryPattern.OffsetRings -> {
                    rings(.1f,.95f,unit*2.4f,3)
                    rings(.95f,.12f,unit*.9f,3)
                    rings(.55f,.55f,unit*.18f,1)
                }
            }
        }
    }
}

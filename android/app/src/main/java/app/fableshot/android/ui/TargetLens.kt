package app.fableshot.android.ui

import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.*
import app.fableshot.android.R
import app.fableshot.android.data.ShotEntity
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.domain.TargetScoring
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.domain.TargetProfile
import kotlin.math.roundToInt

internal data class TargetLensFrame(
    val owner: Any,
    val fingerInWindow: Offset,
    val point: TargetPoint,
    val radius: Float,
    val shots: List<ShotEntity>,
    val selected: String?,
    val numberTypeface: Typeface?,
    val profile:TargetProfile=TargetCatalog.practice,
    val shaftDiameterMm: Double = 6.0,
    val targetDiameterMm: Int = 400,
)

@Stable
internal class TargetLensState { var frame by mutableStateOf<TargetLensFrame?>(null) }
internal val LocalTargetLens = staticCompositionLocalOf<TargetLensState?> { null }

/** A drawing overlay in the same window: no Popup or input surface to steal a second finger. */
@Composable
fun TargetOverlayHost(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val state = remember { TargetLensState() }
    var origin by remember { mutableStateOf(Offset.Zero) }
    var hostSize by remember { mutableStateOf(IntSize.Zero) }
    val density = LocalDensity.current
    val scoreStyle = MaterialTheme.typography.titleMedium
    val measurer = rememberTextMeasurer()
    val scoreWidth = with(density) {
        measurer.measure("10", scoreStyle, maxLines = 1).size.width.toDp() + 8.dp
    }.coerceAtLeast(42.dp)
    val headerWidth = (scoreWidth + 25.dp + 26.dp).coerceAtLeast(112.dp)
    val headerHeight = with(density) { scoreStyle.lineHeight.toDp() + 8.dp }.coerceAtLeast(36.dp)
    CompositionLocalProvider(LocalTargetLens provides state) {
        Box(modifier.onGloballyPositioned { origin = it.positionInWindow(); hostSize = it.size }) {
            content()
            state.frame?.let { frame ->
                val lens = with(density) { headerWidth.toPx() }
                val height = with(density) { (112.dp + headerHeight).toPx() }
                val gap = with(density) { 28.dp.toPx() }
                val finger = frame.fingerInWindow - origin
                val left = (finger.x - lens / 2).coerceIn(0f, (hostSize.width - lens).coerceAtLeast(0f))
                // Clamp only at the window top. Never flip below the finger or clip to the board.
                val top = (finger.y - gap - height).coerceAtLeast(0f)
                Column(Modifier.offset { IntOffset(left.roundToInt(), top.roundToInt()) }.width(headerWidth), horizontalAlignment = Alignment.CenterHorizontally) {
                    val score = frame.profile.scoreShaft(frame.point, frame.shaftDiameterMm, frame.targetDiameterMm)
                    val zoneColor = zoneFill(score.points)
                    val inner = score.code == "X" || score.points > 0 && score.points % 2 == 0
                    Row(Modifier.width(headerWidth).height(headerHeight).testTag("magnifier-zone").background(Color(0xFF152016), RoundedCornerShape(18.dp))
                        .padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center) {
                        Text(
                            text = score.code,
                            modifier = Modifier.width(scoreWidth),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            color = zoneColor,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        if (score.points > 0) Canvas(Modifier.size(25.dp).semantics {
                            contentDescription = if (inner) "Внутреннее кольцо цвета" else "Внешнее кольцо цвета"
                        }.testTag(if (inner) "magnifier-inner-zone" else "magnifier-outer-zone")) {
                            val radius = size.minDimension / 2 - 1.dp.toPx()
                            drawCircle(zoneColor.copy(alpha = if (inner) .2f else .9f), radius)
                            drawCircle(Color(0xFF152016), radius * .57f)
                            drawCircle(zoneColor.copy(alpha = if (inner) .95f else .2f), radius * .52f)
                            drawCircle(Color.White.copy(alpha = .9f), if (inner) radius * .52f else radius,
                                style = Stroke(1.3.dp.toPx()))
                        }
                    }
                    Box(Modifier.size(112.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface).border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape).testTag("magnifier")) {
                        Canvas(Modifier.fillMaxSize()) {
                            val center = Offset(size.width / 2, size.height / 2) - Offset((frame.point.x * frame.radius).toFloat(), (-frame.point.y * frame.radius).toFloat())
                            drawTargetFace(center, frame.radius, frame.shots, frame.selected, frame.point, frame.numberTypeface,frame.profile,
                                frame.radius * (frame.shaftDiameterMm / frame.targetDiameterMm).toFloat())
                        }
                    }
                }
            }
        }
    }
}

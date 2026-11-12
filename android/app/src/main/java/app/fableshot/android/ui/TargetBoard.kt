package app.fableshot.android.ui

import android.graphics.Paint
import android.graphics.Typeface
import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.*
import app.fableshot.android.R
import app.fableshot.android.data.ShotEntity
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.domain.TargetScoring
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.domain.TargetProfile
import kotlin.math.min

private val ringColors = listOf(Color(0xFFF8F8EF), Color(0xFF242A2C), Color(0xFF3295C7), Color(0xFFE44C43), Color(0xFFF4CE44))

internal fun DrawScope.drawTargetFace(center: Offset, radius: Float, shots: List<ShotEntity>, selected: String?, pending: TargetPoint?, numberTypeface: Typeface? = null, profile:TargetProfile = TargetCatalog.practice, pendingShaftRadius: Float? = null) {
    for (zone in profile.zones.asReversed()) {
        drawCircle(ringColors[(zone.points-1)/2], radius * zone.outerRadius.toFloat(), center)
        drawCircle(Color(0xFF30352C), radius * zone.outerRadius.toFloat(), center, style = Stroke(0.65.dp.toPx()))
    }
    drawLine(Color(0xFF51421B), center - Offset(4.dp.toPx(), 0f), center + Offset(4.dp.toPx(), 0f), 1.dp.toPx())
    drawLine(Color(0xFF51421B), center - Offset(0f, 4.dp.toPx()), center + Offset(0f, 4.dp.toPx()), 1.dp.toPx())
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; textSize = min(11.sp.toPx(),12.dp.toPx()); color = android.graphics.Color.WHITE; typeface = numberTypeface ?: Typeface.DEFAULT_BOLD }
    shots.forEach { shot ->
        if (shot.x != null && shot.y != null) {
            val position = center + Offset((shot.x * radius).toFloat(), (-shot.y * radius).toFloat())
            drawCircle(Color(0xFF152210), 9.dp.toPx(), position)
            drawCircle(if (shot.id == selected) Color(0xFFC1F24D) else Color.White, 9.dp.toPx(), position, style = Stroke(2.dp.toPx()))
            drawContext.canvas.nativeCanvas.drawText((shot.inputIndex + 1).toString(), position.x, position.y - (paint.ascent() + paint.descent()) / 2, paint)
        }
    }
    if (pending != null) {
        val p = center + Offset((pending.x * radius).toFloat(), (-pending.y * radius).toFloat())
        if (pendingShaftRadius != null) {
            drawCircle(Color.Black.copy(alpha = .45f), pendingShaftRadius, p)
            drawCircle(Color.White, pendingShaftRadius, p, style = Stroke(1.dp.toPx()))
        } else {
        drawCircle(Color.White, 5.dp.toPx(), p, style = Stroke(2.dp.toPx()))
        drawLine(Color(0xFF14220D), p - Offset(12.dp.toPx(), 0f), p + Offset(12.dp.toPx(), 0f), 3.dp.toPx())
        drawLine(Color.White, p - Offset(10.dp.toPx(), 0f), p + Offset(10.dp.toPx(), 0f), 1.dp.toPx())
        drawLine(Color(0xFF14220D), p - Offset(0f, 12.dp.toPx()), p + Offset(0f, 12.dp.toPx()), 3.dp.toPx())
        drawLine(Color.White, p - Offset(0f, 10.dp.toPx()), p + Offset(0f, 10.dp.toPx()), 1.dp.toPx())
        }
    }
}

@Composable
fun TargetBoard(
    modifier: Modifier,
    sessionId: String,
    endId: String,
    shots: List<ShotEntity>,
    selected: String?,
    inputEnabled: Boolean,
    onPoint: (TargetPoint) -> Unit,
    viewportHeight: Dp = 300.dp,
    profile:TargetProfile = TargetCatalog.practice,
    topContent: (@Composable () -> Unit)? = null,
    bottomContent: (@Composable () -> Unit)? = null,
    panOnly: Boolean = false,
    shaftDiameterMm: Double = 6.0,
    targetDiameterMm: Int = 400,
    onBlockedTap: () -> Unit = {},
) {
    var zoom by remember(sessionId) { mutableFloatStateOf(1f) }
    var pan by remember(sessionId) { mutableStateOf(Offset.Zero) }
    var boardSize by remember { mutableStateOf(IntSize.Zero) }
    var pointer by remember { mutableStateOf<Offset?>(null) }
    var controls by remember { mutableStateOf(Rect.Zero) }
    var sceneOrigin by remember { mutableStateOf(Offset.Zero) }
    var boardOrigin by remember { mutableStateOf(Offset.Zero) }
    var cancelEpoch by remember { mutableIntStateOf(0) }
    var stagePointers by remember { mutableIntStateOf(0) }
    val lens = checkNotNull(LocalTargetLens.current) { "TargetBoard requires TargetOverlayHost" }
    val lensOwner = remember { Any() }
    val context = LocalContext.current
    val numberTypeface = remember(context) { context.resources.getFont(R.font.manrope_700) }
    val latestOnPoint by rememberUpdatedState(onPoint)
    val latestOnBlockedTap by rememberUpdatedState(onBlockedTap)
    val latestShots by rememberUpdatedState(shots)
    val latestSelected by rememberUpdatedState(selected)
    val description = stringResource(R.string.target_touch_description)
    fun normal(position: Offset): TargetPoint {
        val radius = min(boardSize.width, boardSize.height) * .44f * zoom
        val relative = position - Offset(boardSize.width / 2f, boardSize.height / 2f) - pan
        return TargetPoint((relative.x / radius).toDouble(), (-relative.y / radius).toDouble())
    }
    fun scaleTo(value: Float) {
        val next = value.coerceIn(1f, 8f)
        pan = if (next == 1f && !panOnly) Offset.Zero else pan * (next / zoom)
        zoom = next
    }
    LaunchedEffect(pointer, boardOrigin, boardSize, zoom, pan, shots, selected,profile, panOnly, shaftDiameterMm, targetDiameterMm) {
        val position = pointer.takeUnless { panOnly }
        if (position != null && boardSize.width > 0) lens.frame = TargetLensFrame(lensOwner, boardOrigin + position, normal(position), min(boardSize.width, boardSize.height) * .44f * zoom * 2.5f, shots, selected, numberTypeface,profile, shaftDiameterMm, targetDiameterMm)
        else if (lens.frame?.owner === lensOwner) lens.frame = null
    }
    DisposableEffect(lens, lensOwner) { onDispose { if (lens.frame?.owner === lensOwner) lens.frame = null } }
    val drawScene: DrawScope.() -> Unit = {
        val offset = boardOrigin - sceneOrigin
        val center = offset + Offset(boardSize.width / 2f, boardSize.height / 2f) + pan
        drawTargetFace(center, min(boardSize.width, boardSize.height) * .44f * zoom, latestShots, latestSelected, pointer?.takeUnless { panOnly }?.let(::normal), numberTypeface,profile)
    }
    Box(modifier.clipToBounds().onGloballyPositioned { sceneOrigin = it.positionInWindow() }.testTag("target-stage")
        .pointerInput(Unit) {
            // A second finger may land on a glass panel outside the interactive viewport.
            // Observe that common ancestor too, without consuming panel button presses.
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                stagePointers = 1
                var multiple = false
                try {
                    do {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        stagePointers = event.changes.count { it.pressed }
                        if (stagePointers >= 2) {
                            if (!multiple) { cancelEpoch++; multiple = true }
                            pointer = null
                        }
                    } while (stagePointers > 0)
                } finally { stagePointers = 0 }
            }
        }) {
        Canvas(Modifier.matchParentSize().testTag("target-scene"), onDraw = drawScene)
        Column {
            if (topContent != null) TargetGlassPanel(Modifier.fillMaxWidth().testTag("target-top-panel"), sceneOrigin, drawScene, content = topContent)
            Box(Modifier.fillMaxWidth().height(viewportHeight).onSizeChanged { boardSize = it }
                .onGloballyPositioned { boardOrigin = it.positionInWindow() }
                .testTag("target-input").semantics { contentDescription = description }
                // Observe the whole board before its buttons. A second finger on a zoom
                // button must still cancel placement, even after the first finger lifts.
                .pointerInput(endId, selected, inputEnabled, panOnly, profile, shaftDiameterMm, targetDiameterMm) {
                    awaitEachGesture {
                        val first = awaitFirstDown(pass = PointerEventPass.Initial)
                        var last = first.position
                        var transformed = stagePointers >= 2
                        val gestureEpoch = cancelEpoch
                        val startedOnControl = controls.contains(last)
                        val startedAt = SystemClock.uptimeMillis()
                        var aiming = false
                        var movedBeyondTap = false
                        fun inside(position: Offset): Boolean {
                            val point=normal(position)
                            val outer=profile.zones.maxOf { it.outerRadius } + shaftDiameterMm / targetDiameterMm
                            return position.x>=0f && position.y>=0f && position.x<size.width && position.y<size.height && point.x*point.x+point.y*point.y<=outer*outer
                        }
                        val initialPoint=normal(first.position)
                        val outer=profile.zones.maxOf { it.outerRadius } + shaftDiameterMm / targetDiameterMm
                        val startedOnFace=initialPoint.x*initialPoint.x+initialPoint.y*initialPoint.y<=outer*outer
                        if (!startedOnControl && (startedOnFace || panOnly)) first.consume()
                        try {
                            do {
                                val remaining = AIM_PREVIEW_DELAY_MS - (SystemClock.uptimeMillis() - startedAt)
                                val event = if (!panOnly && !aiming && !transformed && !startedOnControl && startedOnFace && inputEnabled) {
                                    if (remaining > 0) withTimeoutOrNull(remaining) { awaitPointerEvent(PointerEventPass.Initial) } else null
                                } else awaitPointerEvent(PointerEventPass.Initial)
                                if (event == null) {
                                    aiming = true
                                    pointer = last.takeIf(::inside)
                                    continue
                                }
                                val pressed = event.changes.count { it.pressed }
                                if (cancelEpoch != gestureEpoch) { transformed = true; pointer = null }
                                // Include newly seen and just-released pointers, not only
                                // the fingers still down in this particular event.
                                if (event.changes.any { it.id != first.id && (it.pressed || it.previousPressed) }) {
                                    transformed = true
                                    pointer = null
                                }
                                if (pressed >= 2) {
                                    val oldZoom = zoom
                                    val next = (oldZoom * event.calculateZoom()).coerceIn(1f, 8f)
                                    val previous = event.calculateCentroid(useCurrent = false)
                                    val current = event.calculateCentroid(useCurrent = true)
                                    val center = Offset(size.width / 2f, size.height / 2f)
                                    if (previous.isSpecified && current.isSpecified) {
                                        val newPan = current - center - (previous - center - pan) * (next / oldZoom)
                                        val limit = min(size.width, size.height) * .44f * next
                                        pan = if (next == 1f && !panOnly) Offset.Zero else Offset(newPan.x.coerceIn(-limit, limit), newPan.y.coerceIn(-limit, limit))
                                    }
                                    zoom = next
                                } else if (!transformed && !startedOnControl && (startedOnFace || panOnly)) {
                                    val change = event.changes.firstOrNull { it.id == first.id }
                                    if (change != null) {
                                        last = change.position
                                        if ((last - first.position).getDistance() > viewConfiguration.touchSlop) movedBeyondTap = true
                                    }
                                    if (panOnly) {
                                        val delta = change?.let { it.position - it.previousPosition } ?: Offset.Zero
                                        val nextPan = pan + delta
                                        val limit = min(size.width, size.height) * .44f * zoom
                                        pan = Offset(nextPan.x.coerceIn(-limit, limit), nextPan.y.coerceIn(-limit, limit))
                                        pointer = null
                                    } else {
                                        if ((change?.uptimeMillis ?: first.uptimeMillis) - first.uptimeMillis >= AIM_PREVIEW_DELAY_MS) aiming = true
                                        pointer = last.takeIf { aiming && inputEnabled && pressed == 1 && inside(it) }
                                    }
                                }
                                if (pressed == 0 && !panOnly && !transformed && !startedOnControl && startedOnFace && boardSize.width > 0 && inside(last)) {
                                    if (inputEnabled) latestOnPoint(normal(last))
                                    else if (!movedBeyondTap) latestOnBlockedTap()
                                }
                                if ((!startedOnControl && (startedOnFace || panOnly)) || transformed) event.changes.forEach { it.consume() }
                                if (pressed == 0) break
                            } while (true)
                        } finally { pointer = null }
                    }
                }) {
        Row(Modifier.align(Alignment.TopEnd).onGloballyPositioned { controls = Rect(it.positionInParent(), it.size.toSize()) }.background(MaterialTheme.colorScheme.surface.copy(alpha = .82f), CircleShape), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { scaleTo(zoom / 1.5f) }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp), enabled = zoom > 1) { Text("−") }
            TextButton(onClick = { pan = Offset.Zero; scaleTo(1f) }, modifier = Modifier.heightIn(min = 48.dp).testTag("target-zoom")) { Text(stringResource(R.string.zoom_value, zoom)) }
            TextButton(onClick = { scaleTo(zoom * 1.5f) }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp), enabled = zoom < 8) { Text("+") }
        }
            }
            if (bottomContent != null) TargetGlassPanel(Modifier.fillMaxWidth().testTag("target-bottom-panel"), sceneOrigin, drawScene, content = bottomContent)
        }
    }
}

private const val AIM_PREVIEW_DELAY_MS = 160L

/** Blur only the sampled target behind a panel; foreground labels and controls stay sharp. */
@Composable
private fun TargetGlassPanel(modifier: Modifier, sceneOrigin: Offset, drawScene: DrawScope.() -> Unit, content: @Composable () -> Unit) {
    var origin by remember { mutableStateOf(Offset.Zero) }
    val tint = MaterialTheme.colorScheme.surface.copy(alpha = .76f)
    Box(modifier.clipToBounds().onGloballyPositioned { origin = it.positionInWindow() }) {
        Canvas(Modifier.matchParentSize().graphicsLayer { renderEffect = BlurEffect(18.dp.toPx(), 18.dp.toPx(), TileMode.Clamp) }) {
            val offset = origin - sceneOrigin
            translate(-offset.x, -offset.y) { drawScene() }
        }
        Box(Modifier.matchParentSize().background(tint))
        content()
    }
}

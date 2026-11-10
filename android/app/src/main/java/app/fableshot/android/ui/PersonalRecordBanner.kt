package app.fableshot.android.ui

import android.view.accessibility.AccessibilityManager
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import app.fableshot.android.data.journal.PersonalRecordEvent
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

@Composable
internal fun PersonalRecordBanner(record: PersonalRecordEvent, onClose: () -> Unit,
    availableSessionIds: Set<String>? = null, onSession: ((String) -> Unit)? = null) {
    val visuals = LocalFableVisuals.current
    val close by rememberUpdatedState(onClose)
    var visible by remember { mutableStateOf(true) }
    var details by remember { mutableStateOf(false) }
    var pressed by remember { mutableStateOf(false) }
    val density = LocalDensity.current
    val top = WindowInsets.statusBars.getTop(density) + with(density) { 8.dp.roundToPx() }
    val windowInfo = LocalWindowInfo.current
    val accessibility = LocalContext.current.getSystemService(AccessibilityManager::class.java)
    val timeout = LocalAccessibilityManager.current?.calculateRecommendedTimeoutMillis(2400, true, true, true) ?: 2400
    val pulse = remember(record.id) { Animatable(if (visuals.motion) 0f else 1f) }

    LaunchedEffect(record.id, visuals.motion) {
        if (visuals.motion) pulse.animateTo(1f, tween(450)) else pulse.snapTo(1f)
    }
    LaunchedEffect(record.id) {
        var remaining = timeout
        while (remaining > 0) {
            delay(100)
            if (!details && !pressed && windowInfo.isWindowFocused && accessibility?.isTouchExplorationEnabled != true) {
                remaining -= 100
            }
        }
        visible = false
    }
    LaunchedEffect(visible) {
        if (!visible) {
            if (visuals.motion) delay(150)
            close()
        }
    }

    Popup(alignment = Alignment.TopCenter, offset = IntOffset(0, top),
        properties = PopupProperties(focusable = false, dismissOnBackPress = false, dismissOnClickOutside = false)) {
        AnimatedVisibility(visible, exit = if (visuals.motion) fadeOut(tween(150)) else ExitTransition.None) {
            Surface(Modifier.padding(horizontal = 16.dp).widthIn(max = 560.dp).fillMaxWidth()
                .testTag("personal-record-banner")
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    customActions = listOf(CustomAccessibilityAction("Скрыть рекорд") { visible = false; true })
                }
                .pointerInput(record.id) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        pressed = true
                        waitForUpOrCancellation()
                        pressed = false
                    }
                }
                .clickable(role = Role.Button, onClickLabel = "Условия рекорда") { details = true },
                shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceVariant,
                border = BorderStroke(1.dp, visuals.gold.copy(alpha = .6f)), shadowElevation = 8.dp) {
                Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                    FableIcon(Glyph.Trophy, tint = visuals.gold)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Личный рекорд", style = MaterialTheme.typography.titleMedium)
                        Text(record.label, style = MaterialTheme.typography.bodySmall,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Row(Modifier.testTag("record-banner-values"), horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(personalRecordValue(record.previousValue), color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.titleMedium, textDecoration = TextDecoration.LineThrough)
                            Text("→", style = MaterialTheme.typography.titleMedium)
                            Text(personalRecordValue(record.value), Modifier.graphicsLayer {
                                val progress = pulse.value
                                val scale = 1f + (sin(progress * PI) * .13).toFloat()
                                scaleX = scale
                                scaleY = scale
                            }.drawBehind {
                                val progress = pulse.value
                                if (visuals.motion && progress < 1f) repeat(5) { index ->
                                    val angle = (index * 63 - 150) * PI / 180
                                    val distance = (9.dp + 14.dp * progress).toPx()
                                    val start = Offset(size.width - 2.dp.toPx(), size.height / 2f)
                                    val point = start + Offset((cos(angle) * distance).toFloat(), (sin(angle) * distance).toFloat())
                                    drawCircle(visuals.gold.copy(alpha = (1f - progress) * .65f), 1.5.dp.toPx(), point)
                                }
                            }, color = visuals.gold, style = MaterialTheme.typography.titleLarge)
                        }
                        Text("Условия рекорда", color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.labelSmall)
                    }
                    IconButton({ visible = false }, Modifier.testTag("record-banner-dismiss")) {
                        FableIcon(Glyph.Close, description = "Скрыть рекорд")
                    }
                }
            }
        }
    }
    if (details) PersonalRecordComparisonSheet(record, {
        details = false
        visible = false
    }, availableSessionIds, onSession)
}

package app.fableshot.android.ui

import android.view.accessibility.AccessibilityManager
import androidx.compose.animation.*
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.fableshot.android.data.journal.PersonalRecordEvent
import app.fableshot.android.domain.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect

private const val ACHIEVEMENT_TIMEOUT_MS = 4_000L
private const val ACHIEVEMENT_TIMER_STEP_MS = 100L

/** Non-focusable overlay: no target movement, no waiting for the user to finish a celebration. */
@Composable
fun AchievementBannerHost(
    awards: List<EarnedAchievement>,
    enabled: Boolean,
    onClaim: suspend (List<String>) -> List<EarnedAchievement>,
    availableSessionIds: Set<String>? = null,
    onSession: (String) -> Unit = {},
    onFailure: (Exception) -> Unit = {},
    recordEvents: List<PersonalRecordEvent> = emptyList(),
    onClaimRecords: suspend (List<String>) -> List<PersonalRecordEvent> = { emptyList() },
    recordsEnabled: Boolean = enabled,
) {
    val owner = LocalLifecycleOwner.current
    var resumed by remember(owner) { mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, _ -> resumed = owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val latestAwards by rememberUpdatedState(awards)
    val latestEnabled by rememberUpdatedState(enabled)
    val claim by rememberUpdatedState(onClaim)
    val failure by rememberUpdatedState(onFailure)
    val latestRecords by rememberUpdatedState(recordEvents)
    val latestRecordsEnabled by rememberUpdatedState(recordsEnabled)
    val claimRecords by rememberUpdatedState(onClaimRecords)
    var waiting by remember { mutableStateOf<List<EarnedAchievement>>(emptyList()) }
    var shown by remember { mutableStateOf<List<EarnedAchievement>>(emptyList()) }
    var recordWaiting by remember { mutableStateOf<List<PersonalRecordEvent>>(emptyList()) }
    var recordShown by remember { mutableStateOf<PersonalRecordEvent?>(null) }
    var attemptedRecords by remember { mutableStateOf<Set<String>>(emptySet()) }
    var claimingRecords by remember { mutableStateOf(false) }
    var visible by remember { mutableStateOf(false) }
    var opened by remember { mutableStateOf<List<EarnedAchievement>?>(null) }
    var pressed by remember { mutableStateOf(false) }
    var dragging by remember { mutableStateOf(false) }
    val windowInfo = LocalWindowInfo.current
    val accessibility = LocalContext.current.getSystemService(AccessibilityManager::class.java)
    val timeout = LocalAccessibilityManager.current
        ?.calculateRecommendedTimeoutMillis(ACHIEVEMENT_TIMEOUT_MS, true, true, true) ?: ACHIEVEMENT_TIMEOUT_MS
    var remainingMs by remember { mutableLongStateOf(timeout) }
    val motion = LocalFableVisuals.current.motion
    val validKeys = remember(awards) { awards.filter { it.valid }.map { it.key }.toSet() }
    val recordKeys = remember(recordEvents) { recordEvents.map { it.id }.toSet() }
    fun dismiss() { visible = false; pressed = false; dragging = false }
    fun recordHasPriority(): Boolean {
        if (!latestRecordsEnabled) return false
        val now = System.currentTimeMillis()
        return claimingRecords || latestRecords.any {
            it.notifiedAtMs == null && it.id !in attemptedRecords && now - it.recordedAtMs in 0..10_000
        }
    }
    fun showNext() {
        if (recordShown != null || opened != null) return
        if (!resumed || recordHasPriority()) {
            shown = emptyList()
            dismiss()
            return
        }
        val currentRecordKeys = latestRecords.map { it.id }.toSet()
        recordWaiting = recordWaiting.filter { it.id in currentRecordKeys }
        recordWaiting.firstOrNull()?.takeIf { latestRecordsEnabled }?.let { next ->
            recordShown = next
            recordWaiting = recordWaiting.drop(1)
            shown = emptyList()
            dismiss()
            return
        }
        if (!latestEnabled) {
            shown = emptyList()
            dismiss()
            return
        }
        val currentKeys = latestAwards.filter { it.valid }.map { it.key }.toSet()
        val next = groupAchievements(waiting.filter { it.key in currentKeys }).firstOrNull()
        shown = next?.let { listOf(it.main) + it.others }.orEmpty()
        val delivered = shown.map { it.key }.toSet()
        waiting = waiting.filter { it.key in currentKeys && it.key !in delivered }
        remainingMs = timeout
        pressed = false
        dragging = false
        visible = shown.isNotEmpty()
    }

    LaunchedEffect(recordKeys) {
        attemptedRecords = attemptedRecords.intersect(recordKeys)
        recordWaiting = recordWaiting.filter { it.id in recordKeys }
        if (recordShown?.id?.let { it !in recordKeys } == true) recordShown = null
    }

    LaunchedEffect(validKeys) {
        waiting = waiting.filter { it.key in validKeys }
        shown = shown.filter { it.key in validKeys }
        opened = opened?.filter { it.key in validKeys }?.takeIf { it.isNotEmpty() }
        if (shown.isEmpty()) dismiss()
    }

    // Serial collection is intentional: claiming updates the same flow and must not cancel its own delivery.
    LaunchedEffect(Unit) {
        snapshotFlow { Triple(latestAwards.filter { it.notifiedAtMs == null }, latestEnabled, resumed) }.collect { (pending, show, foreground) ->
            if (pending.isNotEmpty()) try {
                val fresh = claim(pending.map { it.key })
                if (show && foreground && latestEnabled && resumed) {
                    val instant = System.currentTimeMillis()
                    val currentKeys = latestAwards.filter { it.valid }.map { it.key }.toSet()
                    waiting = (waiting + fresh.filter { it.valid && it.key in currentKeys && instant - it.earnedAtMs in 0..10_000 }).distinctBy { it.key }
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                failure(error)
            }
        }
    }
    LaunchedEffect(Unit) {
        snapshotFlow {
            Triple(latestRecords.filter { it.notifiedAtMs == null && it.id !in attemptedRecords }, latestRecordsEnabled, resumed)
        }.collect { (pending, show, foreground) ->
            if (pending.isEmpty()) return@collect
            claimingRecords = true
            val ids = pending.map { it.id }
            try {
                val fresh = claimRecords(ids)
                if (show && foreground && latestRecordsEnabled && resumed) {
                    val now = System.currentTimeMillis()
                    recordWaiting = (recordWaiting + fresh.filter { now - it.recordedAtMs in 0..10_000 })
                        .distinctBy { it.id }.sortedWith(compareBy<PersonalRecordEvent> { it.recordedAtMs }.thenBy { it.id })
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                failure(error)
            } finally {
                attemptedRecords = attemptedRecords + ids
                claimingRecords = false
            }
        }
    }
    fun readyToShow() = ((recordWaiting.isNotEmpty() && latestRecordsEnabled) || (waiting.isNotEmpty() && latestEnabled)) &&
        shown.isEmpty() && recordShown == null && opened == null && resumed && !recordHasPriority()
    LaunchedEffect(Unit) {
        snapshotFlow { readyToShow() }.collect { ready ->
            if (ready) {
                delay(200)
                if (readyToShow()) showNext()
            }
        }
    }
    LaunchedEffect(shown.firstOrNull()?.key) {
        while (visible && remainingMs > 0) {
            val step = minOf(ACHIEVEMENT_TIMER_STEP_MS, remainingMs)
            delay(step)
            if (visible && !pressed && !dragging && opened == null && windowInfo.isWindowFocused && accessibility?.isTouchExplorationEnabled != true) {
                remainingMs -= step
            }
        }
        if (visible) dismiss()
    }
    LaunchedEffect(visible) {
        if (!visible && shown.isNotEmpty()) {
            if (motion) delay(150)
            if (!visible) showNext()
        }
    }
    LaunchedEffect(enabled, resumed) {
        if (!enabled || !resumed) {
            waiting = emptyList()
            dismiss()
            shown = emptyList()
        }
    }
    LaunchedEffect(recordsEnabled, resumed) {
        if (!recordsEnabled || !resumed) {
            recordWaiting = emptyList()
            recordShown = null
        }
    }
    val groups = remember(shown, validKeys) { groupAchievements(shown.filter { it.key in validKeys }) }
    val main = groups.firstOrNull()
    val density = LocalDensity.current
    val top = WindowInsets.statusBars.getTop(density) + with(density) { 8.dp.roundToPx() }
    val remainingGroups = remember(waiting, validKeys) { groupAchievements(waiting.filter { it.key in validKeys }).size }
    if (main != null) {
        var offset by remember(main.key, main.main.key) { mutableStateOf(Offset.Zero) }
        val threshold = with(density) { 48.dp.toPx() }
        Popup(alignment = Alignment.TopCenter, offset = IntOffset(0, top),
            properties = PopupProperties(focusable = false, dismissOnBackPress = false, dismissOnClickOutside = false)) {
            AnimatedVisibility(visible, enter = if (motion) fadeIn(tween(200)) + slideInVertically(tween(200)) { -with(density) { 12.dp.roundToPx() } } else EnterTransition.None,
                exit = if (motion) fadeOut(tween(150)) + slideOutVertically(tween(150)) { -with(density) { 12.dp.roundToPx() } } else ExitTransition.None) {
                val tint = achievementColor(main.main.rarity)
                val fraction = (remainingMs.toFloat() / timeout).coerceIn(0f, 1f)
                val drawnFraction = key(main.main.key) {
                    animateFloatAsState(fraction,
                        animationSpec = if (motion) tween(ACHIEVEMENT_TIMER_STEP_MS.toInt(), easing = LinearEasing) else snap(),
                        label = "achievement time remaining")
                }
                Surface(Modifier.padding(horizontal = 16.dp).widthIn(max = 560.dp).fillMaxWidth()
                    .testTag("achievement-banner")
                    .graphicsLayer { translationX = offset.x; translationY = offset.y }
                    .semantics {
                        liveRegion = LiveRegionMode.Polite
                        val action = if (remainingGroups > 0) "Следующее достижение" else "Скрыть достижение"
                        customActions = listOf(CustomAccessibilityAction(action) { dismiss(); true })
                    }
                    .pointerInput(main.main.key) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false); pressed = true
                            waitForUpOrCancellation(); pressed = false
                        }
                    }
                    .pointerInput(main.main.key) {
                        detectDragGestures(onDragStart = { dragging = true }, onDragCancel = { dragging = false; offset = Offset.Zero },
                            onDragEnd = {
                                dragging = false
                                if (offset.x <= -threshold || offset.y <= -threshold) dismiss() else offset = Offset.Zero
                            }) { change, amount ->
                            if (amount.x < 0 || amount.y < 0 || offset != Offset.Zero) {
                                change.consume(); offset = Offset((offset.x + amount.x).coerceAtMost(0f), (offset.y + amount.y).coerceAtMost(0f))
                            }
                        }
                    }
                    .clickable { opened = shown }, shape = RoundedCornerShape(24.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant, shadowElevation = 8.dp) {
                    Column(Modifier.fillMaxWidth()
                        .testTag("achievement-banner-time")
                        .semantics { progressBarRangeInfo = ProgressBarRangeInfo(fraction, 0f..1f) }
                        .achievementTimeoutOutline(tint, drawnFraction)
                        .padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            FableIcon(Glyph.Trophy, tint = tint)
                            Column(Modifier.weight(1f)) {
                                Text(main.main.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(main.main.rarity.label + (achievementBowLabels[main.main.scope]?.let { " · $it" } ?: ""),
                                    color = tint, style = MaterialTheme.typography.labelSmall)
                            }
                            if (main.others.isNotEmpty()) Box(Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                                .testTag("achievement-banner-additional")
                                .clickable(role = Role.Button, onClickLabel = "Показать ещё ${main.others.size} достижений") {
                                    opened = listOf(main.main) + main.others
                                }, contentAlignment = Alignment.TopEnd) {
                                Text("+${main.others.size}", color = tint, style = MaterialTheme.typography.titleMedium)
                            }
                        }
                        Text(main.main.flavor, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (remainingGroups > 0) {
                            val count = remainingGroups
                            val noun = when {
                                count % 100 in 11..14 -> "достижений"
                                count % 10 == 1 -> "достижение"
                                count % 10 in 2..4 -> "достижения"
                                else -> "достижений"
                            }
                            Text("Ещё $count $noun", style = MaterialTheme.typography.labelSmall, color = tint)
                        }
                    }
                }
            }
        }
    }
    opened?.filter { it.key in validKeys }?.takeIf { it.isNotEmpty() }?.let { packet ->
        AchievementFamilySheet(awardStatuses(packet), { opened = null; dismiss() }, availableSessionIds, onSession)
    }
    recordShown?.takeIf { it.id in recordKeys }?.let { record ->
        key(record.id) {
            PersonalRecordBanner(record, {
                recordShown = null
                showNext()
            }, availableSessionIds, onSession)
        }
    }
}

private fun Modifier.achievementTimeoutOutline(tint: Color, fraction: State<Float>) = drawWithCache {
    val width = 2.dp.toPx()
    val inset = width / 2
    val radius = (24.dp.toPx() - inset).coerceAtLeast(0f)
    val contour = Path().apply {
        addRoundRect(RoundRect(inset, inset, size.width - inset, size.height - inset, CornerRadius(radius)))
    }
    val measure = PathMeasure().apply { setPath(contour, forceClosed = true) }
    val remaining = Path()
    val stroke = Stroke(width, cap = StrokeCap.Round)
    onDrawWithContent {
        drawContent()
        drawPath(contour, tint.copy(alpha = .22f), style = stroke)
        val length = measure.length * fraction.value
        if (length > 0f) {
            remaining.reset()
            measure.getSegment(0f, length, remaining, startWithMoveTo = true)
            drawPath(remaining, tint, style = stroke)
        }
    }
}

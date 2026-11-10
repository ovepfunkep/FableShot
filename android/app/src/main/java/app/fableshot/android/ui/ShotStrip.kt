package app.fableshot.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.ShotEntity
import kotlinx.coroutines.flow.first

internal fun zoneFill(points: Int): Color = when (points) {
    10, 9 -> Color(0xFFF4CE44)
    8, 7 -> Color(0xFFE44C43)
    6, 5 -> Color(0xFF3295C7)
    4, 3 -> Color(0xFF242A2C)
    2, 1 -> Color(0xFFF8F8EF)
    else -> Color(0xFF667267)
}

internal fun zoneInk(points: Int): Color = if (points in 3..4 || points == 0) Color.White else Color(0xFF111811)

@Composable
internal fun ShotStrip(
    shots: List<ShotEntity>, slots: Int, selectedId: String?, enteringIndex: Int?, enabled: Boolean,
    hideScores: Boolean, endId: String, onChoose: (ShotEntity?) -> Unit,
    selectionTagPrefix: String? = null,
) {
    val count = maxOf(slots, shots.size)
    val compact = count > 3
    val list = rememberLazyListState()
    val motion = LocalFableVisuals.current.motion
    val density = LocalDensity.current
    LaunchedEffect(shots.size, count, density.density) {
        if (count > 6) {
            val last = (shots.size - 1).coerceAtLeast(0)
            val viewport = snapshotFlow { list.layoutInfo.viewportSize.width }.first { it > 0 }
            val visible = ((viewport + with(density) { 4.dp.toPx() }) / with(density) { 52.dp.toPx() }).toInt().coerceAtLeast(1)
            val first = (last - visible + 1).coerceAtLeast(0)
            if (motion) list.animateScrollToItem(first) else list.scrollToItem(first)
        }
    }
    @Composable fun Slot(index: Int, modifier: Modifier) {
        val shot = shots.getOrNull(index)
        val entering = shot?.id == selectedId || enteringIndex == index
        val color = if (shot == null || hideScores) MaterialTheme.colorScheme.surface else zoneFill(shot.points)
        val ink = if (shot == null || hideScores) MaterialTheme.colorScheme.onSurface else zoneInk(shot.points)
        val result = shot?.let { if (hideScores) "✓" else if (it.zoneCode == "X") "X" else if (it.points == 0) "M" else it.points.toString() } ?: "—"
        val outline = arrowOutlineColor(shot != null, entering)
        val tags = modifier.height(52.dp).testTag(if (selectionTagPrefix != null && shot != null) "$selectionTagPrefix-${shot.id}" else "shot-$index").semantics {
            selected = shot?.id == selectedId
            stateDescription = if (entering) "Вводимая стрела" else if (shot != null) "Введённая стрела" else "Невведённая стрела"
            contentDescription = "Стрела ${index + 1}" + (shot?.physicalArrowNumber?.let { ", физическая стрела №$it" } ?: "")
        }
        val feedback = tenChainFeedback(endId, shots.map { it.points }, index, enabled = !hideScores)
        if (compact) Box(tags.clickable(enabled = enabled && shot != null) { onChoose(shot) }, contentAlignment = Alignment.Center) {
            Surface(
                modifier = Modifier.size(36.dp).then(feedback), shape = CircleShape,
                color = color, contentColor = ink, border = BorderStroke(if (entering) 2.dp else 1.dp, outline)) {
                Box(contentAlignment = Alignment.Center) {
                    Box(Modifier.fillMaxWidth().padding(horizontal = 2.dp)) {
                        FittedLine(result, MaterialTheme.typography.labelLarge, ink, alignment = Alignment.Center)
                    }
                }
            }
        } else OutlinedButton({ onChoose(shot) }, enabled = enabled && shot != null,
            modifier = tags.then(feedback), shape = CircleShape, contentPadding = PaddingValues(horizontal = 10.dp),
            border = BorderStroke(if (entering) 2.dp else 1.dp, outline),
            colors = ButtonDefaults.outlinedButtonColors(containerColor = color, contentColor = ink,
                disabledContainerColor = color, disabledContentColor = ink)) {
            ArrowSlotLabel(index + 1, result, shot?.physicalArrowNumber)
        }
    }
    Box(Modifier.fillMaxWidth().testTag("shot-strip")) {
        if (count <= 6) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(count) { Slot(it, Modifier.weight(1f)) }
        } else LazyRow(state = list, modifier = Modifier.fillMaxWidth().testTag("shot-strip-scroll"),
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            items(count, key = { it }) { Slot(it, Modifier.width(48.dp)) }
        }
        val surface = MaterialTheme.colorScheme.surface
        if (count > 6 && list.canScrollBackward) Box(Modifier.align(Alignment.CenterStart).width(14.dp).height(52.dp)
            .background(Brush.horizontalGradient(listOf(surface, Color.Transparent))).testTag("shot-strip-fade-left"))
        if (count > 6 && list.canScrollForward) Box(Modifier.align(Alignment.CenterEnd).width(14.dp).height(52.dp)
            .background(Brush.horizontalGradient(listOf(Color.Transparent, surface))).testTag("shot-strip-fade-right"))
    }
}

/** The footer is measured before the target, so every action remains inside the viewport. */
@Composable
internal fun TrainingEditorFooter(
    shots: List<ShotEntity>, slots: Int, selectedId: String?, enteringIndex: Int?,
    enabled: Boolean, hideScores: Boolean, endId: String, onChoose: (ShotEntity?) -> Unit,
    mainText: String, mainTag: String, mainEnabled: Boolean, onMain: () -> Unit,
    missEnabled: Boolean, onMiss: () -> Unit, onUndo: () -> Unit, canUndo: Boolean,
    timerBadge: (@Composable () -> Unit)? = null,
    status: (@Composable () -> Unit)? = null,
    onNotes: (() -> Unit)? = null,
    selectionTagPrefix: String? = null,
    missTag: String = "miss",
) {
    Surface(Modifier.fillMaxWidth().testTag("training-editor-footer"), tonalElevation = 4.dp) {
        BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
            val density = LocalDensity.current
            val style = MaterialTheme.typography.labelLarge
            val buttonHeight = maxOf(56.dp, with(density) { style.lineHeight.toDp() } + 28.dp)
            Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
                if (timerBadge != null) timerBadge() else if (status != null) Box(Modifier.weight(1f)) { status() }
                Spacer(Modifier.weight(1f))
                if (onNotes != null) IconButton(onNotes, Modifier.testTag("end-notes"), enabled = enabled) {
                    FableIcon(Glyph.Notes, description = "Заметки серии")
                }
                IconButton(onUndo, Modifier.size(40.dp).testTag("undo"), enabled = canUndo) {
                    FableIcon(Glyph.Undo, description = "Отменить")
                }
            }
            Box(Modifier.fillMaxWidth().testTag("arrow-panel")) {
                ShotStrip(shots, maxOf(1, slots), selectedId, enteringIndex, enabled, hideScores, endId,
                    onChoose, selectionTagPrefix)
            }
            Row(Modifier.fillMaxWidth().height(buttonHeight + 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onMiss, Modifier.width(56.dp).height(buttonHeight).testTag(missTag),
                    contentPadding = PaddingValues(8.dp), enabled = missEnabled) { Text("M") }
                FablePrimaryButton(mainText, onMain, Modifier.weight(1f).height(buttonHeight).testTag(mainTag), enabled = mainEnabled,
                    preserveDisabledAppearance = mainEnabled, singleLine = true)
            }
            }
        }
    }
}

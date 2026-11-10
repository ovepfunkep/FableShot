package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.journal.PhysicalArrowSet
import kotlin.math.ceil
import kotlin.math.floor

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun PhysicalArrowPicker(
    value: Int?,
    arrowSet: PhysicalArrowSet?,
    usedNumbers: Set<Int>,
    onChange: (Int?) -> Unit,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    tag: String = "physical-arrow-choice",
) {
    var open by rememberSaveable { mutableStateOf(false) }
    var closing by remember { mutableStateOf(false) }
    var selection by remember { mutableStateOf<Int?>(null) }
    var selectionPending by remember { mutableStateOf(false) }
    val currentLabel = value?.let { "№ $it" } ?: "Без номера"
    TextButton({ open = true },
        modifier.heightIn(min = 48.dp).testTag(tag).semantics {
            contentDescription = "Физическая стрела · $currentLabel"
        }, enabled = enabled) {
        Text(if (value == null) "№ —" else currentLabel, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
    if (open) PhysicalArrowPickerSheet(value, arrowSet, usedNumbers,
        { selection=it;selectionPending=true;closing=true }, {
            if(selectionPending)onChange(selection)
            open=false;closing=false;selectionPending=false
        }, enabled, dismissRequested=closing)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun PhysicalArrowPickerSheet(
    value: Int?,
    arrowSet: PhysicalArrowSet?,
    usedNumbers: Set<Int>,
    onChange: (Int?) -> Unit,
    onDismiss: () -> Unit,
    enabled: Boolean = true,
    errorMessage: String? = null,
    dismissRequested: Boolean = false,
) {
    val sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)
    val latestDismiss by rememberUpdatedState(onDismiss)
    val motion=LocalFableVisuals.current.motion
    val acceptsInput=enabled&&!dismissRequested
    LaunchedEffect(dismissRequested) {
        if(dismissRequested) {
            if(motion)sheetState.hide()
            latestDismiss()
        }
    }
    ModalBottomSheet(onDismissRequest = { if (enabled) onDismiss() },
        sheetState = sheetState) {
        Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).padding(horizontal = 20.dp, vertical = 12.dp)
            .testTag("physical-arrow-picker"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Номер стрелы", style = MaterialTheme.typography.titleLarge)
            if (arrowSet != null) {
                val legacyNumber = value?.takeIf { it !in 1..arrowSet.count }
                val buttonCount = arrowSet.count + if (legacyNumber == null) 0 else 1
                fun numberAt(index: Int) = if (index < arrowSet.count) index + 1 else requireNotNull(legacyNumber)
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                val density = LocalDensity.current
                val measurer = rememberTextMeasurer()
                val largestNumberWidth = listOfNotNull(arrowSet.count, legacyNumber).maxOf {
                    measurer.measure(it.toString(), MaterialTheme.typography.titleMedium).size.width
                }
                val minimumWidth = maxOf(64.dp, with(density) { largestNumberWidth.toDp() } + 20.dp)
                val columns = floor((maxWidth.value + 8) / (minimumWidth.value + 8)).toInt().coerceAtLeast(1)
                val rows = ceil(buttonCount.toDouble() / columns).toInt()
                val rowHeight = maxOf(52.dp, with(density) { MaterialTheme.typography.titleMedium.lineHeight.toDp() } + 20.dp)
                val gridHeight = (rowHeight * rows + 8.dp * (rows - 1) + 12.dp)
                    .coerceAtMost(if (errorMessage == null) 456.dp else 360.dp)
                LazyVerticalGrid(columns = GridCells.Adaptive(minimumWidth), modifier = Modifier.fillMaxWidth()
                    .height(gridHeight).testTag("physical-arrow-buttons"),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 12.dp)) {
                    items(buttonCount, key = ::numberAt) { index ->
                        val number = numberAt(index)
                        val used = number in usedNumbers
                        val modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
                            .testTag("physical-arrow-quick-$number").semantics {
                                contentDescription = "Стрела №$number"
                                stateDescription = if (used) "Уже записана в серии" else if (number == value)
                                    "Выбрана. Повторное нажатие убирает номер" else "Доступна"
                            }
                        OutlinedButton({ onChange(number.takeUnless { it == value }) }, modifier, enabled = acceptsInput && !used,
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (number == value) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                                contentColor = if (number == value) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface)) {
                            Text(number.toString(), style = MaterialTheme.typography.titleMedium, maxLines = 1)
                        }
                    }
                }
                }
            } else if (value != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onDismiss, Modifier.weight(1f).testTag("physical-arrow-keep"), enabled = acceptsInput) { Text("№ $value") }
                    OutlinedButton({ onChange(null) }, Modifier.weight(1f).testTag("physical-arrow-none"), enabled = acceptsInput) { Text("Без номера") }
                }
            }
            errorMessage?.let { Text(it, Modifier.testTag("physical-arrow-save-error"),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
    }
}

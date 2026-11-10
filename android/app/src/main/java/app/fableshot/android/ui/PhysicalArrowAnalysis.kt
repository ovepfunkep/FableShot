package app.fableshot.android.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.journal.PhysicalArrowAnalysisGroup
import app.fableshot.android.data.StatisticFeature
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PhysicalArrowAnalysisCard(groups: List<PhysicalArrowAnalysisGroup>) {
    if (!statisticVisible(StatisticFeature.NumberedArrows)) return
    val showVolume = statisticVisible(StatisticFeature.Volume)
    val showAverage = statisticVisible(StatisticFeature.Average)
    val showGrouping = statisticVisible(StatisticFeature.Grouping)
    val showOffset = statisticVisible(StatisticFeature.Offset)
    val showDetails = showVolume || showAverage || showGrouping || showOffset
    var selectedKey by rememberSaveable { mutableStateOf<String?>(null) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    val selected = groups.firstOrNull { it.conditionKey == selectedKey } ?: groups.firstOrNull()
    FableCard(Modifier.testTag("physical-arrow-analysis")) {
        SectionHeading("По номерам стрел", icon = Glyph.Arrow)
        if (selected == null) {
            Text("Здесь появится анализ выстрелов с номером физической стрелы и сохранённым набором стрел.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            var selectedNumber by rememberSaveable(selected.conditionKey) { mutableStateOf<Int?>(null) }
            val selectedArrow = selected.arrows.firstOrNull { it.number == selectedNumber }
            if (groups.size > 1) FlowRow(Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                groups.forEachIndexed { index, group ->
                    FilterChip(selected.conditionKey == group.conditionKey, { selectedKey = group.conditionKey },
                        {
                            Text(group.conditionLabel.ifBlank { "Условия ${index + 1}" },
                                Modifier.widthIn(max = 220.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        },
                        Modifier.heightIn(min = 48.dp).testTag("physical-arrow-scope-$index"))
                }
            }
            PhysicalArrowComparison(selected, selectedArrow) { selectedNumber = it }
            if (showDetails) TextButton(
                onClick = { expanded = !expanded },
                modifier = Modifier.testTag("physical-arrow-details").semantics {
                    stateDescription = if (expanded) "Развёрнуто" else "Свёрнуто"
                },
            ) {
                Text(if (expanded) "Скрыть подробности" else "Подробнее")
            }
            val shownArrows = if (selectedArrow == null) selected.arrows else listOf(selectedArrow)
            if (showDetails && expanded) shownArrows.forEach { arrow ->
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column(Modifier.fillMaxWidth().testTag("physical-arrow-${arrow.number}"),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Стрела №${arrow.number}" + if(showVolume) " · выстрелов ${arrow.shotCount}" else "", style = MaterialTheme.typography.titleSmall)
                    if (showAverage) Text("Средний балл ${averageNumber(arrow.meanScore)}", style = MaterialTheme.typography.bodyMedium)
                    val geometry = listOfNotNull(
                        arrow.rmsMm?.takeIf { showGrouping }?.let { "Кучность ${decimal(it)} мм" },
                        arrow.centerOffsetMm?.takeIf { showOffset }?.let { "Смещение ${decimal(it)} мм" },
                    ).joinToString(" · ")
                    if (geometry.isNotEmpty()) {
                        Text(geometry,
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

private fun decimal(value: Double) = String.format(Locale.forLanguageTag("ru"), "%.2f", value)

package app.fableshot.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fableshot.android.data.journal.*
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.domain.TargetCatalog
import org.json.JSONObject

/** Conditions are metadata; rounds follow the saved plan, never condition blocks. */
internal fun LazyListScope.journalReportOverview(
    details: JournalDetails,
    onEnd: (JournalEndDetails) -> Unit,
    canEditShots: Boolean,
    canEditCounts: Boolean,
    showSeries: Boolean = true,
) {
    item("conditions") {
        Column(Modifier.fillMaxWidth().testTag("report-conditions"), verticalArrangement=Arrangement.spacedBy(4.dp)) {
            details.orderedBlocks.map { block ->
                val condition = block.block
                val equipment = condition.equipmentSnapshotJson?.let { json -> runCatching { JSONObject(json) }.getOrNull() }
                val bow = equipment?.optJSONObject("bow")?.optString("name")?.takeIf(String::isNotBlank)
                    ?: equipment?.optJSONObject("selection")?.optString("name")?.takeIf(String::isNotBlank)
                val arrows = equipment?.optJSONObject("arrows")?.optString("name")?.takeIf(String::isNotBlank)
                buildList {
                    if (condition.mode == "count_only") add(ConditionValue(Glyph.Target, "Счётчик стрел", "Режим: счётчик стрел"))
                    else {
                        val size = condition.targetDiameterMm?.let { "${number(it / 10.0, if (it % 10 == 0) 0 else 1)} см" }
                            ?: "Размер не указан"
                        val profile = TargetCatalog.find(condition.targetProfileId)?.title?.removePrefix("Indoor · ")
                        val target = listOfNotNull(size, profile).joinToString(" · ")
                        add(ConditionValue(Glyph.Target, target, "Мишень: $target"))
                        val distance = condition.distanceMeters?.let { "${number(it, if (it % 1.0 == 0.0) 0 else 1)} м" }
                            ?: "Не указана"
                        add(ConditionValue(Glyph.Distance, distance, "Дистанция: $distance"))
                    }
                    bow?.let { add(ConditionValue(Glyph.Bow, it, "Лук или комплект: $it")) }
                    arrows?.let { add(ConditionValue(Glyph.Arrow, it, "Стрелы: $it")) }
                }
            }.distinct().forEach { values ->
                ConditionsGrid(values)
            }
            if (statisticVisible(StatisticFeature.Volume)) PlanProgressLine(details,Modifier.padding(top=4.dp))
        }
    }
    if (!showSeries) return
    val ends = details.orderedBlocks.flatMap { it.orderedEnds }.filter { it.end.role == "scored" }
        .filter { details.spendsPlanEnd(it) || it.end.id == details.currentEnd?.end?.id }
    val rounds = ends.groupBy { details.roundProgress(it.end.id).number }
    rounds.forEach { (number, series) ->
        item("round-$number") {
            val shots = series.flatMap { it.shots }
            val counted = series.sumOf { e -> e.counts.sumOf { it.count } }
            val scoredEnds = series.filter { e -> details.blocks.first { it.block.id == e.end.blockId }.block.mode == "scored" }
            val maximum = details.roundProgress(series.first().end.id).maximum
            val total = shots.sumOf { it.points }
            val average = if (shots.isEmpty()) "—" else app.fableshot.android.ui.averageNumber(total.toDouble() / shots.size)
            val showResult = statisticVisible(StatisticFeature.Result)
            val showAverage = statisticVisible(StatisticFeature.Average)
            val showVolume = statisticVisible(StatisticFeature.Volume)
            val caption = listOfNotNull(
                "Раунд $number",
                if (scoredEnds.isEmpty() && showVolume) "$counted стрел без оценки" else null,
                if (scoredEnds.isNotEmpty() && showResult) maximum?.let { "$total/$it" } ?: total.toString() else null,
                if (scoredEnds.isNotEmpty() && showAverage) average else null,
            ).joinToString(" · ")
            Column(Modifier.fillMaxWidth().testTag("report-round-$number"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f).testTag("report-round-total-$number").semantics(mergeDescendants = true) {}) {
                        FittedLine(caption, MaterialTheme.typography.titleMedium, MaterialTheme.colorScheme.onSurface)
                    }
                    val rank = details.roundRank(LocalRankPreferences.current.category, series.first().end.id)
                    if (rank.label != null) StageRankBadge(details, rank,
                        Modifier.width(64.dp), tag = "report-round-rank-$number")
                }
                if (showVolume && counted > 0 && scoredEnds.isNotEmpty()) Text("$counted стрел без оценки", style = MaterialTheme.typography.bodySmall)
            }
        }
        items(series, key={ "series-${it.end.id}" }) { end ->
            val countOnly = details.blocks.first { it.block.id == end.end.blockId }.block.mode == "count_only"
            CompactReportEnd(end, details.roundProgress(end.end.id).seriesNumber, countOnly,
                if (countOnly) canEditCounts else canEditShots && end.shots.isNotEmpty()) { onEnd(end) }
        }
    }
}

@Composable
private fun CompactReportEnd(end: JournalEndDetails, number: Int, countOnly: Boolean, editable: Boolean, onClick: () -> Unit) {
    val shots = end.shots.sortedBy { it.inputIndex }
    val total = shots.sumOf { it.points }
    val average = if (shots.isEmpty()) "—" else app.fableshot.android.ui.averageNumber(total.toDouble() / shots.size)
    val showVolume = statisticVisible(StatisticFeature.Volume)
    val showResult = statisticVisible(StatisticFeature.Result)
    val showAverage = statisticVisible(StatisticFeature.Average)
    Surface(onClick=onClick, enabled=editable, modifier=Modifier.fillMaxWidth().testTag("report-end-${end.end.id}"),
        shape=RoundedCornerShape(16.dp), color=MaterialTheme.colorScheme.surface,
        border=BorderStroke(1.dp, if (editable) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            if (shots.isNotEmpty()) BoxWithConstraints(Modifier.fillMaxWidth()) {
                val minimum = maxOf(26.dp, with(LocalDensity.current) { 24.sp.toDp() + 6.dp })
                val columns = ((maxWidth + 4.dp) / (minimum + 4.dp)).toInt().coerceAtLeast(1)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    shots.chunked(columns).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            row.forEach { shot -> ReportHitChip(shot, Modifier.weight(1f)) }
                        }
                    }
                }
            }
            if (!countOnly && shots.isEmpty()) Text("Нет попаданий", style=MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("$number", Modifier.semantics { contentDescription = "Серия $number" },
                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val summary = if (countOnly) {
                    if (showVolume) "${end.volume}/${end.end.plannedCount} стрел" else ""
                } else listOfNotNull(
                    if (showResult) "$total/${end.end.plannedCount * 10}" else null,
                    if (showAverage) average else null,
                ).joinToString(" · ")
                if (summary.isNotEmpty()) Text(summary, Modifier.testTag("report-series-total-${end.end.id}"), style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun ReportHitChip(shot: JournalShot, modifier: Modifier) {
    val background = when (shot.points) {
        10, 9 -> Color(0xFFF4CE44)
        8, 7 -> Color(0xFFE44C43)
        6, 5 -> Color(0xFF3295C7)
        4, 3 -> Color(0xFF242A2C)
        2, 1 -> Color(0xFFF8F8EF)
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    val foreground = when (shot.points) {
        3, 4 -> Color.White
        0 -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> Color(0xFF111811)
    }
    Surface(modifier, color = background, contentColor = foreground, shape = RoundedCornerShape(6.dp),
        border = BorderStroke(.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Box(Modifier.padding(vertical = 3.dp), contentAlignment = Alignment.Center) {
            Text(if (shot.zoneCode == "X") "X" else if (shot.points == 0) "M" else shot.points.toString(),
                Modifier.testTag("report-hit-${shot.id}"), style = MaterialTheme.typography.labelMedium)
        }
    }
}

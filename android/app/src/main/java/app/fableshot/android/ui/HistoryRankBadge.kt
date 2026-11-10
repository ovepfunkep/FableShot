package app.fableshot.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.data.journal.historyRank

/** One action per history card: its level is part of the result, the report owns the details. */
@Composable
fun HistoryRankBadge(summary: SessionSummary, modifier: Modifier = Modifier) {
    if (!statisticVisible(StatisticFeature.Norms) || summary.scoredCount == 0) return
    val preferences = LocalRankPreferences.current
    val ranks = summary.journalMeta?.roundRanks.orEmpty()
    val overview = remember(ranks, preferences.category) { ranks.historyRank(preferences.category) }
    val label = listOfNotNull(overview.label ?: "—", overview.classLabel).joinToString(" · ")
    Row(modifier.heightIn(min = 32.dp).testTag("session-rank-${summary.id}")
        .semantics(mergeDescendants = true) { contentDescription = "Прогноз разряда: $label" },
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        FableIcon(Glyph.Podium, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    }
}
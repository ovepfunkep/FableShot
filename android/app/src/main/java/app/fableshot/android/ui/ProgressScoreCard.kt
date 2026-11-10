package app.fableshot.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.data.journal.ProgressBaseline
import app.fableshot.android.data.journal.JournalScoringInput
import app.fableshot.android.domain.*
import org.json.JSONArray

fun progressLabel(value:Double,ready:Boolean)=(if(ready)""else"≈ ")+
    (if(ScoreRounding.hundredths(value)>0)"+"else"")+compactProgressNumber(value)+"%"

@Composable
fun ProgressScoreCard(input:JournalScoringInput,baseline:ProgressBaseline?,sourceVersions:Map<String,Long>?=null) {
    if (baseline?.maximumPerArrow == null || baseline.status !in setOf("ready", "building")) return
    val sources = runCatching { JSONArray(baseline.sourceSessionsJson) }.getOrNull() ?: return
    val sourceCount = sources.length()
    val shots = input.ends.flatMap { it.shots }
    val result = ProgressScoring.calculate(shots.sumOf { it.points.toLong() }, shots.size,
        baseline.scoreSum, baseline.scoredCount, sourceCount, baseline.maximumPerArrow,
        input.ends.all { it.closed && it.shots.size == it.plannedCount })
    val presentation = progressPresentation(result.currentAverage, result.baselineAverage, result.fullRankAvailable) ?: return
    val changed = sourceVersions != null && (0 until sourceCount).any { index ->
        val source = sources.getJSONObject(index)
        sourceVersions[source.getString("sessionId")] != source.getLong("revision")
    }
    val sourceText = (0 until sourceCount).joinToString("\n") { index ->
        val source = sources.getJSONObject(index)
        val label = if (source.getString("sourceKind") == "mytargets") "MyTargets" else "FableShot"
        val date = if (source.has("startedAtMs") && !source.isNull("startedAtMs"))
            java.text.DateFormat.getDateInstance().format(java.util.Date(source.getLong("startedAtMs"))) else null
        listOfNotNull(source.getString("title"), date, "${source.getLong("sum")} очков",
            "${source.getInt("count")} стрел", label).joinToString(" · ")
    }
    val explanation = buildString {
        append(presentation.explanation(sourceCount))
        append("\n\n")
        append(stringResource(R.string.pg1_sources, sourceCount, baseline.scoredCount))
        if (changed) {
            append("\n\n")
            append(stringResource(R.string.pg1_source_changed))
        }
        if (sourceText.isNotEmpty()) append("\n\n$sourceText")
    }
    FableCard(Modifier.testTag("pg1-card")) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FableIcon(Glyph.Progress, tint = MaterialTheme.colorScheme.primary)
            Text(stringResource(R.string.pg1_title), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            HelpButton("О прогрессе и базе сравнения", explanation, iconOnly = true)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ProgressChangeValue(presentation.copy(ready = true), explanation,
                Modifier.align(Alignment.CenterVertically).testTag("pg1-value"), style = MaterialTheme.typography.displayMedium)
            if (!result.fullRankAvailable) Text("Предварительно", Modifier.align(Alignment.CenterVertically),
                style = MaterialTheme.typography.labelSmall)
        }
        Text(stringResource(R.string.pg1_averages, averageNumber(requireNotNull(result.baselineAverage)),
            averageNumber(requireNotNull(result.currentAverage))), style = MaterialTheme.typography.bodyMedium)
    }
}

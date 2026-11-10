package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import app.fableshot.android.R
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.PersonalRecordEvent
import app.fableshot.android.data.journal.roundLocations
import app.fableshot.android.data.journal.scoringInput
import app.fableshot.android.data.journal.hasCompleteReportEnds
import app.fableshot.android.data.journal.TrackedTrainingTime
import app.fableshot.android.domain.*
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportScreen(details: SessionDetails,onEditShot:((String)->Unit)?=null,onEditCount:((String,Int,Long)->Unit)?=null,scoring:app.fableshot.android.data.journal.JournalScoringInput?=null,baseline:app.fableshot.android.data.journal.ProgressBaseline?=null,sourceVersions:Map<String,Long>?=null,roundLabels:Map<String,String> = emptyMap(), norms: app.fableshot.android.data.journal.JournalDetails? = null, overview: (LazyListScope.() -> Unit)? = null, showSeries: Boolean = true,onNotes:((app.fableshot.android.data.journal.NoteScope)->Unit)?=null,progressScopeMessage:String?=null,awards:List<app.fableshot.android.domain.EarnedAchievement> = emptyList(),trainingTime:TrackedTrainingTime?=null,
    recordEvents: List<PersonalRecordEvent> = emptyList(), availableRecordSessions: Set<String>? = null, onRecordSession: ((String) -> Unit)? = null) {
    details.journal?.let {
        JournalReportScreen(it,onEditShot,onEditCount,sourceVersions,onNotes,awards,trainingTime,
            recordEvents,availableRecordSessions,onRecordSession)
        return
    }
    val metrics = remember(details) { PracticeMetrics.from(details) }
    val showResult = statisticVisible(StatisticFeature.Result)
    val showAverage = statisticVisible(StatisticFeature.Average)
    val showGrouping = statisticVisible(StatisticFeature.Grouping)
    val showVolume = statisticVisible(StatisticFeature.Volume)
    val showRecords = statisticVisible(StatisticFeature.Records)
    val showGeneralScore = statisticVisible(StatisticFeature.GeneralScore)
    val showProgressScore = statisticVisible(StatisticFeature.ProgressScore)
    val showNorms = statisticVisible(StatisticFeature.Norms)
    val showMap = statisticVisible(StatisticFeature.HitMap)
    val showOffset = statisticVisible(StatisticFeature.Offset)
    val showDistribution = statisticVisible(StatisticFeature.Distribution)
    val showEndResults = showSeries && statisticVisible(StatisticFeature.Series)
    val sessionRecords = remember(details.session.id, recordEvents) { recordEvents.filter { it.sessionId == details.session.id } }
    val radiusMm = details.session.targetDiameterMm / 2.0
    val mapLabels = remember(norms, roundLabels) {
        norms?.roundLocations().orEmpty().mapValues { (_, location) -> "Раунд ${location.first} · Серия ${location.second}" } + roundLabels
    }
    val mapCoordinates = remember(norms, scoring) {
        if (norms != null) norms.orderedBlocks.flatMap { block ->
            val input = block.scoringInput()
            input.ends.map { end -> end.id to if (input.geometryVerified) end.shots.mapNotNull { shot -> shot.position?.let { shot.id to it } }.toMap() else emptyMap() }
        }.toMap()
        else scoring?.let { input -> input.ends.associate { end ->
            end.id to if (input.geometryVerified) end.shots.mapNotNull { shot -> shot.position?.let { shot.id to it } }.toMap() else emptyMap()
        } }
    }
    var editingEnd by remember(details.session.id) { mutableStateOf<EndWithShots?>(null) }
    LazyColumn(Modifier.fillMaxSize().testTag("report-screen"),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(18.dp)) {
        if (overview != null) overview()
        else item { Column(verticalArrangement=Arrangement.spacedBy(8.dp)) { Eyebrow(stringResource(R.string.report_eyebrow));Text(if(details.session.distanceMeters<=0||details.session.targetDiameterMm<=0)stringResource(R.string.unknown_conditions)else stringResource(R.string.conditions,number(details.session.distanceMeters,0),details.session.targetDiameterMm/10),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant) } }
        if (showResult || showAverage || showGrouping || showVolume) item {
            FableCard(Modifier.testTag("report-result"), color=MaterialTheme.colorScheme.surfaceVariant) {
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) { Eyebrow(if(showResult) stringResource(R.string.report_accuracy) else "Показатели");FableIcon(Glyph.Target,tint=MaterialTheme.colorScheme.primary) }
                if (showResult) {
                Row(verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    SlidingValue(metrics.total.toString(),Modifier.weight(1f),style=MaterialTheme.typography.displayLarge)
                    SlidingValue("/ ${metrics.maximum}",Modifier.weight(.65f).padding(bottom=9.dp),
                        style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                LinearProgressIndicator(progress={if(metrics.maximum>0) metrics.total.toFloat()/metrics.maximum else 0f},modifier=Modifier.fillMaxWidth().height(7.dp),color=MaterialTheme.colorScheme.primary,trackColor=MaterialTheme.colorScheme.outlineVariant)
                }
                if (showVolume) Text(stringResource(R.string.session_arrow_count,metrics.shotCount),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if (showAverage || showGrouping) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (showAverage) ReportResultMetric(stringResource(R.string.average_label), metrics.average?.let { averageNumber(it) } ?: "—",
                        Modifier.weight(1f).testTag("report-result-average"))
                    val grouping = metrics.rms?.takeIf { radiusMm > 0 }?.let { stringResource(R.string.unit_mm, number(it * radiusMm, 1)) }
                    if (showGrouping) ReportResultMetric(stringResource(R.string.report_grouping), grouping ?: "—",
                        Modifier.weight(1f).testTag("report-result-grouping"))
                }
            }
        }
        if (showRecords && sessionRecords.isNotEmpty()) item { PersonalRecordReportCard(sessionRecords, availableRecordSessions, onRecordSession) }
        if(awards.any{it.valid})item {TrainingAchievementsCard(awards)}
        if(scoring!=null && showGeneralScore && scoring.hasCompleteReportEnds)item("composite-score") { CompositeScoreCard(scoring) }
        if(scoring!=null && showProgressScore && (progressScopeMessage != null ||
            baseline?.let { it.status in setOf("ready", "building") && it.maximumPerArrow != null && it.scoredCount > 0 } == true &&
            scoring.ends.any { it.shots.isNotEmpty() }))item {
            if(progressScopeMessage!=null)InfoCard("Прогресс по условиям",progressScopeMessage,icon=Glyph.Progress)
            else ProgressScoreCard(scoring,baseline,sourceVersions)
        }
        if (showNorms) norms?.let { journal -> item { SportRankPanel(journal) } }
        if (showMap) item { TrainingHitMap(details, mapLabels, mapCoordinates) }
        if (!showMap && showOffset) item {
            MetricTile(metrics.centreOffset?.takeIf { radiusMm > 0 }?.let { number(it * radiusMm) + " мм" } ?: "—",
                "Смещение от центра", Modifier.testTag("report-offset"), Glyph.Target)
        }
        if (showDistribution) item {
            FableCard {
                BlockHeading(stringResource(R.string.report_zone_distribution),Glyph.Target)
                if (showVolume) Text("Зачётных стрел: ${metrics.shotCount}",Modifier.testTag("report-zones-total"),style=MaterialTheme.typography.bodySmall)
                Row(Modifier.fillMaxWidth().height(126.dp),horizontalArrangement=Arrangement.spacedBy(4.dp),verticalAlignment=Alignment.Bottom) {
                    val max=metrics.zoneCounts.maxOrNull()?.coerceAtLeast(1) ?: 1
                    metrics.zoneCounts.forEachIndexed { zone,count ->
                        Column(Modifier.weight(1f),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(7.dp)) {
                            Text(count.toString(),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            Box(Modifier.fillMaxWidth().height((if(count==0)0f else (count.toFloat()/max*70).coerceAtLeast(3f)).dp).background(if(zone==0)MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,RoundedCornerShape(4.dp)))
                            Text(if(zone==0)stringResource(R.string.miss_short)else zone.toString(),style=MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
        if (showEndResults) item { SectionHeading(stringResource(R.string.report_series)) }
        if (showEndResults) items(details.orderedEnds,key={it.end.id}) { end ->
            val editable = onEditShot != null && end.shots.isNotEmpty()
            Surface(
                onClick = { editingEnd = end }, enabled = editable,
                modifier = Modifier.fillMaxWidth().testTag("report-end-${end.end.id}"),
                shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, if(editable) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
            ) {
                Column(Modifier.padding(20.dp), verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                        Text(roundLabels[end.end.id] ?: stringResource(R.string.end_number,end.end.number),style=MaterialTheme.typography.titleMedium)
                        if (showResult) Text("${end.shots.sumOf{it.points}} / ${end.end.plannedCount*10}",style=MaterialTheme.typography.titleMedium)
                    }
                    end.shots.sortedBy { it.inputIndex }.forEach { shot ->
                        Text(reportShotLabel(shot), style=MaterialTheme.typography.bodyMedium, color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if(end.shots.isEmpty()) Text("Попаданий пока нет", style=MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
    editingEnd?.let { end ->
        ModalBottomSheet(onDismissRequest={editingEnd=null}) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp).testTag("report-end-editor"),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Text((roundLabels[end.end.id] ?: "Серия ${end.end.number}") + " · изменить попадание",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                    IconButton({editingEnd=null}) { FableIcon(Glyph.Close,description="Закрыть серию") }
                }
                end.shots.sortedBy { it.inputIndex }.forEach { shot ->
                    OutlinedButton({editingEnd=null;onEditShot?.invoke(shot.id)},Modifier.fillMaxWidth().heightIn(min=52.dp).testTag("report-edit-${shot.id}")) {
                        Text(reportShotLabel(shot))
                    }
                }
            }
        }
    }
}

@Composable
private fun ReportResultMetric(label: String, value: String, modifier: Modifier) {
    Column(modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

private fun reportShotLabel(shot: ShotEntity): String {
    val score = if(shot.zoneCode=="X") "X · 10" else if(shot.points==0) "M · 0" else shot.points.toString()
    val position = if(shot.x!=null && shot.y!=null) "на мишени" else "по очкам"
    return "${shot.inputIndex+1}. $score · $position"
}

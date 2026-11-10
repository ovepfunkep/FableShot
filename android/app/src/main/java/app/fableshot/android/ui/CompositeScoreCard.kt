package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.data.journal.JournalScoringInput
import app.fableshot.android.data.journal.compositeReportScore
import app.fableshot.android.data.journal.hasCompleteReportEnds
import app.fableshot.android.domain.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CompositeScoreCard(input:JournalScoringInput) {
    if (!statisticVisible(StatisticFeature.GeneralScore) || !input.hasCompleteReportEnds) return
    val showGrouping = statisticVisible(StatisticFeature.Grouping)
    val showStability = statisticVisible(StatisticFeature.Stability)
    val showVolume = statisticVisible(StatisticFeature.Volume)
    var profileName by rememberSaveable(input.scopeId){mutableStateOf(CompositeProfile.Standard.name)}
    var scopeEnd by rememberSaveable(input.scopeId){mutableStateOf(false)}
    var requestedSlice by rememberSaveable(input.scopeId){mutableIntStateOf(Int.MAX_VALUE)}
    var expanded by rememberSaveable(input.scopeId){mutableStateOf(false)}
    var controls by rememberSaveable(input.scopeId){mutableStateOf(false)}
    var help by rememberSaveable(input.scopeId){mutableStateOf(false)}
    val profile=CompositeProfile.entries.firstOrNull{it.name==profileName}?:CompositeProfile.Standard
    val slice=requestedSlice.coerceAtMost(input.ends.size).coerceAtLeast(0)
    val result=remember(input,profile,slice,scopeEnd){input.compositeReportScore(slice,profile,scopeEnd)}
    FableCard(modifier=Modifier.testTag("cg3-card")) {
        val scoreTerm=stringResource(R.string.cg3_title)
        Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FableIcon(Glyph.Spark, tint = MaterialTheme.colorScheme.primary)
            Text(scoreTerm, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            IconButton({ controls = !controls }, Modifier.testTag("cg3-controls")) {
                FableIcon(Glyph.Filters, description = "Настроить общие очки")
            }
            IconButton({ help = true }, Modifier.testTag("cg3-help")) {
                FableIcon(Glyph.Help, description = "Как считаются общие очки")
            }
        }
        if(controls) {
        FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            CompositeProfile.entries.forEach{p->FilterChip(profile==p,{profileName=p.name},{Text(stringResource(if(p==CompositeProfile.Standard)R.string.cg3_standard else R.string.cg3_score_only))},Modifier.heightIn(min=48.dp).testTag("cg3-profile-${p.name}"))}
        }

        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            FilterChip(!scopeEnd,{scopeEnd=false},{Text(stringResource(R.string.cg3_cumulative))},Modifier.testTag("cg3-cumulative"))
            FilterChip(scopeEnd,{scopeEnd=true},{Text(stringResource(R.string.cg3_single))},Modifier.testTag("cg3-single"))
        }
        if(input.ends.isNotEmpty())Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            input.ends.forEach{end->FilterChip(slice==end.number,{requestedSlice=end.number},{Text(stringResource(R.string.cg3_slice,end.number))},Modifier.testTag("cg3-slice-${end.number}"))}
        }
        }
        if (result.availability != ScoreAvailability.NoData) Row(verticalAlignment=androidx.compose.ui.Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            Text(result.total?.let(ScoreRounding::display)?:"—",Modifier.testTag("cg3-total"),style=MaterialTheme.typography.displayMedium)
            Text("/ 105",Modifier.padding(bottom=6.dp),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if(result.availability==ScoreAvailability.Available) {
            Component(stringResource(R.string.cg3_base),result.base!!,100.0)
            if (showGrouping) result.groupBonus?.let{Component(stringResource(R.string.cg3_group),it,if(result.phase==CompositePhase.Full)4.0 else 5.0)}
            if (showStability) result.stabilityBonus?.let{Component(stringResource(R.string.cg3_stability),it,if(profile==CompositeProfile.ScoreOnly)5.0 else 1.0)}
        } else {
            Text(if (result.availability == ScoreAvailability.NoData) "Нет полных серий в выбранном срезе" else stringResource(when(result.availability){
                ScoreAvailability.NoData->R.string.cg3_no_data
                ScoreAvailability.IncompleteSlice->R.string.cg3_incomplete_slice
                ScoreAvailability.IncompleteEnd->R.string.cg3_incomplete_end
                ScoreAvailability.InsufficientEndShots->R.string.cg3_short_end
                ScoreAvailability.InsufficientEnds->R.string.cg3_short_slice
                ScoreAvailability.MissingCoordinates->R.string.cg3_missing_positions
                ScoreAvailability.UnverifiedGeometry->R.string.cg3_unverified
                ScoreAvailability.UnknownMaximum->R.string.cg3_unknown_maximum
                else->R.string.cg3_invalid
            }),Modifier.testTag("cg3-reason"),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if(help) ModalBottomSheet(onDismissRequest={help=false;expanded=false}, modifier=Modifier.testTag("cg3-help-sheet")) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text(scoreTerm, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
        }
        Text(stringResource(if(profile==CompositeProfile.Standard)R.string.cg3_intro else R.string.cg3_intro_numeric),style=MaterialTheme.typography.bodyMedium)
        Text("В расчёт входят только полностью внесённые серии. Неполные серии пропускаются; " +
            "полная открытая серия уже участвует до перехода к следующей.", style = MaterialTheme.typography.bodyMedium)
        if (showVolume) Text("В выбранном срезе: ${result.endCount} полных серий · ${result.shotCount} стрел",
            style = MaterialTheme.typography.bodySmall)
        result.base?.let{Text(stringResource(R.string.cg3_plain_base,result.classic,result.maximum?.toString()?:"—",ScoreRounding.display(it)),style=MaterialTheme.typography.bodyMedium)}
        if(profile==CompositeProfile.Standard)Text(stringResource(R.string.cg3_plain_group),style=MaterialTheme.typography.bodyMedium)
        Text(stringResource(R.string.cg3_plain_stability),style=MaterialTheme.typography.bodyMedium)
        TextButton({expanded=!expanded},Modifier.testTag("cg3-explain")){Text(stringResource(if(expanded)R.string.cg3_hide else R.string.cg3_explain))}
        if(expanded)Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.cg3_formula_title),style=MaterialTheme.typography.titleMedium)
            Text(when {profile==CompositeProfile.ScoreOnly->"G = 100A + 5T";result.phase==CompositePhase.Full->"G = 100A + 4Q + T";else->"E = 100A + 5Q"},style=MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.cg3_formula_hint),style=MaterialTheme.typography.bodySmall)
            if(showGrouping && result.rms!=null)Text("RMS · "+java.math.BigDecimal.valueOf(result.rms).setScale(4,java.math.RoundingMode.HALF_UP).toPlainString()+" R"+(input.radiusMm?.let{" · "+ScoreRounding.display(result.rms*it)+" мм"}?:""),style=MaterialTheme.typography.bodySmall)
            if(showGrouping && result.q!=null)Text("Q · "+ScoreRounding.display(result.q),style=MaterialTheme.typography.bodySmall)
            if(showStability && result.stability!=null)Text("T · "+ScoreRounding.display(result.stability),style=MaterialTheme.typography.bodySmall)
            result.rawEquivalent?.let{Text(stringResource(R.string.cg3_raw_equivalent,ScoreRounding.display(it)),style=MaterialTheme.typography.bodySmall)}
            Text(stringResource(R.string.cg3_rounding_hint),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(profile.id,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        } }
    }
}

@Composable
private fun Component(label:String,value:Double,maximum:Double) {
    val motion=LocalFableVisuals.current.motion
    val fraction by animateFloatAsState((value/maximum).toFloat().coerceIn(0f,1f),animationSpec=if(motion)tween(360)else snap(),label="score component")
    Column(verticalArrangement=Arrangement.spacedBy(5.dp)) {
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(label,style=MaterialTheme.typography.bodyMedium);Text("${ScoreRounding.display(value)} / ${maximum.toInt()}",style=MaterialTheme.typography.labelLarge)}
        LinearProgressIndicator(progress={fraction},modifier=Modifier.fillMaxWidth().height(5.dp),color=MaterialTheme.colorScheme.primary,trackColor=MaterialTheme.colorScheme.outlineVariant)
    }
}

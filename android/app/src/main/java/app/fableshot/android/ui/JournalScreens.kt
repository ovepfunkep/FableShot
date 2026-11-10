package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.data.journal.*
import app.fableshot.android.data.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JournalSetupScreen(busy:Boolean,initial:JournalBlock?=null,equipment:List<EquipmentItem> = emptyList(),newSession:Boolean=initial==null,initialSeriesPerRound:Int?=10,techniqueRepository:app.fableshot.android.technique.TechniqueRepository?=null,techniquePreferences:UserPreferences?=null,onAddEquipment:(()->Unit)?=null,onEditEquipment:((EquipmentItem)->Unit)?=null,preferredEquipmentId:String?=null,presetTools:TrainingPresetTools?=null,onNotes:(()->Unit)?=null,onTimer:(()->Unit)?=null,hideScores:Boolean=false,onHideScores:((Boolean)->Unit)?=null,initialNumbering:Boolean?=null,initialRoundArrowLimit:Int?=null,onApply:(String,BlockPlan)->Unit) {
    key(initial?.id, newSession) {
    var advanced by rememberSaveable { mutableStateOf(false) }
    var techniqueSelection by rememberSaveable(initial?.id){mutableStateOf<String?>(null)}
    var techniqueWindow by rememberSaveable{mutableStateOf(false)}
    var title by rememberSaveable { mutableStateOf("") }
    var distance by rememberSaveable(initial?.id) { mutableStateOf(initial?.distanceMeters?.let{number(it).replace(",0","")}?:"") }
    var diameter by rememberSaveable(initial?.id) { mutableStateOf(initial?.targetDiameterMm?.div(10)?.toString()?:"") }
    var mode by rememberSaveable(initial?.id) { mutableStateOf(initial?.mode?:"scored") }
    var roundUnit by rememberSaveable(initial?.id) { mutableStateOf(when {
        initialRoundArrowLimit != null || initial == null -> "arrows"
        initialSeriesPerRound != null -> "series"
        else -> "unlimited"
    }) }
    var totalEnds by rememberSaveable(initial?.id){mutableStateOf((initialSeriesPerRound ?: 10).toString())}
    var totalArrows by rememberSaveable(initial?.id) { mutableStateOf((initialRoundArrowLimit ?: 30).toString()) }
    var profileId by rememberSaveable(initial?.id){mutableStateOf(initial?.targetProfileId?:TargetCatalog.practice.id)}
    val profileConfirmed=TargetCatalog.find(profileId)!=null
    val profile=TargetCatalog.find(profileId)?:TargetCatalog.practice
    val limit = if (newSession) when (roundUnit) {
        "arrows" -> totalArrows.toIntOrNull()?.takeIf { it in 1..MAX_SERIES_ARROWS }
        "series" -> totalEnds.toIntOrNull()?.takeIf { it in 1..200 }
        else -> null
    } else null
    val available=selectableEquipment(equipment).filter { it.kind=="setup" }
    val savedEquipmentId = remember(initial?.equipmentSnapshotJson) { HabitualTraining.equipmentId(initial?.equipmentSnapshotJson) }
    val savedEquipmentName = remember(initial?.equipmentSnapshotJson) {
        initial?.equipmentSnapshotJson?.let { raw -> runCatching {
            org.json.JSONObject(raw).optJSONObject("selection")?.optString("name")?.takeIf { it.isNotBlank() }
        }.getOrNull() }
    }
    var equipmentChanged by rememberSaveable { mutableStateOf(false) }
    var equipmentId by rememberSaveable(initial?.id) { mutableStateOf(
        HabitualTraining.equipmentId(initial?.equipmentSnapshotJson) ?: if(initial==null)available.firstOrNull{it.favorite}?.id else null
    ) }
    var appliedEquipmentId by rememberSaveable(initial?.id) { mutableStateOf<String?>(null) }
    var numberingOverride by rememberSaveable { mutableStateOf(initialNumbering) }
    val d=distance.replace(',','.').toDoubleOrNull()?.takeIf{it.isFinite()&&it>0}
    val mm=diameter.toIntOrNull()?.takeIf{it in 1..1000}?.times(10)
    LaunchedEffect(preferredEquipmentId,available) {
        if((newSession || equipmentChanged) && preferredEquipmentId!=appliedEquipmentId && available.any { it.id==preferredEquipmentId }) {
            equipmentId=preferredEquipmentId
            appliedEquipmentId=preferredEquipmentId
            equipmentChanged=true
        }
    }
    val selectedEquipment=available.firstOrNull{it.id==equipmentId}
    val keepSavedEquipment = !newSession && !equipmentChanged && savedEquipmentId != null && equipmentId == savedEquipmentId
    val snapshot = if (keepSavedEquipment) initial?.equipmentSnapshotJson else selectedEquipment?.let { equipmentSnapshot(it,equipment) }
    val equipmentLabel = if (keepSavedEquipment || (equipmentId == savedEquipmentId && selectedEquipment == null)) savedEquipmentName
        else selectedEquipment?.name
    val plan=BlockPlan(d,mm,if(newSession) 3 else initial?.defaultArrowsPerEnd ?: 3,mode,snapshot,
        targetProfileId=profile.id,techniqueSelection=techniqueSelection?.let { app.fableshot.android.technique.TechniqueSelection.parse(it) },
        seriesPerRound=limit.takeIf { roundUnit == "series" },flexibleSeries=newSession,numberedArrows=numberingOverride,
        roundArrowLimit=limit.takeIf { roundUnit == "arrows" })
    val hasNumberedSet = HabitualTraining.block(plan).physicalArrowSet() != null
    val fallback=stringResource(R.string.untitled_training)
    var equipmentWindow by rememberSaveable { mutableStateOf(false) }
    val selectionAvailable = equipmentId == null || selectedEquipment != null || keepSavedEquipment
    val canApply=!busy&&selectionAvailable&&(mode!="scored"||profileConfirmed)&&plan.valid()&&(!newSession||roundUnit=="unlimited"||limit!=null)
    Column(Modifier.fillMaxSize().imePadding().testTag("journal-setup")) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal=20.dp,vertical=8.dp).testTag("conditions-content"),
            verticalArrangement=Arrangement.spacedBy(10.dp),
        ) {
            if(newSession&&presetTools!=null) TrainingPresetControls(plan,canApply,presetTools)
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val stacked=maxWidth<300.dp||androidx.compose.ui.platform.LocalDensity.current.fontScale>1.35f
                @Composable fun Distance(modifier:Modifier) {
                    ConditionNumber("Дистанция","м",distance,listOf(10,18,30),"distance",!busy,
                        distance.isNotBlank()&&d==null,modifier) { distance=it.take(10) }
                }
                @Composable fun Diameter(modifier:Modifier) {
                    val choices=(if(profile.diameters.isEmpty()) listOf(40,60,80) else profile.diameters.map { it/10 }).take(3)
                    ConditionNumber("Диаметр","см",diameter,choices,"diameter",!busy,
                        diameter.isNotBlank()&&(mm==null||!profile.acceptsDiameter(mm)),modifier) { diameter=it.take(4) }
                }
                if(stacked) Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    Distance(Modifier.fillMaxWidth())
                    if(mode=="scored")Diameter(Modifier.fillMaxWidth())
                } else Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    Distance(if(mode=="scored")Modifier.weight(1f) else Modifier.fillMaxWidth())
                    if(mode=="scored")Diameter(Modifier.weight(1f))
                }
            }
            if(mode=="scored") TargetProfileChoice(profileId,compact=true,enabled=!busy) { chosen->
                profileId=chosen.id
                if(mm?.let(chosen::acceptsDiameter)!=true) diameter=chosen.diameters.firstOrNull()?.div(10)?.toString()?:diameter
            }
            ConditionRow("Комплект",equipmentLabel?:stringResource(R.string.equipment_none),
                Glyph.Kit,{equipmentWindow=true},Modifier.testTag("conditions-equipment"),!busy,actions={
                    if(selectedEquipment!=null&&onEditEquipment!=null) IconButton({equipmentChanged=true;onEditEquipment(selectedEquipment)},
                        Modifier.size(44.dp).testTag("equipment-edit-choice-${selectedEquipment.id}"),enabled=!busy) {
                        FableIcon(Glyph.Edit,description="Изменить выбранный комплект")
                    }
            })
            ConditionRow(
                if(newSession)"Раунд"else"Параметры тренировки",
                if(newSession) {
                    (when (roundUnit) {
                        "arrows" -> limit?.let { "$it стрел" } ?: "Укажи число стрел"
                        "series" -> limit?.let { "$it серий" } ?: "Укажи число серий"
                        else -> "Без ограничения"
                    })+
                        if(mode=="count_only")" · без оценки" else ""
                } else "Таймер, заметки и отображение",
                Glyph.Settings,{advanced=true},Modifier.testTag("conditions-options"),!busy,
            )
            if(mode=="scored"&&!profileConfirmed) Text(stringResource(R.string.target_unknown_choose),color=MaterialTheme.colorScheme.error)
        }
        Surface(color=MaterialTheme.colorScheme.background) {
            FablePrimaryButton(
                stringResource(if(busy)R.string.saving else if(newSession)R.string.start else R.string.block_apply),
                {onApply(title.trim().ifBlank { fallback },plan)},
                Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=12.dp).testTag("start-training"),
                enabled=canApply,
            )
        }
    }
    if(equipmentWindow) ModalBottomSheet(onDismissRequest={equipmentWindow=false},
        sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp).testTag("conditions-equipment-sheet"),
            verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Text("Комплект",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
            }
            if (keepSavedEquipment && selectedEquipment == null) Text("Сохранённый комплект · ${savedEquipmentName.orEmpty()}",
                Modifier.testTag("conditions-saved-equipment"), style = MaterialTheme.typography.bodyMedium)
            EquipmentChoice("Снаряжение",available,equipmentId,{equipmentChanged=true;equipmentId=it;equipmentWindow=false},
                enabled=!busy,onAdd=onAddEquipment?.let { add->{equipmentChanged=true;equipmentWindow=false;add()} },
                onEdit=onEditEquipment?.let { edit->{item->equipmentChanged=true;equipmentWindow=false;edit(item)} })
            if(available.isEmpty()) Text("Добавь комплект из лука и стрел.",style=MaterialTheme.typography.bodyMedium)
        }
    }
    if(advanced) ModalBottomSheet(onDismissRequest={advanced=false},
        sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(20.dp)
            .testTag("conditions-options-sheet"),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Text("Параметры тренировки",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
            }
            Text("Учёт стрел",style=MaterialTheme.typography.titleSmall)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Номера физических стрел", style = MaterialTheme.typography.titleSmall)
                    Text(if (hasNumberedSet) "Выбор номера после сохранения попадания" else "Выбери комплект с номерным набором стрел",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(hasNumberedSet && (numberingOverride ?: true), { numberingOverride = it },
                    enabled = !busy && hasNumberedSet && mode == "scored", modifier = Modifier.testTag("conditions-numbered-arrows"))
            }
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf("scored" to R.string.scored_mode,"count_only" to R.string.count_mode).forEach { (id,label)->
                    FilterChip(mode==id,{mode=id},{Text(stringResource(label))},Modifier.testTag("plan-$id"),enabled=!busy)
                }
            }
            if(newSession) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Ограничение раунда", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    HelpButton("О формате раунда", "По стрелам: вводи серии любой длины, пока не достигнешь лимита. " +
                        "Затем «Следующий раунд» откроет новую серию. По сериям: граница наступает после выбранного числа серий. " +
                        "Без ограничения: новый раунд начинаешь вручную. Невнесённые стрелы не становятся промахами. " +
                        "Формат сохраняется для этой тренировки; старые тренировки не меняются.", iconOnly = true)
                }
                FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    FilterChip(roundUnit=="arrows",{roundUnit="arrows"},{Text("Стрелы")},Modifier.testTag("volume-arrows"),enabled=!busy)
                    FilterChip(roundUnit=="series",{roundUnit="series"},{Text("Серии")},Modifier.testTag("volume-fixed"),enabled=!busy)
                    FilterChip(roundUnit=="unlimited",{roundUnit="unlimited"},{Text("Без лимита")},Modifier.testTag("volume-free"),enabled=!busy)
                }
                if(roundUnit=="arrows") ConditionNumber("Стрел в раунде", "стрел", totalArrows,
                    listOf(30,60,72), "round-arrows", !busy, limit==null, Modifier.fillMaxWidth()) { totalArrows=it.take(7) }
                if(roundUnit=="series") OutlinedTextField(totalEnds,{totalEnds=it.take(3)},Modifier.fillMaxWidth().testTag("volume-ends"),
                    label={Text("Серий в раунде")},singleLine=true,enabled=!busy,isError=limit==null,
                    keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number))
                TextButton({roundUnit="arrows";totalArrows="30"},Modifier.testTag("classic-training-preset"),enabled=!busy) {
                    Text("Классика · 2 × 30 = 60 стрел")
                }
                if(techniqueRepository!=null&&techniquePreferences!=null) {
                    TextButton({advanced=false;techniqueWindow=true},Modifier.testTag("setup-technique"),enabled=!busy) {
                        FableIcon(Glyph.Notes);Spacer(Modifier.width(8.dp))
                        Text(if(techniqueSelection==null)"Памятка и фокус"else"Памятка и фокус выбраны")
                    }
                    if(techniqueSelection!=null)TextButton({techniqueSelection=null},enabled=!busy) {Text("Убрать выбор памятки")}
                }
                OutlinedTextField(title,{title=it.take(100)},Modifier.fillMaxWidth().testTag("title-field"),
                    label={Text(stringResource(R.string.optional_title))},singleLine=true,enabled=!busy)
            }
            if(!newSession&&onHideScores!=null) ScoreVisibilityPreference(hideScores,onHideScores)
            if(!newSession&&onTimer!=null) TextButton({advanced=false;onTimer()},Modifier.testTag("conditions-timer"),enabled=!busy) {
                FableIcon(Glyph.Timer);Spacer(Modifier.width(8.dp));Text("Таймер серии и отдыха")
            }
            if(!newSession&&onNotes!=null) TextButton({advanced=false;onNotes()},Modifier.testTag("conditions-notes"),enabled=!busy) {
                FableIcon(Glyph.Notes);Spacer(Modifier.width(8.dp));Text("Заметки этих условий")
            }
            FablePrimaryButton("Готово",{advanced=false},Modifier.fillMaxWidth().testTag("conditions-options-done"),enabled=!busy)
        }
    }
    if(techniqueWindow&&techniqueRepository!=null&&techniquePreferences!=null)app.fableshot.android.technique.TechniqueWindow(techniqueRepository,techniquePreferences,onClose={techniqueWindow=false},onSelect={techniqueSelection=it.json();techniqueWindow=false})
    }
}

@Composable
fun CountPractice(details:JournalDetails,busy:Boolean,onCount:(Int)->Unit,onNext:()->Unit,onStats:()->Unit,onFinish:()->Unit,onTimer:(()->Unit)?=null,
    selectedEndId:String?=null,navigation:(@Composable ()->Unit)?=null,
) {
    val live=details.currentEnd?:return
    val current=details.orderedBlocks.flatMap { it.orderedEnds }.firstOrNull { it.end.id==selectedEndId } ?: live
    val viewingPast=current.end.id!=live.end.id
    val count=current.volume;val planned=current.end.plannedCount
    val rolling=details.rollingRounds
    val canAdvance=!viewingPast&&(if(rolling) count>0 else current.full)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp).testTag("count-practice"),verticalArrangement=Arrangement.spacedBy(20.dp)) {
        Text(details.roundProgress(current.end.id).title,style=MaterialTheme.typography.titleLarge)
        navigation?.invoke()
        FableCard {
            Eyebrow(stringResource(R.string.count_mode))
            Text(if(rolling) "$count" else "$count / $planned",style=MaterialTheme.typography.displayLarge,modifier=Modifier.testTag("unscored-count"))
            TermHelp(stringResource(R.string.count_mode),stringResource(R.string.count_mode_hint))
            Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                OutlinedButton({onCount(count-1)},Modifier.weight(1f).heightIn(min=56.dp).testTag("count-minus"),enabled=!busy&&!viewingPast&&count>0){Text("−",style=MaterialTheme.typography.headlineMedium)}
                FablePrimaryButton("+1",{onCount(count+1)},Modifier.weight(1f).heightIn(min=56.dp).testTag("count-plus"),enabled=!busy&&!viewingPast&&count<(if(rolling) MAX_SERIES_ARROWS else planned))
            }
            if(busy) Text(stringResource(R.string.saving),style=MaterialTheme.typography.bodySmall)
        }
        if(statisticVisible(StatisticFeature.Volume))MetricTile(details.orderedBlocks.flatMap{it.orderedEnds}.sumOf{it.volume}.toString(),stringResource(R.string.arrows_label),Modifier.fillMaxWidth(),Glyph.Bow)
        if(onTimer!=null)TextButton(onTimer,Modifier.testTag("practice-timer-open")) {FableIcon(Glyph.Timer);Spacer(Modifier.width(8.dp));Text("Таймер")}
        FablePrimaryButton(stringResource(nextTrainingAction(details)),onNext,Modifier.fillMaxWidth().testTag("next-end"),enabled=canAdvance&&!busy)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){TextButton(onStats,Modifier.testTag("statistics")){Text(stringResource(R.string.statistics))};TextButton(onFinish,Modifier.testTag("finish-training"),enabled=!busy){Text(stringResource(R.string.finish))}}
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JournalReportScreen(details:JournalDetails,onEditShot:((String)->Unit)?=null,onEditCount:((String,Int,Long)->Unit)?=null,sourceVersions:Map<String,Long>?=null,onNotes:((NoteScope)->Unit)?=null,awards:List<app.fableshot.android.domain.EarnedAchievement> = emptyList(),trainingTime:TrackedTrainingTime?=null,
    recordEvents: List<PersonalRecordEvent> = emptyList(), availableRecordSessions: Set<String>? = null, onRecordSession: ((String) -> Unit)? = null) {
    var selected by rememberSaveable(details.session.id){mutableStateOf<String?>(null)}
    var editingCount by remember{mutableStateOf<JournalEndDetails?>(null)}
    var countText by rememberSaveable{mutableStateOf("")}
    val scopes=remember(details) {details.reportScopes()}
    val scope=scopes.firstOrNull {it.id==selected} ?: scopes.filterNot {it.id.startsWith("part-")}.maxByOrNull {it.volume} ?: return
    val block=remember(scope) {scope.merged()}
    val ends=block.orderedEnds.filter { it.end.role == "scored" }
    val showArrowAnalysis = statisticVisible(StatisticFeature.NumberedArrows)
    val arrowAnalysis=remember(details.session,scope,showArrowAnalysis) {
        if (showArrowAnalysis) physicalArrowAnalysis(listOf(details.copy(blocks=scope.blocks))) else emptyList()
    }
    val sessionRecords = remember(details.session.id, recordEvents) { recordEvents.filter { it.sessionId == details.session.id } }
    val showTime = statisticVisible(StatisticFeature.TrainingTime)
    val showSeries = statisticVisible(StatisticFeature.Series)
    val showVolume = statisticVisible(StatisticFeature.Volume)
    val showResult = statisticVisible(StatisticFeature.Result)
    val showRecords = statisticVisible(StatisticFeature.Records)
    val showMeanTrend = statisticVisible(StatisticFeature.MeanTrend) && statisticVisible(StatisticFeature.Average)
    val showDetails = showResult || showVolume || showArrowAnalysis ||
        statisticVisible(StatisticFeature.Average) || statisticVisible(StatisticFeature.Grouping) || statisticVisible(StatisticFeature.Offset) ||
        statisticVisible(StatisticFeature.GeneralScore) || statisticVisible(StatisticFeature.ProgressScore) ||
        statisticVisible(StatisticFeature.Norms) || statisticVisible(StatisticFeature.HitMap) ||
        statisticVisible(StatisticFeature.Distribution)
    val overview: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
        if (showTime) item("training-time") { TrainingTimeLabel(trainingTime) }
        journalReportOverview(details, onEnd={ end ->
            if (details.blocks.first { it.block.id == end.end.blockId }.block.mode == "count_only") {
                editingCount=end
                countText=end.volume.toString()
            } else end.shots.minByOrNull { it.inputIndex }?.let { onEditShot?.invoke(it.id) }
        }, canEditShots=onEditShot!=null, canEditCounts=onEditCount!=null, showSeries=showSeries)
        if (showRecords && sessionRecords.isNotEmpty()) item { PersonalRecordReportCard(sessionRecords, availableRecordSessions, onRecordSession) }
        if(awards.any{it.valid})item {TrainingAchievementsCard(awards)}
        if (showMeanTrend) item("training-mean-trend") {TrainingMeanTrendCard(details)}
        if (showDetails) item {
            Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                SectionHeading("Подробная статистика", icon=Glyph.Progress)
                if (scopes.size > 1) {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        scopes.forEachIndexed { index, item ->
                            val title = if (item.id == "all") "Все условия" else item.title
                            FilterChip(scope.id==item.id,{selected=item.id},{Text(if(showVolume) "$title · ${item.volume} стрел" else title)},
                                Modifier.heightIn(min=48.dp).testTag("report-block-$index"))
                        }
                    }
                }
                if (block.block.targetProfileId?.startsWith("mytargets-source-")==true)
                    Text(stringResource(R.string.import_coordinates_unverified),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                val xCount=ends.sumOf { e -> e.shots.count { it.zoneCode=="X" } }
                if (showResult && xCount>0) Text("X · $xCount",style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary)
            }
        }
        if(showArrowAnalysis && arrowAnalysis.isNotEmpty())item("physical-arrow-analysis") {PhysicalArrowAnalysisCard(arrowAnalysis)}
    }
    Box(Modifier.fillMaxSize().testTag("journal-report")) {
        if (block.block.mode=="count_only") {
            androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().testTag("report-screen"),
                contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(18.dp)) {
                overview()
                item { InfoCard(stringResource(R.string.count_mode),stringResource(R.string.count_mode_hint),icon=Glyph.Bow) }
            }
        } else ReportScreen(details.copy(blocks=listOf(block.copy(ends=ends))).presentation(block.copy(ends=ends),scoredOnly=false)
            .let { app.fableshot.android.data.SessionDetails(it.session,it.ends) },
            onEditShot, scoring=block.scoringInput().copy(scopeId="report:${scope.id}"), baseline=scope.baseline,sourceVersions=sourceVersions,
            progressScopeMessage=if(scope.blocks.size>1&&scope.baseline==null&&scope.blocks.any {it.baselines.isNotEmpty()})"Базы прогресса этих частей отличаются. Выбери отдельную часть для сравнения."else null,
            norms=details,overview=overview,showSeries=false)
    }
    editingCount?.let{end->AlertDialog(onDismissRequest={editingCount=null},title={Text(stringResource(R.string.count_edit_title))},text={Column {OutlinedTextField(countText,{countText=it.take(2)},Modifier.testTag("history-count-field"),label={Text(stringResource(R.string.count_edit_value,end.end.plannedCount))},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number));if(onNotes!=null)TextButton({editingCount=null;onNotes(NoteScope(details.session.id,end.end.blockId,end.end.id))},Modifier.testTag("count-end-notes")){Text("Заметки серии")}}},confirmButton={TextButton({onEditCount?.invoke(end.end.id,countText.toInt(),end.end.revision);editingCount=null},Modifier.testTag("history-count-save"),enabled=countText.toIntOrNull()?.let{it in 0..end.end.plannedCount}==true){Text(stringResource(R.string.save))}},dismissButton={TextButton({editingCount=null}){Text(stringResource(R.string.cancel))}})}
}


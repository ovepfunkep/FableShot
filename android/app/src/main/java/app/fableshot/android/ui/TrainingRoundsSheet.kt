package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.data.journal.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrainingRoundsSheet(
    details:JournalDetails,
    busy:Boolean,
    onDismiss:()->Unit,
    onSelectEnd:(String)->Unit,
    onNewRound:()->Unit,
    hideScores:Boolean=false,
    onRemoveRound: ((String, String, Long) -> Unit)? = null,
    allowNewRound: Boolean = details.session.state == "active",
) {
    var confirmation by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Pair<RoundProgress,Long>?>(null) }
    val rounds=remember(details) { details.trainingRounds() }
    val current=details.roundProgress().number
    val showResult=!hideScores&&statisticVisible(StatisticFeature.Result)
    val showAverage=!hideScores&&statisticVisible(StatisticFeature.Average)
    ModalBottomSheet(onDismissRequest=onDismiss,
        sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().heightIn(max=680.dp).navigationBarsPadding().testTag("training-rounds-sheet")) {
            Row(Modifier.fillMaxWidth().padding(horizontal=20.dp),verticalAlignment=Alignment.CenterVertically) {
                Text("Раунды тренировки",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
            }
            LazyColumn(Modifier.weight(1f,fill=false),contentPadding=PaddingValues(20.dp),
                verticalArrangement=Arrangement.spacedBy(10.dp)) {
                items(rounds,key={it.number}) { round ->
                    val shots=round.ends.flatMap { it.shots }
                    val volume=round.ends.sumOf { it.volume }
                    val points=shots.sumOf { it.points }
                    val target=round.ends.lastOrNull()?.end?.id
                    Surface(onClick={target?.let { onSelectEnd(it);onDismiss() }},
                        enabled=!busy&&target!=null,shape=MaterialTheme.shapes.large,
                        color=if(round.number==current)MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
                        modifier=Modifier.fillMaxWidth().testTag("training-round-${round.number}")) {
                        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                                Text("Раунд ${round.number}",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
                                if(round.number==current)Text("Текущий",style=MaterialTheme.typography.labelMedium,
                                    color=MaterialTheme.colorScheme.primary)
                                if (onRemoveRound != null) IconButton({ removing = round to details.session.revision },
                                    Modifier.testTag("remove-round-${round.number}"), enabled = !busy) {
                                    FableIcon(Glyph.Trash, description = "Удалить раунд ${round.number}")
                                }
                            }
                            val mean = if (shots.isNotEmpty()) averageNumber(points.toDouble()/shots.size) else "—"
                            val results=buildList {
                                if(showResult&&shots.isNotEmpty())add("$points${round.maximum?.let { "/$it" }.orEmpty()} очков")
                                if(showAverage&&shots.isNotEmpty())add("средний $mean")
                            }
                            if(results.isNotEmpty())Text(results.joinToString(" · "),style=MaterialTheme.typography.bodyMedium)
                            Text("${round.ends.count { it.volume>0 }} серий · $volume стрел",style=MaterialTheme.typography.bodySmall,
                                color=MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            if (allowNewRound) FablePrimaryButton("Начать новый раунд",{confirmation=true},
                Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=12.dp).testTag("start-new-round"),
                enabled=!busy&&details.canStartNextRound,icon=Glyph.Plus)
        }
    }
    if(confirmation)AlertDialog(onDismissRequest={confirmation=false},title={Text("Начать новый раунд?")},
        text={Text("Внесённые попадания останутся в текущем раунде. Пропущенные стрелы и серии не добавятся. Новый раунд начнётся с первой серии.")},
        confirmButton={TextButton({confirmation=false;onNewRound();onDismiss()},
            Modifier.testTag("confirm-new-round"),enabled=!busy){Text("Начать раунд")}},
        dismissButton={TextButton({confirmation=false}){Text("Отмена")}})
    removing?.let { (round, revision) ->
        AlertDialog(onDismissRequest={if(!busy)removing=null},title={Text("Удалить раунд ${round.number}?")},
            text={Text("${round.ends.size} серий · ${round.ends.sumOf { it.volume }} стрел. Попадания и заметки этих серий будут удалены. Тренировка останется.")},
            confirmButton={TextButton({
                round.ends.firstOrNull()?.let { onRemoveRound?.invoke(details.session.id,it.end.id,revision) }
                removing=null;onDismiss()
            },Modifier.testTag("confirm-remove-round"),enabled=!busy){Text("Удалить")}},
            dismissButton={TextButton({removing=null},enabled=!busy){Text("Отмена")}})
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrainingSeriesSheet(details: JournalDetails, selectedEndId: String, busy: Boolean,
    onDismiss: () -> Unit, onSelectEnd: (String) -> Unit, hideScores: Boolean = false,
    onRemoveEnd: ((String, Long) -> Unit)? = null) {
    val round = details.roundProgress(selectedEndId)
    var removing by remember { mutableStateOf<JournalEndDetails?>(null) }
    val showResult = !hideScores && statisticVisible(StatisticFeature.Result)
    val showAverage = !hideScores && statisticVisible(StatisticFeature.Average)
    ModalBottomSheet(onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 680.dp).navigationBarsPadding()
            .padding(horizontal = 20.dp).testTag("training-series-sheet")) {
            Text("Серии · раунд ${round.number}", style = MaterialTheme.typography.titleLarge)
            LazyColumn(contentPadding = PaddingValues(vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(round.ends, key = { it.end.id }) { entry ->
                    val number = round.ends.indexOf(entry) + 1
                    val shots = entry.shots
                    Surface(onClick = { onSelectEnd(entry.end.id); onDismiss() }, enabled = !busy,
                        shape = MaterialTheme.shapes.large,
                        color = if (entry.end.id == selectedEndId) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
                        modifier = Modifier.fillMaxWidth().testTag("training-select-series-$number")) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Серия $number", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                            val summary = buildList {
                                if (showResult && shots.isNotEmpty()) add("${shots.sumOf { it.points }} очков")
                                if (showAverage && shots.isNotEmpty()) add(averageNumber(shots.sumOf { it.points }.toDouble() / shots.size))
                                if (shots.isEmpty()) add("—")
                            }
                            Text(summary.joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
                            if (onRemoveEnd != null) IconButton({removing=entry},
                                Modifier.testTag("remove-series-$number"),enabled=!busy) {
                                FableIcon(Glyph.Trash,description="Удалить серию $number")
                            }
                        }
                    }
                }
            }
        }
    }
    removing?.let { entry ->
        AlertDialog(onDismissRequest={if(!busy)removing=null},title={Text("Удалить серию?")},
            text={Text("${entry.volume} стрел. Попадания и заметки этой серии будут удалены.")},
            confirmButton={TextButton({onRemoveEnd?.invoke(entry.end.id,entry.end.revision);removing=null;onDismiss()},
                Modifier.testTag("confirm-remove-series"),enabled=!busy){Text("Удалить")}},
            dismissButton={TextButton({removing=null},enabled=!busy){Text("Отмена")}})
    }
}

@Composable
internal fun TrainingStructureManager(details: JournalDetails, busy: Boolean, onDismiss: () -> Unit,
    onRemoveEnd: (String,Long) -> Unit, onRemoveRound: (String,String,Long) -> Unit,
    onEditEnd: (JournalEndDetails) -> Unit) {
    var roundEndId by remember(details.session.id) { mutableStateOf<String?>(null) }
    if (roundEndId == null) TrainingRoundsSheet(details,busy,
        onDismiss={if(roundEndId==null)onDismiss()},onSelectEnd={roundEndId=it},onNewRound={},
        onRemoveRound=onRemoveRound,allowNewRound=false)
    else TrainingSeriesSheet(details,requireNotNull(roundEndId),busy,onDismiss,
        onSelectEnd={id->details.orderedBlocks.flatMap {it.orderedEnds}.firstOrNull {it.end.id==id}?.let(onEditEnd);onDismiss()},
        onRemoveEnd=onRemoveEnd)
}

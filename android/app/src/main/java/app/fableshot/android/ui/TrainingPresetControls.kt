package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.BlockPlan
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

data class TrainingPresetTools(
    val raw:String?,val select:(TrainingPreset)->Unit,
    val save:suspend(TrainingPreset)->Unit,val remove:suspend(String)->Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrainingPresetControls(plan:BlockPlan?,canSave:Boolean,tools:TrainingPresetTools) {
    val read=remember(tools.raw) {runCatching {TrainingPresets.decode(tools.raw)}}
    val values=read.getOrNull().orEmpty()
    var picker by rememberSaveable {mutableStateOf(false)}
    var editing by remember {mutableStateOf<TrainingPreset?>(null)}
    var deleting by remember {mutableStateOf<TrainingPreset?>(null)}
    var busy by remember {mutableStateOf(false)}
    var error by remember {mutableStateOf<String?>(null)}
    var query by rememberSaveable {mutableStateOf("")}
    val scope=rememberCoroutineScope()
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        TextButton({picker=true;error=null},Modifier.weight(1f).testTag("training-presets"),enabled=!busy,
            contentPadding=PaddingValues(horizontal=0.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                FableIcon(Glyph.Favorite);Spacer(Modifier.width(10.dp));Text("Избранные условия")
            }
        }
        IconButton({editing=TrainingPreset(name="",plan=requireNotNull(plan).copy(techniqueSelection=null));error=null},
            Modifier.testTag("save-training-preset"),enabled=canSave&&!busy&&read.isSuccess&&values.size<TrainingPresets.LIMIT) {
            FableIcon(Glyph.Plus,description="Сохранить условия в избранное")
        }
    }
    if(picker) ModalBottomSheet(onDismissRequest={if(!busy)picker=false},sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.85f).padding(20.dp).testTag("training-presets-sheet"),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                Text("Избранные условия",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
            }
            when {
                read.isFailure -> Text("Не удалось прочитать избранные условия. Остальной дневник доступен; повреждённые записи не перезаписаны.",color=MaterialTheme.colorScheme.error)
                values.isEmpty() -> Text("Сначала задай условия тренировки и сохрани их кнопкой +.",style=MaterialTheme.typography.bodyMedium)
                else -> {
                    OutlinedTextField(query,{query=it.take(60)},Modifier.fillMaxWidth().testTag("preset-search"),label={Text("Поиск условий")},singleLine=true)
                    LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                        items(values.filter {it.name.contains(query,ignoreCase=true)},key={it.id}) { preset ->
                            Surface(onClick={picker=false;tools.select(preset)},enabled=!busy,modifier=Modifier.fillMaxWidth().testTag("preset-${preset.id}"),
                                shape=RoundedCornerShape(16.dp),border=BorderStroke(1.dp,MaterialTheme.colorScheme.primary)) {
                                Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                                        Text(preset.name,style=MaterialTheme.typography.titleMedium)
                                        Text(presetDescription(preset.plan),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    IconButton({editing=preset;error=null},Modifier.testTag("preset-rename-${preset.id}"),enabled=!busy) {FableIcon(Glyph.Edit,description="Переименовать избранные условия")}
                                    IconButton({deleting=preset;error=null},Modifier.testTag("preset-delete-${preset.id}"),enabled=!busy) {FableIcon(Glyph.Trash,description="Удалить избранные условия")}
                                }
                            }
                        }
                    }
                }
            }
            if(editing==null && deleting==null) error?.let {Text(it,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
        }
    }
    editing?.let { preset ->
        var name by rememberSaveable(preset.id,preset.revision) {mutableStateOf(preset.name)}
        AlertDialog(onDismissRequest={if(!busy)editing=null},title={Text(if(preset.revision==0L)"Сохранить условия"else"Название условий")},
            text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name,{name=it.take(60)},Modifier.fillMaxWidth().testTag("preset-name"),label={Text("Название")},singleLine=true,enabled=!busy)
                error?.let {Text(it,Modifier.testTag("preset-error"),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
            }},confirmButton={TextButton({scope.launch {
                busy=true;error=null
                try {tools.save(preset.copy(name=name.trim()));editing=null}
                catch(e:Exception) {
                    if(e is CancellationException)throw e
                    error=when(e) {is TrainingPresetNameTaken->"Такое название уже есть";is TrainingPresetConflict->"Условия изменились. Закрой окно и открой их снова.";else->"Не удалось сохранить. Попробуй снова."}
                } finally {busy=false}
            }},Modifier.testTag("preset-save"),enabled=!busy&&name.isNotBlank()&&name.none {it.code<32}) {Text(if(busy)"Сохраняем…"else"Сохранить")}},
            dismissButton={TextButton({editing=null},enabled=!busy) {Text("Отмена")}})
    }
    deleting?.let { preset ->
        AlertDialog(onDismissRequest={if(!busy)deleting=null},title={Text("Удалить избранные условия?")},
            text={Column {Text(preset.name);error?.let {Text(it,color=MaterialTheme.colorScheme.error)}}},
            confirmButton={TextButton({scope.launch {
                busy=true;error=null
                try {tools.remove(preset.id);deleting=null}
                catch(e:Exception) {if(e is CancellationException)throw e;error="Не удалось удалить. Попробуй снова."}
                finally {busy=false}
            }},Modifier.testTag("preset-delete-confirm"),enabled=!busy) {Text("Удалить")}},
            dismissButton={TextButton({deleting=null},enabled=!busy) {Text("Отмена")}})
    }
}

private fun presetDescription(plan:BlockPlan):String = buildList {
    if(plan.mode=="count_only")add("Без оценки")
    plan.distanceMeters?.let {add("${number(it,if(it%1.0==0.0)0 else 1)} м")}
    plan.diameterMm?.let {add("${number(it/10.0,if(it%10==0)0 else 1)} см")}
    add("${plan.arrows} стрел")
    add(plan.roundArrowLimit?.let {"$it стрел в раунде"}
        ?: plan.forOpenPractice().seriesPerRound?.let {"$it серий в раунде"} ?: "Без ограничения раунда")
}.joinToString(" · ")

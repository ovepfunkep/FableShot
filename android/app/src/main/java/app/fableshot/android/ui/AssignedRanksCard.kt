package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.material3.Text as MaterialText
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssignedRanksCard(repository:RankAssignmentRepository, modifier: Modifier = Modifier) {
    var rows by remember(repository) { mutableStateOf<List<RankAssignment>?>(null) }
    var readError by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    var editing by remember { mutableStateOf<RankAssignment?>(null) }
    var removing by remember { mutableStateOf<RankAssignment?>(null) }
    var history by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope=rememberCoroutineScope()
    val category=LocalRankPreferences.current.category
    LaunchedEffect(repository,retry) {
        try {readError=false;repository.records.collect {rows=it}}
        catch(e:Exception) {if(e is CancellationException)throw e;readError=true}
    }
    fun edit(value:RankAssignment) {editing=value;error=null}
    @Composable fun Record(value:RankAssignment) {
        Row(Modifier.fillMaxWidth().testTag("assigned-rank-${value.id}"),verticalAlignment=Alignment.CenterVertically) {
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Text("${rankDisciplines[value.discipline]}(${if(value.category=="male")"М"else"Ж"}) · ${value.level}",style=MaterialTheme.typography.titleMedium)
                Text(listOfNotNull(value.assignedOn,if(value.current)"Текущий"else"В истории").joinToString(" · "),style=MaterialTheme.typography.bodySmall)
                if(value.issuedBy.isNotBlank()) Text(value.issuedBy,style=MaterialTheme.typography.bodySmall)
                if(value.reference.isNotBlank()) Text(value.reference,style=MaterialTheme.typography.bodySmall)
                Text("Указан пользователем",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton({edit(value)},Modifier.testTag("assigned-edit-${value.id}"),enabled=!busy) { FableIcon(Glyph.Edit,description="Изменить присвоенный разряд") }
        }
    }
    val current = rows.orEmpty().filter { it.current }
    val single = current.singleOrNull()
    val summary = when {
        readError -> "Ошибка чтения"
        rows == null -> "…"
        current.isEmpty() -> "—"
        single != null -> "${single.level} · ${rankDisciplines[single.discipline]}"
        else -> "${current.size} текущих"
    }
    MetricTile(summary, "Присвоенный разряд", modifier.testTag("profile-assigned-rank"), Glyph.Podium,
        action = {
            IconButton({ history = true }, Modifier.testTag("assigned-open"), enabled = !busy) {
                FableIcon(Glyph.Edit, description = "Присвоенные разряды: просмотр и редактирование")
            }
        })
    if(history) ModalBottomSheet(onDismissRequest={if(!busy)history=false}) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp).testTag("assigned-history-sheet"),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                Text("Присвоенные разряды",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
            }
            when {
                readError -> TextButton({retry++}) { Text("Не удалось прочитать записи · повторить") }
                rows == null -> CircularProgressIndicator(Modifier.size(24.dp))
                rows.orEmpty().isEmpty() -> Text("Пока не указан", style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            rows.orEmpty().sortedWith(compareByDescending<RankAssignment> { it.current }.thenByDescending { it.assignedOn })
                .forEach { Record(it); HorizontalDivider() }
            OutlinedButton({ edit(RankAssignment(category = category.orEmpty())) },
                Modifier.fillMaxWidth().testTag("assigned-add"), enabled = !busy && !readError && rows != null) {
                FableIcon(Glyph.Plus)
                Spacer(Modifier.width(8.dp))
                MaterialText("Добавить присвоенный разряд")
            }
        }
    }
    editing?.let { value ->
        RankAssignmentEditor(value,busy,error,onClose={editing=null},onRemove={removing=value}) { draft ->
            scope.launch {
                busy=true;error=null
                try {repository.save(draft);editing=null}
                catch(e:Exception) {
                    if(e is CancellationException)throw e
                    error=if(e is RankAssignmentConflict)"Запись изменилась. Закрой окно и открой её заново."else"Не удалось сохранить. Попробуй снова."
                } finally {busy=false}
            }
        }
    }
    removing?.let { value ->
        AlertDialog(onDismissRequest={if(!busy)removing=null},title={Text("Удалить отметку разряда?")},
            text={Text("${rankDisciplines[value.discipline]} · ${value.level}")},
            confirmButton={TextButton({scope.launch {
                busy=true;error=null
                try {repository.remove(value);removing=null;editing=null}
                catch(e:Exception) {if(e is CancellationException)throw e;error="Не удалось удалить. Закрой подтверждение и попробуй снова."}
                finally {busy=false}
            }},Modifier.testTag("assigned-delete-confirm"),enabled=!busy) {Text("Удалить")}},
            dismissButton={TextButton({removing=null},enabled=!busy) {Text("Отмена")}})
    }
}

@OptIn(ExperimentalMaterial3Api::class,ExperimentalLayoutApi::class)
@Composable
private fun RankAssignmentEditor(value:RankAssignment,busy:Boolean,error:String?,onClose:()->Unit,onRemove:()->Unit,onSave:(RankAssignment)->Unit) {
    var discipline by rememberSaveable(value.id,value.revision) {mutableStateOf(value.discipline)}
    var category by rememberSaveable(value.id,value.revision) {mutableStateOf(value.category)}
    var level by rememberSaveable(value.id,value.revision) {mutableStateOf(value.level)}
    var date by rememberSaveable(value.id,value.revision) {mutableStateOf(value.assignedOn.orEmpty())}
    var issuer by rememberSaveable(value.id,value.revision) {mutableStateOf(value.issuedBy)}
    var reference by rememberSaveable(value.id,value.revision) {mutableStateOf(value.reference)}
    var current by rememberSaveable(value.id,value.revision) {mutableStateOf(value.current)}
    var choosing by rememberSaveable {mutableStateOf<String?>(null)}
    val draft=value.copy(discipline=discipline,category=category,level=level,assignedOn=date.trim().takeIf {it.isNotEmpty()},issuedBy=issuer.trim(),reference=reference.trim(),current=current)
    ModalBottomSheet(onDismissRequest={if(!busy)onClose()},sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(20.dp).testTag("assigned-editor"),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                Text(if(value.revision==0L)"Добавить присвоенный разряд"else"Изменить отметку",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                IconButton(onClose,enabled=!busy) {FableIcon(Glyph.Close,description="Закрыть отметку разряда")}
            }
            OutlinedButton({choosing="discipline"},Modifier.fillMaxWidth().testTag("assigned-discipline"),enabled=!busy) {Text("Дисциплина · ${rankDisciplines[discipline]}")}
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf("male" to "Мужчины","female" to "Женщины").forEach {(id,label)->
                    FilterChip(category==id,{category=id},{Text(label)},Modifier.testTag("assigned-category-$id"),enabled=!busy)
                }
            }
            OutlinedButton({choosing="level"},Modifier.fillMaxWidth().testTag("assigned-level"),enabled=!busy) {MaterialText("Разряд / звание · $level")}
            OutlinedTextField(date,{date=it.take(10)},Modifier.fillMaxWidth().testTag("assigned-date"),
                label={Text("Дата присвоения · необязательно")},placeholder={Text("ГГГГ-ММ-ДД")},singleLine=true,enabled=!busy,
                isError=date.isNotBlank() && runCatching {java.time.LocalDate.parse(date).toString()==date}.getOrDefault(false)!=true)
            OutlinedTextField(issuer,{issuer=it.take(120)},Modifier.fillMaxWidth().testTag("assigned-issuer"),label={Text("Кем присвоен · необязательно")},enabled=!busy)
            OutlinedTextField(reference,{reference=it.take(500)},Modifier.fillMaxWidth().testTag("assigned-reference"),label={Text("Приказ / примечание · необязательно")},enabled=!busy)
            Row(verticalAlignment=Alignment.CenterVertically) {
                Text("Текущий разряд этой дисциплины",Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
                Switch(current,{current=it},Modifier.testTag("assigned-current"),enabled=!busy)
            }
            error?.let {Text(it,Modifier.testTag("assigned-error"),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
            FablePrimaryButton(if(busy)"Сохраняем…"else"Сохранить",{onSave(draft)},Modifier.fillMaxWidth().testTag("assigned-save"),enabled=!busy&&draft.valid()&&(value.revision==0L || draft!=value))
            if(value.revision>0) TextButton(onRemove,Modifier.testTag("assigned-delete"),enabled=!busy) {FableIcon(Glyph.Trash);Spacer(Modifier.width(8.dp));Text("Удалить отметку")}
        }
    }
    choosing?.let { kind ->
        AlertDialog(onDismissRequest={choosing=null},title={Text(if(kind=="discipline")"Дисциплина"else"Разряд / звание")},
            text={Column(Modifier.verticalScroll(rememberScrollState())) {
                val choices=if(kind=="discipline")rankDisciplines.toList()else rankLevels.map {it to it}
                choices.forEach {(id,label)->TextButton({if(kind=="discipline")discipline=id else level=id;choosing=null},Modifier.fillMaxWidth().testTag("assigned-choice-$id")) {Text(label)}}
            }},confirmButton={TextButton({choosing=null}) {Text("Закрыть")}})
    }
}

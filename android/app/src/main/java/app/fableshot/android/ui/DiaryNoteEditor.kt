package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.journal.*

internal val DiaryNoteSaver=listSaver<DiaryNote,Any>(save={value ->
    listOf(value.id,value.sessionId.orEmpty(),value.blockId.orEmpty(),value.endId.orEmpty(),value.localDate,
        value.body,value.tagsJson,value.place,value.feeling,value.conditions,value.createdAtMs,value.updatedAtMs,value.revision)
},restore={v ->DiaryNote(v[0] as String,(v[1] as String).takeIf {it.isNotEmpty()},(v[2] as String).takeIf {it.isNotEmpty()},
    (v[3] as String).takeIf {it.isNotEmpty()},v[4] as String,v[5] as String,v[6] as String,v[7] as String,
    v[8] as String,v[9] as String,v[10] as Long,v[11] as Long,v[12] as Long)})

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DiaryNoteEditor(value:DiaryNote,busy:Boolean,error:String?,onClose:()->Unit,onSave:(DiaryNote)->Unit,onRemove:(DiaryNote)->Unit) {
    var body by rememberSaveable(value.id) {mutableStateOf(value.body)}
    var date by rememberSaveable(value.id) {mutableStateOf(value.localDate)}
    var tags by rememberSaveable(value.id) {mutableStateOf(NoteTags.decode(value.tagsJson).joinToString(", "))}
    var place by rememberSaveable(value.id) {mutableStateOf(value.place)}
    var feeling by rememberSaveable(value.id) {mutableStateOf(value.feeling)}
    var conditions by rememberSaveable(value.id) {mutableStateOf(value.conditions)}
    var detached by rememberSaveable(value.id) {mutableStateOf(false)}
    var context by rememberSaveable(value.id) {mutableStateOf(listOf(value.place,value.feeling,value.conditions).any {it.isNotBlank()})}
    var discard by remember {mutableStateOf(false)}
    var deleting by remember {mutableStateOf(false)}
    val tagJson=runCatching {NoteTags.encode(tags)}.getOrNull()
    val draft=value.copy(body=body,localDate=date,tagsJson=tagJson ?: "invalid",place=place.trim(),feeling=feeling.trim(),conditions=conditions.trim(),
        sessionId=if(detached)null else value.sessionId,blockId=if(detached)null else value.blockId,endId=if(detached)null else value.endId)
    val changed=draft!=value
    fun close() {if(!busy){if(changed)discard=true else onClose()}}
    ModalBottomSheet(onDismissRequest=::close,sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(20.dp).testTag("note-editor"),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                Text(if(value.revision==0L)"Новая заметка"else"Заметка",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                IconButton(::close,enabled=!busy) {FableIcon(Glyph.Close,description="Закрыть редактор заметки")}
            }
            if(value.sessionId!=null&&!detached)Row(verticalAlignment=Alignment.CenterVertically) {
                Text(noteScopeTitle(value.scope()),Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
                TextButton({detached=true},Modifier.testTag("note-detach"),enabled=!busy) {Text("Отвязать")}
            }
            OutlinedTextField(date,{date=it.take(10)},Modifier.fillMaxWidth().testTag("note-date"),label={Text("Дата")},placeholder={Text("ГГГГ-ММ-ДД")},singleLine=true,enabled=!busy,
                isError=runCatching {java.time.LocalDate.parse(date).toString()==date}.getOrDefault(false)!=true)
            OutlinedTextField(body,{body=it.take(8000)},Modifier.fillMaxWidth().testTag("note-body"),label={Text("Мои наблюдения")},minLines=4,maxLines=12,enabled=!busy)
            OutlinedTextField(tags,{tags=it.take(500)},Modifier.fillMaxWidth().testTag("note-tags"),label={Text("Теги через запятую")},enabled=!busy,isError=tagJson==null)
            TextButton({context=!context},Modifier.testTag("note-context"),enabled=!busy) {Text(if(context)"Скрыть ручной контекст"else"Место, самочувствие и условия")}
            if(context) {
                OutlinedTextField(place,{place=it.take(120)},Modifier.fillMaxWidth().testTag("note-place"),label={Text("Место · необязательно")},enabled=!busy)
                OutlinedTextField(feeling,{feeling=it.take(240)},Modifier.fillMaxWidth().testTag("note-feeling"),label={Text("Самочувствие · со своих слов")},enabled=!busy)
                OutlinedTextField(conditions,{conditions=it.take(500)},Modifier.fillMaxWidth().testTag("note-conditions"),label={Text("Условия · мои наблюдения")},enabled=!busy)
            }
            error?.let {Text(it,Modifier.testTag("note-error"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)}
            FablePrimaryButton(if(busy)"Сохраняем…"else"Сохранить",{onSave(draft)},Modifier.fillMaxWidth().testTag("note-save"),enabled=!busy&&changed&&draft.valid())
            if(value.revision>0)TextButton({deleting=true},Modifier.testTag("note-delete"),enabled=!busy) {FableIcon(Glyph.Trash);Spacer(Modifier.width(8.dp));Text("Удалить заметку")}
        }
    }
    if(discard)AlertDialog(onDismissRequest={discard=false},title={Text("Не сохранять изменения?")},
        confirmButton={TextButton(onClose,Modifier.testTag("note-discard")) {Text("Не сохранять")}},
        dismissButton={TextButton({discard=false}) {Text("Продолжить запись")}})
    if(deleting)AlertDialog(onDismissRequest={if(!busy)deleting=false},title={Text("Удалить заметку?")},
        text={error?.let {Text(it,color=MaterialTheme.colorScheme.error)}},
        confirmButton={TextButton({onRemove(value)},Modifier.testTag("note-delete-confirm"),enabled=!busy) {Text("Удалить")}},
        dismissButton={TextButton({deleting=false},enabled=!busy) {Text("Отмена")}})
}

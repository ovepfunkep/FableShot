package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

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
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun NotebookScreen(repository:DiaryNoteRepository,scope:NoteScope=NoteScope(),sessions:List<SessionSummary> = emptyList(),onSession:((SessionSummary)->Unit)?=null) {
    var notes by remember(repository,scope) {mutableStateOf<List<DiaryNote>?>(null)}
    var readError by remember {mutableStateOf(false)}
    var retry by remember {mutableIntStateOf(0)}
    var query by rememberSaveable(scope.sessionId,scope.blockId,scope.endId) {mutableStateOf("")}
    var editingId by rememberSaveable {mutableStateOf<String?>(null)}
    var creating by rememberSaveable {mutableStateOf(false)}
    var createdAt by rememberSaveable {mutableLongStateOf(0)}
    var busy by remember {mutableStateOf(false)}
    var error by remember {mutableStateOf<String?>(null)}
    val coroutine=rememberCoroutineScope()
    LaunchedEffect(repository,scope,retry) {
        try {readError=false;repository.notes(scope).collect {notes=it}}
        catch(e:Exception) {if(e is CancellationException)throw e;readError=true}
    }
    val needle=query.trim().removePrefix("#")
    val filtered=notes.orEmpty().filter {note ->
        listOf(note.body,note.place,note.feeling,note.conditions,note.tagsJson,note.localDate)
            .any {it.contains(needle,ignoreCase=true)}
    }
    Column(Modifier.fillMaxSize().padding(16.dp).testTag("notebook-screen"),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment=Alignment.CenterVertically) {
            OutlinedTextField(query,{query=it.take(120)},Modifier.weight(1f).testTag("note-search"),label={Text("Поиск по заметкам")},singleLine=true)
            IconButton({editingId=UUID.randomUUID().toString();creating=true;createdAt=System.currentTimeMillis();error=null},Modifier.testTag("note-add"),enabled=!busy&&!readError) {
                FableIcon(Glyph.Plus,description="Написать заметку")
            }
        }
        when {
            readError -> TextButton({retry++}) {Text("Не удалось загрузить записи · повторить")}
            notes==null -> CircularProgressIndicator(Modifier.size(28.dp))
            filtered.isEmpty() -> Text(if(query.isNotBlank())"Ничего не найдено"else"Пока нет заметок. Можно написать отдельную запись без тренировки.",
                Modifier.testTag("notes-empty"),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            else -> LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                items(filtered,key={it.id}) { note ->
                    Surface(onClick={editingId=note.id;creating=false;error=null},modifier=Modifier.fillMaxWidth().testTag("note-${note.id}"),
                        shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surface,border=BorderStroke(1.dp,MaterialTheme.colorScheme.primary)) {
                        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                            Text(note.localDate,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            if(note.body.isNotBlank())Text(note.body,style=MaterialTheme.typography.bodyMedium,maxLines=4,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            val context=listOf(note.place,note.feeling,note.conditions).filter {it.isNotBlank()}.joinToString(" · ")
                            if(context.isNotBlank())Text(context,style=MaterialTheme.typography.bodySmall,maxLines=3,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            val tags=NoteTags.decode(note.tagsJson)
                            if(tags.isNotEmpty())Text(tags.joinToString(" ") {"#$it"},style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary)
                            note.sessionId?.let {id ->
                                val source=sessions.firstOrNull {it.id==id}
                                if(source!=null && onSession!=null)TextButton({onSession(source)},Modifier.testTag("note-source-${note.id}")) {
                                    Text("${noteScopeTitle(note.scope())} · ${source.title}",maxLines=2)
                                }else Text("${noteScopeTitle(note.scope())} · тренировка недоступна или в корзине",style=MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }
    editingId?.let { id ->
        val initial=notes?.firstOrNull {it.id==id} ?: if(creating)DiaryNote(id=id,sessionId=scope.sessionId,blockId=scope.blockId,endId=scope.endId,createdAtMs=createdAt,updatedAtMs=createdAt)else null
        if(initial!=null) {
            val snapshot=rememberSaveable(id,saver=DiaryNoteSaver) {initial}
            DiaryNoteEditor(snapshot,busy,error,onClose={editingId=null},onSave={value ->
                coroutine.launch {
                    busy=true;error=null
                    try {repository.save(value);editingId=null}
                    catch(e:Exception) {if(e is CancellationException)throw e;error=if(e is DiaryNoteConflict)"Запись изменилась. Закрой окно и открой её заново."else"Не удалось сохранить. Попробуй снова."}
                    finally {busy=false}
                }
            },onRemove={value ->
                coroutine.launch {
                    busy=true;error=null
                    try {repository.remove(value);editingId=null}
                    catch(e:Exception) {if(e is CancellationException)throw e;error="Не удалось удалить. Попробуй снова."}
                    finally {busy=false}
                }
            })
        }
    }
}

internal fun noteScopeTitle(scope:NoteScope)=when {
    scope.endId!=null -> "Заметки серии"
    scope.blockId!=null -> "Заметки условий"
    scope.sessionId!=null -> "Заметки тренировки"
    else -> "Отдельная запись"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesWindow(repository:DiaryNoteRepository,scope:NoteScope,sessions:List<SessionSummary>,onClose:()->Unit,onSession:((SessionSummary)->Unit)?=null) {
    ModalBottomSheet(onDismissRequest=onClose,sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.94f).testTag("notes-window")) {
            Row(Modifier.padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically) {
                Text(noteScopeTitle(scope),Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                IconButton(onClose) {FableIcon(Glyph.Close,description="Закрыть заметки")}
            }
            NotebookScreen(repository,scope,sessions,onSession)
        }
    }
}

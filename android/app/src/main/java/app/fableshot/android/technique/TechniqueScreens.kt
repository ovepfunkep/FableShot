package app.fableshot.android.technique

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import app.fableshot.android.ui.Text
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.Saver
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.fableshot.android.ui.ScaledDialog as Dialog
import androidx.compose.ui.window.DialogProperties
import app.fableshot.android.data.UserPreferences
import app.fableshot.android.data.journal.JournalDetails
import app.fableshot.android.data.journal.roundProgress
import app.fableshot.android.ui.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable fun TechniqueWindow(repo:TechniqueRepository,preferences:UserPreferences,onClose:()->Unit,onSelect:((TechniqueSelection)->Unit)?=null,initialVersion:String?=null) {
 Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false,dismissOnBackPress=false,dismissOnClickOutside=false)) {
  TechniqueWindowContent(repo,preferences,onClose,onSelect,initialVersion)
 }
}

@Composable private fun TechniqueWindowContent(repo:TechniqueRepository,preferences:UserPreferences,onClose:()->Unit,onSelect:((TechniqueSelection)->Unit)?=null,initialVersion:String?=null) {
 var error by remember { mutableStateOf<String?>(null) }
 var retry by remember { mutableIntStateOf(0) }
 val libraryFlow = remember(repo, retry) {
  repo.library.map<List<TechniqueDocumentDetails>, List<TechniqueDocumentDetails>?> { it }
   .catch { error = "Не удалось открыть памятки"; emit(null) }
 }
 val rows by libraryFlow.collectAsStateWithLifecycle(initialValue = null)
 val scope=rememberCoroutineScope();var busy by remember{mutableStateOf(false)}
 fun work(action:suspend()->Unit){if(busy)return;scope.launch{busy=true;try{action();error=null}catch(e:CancellationException){throw e}catch(e:Exception){error="Не удалось сохранить. Проверь данные и повтори действие."}finally{busy=false}}}
 var editor by rememberSaveable{mutableStateOf<String?>(null)};var reading by rememberSaveable{mutableStateOf(initialVersion)};var ownFocus by rememberSaveable{mutableStateOf(false)};var archives by rememberSaveable{mutableStateOf(false)}
 BackHandler(enabled=editor==null&&reading==null&&!ownFocus,onBack=onClose)

  Surface(Modifier.fillMaxSize()){Column(Modifier.fillMaxSize().padding(16.dp)){
   if(editor==null)TextButton(onClose,enabled=!busy){Text("Закрыть")}
   error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton({retry++}){Text("Повторить чтение")}}
   val list=rows
   if(list==null)CircularProgressIndicator()else {
    val document=list.firstOrNull{it.document.id==editor}
    val version=list.flatMap{it.versions}.firstOrNull{it.id==reading}
    when {
     document!=null->TechniqueEditor(document.document,repo){editor=null}
     version != null || ownFocus -> TechniqueReader(version, onBack = { reading = null; ownFocus = false }, onApply = onSelect,
      onRestore = if (version != null) ({ work {
       val document = list.first { it.document.id == version.documentId }.document
       val payload = TechniqueText.parse(version.payloadJson).copy(discussed = null, change = "Возврат к версии ${version.number}")
       repo.publish(document.id, document.draftJson, payload.json(), countForAchievements = false)
       reading = null
      } }) else null)
     else->Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).testTag("technique-library"),verticalArrangement=Arrangement.spacedBy(10.dp)){
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
       Text("Моя техника", Modifier.weight(1f), style = MaterialTheme.typography.headlineMedium)
       HelpButton("Моя техника", "Личные памятки для работы с тренером. Черновик сохраняется автоматически, а сохранённые версии остаются в истории тренировок.", iconOnly = true)
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
       Button({work{editor=repo.create()}},enabled=!busy,modifier=Modifier.testTag("technique-create")) {
        FableIcon(Glyph.Plus); Spacer(Modifier.width(6.dp)); Text("Создать")
       }
       TechniqueImportButton(enabled = !busy) { imported -> work { editor = repo.create(imported) } }
      }
      if(onSelect!=null)TextButton({ownFocus=true}){Text("Свой фокус без памятки")}
      FilterChip(archives,{archives=!archives},{Text("Архив памяток")})
      list.filter{it.document.archived==archives}.forEach{d->val text=TechniqueText.parse(d.latest?.payloadJson?:d.document.draftJson,true)
       FableCard {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
         FableIcon(Glyph.Notes, Modifier.size(20.dp), tint=MaterialTheme.colorScheme.primary)
         Column(Modifier.weight(1f).clickable(enabled = !busy) {
          d.latest?.let { reading = it.id } ?: run { editor = d.document.id }
         }.testTag(d.latest?.let { "technique-read-${d.document.id}" } ?: "technique-draft-${d.document.id}"),
          verticalArrangement=Arrangement.spacedBy(4.dp)) {
          Text(text.title.ifBlank { "Без названия" }, style = MaterialTheme.typography.titleMedium,
           maxLines = 2, overflow = TextOverflow.Ellipsis)
          val versionLabel = d.latest?.let { "${if(d.document.isPrimary)"Основная · "else ""}v${it.number}" } ?: "Черновик"
          val count = text.phases.sumOf { phase -> phase.steps.size }
          Text("$versionLabel · ${text.phases.size} фаз · $count пунктов", style=MaterialTheme.typography.bodySmall,
           color = MaterialTheme.colorScheme.onSurfaceVariant)
          if(text.context.isNotBlank()) Text(text.context, style=MaterialTheme.typography.bodySmall,
           maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
         }
        ActionMenu("Действия памятки") {
        if(!archives){TextButton({editor=d.document.id},enabled=!busy,modifier=Modifier.testTag("technique-edit-${d.document.id}")){Text("Редактировать")};TextButton({work{repo.create(text.copy(title=(text.title+" — копия").take(100)))}} ,enabled=!busy){Text("Дублировать")};if(d.latest!=null)TextButton({work{repo.primary(d.document.id)}},enabled=!busy){Text("Сделать основной")}}
        TextButton({work{repo.archive(d.document.id,!archives)}},enabled=!busy){Text(if(archives)"Восстановить"else "Архивировать")}
        if(d.versions.size>1){var history by remember{mutableStateOf(false)};TextButton({history=!history}){Text("История версий")};if(history)d.versions.sortedByDescending{it.number}.forEach{v->TextButton({reading=v.id}){Text("Версия ${v.number} · ${java.time.Instant.ofEpochMilli(v.createdAtMs).atZone(java.time.ZoneId.systemDefault()).toLocalDate()}")}}}
        }
      }
      }
      }
       Text("Показ техники",style=MaterialTheme.typography.titleMedium)
      val read by preferences.state.collectAsState(initial=app.fableshot.android.data.SettingsRead.Loading)
      val settings=(read as? app.fableshot.android.data.SettingsRead.Ready)?.value
      settings?.let{s->listOf(Triple("focus",s.techniqueFocus,"Фокус в памятке"),Triple("reflection",s.techniqueReflection,"Рефлексия в разборе")).forEach{(key,value,label)->Row{Checkbox(value,{v->work{preferences.techniqueVisibility(key,v)}});Text(label,Modifier.padding(top=12.dp))}}}
     }
    }
   }
  }}
}

@Composable fun TechniqueEditor(document: TechniqueDocument, repo: TechniqueRepository, onBack: () -> Unit) {
 CompactTechniqueEditor(document, repo, onBack)
}
@Composable fun TechniqueReader(version:TechniqueVersion?,onBack:()->Unit,onApply:((TechniqueSelection)->Unit)?,onRestore:(()->Unit)?){
 val text=remember(version?.id){version?.let{TechniqueText.parse(it.payloadJson)}};var compact by rememberSaveable(version?.id){mutableStateOf(false)};var index by rememberSaveable(version?.id){mutableIntStateOf(0)}
 var f1 by rememberSaveable(version?.id){mutableStateOf("")};var f2 by rememberSaveable(version?.id){mutableStateOf("")}
 BackHandler(onBack=onBack)
 Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).testTag("technique-reader"),verticalArrangement=Arrangement.spacedBy(10.dp)){
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
   TextButton(onBack){Text("Назад")}
   Spacer(Modifier.weight(1f))
   text?.let { TechniqueExportButton(it, version?.let { value -> "Версия ${value.number}" }) }
  }
  Text(text?.title?:"Мой фокус",style=MaterialTheme.typography.headlineLarge)
  if(version!=null)Text("Версия ${version.number}");text?.discussed?.let{Text("Обсуждал с тренером: $it · личная отметка")};text?.change?.takeIf{it.isNotBlank()}?.let{Text(it)}
  if(text!=null){if(text.description.isNotBlank())Text(text.description);FilterChip(compact,{compact=!compact},{Text("На тренировке · кратко")})
   val phases = text.phases.withIndex().filter { !compact || it.index == index }
   phases.forEach { (phaseIndex, phase) ->
    val phaseNumber = phaseIndex + 1
    Text("$phaseNumber. ${techniqueListContent(phase.title)}", style = MaterialTheme.typography.titleLarge)
    phase.steps.forEachIndexed { stepIndex, s ->
     if (!compact || s.visible) {
      if (s.short.isNotBlank() || !compact) Text(techniqueStepLabel(s, phaseNumber, stepIndex + 1),
       style = if (compact) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium)
      if (!compact) {
       techniqueSubpoints(s, phaseNumber, stepIndex + 1).forEach { Text(it) }
       if (s.question.isNotBlank()) Text("Обсудить: ${s.question}")
      }
      if (onApply != null && s.short.isNotBlank()) TextButton({
       if (f1 == s.short) f1 = "" else if (f2 == s.short) f2 = ""
       else if (f1.isBlank()) f1 = s.short else f2 = s.short
      }) { Text("Фокус: ${if (s.short == f1 || s.short == f2) "выбран" else "выбрать"}") }
     }
    }
   }
   if(compact)FlowRow(horizontalArrangement=Arrangement.spacedBy(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){TextButton({index--},enabled=index>0){Text("Назад по фазам")};TextButton({index++},enabled=index<text.phases.lastIndex){Text("Следующая фаза")}}
  }
  if(onApply!=null){OutlinedTextField(f1,{f1=it.take(200)},Modifier.fillMaxWidth().testTag("technique-focus-1"),label={Text("Фокус занятия · необязательно")});OutlinedTextField(f2,{f2=it.take(200)},Modifier.fillMaxWidth(),label={Text("Второй фокус · необязательно")});val choice=remember(version?.id,f1,f2){TechniqueSelection(version?.id,f1,f2)};Button({onApply(choice)},Modifier.testTag("technique-apply")){Text("Использовать на тренировке")}}
  if(onRestore!=null)TextButton(onRestore){Text("Создать новую версию из этой")}
 }
}

@Composable fun TechniqueSession(repo:TechniqueRepository,details:JournalDetails,preferences:UserPreferences,showFocus:Boolean=true,showReflection:Boolean=true){
 var error by remember { mutableStateOf(false) }
 val useFlow = remember(repo, details.session.id) {
  repo.uses(details.session.id).catch { error = true; emit(emptyList()) }
 }
 val libraryFlow = remember(repo) {
  repo.library.catch { error = true; emit(emptyList()) }
 }
 val uses by useFlow.collectAsStateWithLifecycle(initialValue = emptyList())
 val library by libraryFlow.collectAsStateWithLifecycle(initialValue = emptyList())
 var window by rememberSaveable(details.session.id){mutableStateOf(false)};var reading by rememberSaveable(details.session.id){mutableStateOf<String?>(null)};var reflection by remember{mutableStateOf<TechniqueUse?>(null)};val scope=rememberCoroutineScope()
 val active=details.session.state=="active";val last=uses.lastOrNull()
 val focus = last?.let { listOf(it.focus1, it.focus2).filter(String::isNotBlank) }.orEmpty()
 val currentVersion = library.flatMap { it.versions }.firstOrNull { it.id == last?.versionId }
 val relevantUses = uses.filter {
  it.versionId != null || it.focus1.isNotBlank() || it.focus2.isNotBlank() ||
   it.worked.isNotBlank() || it.question.isNotBlank() || it.rating != null
 }
 val hasContent = if (active) last?.versionId != null || focus.isNotEmpty() else relevantUses.isNotEmpty()
 if(active&&!showFocus)return
 if (!error && !hasContent) return
 Column(Modifier.fillMaxWidth().padding(horizontal=16.dp)){
  if(error)Text("Не удалось прочитать технику",color=MaterialTheme.colorScheme.error)
  if(active){
   Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
    IconButton({window=true},Modifier.testTag("session-technique")) { FableIcon(Glyph.Notes,description="Моя техника и фокус") }
    Column(Modifier.weight(1f)) {
     if (focus.isNotEmpty()) focus.forEach { Text(it,maxLines=2,style=MaterialTheme.typography.labelLarge) }
     else currentVersion?.let { Text(TechniqueText.parse(it.payloadJson).title,
      maxLines = 2, style = MaterialTheme.typography.labelLarge) }
    }
    if(last!=null) ActionMenu("Действия с фокусом") {
     TextButton({scope.launch{try{repo.bind(details.session.id,TechniqueSelection(null))}catch(_:Exception){error=true}}}) { Text("Убрать фокус") }
    }
   }
  }else if(relevantUses.isNotEmpty()){
   var expanded by remember{mutableStateOf(false)}
   TextButton({expanded=!expanded},Modifier.testTag("report-technique")){Text("Техника и рефлексия · ${relevantUses.size}")}
   if(expanded)Column(Modifier.heightIn(max=240.dp).verticalScroll(rememberScrollState())){relevantUses.forEach{u->
    val v=library.flatMap{it.versions}.firstOrNull{it.id==u.versionId}
    val sourceEnd=details.orderedBlocks.firstOrNull { it.block.ordinal==u.blockOrdinal }?.orderedEnds?.firstOrNull { it.end.ordinal==u.endOrdinal }
    val place=sourceEnd?.let { details.roundProgress(it.end.id).title } ?: "Серия ${u.endOrdinal+1}"
    val focusText = listOf(u.focus1, u.focus2).filter(String::isNotBlank).joinToString(" · ")
    if (focusText.isNotEmpty()) Text("$place: $focusText")
    else if (v == null) Text(place)
    if(v!=null)TextButton({reading=v.id}){Text((if (focusText.isEmpty()) "$place · " else "") +
     "${TechniqueText.parse(v.payloadJson).title} · версия ${v.number}")}
    if(u.worked.isNotBlank())Text("Получилось: ${u.worked}")
    if(u.question.isNotBlank())Text("Обсудить: ${u.question}")
    u.rating?.let{Text(when(it){"yes"->"Получалось";"unstable"->"Нестабильно";else->"Не отслеживал"})}
    if(showReflection)TextButton({reflection=u}){Text("Рефлексия")}
   }}
  }
 }

 if(window)TechniqueWindow(repo,preferences,onClose={window=false},onSelect={selection->scope.launch{try{repo.bind(details.session.id,selection);window=false}catch(_:Exception){error=true}}},initialVersion=last?.versionId)
 if(reading!=null)TechniqueWindow(repo,preferences,onClose={reading=null},initialVersion=reading)
 reflection?.let{u->var worked by remember(u.id){mutableStateOf(u.worked)};var question by remember(u.id){mutableStateOf(u.question)};var rating by remember(u.id){mutableStateOf(u.rating)};var busy by remember{mutableStateOf(false)}
  AlertDialog(onDismissRequest={if(!busy)reflection=null},title={Text("После тренировки")},text={Column{OutlinedTextField(worked,{worked=it.take(4000)},label={Text("Что получилось?")});OutlinedTextField(question,{question=it.take(4000)},label={Text("Что хочу разобрать?")});listOf("yes" to "Получалось","unstable" to "Нестабильно","untracked" to "Не отслеживал").forEach{(id,label)->FilterChip(rating==id,{rating=if(rating==id)null else id},{Text(label)})}}},confirmButton={TextButton({scope.launch{busy=true;try{repo.reflect(u.id,u.revision,worked,question,rating);reflection=null}catch(_:Exception){error=true}finally{busy=false}}},enabled=!busy){Text("Сохранить")}},dismissButton={TextButton({reflection=null},enabled=!busy){Text("Пропустить")}})
 }
}


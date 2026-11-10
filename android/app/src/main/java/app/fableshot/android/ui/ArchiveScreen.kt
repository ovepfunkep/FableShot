package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.backup.*
import kotlinx.coroutines.*
import java.io.File
import java.text.DateFormat
import java.util.Date

/** Export and full isolated restore rehearsal. Replacing the current diary is a separate step. */
@Composable
fun ArchiveScreen(archive:JournalArchive,initialFile:File?=null,diaries:DiaryManager?=null,canReplace:Boolean=true,onCreated:suspend()->Unit={}) {
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    var busy by remember{mutableStateOf(false)}
    var job by remember{mutableStateOf<Job?>(null)}
    var pendingExport by rememberSaveable{mutableStateOf<String?>(null)}
    var exportAchievement by rememberSaveable{mutableStateOf(true)}
    var incoming by rememberSaveable{mutableStateOf(initialFile?.absolutePath)}
    var preview by remember{mutableStateOf<ArchiveManifest?>(null)}
    var message by remember{mutableStateOf<String?>(null)}
    var confirmation by rememberSaveable{mutableStateOf<String?>(null)}
    var acknowledged by rememberSaveable{mutableStateOf(false)}
    var currentSessions by remember{mutableLongStateOf(0L)}
    var currentShots by remember{mutableLongStateOf(0L)}
    var recovery by remember{mutableStateOf<RecoveryBackupCatalog?>(null)}
    var recoveryFailed by remember{mutableStateOf(false)}
    var recoveryRevision by remember{mutableIntStateOf(0)}
    LaunchedEffect(diaries,recoveryRevision) {
        if(diaries==null)return@LaunchedEffect
        recovery=null;recoveryFailed=false
        try {recovery=diaries.recoveryBackups.discover()}
        catch(error:CancellationException){throw error}
        catch(error:Exception){android.util.Log.e("FableRecovery","Recovery catalog could not be read",error);recoveryFailed=true}
    }
    LaunchedEffect(diaries) {if(diaries!=null)withContext(Dispatchers.IO){
        val db=diaries.current.journal.openHelper.writableDatabase
        currentSessions=db.query("SELECT COUNT(*) FROM sessions").use{it.moveToFirst();it.getLong(0)}
        currentShots=db.query("SELECT COUNT(*) FROM shots").use{it.moveToFirst();it.getLong(0)}
    }}
    val saved=stringResource(R.string.archive_saved)
    val failed=stringResource(R.string.archive_failed)
    val cancelled=stringResource(R.string.archive_cancelled)
    fun work(action:suspend()->Unit) {
        if(busy)return
        busy=true;message=null
        job=scope.launch{try{action()}catch(e:CancellationException){message=cancelled;throw e}catch(_:Exception){message=failed}finally{busy=false}}
    }
    val destination=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")){uri->
        val path=pendingExport
        if(uri==null){path?.let{archive.discard(File(it))};pendingExport=null}
        else if(path!=null)work {
            withContext(Dispatchers.IO) {
                val file=archive.stagedFile(path)
                val coroutine=currentCoroutineContext()
                requireNotNull(context.contentResolver.openOutputStream(uri,"wt")).use{out->file.inputStream().use{input->val buffer=ByteArray(8192);while(true){coroutine.ensureActive();val n=input.read(buffer);if(n<0)break;out.write(buffer,0,n)};out.flush()}}
                archive.discard(file)
            }
            pendingExport=null;message=saved
            if(exportAchievement)try{onCreated()}catch(e:CancellationException){throw e}catch(_:Exception){message="$saved · Не удалось сохранить достижение, повтори создание архива."}
        }
    }
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)work {
        val staged=archive.stage(requireNotNull(context.contentResolver.openInputStream(uri)))
        incoming?.let{archive.discard(archive.stagedFile(it))};incoming=staged.absolutePath
    }}
    LaunchedEffect(incoming) {
        val path=incoming?:return@LaunchedEffect
        busy=true;message=null;preview=null
        try {
            val restored=archive.prepare(archive.stagedFile(path))
            try{preview=restored.manifest}finally{withContext(Dispatchers.IO){archive.discard(restored.directory)}}
        }catch(e:CancellationException){throw e}catch(_:Exception){message=failed}finally{busy=false}
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp).testTag("archive-screen"),verticalArrangement=Arrangement.spacedBy(20.dp)) {
        Text(stringResource(R.string.archive_title),style=MaterialTheme.typography.headlineLarge)
        Text(stringResource(R.string.archive_description),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(diaries!=null)FableCard(Modifier.testTag("recovery-backup-card")) {
            BlockHeading("Копия перед сбросом",Glyph.Archive)
            when {
                recoveryFailed -> {
                    Text("Не удалось прочитать сохранённые копии. Можно повторить поиск или выбрать файл вручную.",
                        Modifier.testTag("recovery-backup-error"),color=MaterialTheme.colorScheme.error)
                    TextButton({recoveryRevision++},enabled=!busy){Text("Повторить поиск")}
                }
                recovery==null -> Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(24.dp));Text("Ищем сохранённую копию…")
                }
                else -> {
                    val catalog=requireNotNull(recovery)
                    if(catalog.issues.isNotEmpty())Text(
                        if(catalog.latest!=null)"Более новая копия повреждена или недоступна. Показана последняя прошедшая проверку."
                        else "Найденные копии повреждены или недоступны. Выбери другой файл архива.",
                        Modifier.testTag("recovery-backup-warning"),color=MaterialTheme.colorScheme.error)
                    val backup=catalog.latest
                    if(backup==null&&catalog.issues.isEmpty())Text("Сохранённых копий перед сбросом пока нет.",
                        Modifier.testTag("recovery-backup-empty"),style=MaterialTheme.typography.bodyMedium)
                    if(backup!=null) {
                        Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(Date(backup.savedAtMs)),
                            Modifier.testTag("recovery-backup-date"))
                        Text("Файл FableShot: ${backup.file.name}",Modifier.testTag("recovery-backup-file"),
                            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("${backup.manifest.rowCounts.getValue("data/journal/sessions.jsonl")} тренировок · ${backup.manifest.rowCounts.getValue("data/journal/shots.jsonl")} стрел · ${formatBackupSize(backup.sizeBytes)}",
                            Modifier.testTag("recovery-backup-counts"),style=MaterialTheme.typography.bodyMedium)
                        FablePrimaryButton("Проверить и восстановить",{
                            work {
                                val staged=diaries.recoveryBackups.stage(backup,archive)
                                incoming?.let{archive.discard(archive.stagedFile(it))}
                                preview=null;incoming=staged.absolutePath
                            }
                        },Modifier.fillMaxWidth().testTag("recovery-backup-preview"),enabled=!busy&&canReplace)
                        OutlinedButton({
                            work {
                                pendingExport?.let{archive.discard(archive.stagedFile(it))}
                                pendingExport=null
                                val staged=diaries.recoveryBackups.stage(backup,archive)
                                try {
                                    val checked=archive.prepare(staged)
                                    withContext(NonCancellable+Dispatchers.IO){archive.discard(checked.directory)}
                                    exportAchievement=false;pendingExport=staged.absolutePath
                                    destination.launch("FableShot-before-reset-${java.time.Instant.ofEpochMilli(backup.savedAtMs).atZone(java.time.ZoneId.systemDefault()).toLocalDate()}.fableshot")
                                }catch(error:Exception) {
                                    withContext(NonCancellable+Dispatchers.IO){archive.discard(staged)}
                                    pendingExport=null;throw error
                                }
                            }
                        },Modifier.fillMaxWidth().testTag("recovery-backup-save"),enabled=!busy&&pendingExport==null){Text("Сохранить копию в файл")}
                    }
                    Text("Здесь ищем только копии перед сбросом, сохранённые FableShot на этом устройстве. При удалении приложения они могут исчезнуть.",
                        style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        FableCard {
            Text(stringResource(R.string.archive_export_title),style=MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.archive_export_hint),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            FablePrimaryButton(stringResource(R.string.archive_export),{
                work {
                    pendingExport?.let{archive.discard(archive.stagedFile(it))};pendingExport=null
                    val result=archive.export()
                    try {
                        val verified=archive.prepare(result.file)
                        withContext(NonCancellable+Dispatchers.IO){archive.discard(verified.directory)}
                    } catch(error:Exception) {
                        withContext(NonCancellable+Dispatchers.IO){archive.discard(result.file)}
                        throw error
                    }
                    exportAchievement=true;pendingExport=result.file.absolutePath
                    destination.launch("FableShot-${java.time.LocalDate.now()}.fableshot")
                }
            },enabled=!busy&&pendingExport==null,modifier=Modifier.fillMaxWidth().testTag("archive-export"))
            if(pendingExport!=null&&!busy)OutlinedButton({destination.launch("FableShot-${java.time.LocalDate.now()}.fableshot")},Modifier.fillMaxWidth()){Text(stringResource(R.string.archive_save_file))}
        }
        FableCard {
            Text(stringResource(R.string.archive_check_title),style=MaterialTheme.typography.titleMedium)
            Text("Проверим файл и восстановим отдельную копию данных перед заменой дневника.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            FablePrimaryButton(stringResource(R.string.archive_check),{preview=null;picker.launch(arrayOf("application/zip","application/octet-stream","*/*"))},Modifier.fillMaxWidth().testTag("archive-check"),enabled=!busy)
        }
        if(busy)Row(horizontalArrangement=Arrangement.spacedBy(16.dp)){CircularProgressIndicator(Modifier.size(24.dp));Text(stringResource(R.string.archive_working))}
        if(busy&&job?.isActive==true)TextButton({job?.cancel()}){Text(stringResource(R.string.cancel))}
        message?.let{Text(it,Modifier.testTag("archive-message"),color=MaterialTheme.colorScheme.onSurfaceVariant)}
        preview?.let{manifest->FableCard(Modifier.testTag("archive-preview")) {
            Text(stringResource(R.string.archive_valid),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.primary)
            Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(Date(manifest.createdAtMs)))
            for((path,label)in listOf("data/journal/sessions.jsonl" to R.string.archive_sessions,"data/journal/shots.jsonl" to R.string.archive_shots,"data/equipment/equipment_items.jsonl" to R.string.archive_equipment))Text(stringResource(label,manifest.rowCounts.getValue(path)))
            Text(stringResource(if(diaries==null)R.string.archive_preview_hint else R.string.archive_apply_hint),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(diaries!=null){
                Text(stringResource(R.string.archive_current_counts,currentSessions,currentShots),style=MaterialTheme.typography.bodySmall)
                FablePrimaryButton(stringResource(R.string.archive_apply),{acknowledged=false;confirmation="replace"},enabled=!busy&&canReplace,modifier=Modifier.fillMaxWidth().testTag("archive-apply"))
            }
        }}
        if(diaries?.previousAvailable()==true)OutlinedButton({acknowledged=false;confirmation="undo"},Modifier.fillMaxWidth().testTag("archive-undo"),enabled=!busy&&canReplace){Text(stringResource(R.string.archive_return_previous))}
    }
    if(confirmation!=null)AlertDialog(
        onDismissRequest={confirmation=null},
        title={Text(stringResource(if(confirmation=="replace")R.string.archive_apply_question else R.string.archive_undo_question))},
        text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text(stringResource(R.string.archive_confirmation))
            if(confirmation=="replace")Text(stringResource(R.string.archive_current_counts,currentSessions,currentShots))
            Row{Checkbox(acknowledged,{acknowledged=it},Modifier.testTag("archive-ack"));Text(stringResource(R.string.archive_ack),Modifier.padding(top=12.dp))}
        }},
        confirmButton={TextButton({
            val action=confirmation;confirmation=null
            work{if(action=="replace")requireNotNull(diaries).restore(archive.stagedFile(requireNotNull(incoming)))else requireNotNull(diaries).undoReplacement()}
        },enabled=acknowledged&&canReplace,modifier=Modifier.testTag("archive-apply-confirm")){Text(stringResource(R.string.archive_confirm_action))}},
        dismissButton={TextButton({confirmation=null}){Text(stringResource(R.string.cancel))}},
    )
}

private fun formatBackupSize(bytes:Long):String = if(bytes<1024L*1024L)"${(bytes+1023)/1024} КБ"
    else String.format(java.util.Locale.getDefault(),"%.1f МБ",bytes.toDouble()/(1024*1024))

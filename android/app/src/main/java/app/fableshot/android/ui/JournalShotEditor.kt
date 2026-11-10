package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.*

@Composable
fun JournalShotEditor(details: JournalDetails, shotId: String, busy: Boolean, onSave: (JournalShot) -> Unit,
    onRemove: (String, Long) -> Unit, onCancel: () -> Unit, onNotes: ((NoteScope) -> Unit)? = null) {
    key(details.session.id, shotId) {
        JournalSeriesEditor(details, shotId, busy, onSave, onRemove, onCancel, onNotes)
    }
}

@Composable
private fun JournalSeriesEditor(details: JournalDetails, shotId: String, busy: Boolean, onSave: (JournalShot) -> Unit,
    onRemove: (String, Long) -> Unit, onCancel: () -> Unit, onNotes: ((NoteScope) -> Unit)?) {
    val endId by rememberSaveable(details.session.id,shotId) {
        mutableStateOf(details.allShots.firstOrNull {it.id==shotId}?.endId
            ?: details.orderedBlocks.flatMap {it.orderedEnds}.firstOrNull {it.end.id==shotId}?.end?.id)
    }
    val block=details.orderedBlocks.firstOrNull {entry->entry.ends.any {it.end.id==endId}}
    val end=block?.orderedEnds?.firstOrNull {it.end.id==endId}
    if(block==null || end==null) {
        Column(Modifier.fillMaxSize().padding(20.dp).testTag("history-shot-editor"),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            IconButton(onCancel) {FableIcon(Glyph.Close,description="Закрыть редактор")}
            InfoCard(stringResource(R.string.shot_missing),stringResource(R.string.diary_load_error_hint))
        }
        return
    }
    val shots=end.shots.sortedBy {it.inputIndex}
    var selected by rememberSaveable(details.session.id,shotId) {mutableStateOf<String?>(null)}
    val source=shots.firstOrNull {it.id==selected}
    val original=source?.presentation()
    var draft by remember(source?.id,source?.revision) {mutableStateOf(original)}
    var zone by remember(source?.id,source?.revision) {mutableStateOf(source?.zoneCode)}
    val changed=source!=null && draft!=null && (draft!=original || zone!=source.zoneCode)
    // Footer callbacks can be retained while the target is edited. Read the latest
    // draft at the moment of the tap instead of capturing an earlier dirty flag.
    val latest by rememberUpdatedState(Triple(source,draft,zone))
    val latestBusy by rememberUpdatedState(busy)
    var removing by remember {mutableStateOf(false)}
    var discard by remember {mutableStateOf(false)}
    var switchAfterSave by remember {mutableStateOf<String?>(null)}
    var waitingRevision by remember {mutableStateOf<Pair<String,Long>?>(null)}
    val profile=block.block.verifiedTarget()
    val arrows=block.block.physicalArrowSet()
    val round=details.roundProgress(end.end.id)

    LaunchedEffect(shots,waitingRevision) {
        if(selected!=null && shots.none {it.id==selected})selected=null
        waitingRevision?.let { (id,revision)->
            if(shots.firstOrNull {it.id==id}?.revision?.let {it>revision}==true) {
                switchAfterSave?.let {selected=it}
                switchAfterSave=null
                waitingRevision=null
            }
        }
    }
    fun hasChanges():Boolean {
        val (old,value,currentZone)=latest
        return old!=null && value!=null && (value!=old.presentation() || currentZone!=old.zoneCode)
    }
    fun save() {
        if(latestBusy)return
        val old=latest.first ?: return
        val value=latest.second ?: return
        val currentZone=latest.third ?: return
        val numberOnly=value==old.presentation().copy(physicalArrowNumber=value.physicalArrowNumber) && currentZone==old.zoneCode
        val keepRaw=old.positionStatus=="unverified" && value.x==null
        val saved=if(numberOnly) old.copy(physicalArrowNumber=value.physicalArrowNumber)
        else old.copy(points=value.points,zoneCode=currentZone,
            x=if(keepRaw)old.x else value.x,y=if(keepRaw)old.y else value.y,
            scoreSource=if(value.origin=="target")"target_computed" else "manual_edit",
            positionStatus=if(keepRaw)"unverified" else if(value.x==null)"unknown" else "known",
            positionSource=if(keepRaw)old.positionSource else if(value.x==null)"none" else "manual_target",
            physicalArrowNumber=value.physicalArrowNumber)
        waitingRevision=old.id to old.revision
        onSave(saved)
    }
    fun choose(shot:ShotEntity?) {
        val id=shot?.id ?: return
        if(latestBusy)return
        if(selected==id) {
            if(!hasChanges())selected=null
            return
        }
        if(hasChanges()) {switchAfterSave=id;save()} else selected=id
    }
    fun back() {
        if(latestBusy)return
        if(hasChanges())discard=true else if(selected!=null)selected=null else onCancel()
    }
    BackHandler {back()}
    val displayed=shots.map {if(it.id==draft?.id)requireNotNull(draft) else it.presentation()}
    Column(Modifier.fillMaxSize().testTag("history-shot-editor")) {
        Row(Modifier.fillMaxWidth().heightIn(min=56.dp).padding(horizontal=8.dp),verticalAlignment=Alignment.CenterVertically) {
            IconButton({if(source!=null)removing=true else onCancel()},
                Modifier.testTag(if(source!=null)"history-remove-shot" else "history-editor-close"),enabled=!busy) {
                FableIcon(if(source!=null)Glyph.Trash else Glyph.Close,
                    description=if(source!=null)"Удалить попадание" else "Закрыть редактор")
            }
            Column(Modifier.weight(1f)) {
                androidx.compose.material3.Text(if(source==null)"Редактор серии" else "Стрела ${source.inputIndex+1}",
                    style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                androidx.compose.material3.Text(round.title,style=MaterialTheme.typography.labelSmall,maxLines=1)
            }
            if(source!=null && (arrows!=null || source.physicalArrowNumber!=null)) PhysicalArrowPicker(
                draft?.physicalArrowNumber,arrows,shots.filter {it.id!=source.id}.mapNotNull {it.physicalArrowNumber}.toSet(),
                {draft=draft?.copy(physicalArrowNumber=it)},enabled=!busy,tag="history-physical-arrow-choice")
        }
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f).testTag("history-target-area")) {
            if(profile==null) InfoCard("Мишень не подтверждена",
                "Исходные попадания сохранены. Для переноса по мишени сначала выбери подтверждённую мишень в условиях.",
                Modifier.padding(16.dp).testTag("history-target-unavailable"))
            else TargetBoard(Modifier.fillMaxSize(),details.session.id,end.end.id,displayed,source?.id,!busy,
                onPoint={point->draft?.let {value->
                    val score=profile.scoreShaft(point,block.block.shaftDiameterMm(),block.block.targetDiameterMm ?: 400)
                    draft=value.copy(x=point.x,y=point.y,points=score.points,origin="target");zone=score.code
                }},viewportHeight=maxHeight,profile=profile,panOnly=source==null,
                shaftDiameterMm=block.block.shaftDiameterMm(),targetDiameterMm=block.block.targetDiameterMm ?: 400)
        }
        TrainingEditorFooter(displayed,maxOf(1,shots.size),source?.id,null,!busy,false,end.end.id,{choose(it)},
            mainText=if(busy)"Сохраняем…"else"Сохранить",mainTag="history-save-shot",mainEnabled=!busy&&changed,onMain={save()},
            missEnabled=!busy&&source!=null,onMiss={draft=draft?.copy(points=0,x=null,y=null,origin="manual");zone="M"},
            onUndo={draft=original;zone=source?.zoneCode;switchAfterSave=null;waitingRevision=null},canUndo=!busy&&changed,
            status={androidx.compose.material3.Text(draft?.let {"${it.points} очков"} ?: "Выбери стрелу",
                Modifier.testTag("history-edit-result"),style=MaterialTheme.typography.labelMedium,maxLines=1)},
            onNotes=onNotes?.let {open->{open(NoteScope(details.session.id,end.end.blockId,end.end.id))}},
            selectionTagPrefix="report-edit",missTag="history-miss")
    }
    if(discard) AlertDialog(onDismissRequest={discard=false},title={Text(stringResource(R.string.discard_edit_title))},
        text={Text(stringResource(R.string.discard_edit_text))},
        confirmButton={TextButton({discard=false;draft=original;zone=source?.zoneCode;selected=null},
            Modifier.testTag("history-discard-draft")){Text(stringResource(R.string.discard_edit))}},
        dismissButton={TextButton({discard=false}){Text(stringResource(R.string.continue_input))}})
    if(removing && source!=null) AlertDialog(onDismissRequest={if(!busy)removing=false},
        title={Text("Удалить попадание?")},text={Text("Попадание исчезнет из серии. Счёт и показатели будут пересчитаны.")},
        confirmButton={TextButton({removing=false;onRemove(source.id,source.revision)},
            Modifier.testTag("history-remove-confirm"),enabled=!busy){Text("Удалить")}},
        dismissButton={TextButton({removing=false},enabled=!busy){Text("Отмена")}})
}

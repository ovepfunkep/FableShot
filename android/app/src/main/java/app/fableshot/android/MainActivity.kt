package app.fableshot.android

import app.fableshot.android.data.journal.roundProgress
import app.fableshot.android.data.journal.currentRoundDetails
import app.fableshot.android.ui.ShotStrip
import app.fableshot.android.ui.TrainingRoundsSheet
import app.fableshot.android.data.journal.presentation
import app.fableshot.android.data.journal.physicalArrowSet
import app.fableshot.android.data.journal.numberedArrowsEnabled
import app.fableshot.android.data.journal.shaftDiameterMm
import app.fableshot.android.ui.TrainingSeriesSheet
import app.fableshot.android.ui.PhysicalArrowPicker
import app.fableshot.android.ui.PhysicalArrowPickerSheet
import app.fableshot.android.ui.Text
import app.fableshot.android.ui.SportRankPanel
import app.fableshot.android.ui.TrainingSummary
import app.fableshot.android.ui.TrainingSummaryMetric
import app.fableshot.android.ui.TrainingEditorFooter
import app.fableshot.android.ui.StageRankBadge
import app.fableshot.android.ui.LocalRankPreferences
import app.fableshot.android.data.journal.roundRank
import app.fableshot.android.data.journal.seriesRank

import app.fableshot.android.ui.FableIcon
import app.fableshot.android.ui.tenChainFeedback
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.graphics.graphicsLayer
import app.fableshot.android.ui.Glyph

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.BackHandler
import androidx.activity.viewModels
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.rollingRounds
import app.fableshot.android.data.journal.MAX_SERIES_ARROWS
import androidx.compose.foundation.lazy.LazyColumn
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.domain.TargetScoring
import app.fableshot.android.ui.TargetBoard
import app.fableshot.android.ui.TargetOverlayHost
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.AppScale
import app.fableshot.android.ui.FablePrimaryButton
import app.fableshot.android.ui.ReleaseNotesHost
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    private val models:GenerationViewModels by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app=application as FableShotApplication
        val manager=app.diaries
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        val existingInstallation = packageInfo.lastUpdateTime > packageInfo.firstInstallTime
        setContent {
          val runtime by manager.runtime.collectAsStateWithLifecycle()
          key(runtime) {
            var prepared by remember { mutableStateOf(false) }
            var preparationFailed by remember { mutableStateOf(false) }
            var preparationAttempt by remember { mutableIntStateOf(0) }
            LaunchedEffect(preparationAttempt) {
                try {
                    runtime.warmUp()
                    preparationFailed = false
                    prepared = true
                } catch (error: kotlinx.coroutines.CancellationException) {
                    throw error
                } catch (error: Exception) {
                    android.util.Log.e("FableDiary", "Could not prepare imported diary data", error)
                    preparationFailed = true
                }
            }
            val model=remember(runtime){models.select(runtime,manager,app.cleanupScope)}
            val preferences=runtime.preferences
            val settings by preferences.state.collectAsStateWithLifecycle(initialValue = SettingsRead.Loading)
            val appSettings = (settings as? SettingsRead.Ready)?.value ?: UserSettings()
            AppScale(appSettings) {
              FableTheme(appSettings) {
                if (prepared) {
                    PracticeShell(model, preferences, settings,runtime.equipment,runtime.importer,runtime.archive,manager)
                    (settings as? SettingsRead.Ready)?.value?.let { currentSettings ->
                        ReleaseNotesHost(currentSettings, existingInstallation, preferences::acknowledgeReleaseNotes)
                    }
                }
                else Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (preparationFailed) Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text(stringResource(R.string.diary_load_error))
                        FablePrimaryButton(stringResource(R.string.retry), {
                            preparationFailed = false
                            preparationAttempt++
                        })
                    } else CircularProgressIndicator()
                }
              }
            }
          }
        }
    }
}


@Composable
internal fun Setup(busy: Boolean, onStart: (String, Double, Int, Int) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var distance by rememberSaveable { mutableStateOf("") }
    var diameter by rememberSaveable { mutableIntStateOf(0) }
    var arrows by rememberSaveable { mutableIntStateOf(3) }
    val parsed = distance.replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }
    val fallback = stringResource(R.string.untitled_training)
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.new_training), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text(stringResource(R.string.setup_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(value = distance, onValueChange = { distance = it }, singleLine = true, label = { Text(stringResource(R.string.distance_meters)) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth().testTag("distance-field"))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(10, 18, 30).forEach { n -> FilterChip(selected = parsed == n.toDouble(), onClick = { distance = n.toString() }, label = { Text(stringResource(R.string.distance_value, n)) }, modifier = Modifier.heightIn(min = 48.dp).testTag("distance-$n")) } }
        Text(stringResource(R.string.target_diameter), fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(40, 60, 80).forEach { n -> FilterChip(selected = diameter == n, onClick = { diameter = n }, label = { Text(stringResource(R.string.diameter_value, n)) }, modifier = Modifier.heightIn(min = 48.dp).testTag("diameter-$n")) } }
        Text(stringResource(R.string.arrows_per_end), fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(3, 6).forEach { n -> FilterChip(selected = arrows == n, onClick = { arrows = n }, label = { Text(n.toString()) }, modifier = Modifier.heightIn(min = 48.dp).testTag("arrows-$n")) } }
        OutlinedTextField(value = title, onValueChange = { title = it }, singleLine = true, label = { Text(stringResource(R.string.optional_title)) }, modifier = Modifier.fillMaxWidth().testTag("title-field"))
        FablePrimaryButton(stringResource(if (busy) R.string.saving else R.string.start), onClick = { onStart(title.trim().ifBlank { fallback }, requireNotNull(parsed), diameter * 10, arrows) }, enabled = parsed != null && diameter > 0 && !busy, modifier = Modifier.fillMaxWidth().testTag("start-training"))
        Text(stringResource(R.string.educational_profile), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(20.dp))
    }
}

internal data class PracticeCommands(
    val point: (String, TargetPoint) -> Unit,
    val numeric: (String, Int) -> Unit,
    val update: (ShotEntity) -> Unit,
    val undo: (String) -> Unit,
    val next: (String) -> Unit,
    val x:(String)->Unit = {},
    val numberedPoint: (String, TargetPoint, Int?) -> Unit = { end, target, _ -> point(end, target) },
    val numberedNumeric: (String, Int, Int?) -> Unit = { end, score, _ -> numeric(end, score) },
    val remove: (String, Long) -> Unit = { _, _ -> },
)

@Composable
internal fun ActivePractice(
    details: SessionDetails, commands: PracticeCommands, canUndo: Boolean, busy: Boolean,
    onStats: () -> Unit, onFinish: () -> Unit, onLeave: () -> Unit = {},
    onConditions: () -> Unit = {}, onTechnique: () -> Unit = {},
    timerBadge: @Composable (() -> Unit)? = null,
    hideScores: Boolean = false,
    saveFailed: Boolean = false,
    selectedEndId: String? = null,
    navigation: (@Composable () -> Unit)? = null,
    targetVerified: Boolean = true,
    onReturnToCurrent: () -> Unit = {},
    onSelectRound: (String) -> Unit = {},
    onStartRound: () -> Unit = {},
    onRemoveEnd: ((String, Long) -> Unit)? = null,
    onRemoveRound: ((String, String, Long) -> Unit)? = null,
) {
    val live=details.currentEnd ?: return
    val current=details.orderedEnds.firstOrNull { it.end.id==selectedEndId } ?: live
    val end=current.end
    val journal=details.journal
    val currentBlock = journal?.orderedBlocks?.firstOrNull { block -> block.ends.any { it.end.id == end.id } }?.block
    val arrowSet = currentBlock?.physicalArrowSet()
    val numberingEnabled = currentBlock?.let { journal?.numberedArrowsEnabled(it) } == true && arrowSet != null
    val profileId=currentBlock?.targetProfileId
        ?: details.session.profileId
    val profile=app.fableshot.android.domain.TargetCatalog.find(profileId) ?: app.fableshot.android.domain.TargetCatalog.practice
    val viewingPast=end.id!=live.end.id
    val flexible=journal?.rollingRounds==true
    val shots=current.shots.sortedBy(ShotEntity::inputIndex)
    var pendingNumberedAppend by remember(end.id) { mutableStateOf<Set<String>?>(null) }
    var postHitId by remember(end.id) { mutableStateOf<String?>(null) }
    var postHitReady by remember(end.id) { mutableStateOf(false) }
    var postHitClosing by remember(end.id) { mutableStateOf(false) }
    var numberSaveRequest by remember(end.id) { mutableStateOf<ShotEntity?>(null) }
    var numberSaveError by remember(end.id) { mutableStateOf(false) }
    var editing by remember(end.id) { mutableStateOf<ShotEntity?>(null) }
    var removing by remember(end.id) { mutableStateOf(false) }
    val pendingEdits = remember(end.id) { mutableStateMapOf<String, ShotEntity>() }
    val motion=app.fableshot.android.ui.LocalFableVisuals.current.motion
    LaunchedEffect(postHitId,motion) {
        postHitReady=false
        if(postHitId!=null) {
            if(motion)app.fableshot.android.ui.awaitValueMotion()
            postHitReady=true
        }
    }
    LaunchedEffect(shots, saveFailed, busy, numberingEnabled, numberSaveRequest) {
        pendingNumberedAppend?.let { previous ->
            val inserted = shots.firstOrNull { it.id !in previous }
            if (inserted != null) {
                if (numberingEnabled && inserted.physicalArrowNumber == null) {
                    postHitClosing=false
                    postHitId=inserted.id
                }
                pendingNumberedAppend = null
            }
        }
        if (!numberingEnabled) {
            pendingNumberedAppend = null
            postHitId = null
            numberSaveRequest = null
        }
        postHitId?.let { id ->
            val stored = shots.firstOrNull { it.id == id }
            if (stored == null) {
                postHitId = null
                numberSaveRequest = null
                numberSaveError = false
            } else if(stored.physicalArrowNumber!=null) {
                postHitClosing=true
                numberSaveRequest=null
                numberSaveError=false
            } else if (numberSaveRequest != null && !busy && saveFailed) {
                numberSaveRequest = null
                numberSaveError = true
            }
        }
        if (saveFailed) {
            pendingEdits.clear()
            if (!busy) pendingNumberedAppend = null
        }
        else pendingEdits.toMap().forEach { (id, draft) ->
            val stored = shots.firstOrNull {it.id == id}
            if (stored == null || stored.revision > draft.revision) pendingEdits.remove(id)
        }
    }
    var roundsWindow by remember(details.session.id) { mutableStateOf(false) }
    var seriesWindow by remember(details.session.id) { mutableStateOf(false) }
    val shaftDiameter = currentBlock?.shaftDiameterMm() ?: 6.0
    val targetDiameter = currentBlock?.targetDiameterMm ?: details.session.targetDiameterMm
    val full=shots.size >= if(flexible) MAX_SERIES_ARROWS else end.plannedCount
    val round = remember(journal,end.id) { journal?.roundProgress(end.id) }
    val roundFull = round?.roundArrowLimit?.let { limit -> round.ends.sumOf { it.volume } >= limit } == true
    val canEnter=targetVerified&&!busy&&(editing!=null||(!viewingPast&&!full&&!roundFull&&postHitId==null&&pendingNumberedAppend==null))
    val canAdvance=!viewingPast&&!busy&&(if(flexible) shots.isNotEmpty() else full || roundFull)
    val slots=if(flexible&&!viewingPast&&!full) maxOf(end.plannedCount,shots.size+1) else end.plannedCount
    fun preview(shot: ShotEntity) = if (shot.id == editing?.id) editing!! else pendingEdits[shot.id] ?: shot
    val displayed=shots.map(::preview)
    fun saveEdit() {
        editing?.let { draft -> if(draft!=shots.firstOrNull { it.id==draft.id }) {
            pendingEdits[draft.id] = draft
            commands.update(draft)
        } }
        editing=null
    }
    fun choose(shot: ShotEntity?) {
        if(shot==null || busy || shot.id in pendingEdits) return
        if(editing?.id==shot.id) return
        saveEdit()
        editing=shot
    }
    BackHandler { if(editing!=null) editing=null else onFinish() }
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal=8.dp),verticalAlignment=Alignment.CenterVertically) {
            IconButton({if(editing!=null) removing=true else onFinish()},Modifier.testTag(if(editing!=null) "remove-selected-shot" else "finish-training"),enabled=!busy,colors=IconButtonDefaults.iconButtonColors(disabledContentColor=MaterialTheme.colorScheme.onSurface)) {
                FableIcon(if(editing!=null) Glyph.Trash else Glyph.Close,description=if(editing!=null) "Удалить попадание" else "Завершить тренировку")
            }
            val hadPhysicalNumber = remember(editing?.id) { editing?.physicalArrowNumber != null }
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text(if(editing!=null) "Стрела ${editing!!.inputIndex+1}" else "Тренировка", Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (editing != null && (arrowSet != null || hadPhysicalNumber)) PhysicalArrowPicker(
                    editing?.physicalArrowNumber,
                    arrowSet, displayed.filter { it.id != editing?.id }.mapNotNull { it.physicalArrowNumber }.toSet(),
                    { value ->
                        val old = editing
                        if (old != null) editing = old.copy(physicalArrowNumber = value)
                    }, enabled = !busy, modifier = Modifier.widthIn(min = 48.dp))
            }
            IconButton({saveEdit();onTechnique()},enabled=!busy,colors=IconButtonDefaults.iconButtonColors(disabledContentColor=MaterialTheme.colorScheme.onSurface)) { FableIcon(Glyph.Notes,description="Алгоритмы и фокус") }
            IconButton({saveEdit();onConditions()},enabled=!busy,colors=IconButtonDefaults.iconButtonColors(disabledContentColor=MaterialTheme.colorScheme.onSurface)) { FableIcon(Glyph.Settings,description="Условия тренировки") }
            IconButton({saveEdit();onStats()},Modifier.testTag("statistics"),enabled=!busy,colors=IconButtonDefaults.iconButtonColors(disabledContentColor=MaterialTheme.colorScheme.onSurface)) { FableIcon(Glyph.Progress,description=stringResource(R.string.statistics)) }
        }
        val roundShots = round?.ends?.flatMap { it.shots }?.map { it.presentation() } ?: details.allShots
        val roundDisplayed = roundShots.map(::preview)
        val roundMaximum = round?.maximum
        @Composable fun average(values: List<ShotEntity>) = if(values.isEmpty()) "—" else app.fableshot.android.ui.averageNumber(values.sumOf { it.points }.toDouble() / values.size)
        val projected = details.journal?.let { journal ->
            if (pendingEdits.isEmpty()) journal else journal.copy(blocks = journal.blocks.map { block ->
                block.copy(ends = block.ends.map { entry -> entry.copy(shots = entry.shots.map { shot ->
                    pendingEdits[shot.id]?.let { shot.copy(points=it.points) } ?: shot
                }) })
            })
        }
        val draft = editing?.let { value -> projected?.allShots?.firstOrNull { it.id == value.id }?.copy(points = value.points) }
        val rankCategory=LocalRankPreferences.current.category
        val roundStageRank=remember(projected,rankCategory,end.id,draft) { projected?.roundRank(rankCategory,end.id,draft) }
        val seriesStageRank=remember(projected,rankCategory,end.id,draft) { projected?.seriesRank(rankCategory,end.id,draft) }
        val seriesMaximum = end.plannedCount * 10
        TrainingSummary(
            round = TrainingSummaryMetric(
                position = "${round?.number ?: 1}" + (round?.count?.let { "/$it" } ?: ""),
                score = "${roundDisplayed.sumOf { it.points }}" + (roundMaximum?.let { "/$it" } ?: ""),
                average = average(roundDisplayed),
                scoreWidthReference = (round?.plannedArrowCount?.times(10) ?: 999).let { "$it/$it" },
            ),
            series = TrainingSummaryMetric(
                position = "${round?.seriesNumber ?: end.number}" + (round?.seriesLimit?.let { "/$it" } ?: ""),
                score = "${displayed.sumOf { it.points }}/$seriesMaximum",
                average = average(displayed),
                scoreWidthReference = "999/999",
            ),
            hideScores = hideScores,
            onRounds = { saveEdit(); roundsWindow = true },
            onSeries = { saveEdit(); seriesWindow = true },
            roundRank = { projected?.let { value->roundStageRank?.let { StageRankBadge(value,it,tag="training-round-rank") } } },
            seriesRank = { projected?.let { value->seriesStageRank?.let { StageRankBadge(value,it,tag="training-series-rank") } } },
        )
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f).testTag("training-target-area")) {
            TargetBoard(Modifier.fillMaxSize().testTag("target-board"),
                details.session.id, end.id, displayed, editing?.id, canEnter,
                onPoint = { point ->
                    val old = editing
                    if (old == null) {
                        if (numberingEnabled) pendingNumberedAppend = shots.map { it.id }.toSet()
                        commands.numberedPoint(end.id, point, null)
                    } else {
                        val score = profile.scoreShaft(point, shaftDiameter, targetDiameter)
                        editing = old.copy(x=point.x,y=point.y,points=score.points,origin="target",zoneCode=score.code)
                    }
                }, viewportHeight = maxHeight, profile = profile,
                shaftDiameterMm = shaftDiameter, targetDiameterMm = targetDiameter)
            if (editing == null && navigation != null) Box(Modifier.align(Alignment.TopStart).padding(start=16.dp,top=2.dp)) { navigation() }
            if (!targetVerified && !viewingPast) TextButton(onConditions, Modifier.align(Alignment.Center)) {
                Text("Выбрать мишень для продолжения")
            }
        }
        val nextAction = when {
            editing != null -> Triple("Сохранить", "save-edit", {saveEdit()})
            viewingPast -> Triple("К текущей серии", "practice-return-current", onReturnToCurrent)
            else -> Triple(stringResource(journal?.let { app.fableshot.android.ui.nextTrainingAction(it) } ?: R.string.next_end),
                "next-end", { commands.next(end.id) })
        }
        TrainingEditorFooter(displayed, slots, editing?.id,
            if (editing == null && !viewingPast && !full && !roundFull) shots.size else null,
            enabled = !busy, hideScores = hideScores, endId = end.id, onChoose = {choose(it)},
            mainText = nextAction.first, mainTag = nextAction.second,
            mainEnabled = canAdvance || (!busy && (editing != null || viewingPast)), onMain = nextAction.third,
            missEnabled = !busy && (editing != null || canEnter), onMiss = {
                val old = editing
                if (old == null) {
                    if (numberingEnabled) pendingNumberedAppend = shots.map { it.id }.toSet()
                    commands.numberedNumeric(end.id, 0, null)
                } else editing = old.copy(points=0,x=null,y=null,origin="manual",zoneCode="M")
            }, onUndo = { if (editing != null) editing = null else commands.undo(end.id) },
            canUndo = !busy && (editing != null || canUndo), timerBadge = timerBadge)
    }
    if (removing && editing != null) app.fableshot.android.ui.ScaledAlertDialog(
        onDismissRequest = { removing = false }, title = { Text("Удалить попадание?") },
        text = { Text("Попадание исчезнет из серии. Счёт и показатели будут пересчитаны.") },
        confirmButton = { TextButton({
            val selected = editing
            removing = false
            editing = null
            selected?.let { commands.remove(it.id, it.revision.toLong()) }
        }, Modifier.testTag("confirm-remove-selected-shot"), enabled = !busy) { Text("Удалить") } },
        dismissButton = { TextButton({ removing = false }) { Text("Отмена") } })
    if (roundsWindow && journal != null) TrainingRoundsSheet(journal, busy,
        onDismiss = { roundsWindow = false },
        onSelectEnd = { roundsWindow = false; onSelectRound(it) },
        onNewRound = { roundsWindow = false; onStartRound() }, hideScores = hideScores,
        onRemoveRound = onRemoveRound)
    if (seriesWindow && journal != null) TrainingSeriesSheet(journal, end.id, busy,
        onDismiss = { seriesWindow = false }, onSelectEnd = { seriesWindow = false; onSelectRound(it) }, hideScores = hideScores,
        onRemoveEnd = onRemoveEnd)
    postHitId?.takeIf { postHitReady }?.let { id -> shots.firstOrNull { it.id == id } }?.let { stored ->
        key(stored.id) {
            PhysicalArrowPickerSheet(stored.physicalArrowNumber, arrowSet,
                displayed.filter { it.id != stored.id }.mapNotNull { it.physicalArrowNumber }.toSet(),
                onChange = { number ->
                    if (number == null) {
                        postHitClosing = true
                        numberSaveError = false
                    } else if (!busy && numberSaveRequest == null) {
                        val request = stored.copy(physicalArrowNumber = number)
                        numberSaveError = false
                        numberSaveRequest = request
                        commands.update(request)
                    }
                }, onDismiss = { postHitId = null; postHitClosing=false; numberSaveRequest = null; pendingNumberedAppend = null; numberSaveError = false },
                enabled = !busy && numberSaveRequest == null,
                errorMessage = if (numberSaveError) "Номер не сохранён. Выбери его ещё раз или оставь попадание без номера." else null,
                dismissRequested=postHitClosing)
        }
    }
}


@Composable
internal fun PracticeSeriesNavigation(previous:(()->Unit)?,next:(()->Unit)?,enabled:Boolean) {
    Surface(shape=CircleShape,color=MaterialTheme.colorScheme.surface) {
        Row {
            IconButton({previous?.invoke()},Modifier.size(44.dp).testTag("practice-previous-series"),enabled=enabled&&previous!=null) {
                FableIcon(Glyph.Back,description="Предыдущая серия")
            }
            IconButton({next?.invoke()},Modifier.size(44.dp).testTag("practice-next-series"),enabled=enabled&&next!=null) {
                FableIcon(Glyph.Next,description="Следующая сохранённая серия")
            }
        }
    }
}

private fun format(value: Double, decimals: Int = 2) = String.format(Locale.getDefault(), "%.$decimals" + "f", value)


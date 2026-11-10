package app.fableshot.android

import app.fableshot.android.ui.ScaledDropdownMenu as DropdownMenu

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import app.fableshot.android.ui.Text

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.*
import androidx.compose.ui.res.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.JournalDetails
import app.fableshot.android.data.journal.NoteScope
import app.fableshot.android.data.journal.TrainingTimeSummary
import app.fableshot.android.data.journal.summary
import app.fableshot.android.data.journal.plannedEnds
import app.fableshot.android.data.journal.rollingRounds
import app.fableshot.android.data.journal.verifiedTarget
import app.fableshot.android.ui.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect
import org.json.JSONObject
import java.io.IOException

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
internal fun PracticeShell(model: PracticeViewModel, preferences: UserPreferences, read: SettingsRead,equipment:EquipmentRepository?=null,importer:app.fableshot.android.importing.MyTargetsImporter?=null,archive:app.fableshot.android.backup.JournalArchive?=null,diaries:app.fableshot.android.backup.DiaryManager?=null) {
    val state by model.state.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val undoableEnds by model.undoableEnds.collectAsStateWithLifecycle()
    val completedSession by model.completedSession.collectAsStateWithLifecycle()
    val achievementBoard by model.achievementBoard.collectAsStateWithLifecycle()
    val recordEvents by model.recordEvents.collectAsStateWithLifecycle()
    val settings = (read as? SettingsRead.Ready)?.value ?: UserSettings()
    val commands = remember(model) { PracticeCommands({e,p->model.point(e,p)},{e,s->model.numeric(e,s)},{model.update(it)},{model.undo(it)},{model.next(it)},{model.x(it)},
        numberedPoint=model::pointNumbered, numberedNumeric=model::numericNumbered, remove=model::removeShot) }
    var stack by rememberSaveable { mutableStateOf(arrayListOf("root")) }
    var tab by rememberSaveable { mutableStateOf("home") }
    var initialRoute by rememberSaveable { mutableStateOf(false) }
    var importWindow by rememberSaveable { mutableStateOf(false) }
    var techniqueWindow by rememberSaveable{mutableStateOf(false)}
    var notesWindow by rememberSaveable {mutableStateOf(false)}
    var timerWindow by rememberSaveable {mutableStateOf(false)}
    var notesSessionId by rememberSaveable {mutableStateOf<String?>(null)}
    var notesBlockId by rememberSaveable {mutableStateOf<String?>(null)}
    var notesEndId by rememberSaveable {mutableStateOf<String?>(null)}
    var historyNotes by rememberSaveable {mutableStateOf(false)}
    var arrowAnalysisSetId by rememberSaveable { mutableStateOf<String?>(null) }
    var finishing by remember { mutableStateOf(false) }
    var reportMenu by rememberSaveable { mutableStateOf(false) }
    var managingRounds by rememberSaveable { mutableStateOf(false) }
    var starting by remember { mutableStateOf(false) }
    var partial by remember { mutableStateOf(false) }
    var editShotId by rememberSaveable { mutableStateOf<String?>(null) }
    var trashConfirm by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var renamedTitle by rememberSaveable { mutableStateOf("") }
    var repeatSourceId by rememberSaveable { mutableStateOf<String?>(null) }
    var repeatSeriesLimit by remember { mutableStateOf<Int?>(10) }
    var repeatArrowLimit by remember { mutableStateOf<Int?>(null) }
    var setupTemplate by remember { mutableStateOf<app.fableshot.android.data.journal.JournalBlock?>(null) }
    var presetEpoch by rememberSaveable {mutableIntStateOf(0)}
    var setupNumbering by rememberSaveable { mutableStateOf<Boolean?>(null) }
    var reportId by rememberSaveable { mutableStateOf<String?>(null) }
    var report by remember { mutableStateOf<SessionDetails?>(null) }
    var reportMissing by remember { mutableStateOf(false) }
    val page = stack.last()
    val trainingTimes=if(page=="report"||page=="profile") model.trainingTimes.collectAsStateWithLifecycle().value
        else TrainingTimeSummary()
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(settings.seriesTimerSeconds, settings.restTimerSeconds) {
        model.timer.configure(settings.seriesTimerSeconds, settings.restTimerSeconds)
    }
    LaunchedEffect(state.loading, state.active?.session?.id) {
        if (!state.loading) {
            model.timer.bindSession(state.active?.session?.id)
            if (state.active == null) timerWindow = false
        }
    }
    val scope = rememberCoroutineScope()
    var equipmentDraft by remember { mutableStateOf<EquipmentItem?>(null) }
    var preferredEquipmentId by rememberSaveable { mutableStateOf<String?>(null) }
    var equipmentItems by remember(equipment){mutableStateOf(emptyList<EquipmentItem>())}
    var equipmentReadError by remember{mutableStateOf(false)}
    var equipmentRetry by remember{mutableIntStateOf(0)}
    var equipmentBusy by remember{mutableStateOf(false)}
    var equipmentSaveError by remember{mutableStateOf(false)}
    LaunchedEffect(equipment,equipmentRetry) { if(equipment!=null)try{equipmentReadError=false;equipment.items.collect{equipmentItems=it}}catch(e:Exception){if(e is CancellationException)throw e;equipmentReadError=true} }
    fun saveEquipment(value:EquipmentItem,after:()->Unit) { scope.launch {equipmentBusy=true;equipmentSaveError=false;try{requireNotNull(equipment).save(value);after()}catch(e:Exception){if(e is CancellationException)throw e;equipmentSaveError=true}finally{equipmentBusy=false}} }
    val snackbar = remember { SnackbarHostState() }
    val saveFailed = stringResource(R.string.preferences_save_failed)
    val stateHolder = rememberSaveableStateHolder()
    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
    fun push(route: String) { if(route in listOf("setup","conditions"))preferredEquipmentId=null; if(route=="setup"){repeatSourceId=null;setupTemplate=null;repeatSeriesLimit=10;repeatArrowLimit=null;setupNumbering=null};if (page != route) stack = ArrayList(stack + route) }
    fun pop() { stack = if (stack.size > 1) ArrayList(stack.dropLast(1)) else arrayListOf("root") }
    fun root() { stack = arrayListOf("root");tab="home" }
    fun configureRankBow(details: JournalDetails) {
        val savedEquipment = details.orderedBlocks
            .firstOrNull { block -> block.ends.any { it.end.role == "scored" } }
            ?.block?.equipmentSnapshotJson
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
        val selection = savedEquipment?.optJSONObject("selection")
        val selectionId = selection?.optString("id")
        val kit = equipmentItems.firstOrNull { it.kind == "setup" && it.id == selectionId }
        val bowIds = listOfNotNull(
            savedEquipment?.optJSONObject("bow")?.optString("id"),
            selectionId?.takeIf { selection?.optString("kind") == "bow" },
            kit?.bowId,
        )
        val bow = bowIds.firstNotNullOfOrNull { id -> equipmentItems.firstOrNull { it.kind == "bow" && it.id == id } }
        val draft = bow ?: kit
        if (draft == null) push("rank-equipment") else {
            equipmentDraft = draft
            push("equipment-editor")
        }
    }
    fun setting(action: suspend () -> Unit, after: () -> Unit = {}) {
        scope.launch { try { action(); after() } catch (e: IOException) { snackbar.showSnackbar(saveFailed) } }
    }
    fun openSession(summary: SessionSummary) { if (summary.id == state.active?.session?.id) push("training") else { reportId = summary.id; push("report") } }
    fun openNotes(scope:NoteScope) {notesSessionId=scope.sessionId;notesBlockId=scope.blockId;notesEndId=scope.endId;notesWindow=true}
    fun noteSessions()=state.history+listOfNotNull(state.active?.journal?.summary())
    fun firstChoice(route: String) { setting({ preferences.finishOnboarding(if (route == "root") "skipped" else "completed") }) { if (route == "root") root() else push(route) } }

    LaunchedEffect(completedSession) {
        completedSession?.let { id ->
            reportId = id
            stack = arrayListOf("root", "report")
            model.acknowledgeCompletion(id)
        }
    }
    LaunchedEffect(page,state.active?.session?.id,state.loading,pending,completedSession) {
        if(page=="training"&&!state.loading&&state.active==null&&pending==0&&completedSession==null)root()
    }
    BackHandler(stack.size > 1) { pop() }
    LaunchedEffect(state.loading, read) {
        if (!state.loading && read is SettingsRead.Ready && !initialRoute) {
            initialRoute = true
            if (state.active != null) push("training")
            if (read.value.onboardingVersion == 0 && (state.active != null || state.history.isNotEmpty())) {
                try { preferences.finishOnboarding("existing_user") } catch (_: IOException) { snackbar.showSnackbar(saveFailed) }
            }
        }
    }
    LaunchedEffect(starting, state.active?.session?.id, pending, error) {
        if (starting && state.active != null) { starting = false; stack = arrayListOf("root","training") }
        else if (starting && pending == 0 && error != null) starting = false
    }
    LaunchedEffect(page, reportId, state.active,state.history) {
        if (page in listOf("report","edit-shot") && reportId != null) { reportMissing = false; val loaded=state.active?.takeIf { it.session.id == reportId } ?: model.details(reportId!!);report=loaded;reportMissing=loaded==null }
    }
    LaunchedEffect(repeatSourceId) {
        repeatSourceId?.let { id ->
            val previous=model.details(id)?.journal
            setupTemplate=previous?.currentBlock?.block
            val format=previous?.plans?.singleOrNull()
            repeatSeriesLimit=if(format==null)10 else format.seriesLimit
            repeatArrowLimit=format?.roundArrowLimit
        }
    }
    var savedHabitual by remember { mutableStateOf<app.fableshot.android.data.journal.BlockPlan?>(null) }
    LaunchedEffect(preferences) {
        try { savedHabitual = HabitualTraining.decode(preferences.habitualTraining()) }
        catch (_: IOException) { snackbar.showSnackbar(saveFailed) }
    }
    var pausedSession by remember { mutableStateOf<SessionDetails?>(null) }
    LaunchedEffect(state.history) { pausedSession=state.history.firstOrNull { it.state=="paused" }?.let { model.details(it.id) } }
    var habitual by remember { mutableStateOf<app.fableshot.android.data.journal.JournalDetails?>(null) }
    LaunchedEffect(state.history) {
        habitual = null
        for (summary in state.history.sortedByDescending { it.startedAt }) {
            val candidate = model.details(summary.id)?.journal ?: continue
            if (candidate.session.sourceKind == "native" && candidate.orderedBlocks.isNotEmpty()) {
                habitual = candidate
                break
            }
        }
    }
    val habitualBlock = savedHabitual?.let(HabitualTraining::block) ?: habitual?.orderedBlocks?.firstOrNull()?.block
    val habitualPlan = (savedHabitual ?: habitualBlock?.let { block ->
        app.fableshot.android.data.journal.BlockPlan(
            distanceMeters = block.distanceMeters,
            diameterMm = block.targetDiameterMm,
            arrows = block.defaultArrowsPerEnd,
            mode = block.mode,
            equipmentSnapshotJson = block.equipmentSnapshotJson,
            plannedEnds = habitual?.plannedEnds,
            roundCount = habitual?.plans?.singleOrNull()?.takeUnless { it.rolling }?.roundCount ?: 1,
            flexibleSeries = habitual?.rollingRounds==true,
            seriesPerRound = habitual?.plans?.singleOrNull()?.takeIf { it.rolling }?.seriesLimit,
            roundArrowLimit = habitual?.plans?.singleOrNull()?.roundArrowLimit,
            targetProfileId = block.targetProfileId ?: app.fableshot.android.domain.TargetCatalog.practice.id,
        ).takeIf { it.valid() }
    })?.forOpenPractice()
    val readyHabitualPlan=habitualPlan?.takeUnless { equipmentReadError }?.let { HabitualTraining.refreshEquipment(it,equipmentItems)?.copy(numberedArrows=null) }
    LaunchedEffect(state.active?.session?.id,state.active?.journal?.currentBlock?.block?.id) {
        val journal = state.active?.journal
        val block = journal?.currentBlock?.block
        if (journal?.session?.sourceKind == "native" && block != null) {
            val plan = app.fableshot.android.data.journal.BlockPlan(block.distanceMeters, block.targetDiameterMm,
                block.defaultArrowsPerEnd, block.mode, block.equipmentSnapshotJson,
                journal.plans.singleOrNull()?.plannedEnds, block.targetProfileId ?: app.fableshot.android.domain.TargetCatalog.practice.id,roundCount=journal.plans.singleOrNull()?.roundCount?:1)
            val format=journal.plans.singleOrNull()
            val reusable=if(format?.rolling==true) plan.copy(
                plannedEnds=null,roundCount=1,seriesPerRound=format.seriesLimit,flexibleSeries=true,roundArrowLimit=format.roundArrowLimit,
            ) else plan.forOpenPractice()
            if (reusable.valid()) {
                try { preferences.habitualTraining(HabitualTraining.encode(reusable)); savedHabitual = reusable }
                catch (_: IOException) { snackbar.showSnackbar(saveFailed) }
            }
        }
    }
    val view = LocalView.current
    TrainingLockScreen(page == "training" && state.active != null && settings.trainingOnLockScreen)
    DisposableEffect(state.active?.session?.id, settings.keepAwake) {
        view.keepScreenOn = state.active != null && settings.keepAwake
        onDispose { view.keepScreenOn = false }
    }
    val feedback = LocalHapticFeedback.current
    val timerHaptics by rememberUpdatedState(settings.haptics)
    LaunchedEffect(model.timer) {
        model.timer.completions.collect {
            if (timerHaptics && lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                feedback.performHapticFeedback(HapticFeedbackType.LongPress)
            }
        }
    }
    val shotIds = state.active?.allShots.orEmpty().map { it.id }
    var seenShots by remember(state.active?.session?.id) { mutableStateOf(shotIds) }
    LaunchedEffect(shotIds) { if (settings.haptics && shotIds.any { it !in seenShots }) feedback.performHapticFeedback(HapticFeedbackType.LongPress); seenShots = shotIds }

    val showWelcome = read is SettingsRead.Ready && !state.loading && settings.onboardingVersion == 0 && state.active == null && state.history.isEmpty()
    CompositionLocalProvider(LocalRankPreferences provides RankPreferences(
        category = settings.rankCategory,
        onCategory = { value -> setting({ preferences.rankCategory(value) }) },
        onConfigureBow = if (equipment != null) ::configureRankBow else null,
    )) {
    Surface(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }, color = MaterialTheme.colorScheme.background) {
        TargetOverlayHost(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize().then(if (page !in listOf("training", "edit-shot", "tutorial")) Modifier.fableGeometry(settings.style,seed="$page:$tab") else Modifier)) {
                Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                    if (read is SettingsRead.Loading || state.loading) {
                        Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center) { CircularProgressIndicator() }
                    } else if (read is SettingsRead.Failed) {
                        Column(Modifier.padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) { InfoCard(stringResource(R.string.preferences_failed),stringResource(R.string.preferences_failed_hint));FablePrimaryButton(stringResource(R.string.retry),preferences::retry) }
                    } else if(state.loadError) {
                        Column(Modifier.padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){InfoCard(stringResource(R.string.diary_load_error),stringResource(R.string.diary_load_error_hint));FablePrimaryButton(stringResource(R.string.retry),model::retryLast)}
                    } else if (showWelcome || page == "welcome") {
                        WelcomeScreen(
                            onStart={firstChoice("setup")},
                            onImport={setting({preferences.finishOnboarding("completed")}) {root();run { importWindow = true }}},
                            onExample={firstChoice("tutorial")},
                            onSkip={firstChoice("root")},
                        )
                    } else {
                        if(page !in listOf("training","edit-shot")) ShellTopBar(page,tab,settings,onBack={backDispatcher?.onBackPressed()},onProfile={push("profile")},onSettings={push("settings")})
                        if (error != null) {
                            Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.errorContainer).padding(horizontal=20.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) { Text(stringResource(R.string.save_error),Modifier.weight(1f),style=MaterialTheme.typography.bodySmall);TextButton(model::retryLast){Text(stringResource(R.string.retry))} }
                        }
                        val contentKey=if(page=="root") "root:$tab" else page
                        val motion=LocalFableVisuals.current.motion
                        AnimatedContent(contentKey,modifier=Modifier.weight(1f),transitionSpec={
                            (fadeIn(tween(if(motion)180 else 0))+slideInHorizontally(tween(if(motion)220 else 0)){if(motion)it/24 else 0}).togetherWith(fadeOut(tween(if(motion)100 else 0)))
                        },label="page") { key ->
                            stateHolder.SaveableStateProvider(key) {
                                when {
                                    key=="root:home" -> HomeScreen(state.history,state.active ?: pausedSession,settings,{push("setup")},{if(state.active!=null)push("training")else pausedSession?.let{starting=true;model.resume(it.session.id)}},{tab="history"},::openSession,if(model.techniques!=null)({techniqueWindow=true})else null,
                                        habitualPlan = habitualPlan,
                                        quickStartAvailable = habitualPlan == null || readyHabitualPlan != null,
                                        busy = starting || pending > 0,
                                        onQuickStart = {
                                            if (!starting && pending == 0 && state.active == null) {
                                                readyHabitualPlan?.let { plan ->
                                                    starting = true
                                                    model.startPlan("Тренировка", plan.copy(rankCategory=settings.rankCategory))
                                                }
                                            }
                                        },
                                        onChangeConditions = {
                                            push("setup")
                                            setupTemplate = habitualBlock
                                            repeatSeriesLimit = habitualPlan?.seriesPerRound
                                            repeatArrowLimit = habitualPlan?.roundArrowLimit
                                        })
                                    key=="root:history" -> Column(Modifier.fillMaxSize()) {
                                        if(model.notes!=null)Row(Modifier.padding(horizontal=20.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                            FilterChip(!historyNotes,{historyNotes=false},{Text("Тренировки")},Modifier.testTag("history-trainings"))
                                            FilterChip(historyNotes,{historyNotes=true},{Text("Заметки")},Modifier.testTag("history-notes"))
                                        }
                                        Box(Modifier.weight(1f)) {
                                            if(historyNotes && model.notes!=null)NotebookScreen(model.notes!!,sessions=noteSessions(),onSession=::openSession)
                                            else HistoryScreen(state.history,::openSession,{if(state.active!=null)push("training")else push("setup")}, deletedSessions = state.trash, restoreEnabled = pending == 0, onRestore = model::restore)
                                            if(!historyNotes)FloatingActionButton(onClick={if(state.active!=null)push("training")else {push("setup");setupTemplate=habitualBlock;repeatSeriesLimit=if(habitualPlan==null)10 else habitualPlan.seriesPerRound;repeatArrowLimit=habitualPlan?.roundArrowLimit}},modifier=Modifier.align(Alignment.BottomEnd).padding(20.dp)) {
                                                FableIcon(Glyph.Start,description=if(state.active==null)"Новая тренировка" else "Продолжить тренировку")
                                            }
                                        }
                                    }
                                    key=="root:progress" -> ProgressScreen(state.history,model::details,onRanks={push("ranks")})
                                    key=="root:equipment" || key=="rank-equipment" -> if(equipmentReadError)Column(Modifier.padding(20.dp)){InfoCard(stringResource(R.string.equipment_load_failed),stringResource(R.string.diary_load_error_hint));FablePrimaryButton(stringResource(R.string.retry),{equipmentRetry++})}else EquipmentScreen(equipmentItems,equipmentBusy,equipmentSaveError,
                                        onArrowAnalysis={ id -> arrowAnalysisSetId=id; push("arrow-analysis") },onSave=::saveEquipment)
                                    key=="arrow-analysis" -> arrowAnalysisSetId?.let { id ->
                                        val analysis=remember(id,model) { model.arrowAnalysis(id) }
                                        PhysicalArrowHistoryScreen(id,analysis)
                                    }
                                    key=="setup" -> if(repeatSourceId!=null&&setupTemplate==null)Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center){CircularProgressIndicator()}
                                    else androidx.compose.runtime.key(setupTemplate?.id,presetEpoch) {
                                        JournalSetupScreen(pending>0,setupTemplate,equipmentItems,newSession=true,initialSeriesPerRound=repeatSeriesLimit,initialNumbering=setupNumbering,initialRoundArrowLimit=repeatArrowLimit,
                                            techniqueRepository=model.techniques,techniquePreferences=preferences,
                                            onAddEquipment={equipmentDraft=EquipmentItem(kind="setup",name="");push("equipment-editor")},
                                            onEditEquipment={equipmentDraft=it;push("equipment-editor")},preferredEquipmentId=preferredEquipmentId,
                                            presetTools=TrainingPresetTools(settings.trainingPresetsJson,{preset ->
                                                setupTemplate=HabitualTraining.block(preset.plan).copy(id="saved-${preset.id}")
                                                repeatSeriesLimit=preset.plan.forOpenPractice().seriesPerRound;repeatArrowLimit=preset.plan.roundArrowLimit;setupNumbering=preset.plan.numberedArrows;presetEpoch++
                                            },preferences::saveTrainingPreset,preferences::removeTrainingPreset)) {title,plan->starting=true;model.startPlan(title,plan.copy(rankCategory=settings.rankCategory))}
                                    }
                                    key=="equipment-editor" -> equipmentDraft?.let { draft -> EquipmentEditor(draft,equipmentItems,equipmentBusy,equipmentSaveError,::pop,onSaveComponent=::saveEquipment) { value -> saveEquipment(value) { preferredEquipmentId=value.id;pop() } } }
                                    key=="conditions" -> state.active?.journal?.let{journal->JournalSetupScreen(pending>0,journal.currentBlock?.block,equipmentItems,initialNumbering=journal.session.numberedArrows,initialRoundArrowLimit=journal.plans.singleOrNull()?.roundArrowLimit,onAddEquipment={equipmentDraft=EquipmentItem(kind="setup",name="");push("equipment-editor")},onEditEquipment={equipmentDraft=it;push("equipment-editor")},preferredEquipmentId=preferredEquipmentId,
                                        onNotes=if(model.notes!=null)({openNotes(NoteScope(journal.session.id,journal.currentBlock?.block?.id))})else null, onTimer={timerWindow=true},hideScores=settings.hideCurrentScores,onHideScores={value->setting({preferences.hideCurrentScores(value)})}){_,plan->model.newBlock(journal.session.id,plan,true);pop()}}
                                    key=="training" -> state.active?.let{active->
                                        Column(Modifier.fillMaxSize()) {
                                            val journal=active.journal
                                            val currentId=active.currentEnd?.end?.id
                                            var browsingId by rememberSaveable(currentId) { mutableStateOf<String?>(null) }
                                            val browsable=journal?.orderedBlocks.orEmpty().flatMap { it.orderedEnds }
                                                .filter { it.volume>0 || it.end.id==currentId }
                                            val selectedId=browsingId?.takeIf { id->browsable.any { it.end.id==id } } ?: currentId
                                            val index=browsable.indexOfFirst { it.end.id==selectedId }
                                            val navigation: (@Composable () -> Unit)?=if(browsable.size>1) ({
                                                PracticeSeriesNavigation(
                                                    previous=browsable.getOrNull(index-1)?.let { item->{ browsingId=item.end.id } },
                                                    next=browsable.getOrNull(index+1)?.let { item->{ browsingId=item.end.id } },
                                                    enabled=pending==0 && error==null,
                                                )
                                            }) else null
                                            val selectedBlock=journal?.orderedBlocks?.firstOrNull { b->b.ends.any { it.end.id==selectedId } }?.block
                                            val openReport={ reportId=active.session.id;push("report") }
                                            if(journal!=null&&selectedBlock?.mode=="count_only") CountPractice(journal,pending>0||error!=null,
                                                {model.setCount(requireNotNull(currentId),it)},{model.next(requireNotNull(currentId))},openReport,{finishing=true},
                                                onTimer={timerWindow=true},selectedEndId=selectedId,navigation=navigation)
                                            else ActivePractice(active,commands,selectedId in undoableEnds,pending>0||error!=null,onStats=openReport,onFinish={finishing=true},onLeave=::pop,
                                                onConditions={push("conditions")},onTechnique={techniqueWindow=true},timerBadge={PracticeTimerBadge(model.timer){timerWindow=true}},
                                                hideScores=settings.hideCurrentScores,saveFailed=error!=null,selectedEndId=selectedId,navigation=navigation,
                                                targetVerified=selectedBlock?.let { it.verifiedTarget()!=null } ?: true,
                                                onReturnToCurrent={browsingId=null},onSelectRound={browsingId=it},
                                                onStartRound={browsingId=null;model.startNextRound(active.session.id)},onRemoveEnd=model::removeEnd,onRemoveRound=model::removeRound)
                                        }
                                    } ?: Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center){FablePrimaryButton(stringResource(R.string.to_home),::root)}
                                    key=="settings" -> Column {Box(Modifier.weight(1f)){ SettingsScreen(settings,{setting({preferences.style(it)})},{setting({preferences.appearance(it)})},{setting({preferences.animations(it)})},{setting({preferences.haptics(it)})},{setting({preferences.keepAwake(it)})},{push("welcome")},{push("tutorial")},if(archive!=null){{push("archive")}}else null, onImport = {run { importWindow = true }}, onTechnique = {techniqueWindow=true}, onTrash = {push("trash")},onHideScores={value->setting({preferences.hideCurrentScores(value)})},onAchievements={value->setting({preferences.showAchievements(value)})},diaries=diaries,canReset=pending==0&&!equipmentBusy&&!importWindow,onStatistic={feature,visible->setting({preferences.statistic(feature,visible)})},onStatisticsReset={setting({preferences.resetStatistics()})},onSystemScale={value->setting({preferences.useSystemScale(value)})},onAverageHundredths={value->setting({preferences.averageHundredths(value)})},onTrainingOnLockScreen={value->setting({preferences.trainingOnLockScreen(value)})}) }}
                                    key=="archive" -> archive?.let{ArchiveScreen(it,diaries=diaries,canReplace=pending==0&&!equipmentBusy,
                                        onCreated={model.achievements?.service("MIND08",java.util.UUID.randomUUID().toString());Unit})}
                                    key=="tutorial" -> TargetTutorial(onFinish={setting({preferences.finishTutorial()}){if(state.active!=null){stack=arrayListOf("root","training")}else{stack=arrayListOf("root","setup")}}},onHome={setting({preferences.finishTutorial()}){root()}})
                                    key=="import" -> importer?.let{MyTargetsImportScreen(it,equipmentItems,{root();tab="history"},onTrash={push("trash")})}?:InfoCard(stringResource(R.string.import_pending_title),stringResource(R.string.import_pending_text))
                                    key=="report" -> report?.takeIf{it.session.id==reportId}?.let{value->Column(Modifier.fillMaxSize()) {
                                        Row(Modifier.fillMaxWidth().padding(horizontal=20.dp), verticalAlignment=Alignment.CenterVertically) {
                                            Text(value.session.title, Modifier.weight(1f), style=MaterialTheme.typography.titleLarge)
                                            state.history.firstOrNull { it.id==value.session.id }?.let { summary ->
                                                value.journal?.let {journal->TrainingShareButton(journal,settings,enabled=pending==0,
                                                    onGenerated={model.achievements?.service("APP04",java.util.UUID.randomUUID().toString(),sessionId=journal.session.id);Unit})}
                                                AnalyticsExportButton(listOf(summary),value.session.title,true,model::details)
                                            }
                                            Box {
                                                IconButton({reportMenu=true}) { FableIcon(Glyph.More, description="Действия тренировки") }
                                                DropdownMenu(reportMenu, {reportMenu=false}) {
                                                    if(model.notes!=null)DropdownMenuItem(modifier=Modifier.testTag("session-notes"),text={Text("Заметки тренировки")},onClick={reportMenu=false;openNotes(NoteScope(value.session.id))})
                                                    if(value.session.state=="active") DropdownMenuItem(modifier=Modifier.testTag("session-pause"),text={Text(stringResource(R.string.session_pause))}, onClick={reportMenu=false;model.pause(value.session.id);root()}, enabled=pending==0)
                                                    if(value.session.state in setOf("paused","completed") && value.journal?.session?.deletedAtMs==null) DropdownMenuItem(modifier=Modifier.testTag("session-resume"),text={Text(stringResource(R.string.session_resume))}, onClick={reportMenu=false;starting=true;model.resume(value.session.id)}, enabled=pending==0&&state.active==null)
                                                    DropdownMenuItem(modifier=Modifier.testTag("session-repeat"),text={Text(stringResource(R.string.session_repeat))}, onClick={reportMenu=false;push("setup");repeatSourceId=value.session.id}, enabled=state.active==null)
                                                    DropdownMenuItem(modifier=Modifier.testTag("session-rounds"),text={Text("Раунды и серии")},onClick={reportMenu=false;managingRounds=true},enabled=pending==0)
                                                    DropdownMenuItem(modifier=Modifier.testTag("session-rename"),text={Text(stringResource(R.string.session_rename))}, onClick={reportMenu=false;renamedTitle=value.session.title;renaming=true}, enabled=pending==0)
                                                    DropdownMenuItem(modifier=Modifier.testTag("session-trash"),text={Text(stringResource(R.string.trash_action))}, onClick={reportMenu=false;trashConfirm=true}, enabled=pending==0)
                                                }
                                            }
                                        }
                                        value.journal?.let { journal ->
                                            model.techniques?.let { app.fableshot.android.technique.TechniqueSession(it,journal,preferences,showReflection=settings.techniqueReflection) }
                                        }
                                        if(value.session.state!="active"&&state.active!=null)Text(stringResource(R.string.another_active),Modifier.padding(horizontal=20.dp),style=MaterialTheme.typography.bodySmall)
                                        Box(Modifier.weight(1f)){ReportScreen(value,onEditShot={id->editShotId=id;push("edit-shot")},onEditCount={id,count,revision->model.reviseCount(id,count,revision)},sourceVersions=state.history.associate{it.id to (it.journalMeta?.sessionRevision?:1L)},onNotes=if(model.notes!=null)::openNotes else null,
                                            awards=achievementBoard.awards.filter{it.sessionId==value.session.id&&it.valid},
                                            trainingTime=trainingTimes.bySession[value.session.id], recordEvents=recordEvents,
                                            availableRecordSessions=noteSessions().map{it.id}.toSet(),
                                            onRecordSession={id->noteSessions().firstOrNull{it.id==id}?.let(::openSession)})}
                                    }} ?: Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center){if(reportMissing)FablePrimaryButton(stringResource(R.string.to_home),::root)else CircularProgressIndicator()}
                                    key=="edit-shot" -> report?.journal?.let{journal->editShotId?.let{id->JournalShotEditor(journal,id,pending>0||error!=null,{model.reviseJournal(it)},model::removeShot,::pop,onNotes=if(model.notes!=null)::openNotes else null)}}
                                    key=="trash" -> HistoryScreen(
                                        state.history, ::openSession, { push("setup") },
                                        deletedSessions = state.trash, initiallyDeleted = true,
                                        restoreEnabled = pending == 0, onRestore = model::restore,
                                    )
                                    key=="profile" -> ProfileScreen(settings,state.history,onTechnique=if(model.techniques!=null)({techniqueWindow=true})else null,onRanks={push("ranks")},assignments=model.rankAssignments,achievementSessions=noteSessions(),onAchievements={push("achievements")},onRecords={push("records")},board=achievementBoard,
                                        shootingHours={ShootingHoursCard(settings.shootingBaseMinutes,trainingTimes.recordedMs){ value->setting({preferences.shootingBaseMinutes(value)}) }}){name->setting({preferences.displayName(name)})}
                                    key=="ranks" -> PersonalRanksScreen(state.history,::openSession)
                                    key=="achievements" -> AchievementsScreen(noteSessions(),achievementBoard,::openSession)
                                    key=="records" -> PersonalRecordsScreen(state.history, ::openSession, onRanks={push("ranks")})
                                }
                            }
                        }
                        if(page=="root") ShellNavigation(tab){tab=it}
                    }
                }
                SnackbarHost(snackbar,Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp))
            }
        }
    }
    if(finishing) state.active?.let{active->
        val empty=active.journal?.orderedBlocks?.flatMap{it.orderedEnds}?.sumOf{it.volume}?.let{it==0}?:active.allShots.isEmpty()
        AlertDialog(onDismissRequest={finishing=false},title={Text(stringResource(if(empty)R.string.empty_training else R.string.finish_training))},text={Text(stringResource(if(empty)R.string.empty_training_message else R.string.finish_message))},confirmButton={TextButton({if(empty){model.delete(active.session.id);root()}else model.finish(active.session.id);finishing=false},Modifier.testTag("finish-confirm")){Text(stringResource(if(empty)R.string.delete_empty else R.string.finish))}},dismissButton={TextButton({finishing=false}){Text(stringResource(R.string.continue_input))}})
    }
    model.achievements?.let {engine->AchievementBannerHost(achievementBoard.awards,
        settings.showAchievements&&!(settings.hideCurrentScores&&page=="training"),engine::claimNotifications,
        availableSessionIds=noteSessions().map{it.id}.toSet(),
        onSession={id->noteSessions().firstOrNull{it.id==id}?.let(::openSession)},
        onFailure={scope.launch{snackbar.showSnackbar("Не удалось показать поздравление.")}},
        recordEvents=recordEvents,onClaimRecords=model::claimRecordNotifications,
        recordsEnabled=settings.showAchievements&&!settings.hideCurrentScores)}
    if (timerWindow && state.active != null) PracticeTimerWindow(model.timer, settings.seriesTimerSeconds,
        settings.restTimerSeconds, preferences::timerDurations, onClose = {timerWindow = false})
    if(notesWindow) model.notes?.let {repository ->
        NotesWindow(repository,NoteScope(notesSessionId,notesBlockId,notesEndId),noteSessions(),onClose={notesWindow=false},
            onSession={notesWindow=false;openSession(it)})
    }
    if (managingRounds) report?.journal?.let { journal ->
        TrainingStructureManager(journal,pending>0||error!=null,onDismiss={managingRounds=false},
            onRemoveEnd=model::removeEnd,onRemoveRound=model::removeRound,onEditEnd={end->
                editShotId=end.shots.firstOrNull()?.id ?: end.end.id
                managingRounds=false
                push("edit-shot")
            })
    }
    if (importWindow) {
        ModalBottomSheet(onDismissRequest = { importWindow = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(Modifier.fillMaxWidth().fillMaxHeight(.92f).testTag("import-sheet")) {
                Row(Modifier.fillMaxWidth().padding(horizontal=20.dp), verticalAlignment=Alignment.CenterVertically) {
                    Text("Импорт MyTargets", Modifier.weight(1f), style=MaterialTheme.typography.titleLarge)
                    IconButton({ importWindow = false }) { FableIcon(Glyph.Close, description="Закрыть импорт") }
                }
                importer?.let { source -> MyTargetsImportScreen(source,equipmentItems,{importWindow=false;root();tab="history"},onTrash={importWindow=false;push("trash")}) }
                    ?: InfoCard(stringResource(R.string.import_pending_title),stringResource(R.string.import_pending_text))
            }
        }
    }
    if(techniqueWindow)model.techniques?.let { repo ->
        app.fableshot.android.technique.TechniqueWindow(repo,preferences,onClose={techniqueWindow=false},onSelect=if(page=="training"&&state.active!=null)({selection ->
            scope.launch {
                try { repo.bind(state.active!!.session.id,selection);techniqueWindow=false }
                catch(e:CancellationException) { throw e }
                catch(_:Exception) { snackbar.showSnackbar(saveFailed) }
            }
        })else null)
    }
    if(partial) state.active?.journal?.currentEnd?.let{end->AlertDialog(onDismissRequest={partial=false},title={Text(stringResource(R.string.partial_title))},text={Text(stringResource(R.string.partial_hint))},confirmButton={TextButton({model.nextPartial(end.end.id);partial=false},Modifier.testTag("partial-confirm")){Text(stringResource(R.string.close_partial))}},dismissButton={TextButton({partial=false}){Text(stringResource(R.string.cancel))}})}
    }
    if(trashConfirm)report?.let{value->AlertDialog(onDismissRequest={trashConfirm=false},title={Text(stringResource(R.string.trash_action))},text={Text(stringResource(R.string.trash_hint))},confirmButton={TextButton({model.delete(value.session.id);trashConfirm=false;root()},Modifier.testTag("trash-confirm")){Text(stringResource(R.string.trash_action))}},dismissButton={TextButton({trashConfirm=false}){Text(stringResource(R.string.cancel))}})}
    if(renaming)report?.let{value->AlertDialog(onDismissRequest={renaming=false},title={Text(stringResource(R.string.session_rename))},text={OutlinedTextField(renamedTitle,{renamedTitle=it.take(100)},Modifier.testTag("rename-title"),singleLine=true)},confirmButton={TextButton({model.rename(value.session.id,renamedTitle);renaming=false},Modifier.testTag("rename-confirm"),enabled=renamedTitle.isNotBlank()&&pending==0){Text(stringResource(R.string.save))}},dismissButton={TextButton({renaming=false}){Text(stringResource(R.string.cancel))}})}
}

@Composable
internal fun ShellTopBar(page:String,tab:String,settings:UserSettings,onBack:()->Unit,onProfile:()->Unit,onSettings:()->Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal=12.dp).heightIn(min=64.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(4.dp)) {
        if(page=="root") {
            Image(painterResource(R.drawable.fableshot_icon),null,Modifier.padding(8.dp).size(32.dp))
            Column(Modifier.weight(1f)){FittedLine(when(tab){"history"->"История";"progress"->"Прогресс";"equipment"->"Снаряжение";else->"FableShot"},style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.onSurface);if(tab=="home")FittedLine(if(settings.displayName.isBlank())stringResource(R.string.greeting)else stringResource(R.string.greeting_name,settings.displayName),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            IconButton(onSettings,Modifier.testTag("open-settings")){FableIcon(Glyph.Settings,description=stringResource(R.string.settings))}
            FilledTonalIconButton(onProfile,Modifier.size(44.dp).testTag("open-profile")){if(settings.displayName.isBlank())FableIcon(Glyph.User,description=stringResource(R.string.profile))else Text(settings.displayName.trim().take(1).uppercase(),style=MaterialTheme.typography.titleMedium)}
        } else {
            IconButton(onBack,Modifier.testTag("page-back")){FableIcon(Glyph.Back,description=stringResource(R.string.back))}
            val title=when(page){"setup"->R.string.new_training;"conditions"->R.string.block_change;"training"->R.string.target;"settings"->R.string.settings;"tutorial"->R.string.target_introduction;"import"->R.string.import_screen_title;"report"->R.string.statistics;"profile"->R.string.profile;"rank-equipment","equipment-editor"->R.string.nav_equipment;else->R.string.app_name}
            Text(when(page) {"ranks" -> "Нормативы"; "achievements" -> "Достижения"; "records" -> "Рекорды"; "arrow-analysis" -> "Номерные стрелы"; else -> stringResource(title)},Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
            if(page=="report") FableIcon(Glyph.Target,Modifier.padding(12.dp),tint=MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
internal fun ShellNavigation(selected:String,onSelected:(String)->Unit) {
    val destinations=listOf(Triple("home",Glyph.Home,R.string.nav_home),Triple("history",Glyph.History,R.string.history),Triple("progress",Glyph.Progress,R.string.nav_progress),Triple("equipment",Glyph.Bow,R.string.nav_equipment))
    val labels=destinations.map { stringResource(it.third) }
    val measurer=androidx.compose.ui.text.rememberTextMeasurer()
    val density=LocalDensity.current
    val baseStyle=MaterialTheme.typography.labelSmall
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val available=with(density) { (maxWidth/4-16.dp).roundToPx().coerceAtLeast(1) }
        val fontSize=remember(labels,available,density.fontScale,baseStyle) {
            var low=4f
            var high=baseStyle.fontSize.value
            repeat(10) {
                val candidate=(low+high)/2
                if(labels.all { measurer.measure(it,style=baseStyle.copy(fontSize=candidate.sp),maxLines=1,softWrap=false).size.width<=available }) low=candidate else high=candidate
            }
            low.sp
        }
        NavigationBar(containerColor=MaterialTheme.colorScheme.surface,tonalElevation=0.dp,windowInsets=WindowInsets(0,0,0,0)) {
            destinations.forEachIndexed { index,(id,glyph,_) ->
                NavigationBarItem(selected==id,{onSelected(id)},icon={FableIcon(glyph)},
                    label={androidx.compose.material3.Text(labels[index],style=baseStyle.copy(fontSize=fontSize),maxLines=1,softWrap=false,modifier=Modifier.testTag("nav-label-$id"))},
                    modifier=Modifier.testTag("nav-$id"),colors=NavigationBarItemDefaults.colors(selectedIconColor=LocalFableVisuals.current.onAction,indicatorColor=LocalFableVisuals.current.action,selectedTextColor=MaterialTheme.colorScheme.onSurface,unselectedTextColor=MaterialTheme.colorScheme.onSurfaceVariant))
            }
        }
    }
}

@Composable
private fun ProfileScreen(settings:UserSettings,sessions:List<SessionSummary>,onTechnique:(()->Unit)?=null,onRanks:()->Unit,assignments:app.fableshot.android.data.journal.RankAssignmentRepository?=null,achievementSessions:List<SessionSummary> = sessions,onAchievements:()->Unit,onRecords:()->Unit,board:app.fableshot.android.domain.AchievementBoard=app.fableshot.android.domain.AchievementBoard(),shootingHours:(@Composable ()->Unit)?=null,onSave:(String)->Unit) {
    var editingName by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable(settings.displayName){mutableStateOf(settings.displayName)}
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp).testTag("profile-screen"),verticalArrangement=Arrangement.spacedBy(20.dp)) {
        FableCard {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                FableIcon(Glyph.User,Modifier.size(36.dp),tint=MaterialTheme.colorScheme.primary)
                Text(settings.displayName.ifBlank { "Мой профиль" },Modifier.weight(1f).padding(horizontal=16.dp),style=MaterialTheme.typography.titleLarge)
                IconButton({editingName=!editingName}) { FableIcon(Glyph.Edit,description="Изменить имя") }
            }
            if(editingName) {
                OutlinedTextField(name,{name=it.take(40)},Modifier.fillMaxWidth(),label={Text(stringResource(R.string.profile_name))},singleLine=true)
                FablePrimaryButton(stringResource(R.string.save),{onSave(name);editingName=false},Modifier.fillMaxWidth(),enabled=name.trim()!=settings.displayName)
            }
        }
        if (onTechnique != null) FablePrimaryButton("Моя техника", onTechnique, Modifier.fillMaxWidth().testTag("profile-technique"), icon=Glyph.Notes)
        if (statisticVisible(StatisticFeature.Volume)) Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){MetricTile(sessions.sumOf{it.shotCount}.toString(),stringResource(R.string.arrows_label),Modifier.weight(1f));MetricTile(sessions.count{it.state=="completed"}.toString(),stringResource(R.string.completed_sessions),Modifier.weight(1f),Glyph.Calendar)}
        if (statisticVisible(StatisticFeature.TrainingTime)) shootingHours?.invoke()
        if (statisticVisible(StatisticFeature.Norms)) {
            assignments?.let {AssignedRanksCard(it)}
            ProfileRankSummary(sessions,onRanks)
        }
        if (statisticVisible(StatisticFeature.Records)) FablePrimaryButton("Мои рекорды", onRecords, Modifier.fillMaxWidth().testTag("profile-records"), icon = Glyph.Progress)
        ProfileAchievementsCard(achievementSessions, onAchievements, showEarned=settings.showAchievements,board=board)
    }
}





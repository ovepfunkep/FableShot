package app.fableshot.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.fableshot.android.data.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import app.fableshot.android.data.journal.BlockPlan
import app.fableshot.android.data.journal.JournalPracticeStore
import app.fableshot.android.data.journal.PersonalRecordEvent
import app.fableshot.android.data.journal.TrainingTimeSummary
import java.util.UUID

data class PracticeUiState(val active: SessionDetails? = null, val history: List<SessionSummary> = emptyList(), val loading: Boolean = true,val loadError:Boolean=false,val trash:List<SessionSummary> = emptyList())
private sealed interface UndoEntry {
    data class Insert(val shot: ShotEntity) : UndoEntry
    data class Edit(val old: ShotEntity, val expectedRevision: Int = old.revision + 1) : UndoEntry
}

class PracticeViewModel(private val repo: PracticeStore) : ViewModel() {
    val timer = PracticeTimer(viewModelScope)
    val techniques get()=(repo as? app.fableshot.android.data.journal.JournalPracticeStore)?.techniques
    val rankAssignments get()=(repo as? app.fableshot.android.data.journal.JournalPracticeStore)?.rankAssignments
    val notes get()=(repo as? app.fableshot.android.data.journal.JournalPracticeStore)?.notes
    val achievements get()=(repo as? app.fableshot.android.data.journal.JournalPracticeStore)?.journal?.achievements
    val achievementBoard = (achievements?.board ?: flowOf(app.fableshot.android.domain.AchievementBoard()))
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), app.fableshot.android.domain.AchievementBoard())
    private val journal get() = (repo as? JournalPracticeStore)?.journal
    val recordEvents = (journal?.recordEvents ?: flowOf(emptyList()))
        .catch { error ->
            if (error is kotlinx.coroutines.CancellationException) throw error
            android.util.Log.e("FableRecords", "Could not read personal record events", error)
            emit(emptyList())
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    suspend fun claimRecordNotifications(ids: List<String>): List<PersonalRecordEvent> =
        journal?.claimRecordNotifications(ids).orEmpty()
    fun arrowAnalysis(arrowsSetId: String): Flow<List<app.fableshot.android.data.journal.PhysicalArrowAnalysisGroup>> =
        journal?.history?.map { sessions ->
            app.fableshot.android.data.journal.physicalArrowAnalysis(sessions).filter { it.arrowsSetId == arrowsSetId }
        }?.flowOn(kotlinx.coroutines.Dispatchers.Default) ?: flowOf(emptyList())
    val trainingTimes = ((repo as? JournalPracticeStore)?.trainingTimes ?: flowOf(TrainingTimeSummary()))
        .catch { error ->
            if (error is kotlinx.coroutines.CancellationException) throw error
            android.util.Log.e("FableTrainingTime", "Could not read training durations", error)
            emit(TrainingTimeSummary())
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TrainingTimeSummary())
    suspend fun awaitStopped(){viewModelScope.coroutineContext[kotlinx.coroutines.Job]?.join()}
    private val reload=MutableStateFlow(0)
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val state = reload.flatMapLatest { combine(repo.active, repo.history,repo.trash) { active, history,trash -> PracticeUiState(active, history, false,trash=trash) }.catch { if(it is kotlinx.coroutines.CancellationException)throw it;emit(PracticeUiState(loading=false,loadError=true)) } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PracticeUiState())
    private val queue = Mutex()
    private val undoByEnd = mutableMapOf<String, ArrayDeque<UndoEntry>>()
    private val _undoableEnds = MutableStateFlow<Set<String>>(emptySet())
    val undoableEnds = _undoableEnds.asStateFlow()
    private val _pending = MutableStateFlow(0)
    val pending = _pending.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()
    private val _completedSession = MutableStateFlow<String?>(null)
    val completedSession = _completedSession.asStateFlow()
    fun acknowledgeCompletion(id: String) { _completedSession.compareAndSet(id, null) }
    private var retry: (() -> Unit)? = null

    private fun execute(operationId:String=UUID.randomUUID().toString(), action: suspend (String) -> Unit) {
        _pending.value++
        viewModelScope.launch {
            try { queue.withLock { action(operationId); _error.value = null; retry = null } }
            catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                _error.value = e.javaClass.simpleName
                retry = { execute(operationId,action) }
            } finally { _pending.value-- }
        }
    }

    private fun remember(endId: String, entry: UndoEntry) {
        undoByEnd.getOrPut(endId) { ArrayDeque() }.addLast(entry)
        _undoableEnds.value = undoByEnd.keys.toSet()
    }

    private fun clearUndo() { undoByEnd.clear(); _undoableEnds.value = emptySet() }
    fun retryLast() { if(state.value.loadError)reload.value++ else retry?.invoke() }
    fun start(title: String, distance: Double, diameterMm: Int, arrows: Int) = execute {
        repo.start(title, distance, diameterMm, arrows, it); clearUndo()
    }
    fun point(endId: String, value: TargetPoint) = execute { repo.add(endId, value, null, it)?.let { remember(endId, UndoEntry.Insert(it)) } }
    fun numeric(endId: String, score: Int) = execute { repo.add(endId, null, score, it)?.let { remember(endId, UndoEntry.Insert(it)) } }
    fun pointNumbered(endId: String, point: TargetPoint, physicalArrowNumber: Int?) = execute {
        repo.addNumbered(endId, point, null, physicalArrowNumber, it)?.let { remember(endId, UndoEntry.Insert(it)) }
    }
    fun numericNumbered(endId: String, score: Int, physicalArrowNumber: Int?) = execute {
        repo.addNumbered(endId, null, score, physicalArrowNumber, it)?.let { remember(endId, UndoEntry.Insert(it)) }
    }
    fun x(endId:String)=execute { repo.addX(endId,it)?.let{remember(endId,UndoEntry.Insert(it))} }
    fun update(value: ShotEntity) = execute { repo.revise(value,it)?.let { remember(value.endId, UndoEntry.Edit(it)) } }
    fun undo(endId: String) = execute {
        val undo = undoByEnd[endId] ?: return@execute
        val entry = undo.last()
        when (entry) {
            is UndoEntry.Insert -> repo.undoInserted(entry.shot.id, entry.shot.endId,it)
            is UndoEntry.Edit -> repo.undoRevision(entry.old.copy(revision=entry.expectedRevision),it)
        }
        undo.removeLast()
        if (entry is UndoEntry.Edit) {
            val previous = undo.indexOfLast { it is UndoEntry.Edit && it.old.id == entry.old.id }
            if (previous >= 0) {
                val edit = undo[previous] as UndoEntry.Edit
                undo[previous] = edit.copy(expectedRevision = entry.expectedRevision + 1)
            }
        }
        if (undo.isEmpty()) undoByEnd.remove(endId)
        _undoableEnds.value = undoByEnd.keys.toSet()
    }
    private suspend fun completed(id: String) {
        if (repo.details(id)?.session?.state == "completed") _completedSession.value = id
    }
    fun next(endId: String) = execute {
        val active = repo.active.first()?.takeIf { it.currentEnd?.end?.id == endId }
        repo.next(endId,it)
        clearUndo()
        active?.session?.id?.let { completed(it) }
    }
    fun startNextRound(id:String) = execute {
        repo.startNextRound(id,it)
        clearUndo()
    }
    fun finish(id: String) = execute {
        repo.complete(id,it)
        clearUndo()
        completed(id)
    }
    suspend fun details(id: String) = repo.details(id)
    fun delete(id: String) = execute { repo.delete(id,it); clearUndo() }

    fun newBlock(id:String,plan:BlockPlan,allowPartial:Boolean) = execute { repo.block(id,plan,allowPartial,it); clearUndo() }
    fun startPlan(title:String,plan:BlockPlan) = execute { repo.startPlan(title,plan,it); clearUndo() }
    fun setCount(endId:String,count:Int) = execute { repo.count(endId,count,it); clearUndo() }
    fun warmup(endId:String,enabled:Boolean) = execute { repo.warmup(endId,enabled,it) }
    fun nextPartial(endId:String) = execute {
        val active = repo.active.first()?.takeIf { it.currentEnd?.end?.id == endId }
        repo.nextPartial(endId,it)
        clearUndo()
        active?.session?.id?.let { completed(it) }
    }
    fun restore(id:String) = execute { repo.restore(id,it);clearUndo() }
    fun pause(id:String) = execute { repo.pause(id,it);clearUndo() }
    fun resume(id:String) = execute { repo.resume(id,it);clearUndo() }
    fun rename(id:String,title:String) = execute { repo.rename(id,title,it) }
    fun removeShot(id:String,revision:Long) = execute { repo.removeShot(id,revision,it);clearUndo() }
    fun removeEnd(id:String,revision:Long) = execute { repo.removeEnd(id,revision,it);clearUndo() }
    fun removeRound(sessionId:String,firstEndId:String,revision:Long) = execute { repo.removeRound(sessionId,firstEndId,revision,it);clearUndo() }
    fun reviseCount(endId:String,count:Int,revision:Long) = execute { repo.reviseCount(endId,count,revision,it);clearUndo() }
    fun reviseJournal(value:app.fableshot.android.data.journal.JournalShot) = execute { repo.reviseJournal(value,it);clearUndo() }

    class Factory(private val repository: PracticeStore) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = PracticeViewModel(repository) as T
    }
}



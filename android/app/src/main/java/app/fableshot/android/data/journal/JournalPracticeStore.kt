package app.fableshot.android.data.journal

import app.fableshot.android.data.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import java.util.concurrent.ConcurrentHashMap

/** Presentation adapter. Primary facts stay in JournalDatabase; old target drawing uses ShotEntity. */
class JournalPracticeStore(private val db:JournalDatabase,gate:WriteGate=WriteGate(),comparisonCategory:(suspend()->String?)?=null):PracticeStore {
    val journal=JournalRepository(db,gate,System::currentTimeMillis,comparisonCategory)
    val techniques = app.fableshot.android.technique.TechniqueRepository(db, gate) { ruleId, operationId ->
        journal.achievements.serviceInTransaction(ruleId, operationId, System.currentTimeMillis())
    }
    val rankAssignments=RankAssignmentRepository(db,gate)
    val notes=DiaryNoteRepository(db,gate)
    private val dao=db.journalDao()
    val trainingTimes = dao.trainingTimeEvents()
        .distinctUntilChanged()
        .map(::trainingTimeSummary)
        .flowOn(Dispatchers.Default)
    private val pendingIntents=ConcurrentHashMap<String,Any>()
    private val undoSnapshots=ConcurrentHashMap<String,List<JournalShot>>()
    private val undoReceipts=ConcurrentHashMap<String,JournalShot>()
    private fun clearUndoSnapshots() {undoSnapshots.clear();undoReceipts.clear()}
    @Suppress("UNCHECKED_CAST")
    private suspend fun <T:Any,R> intent(id:String,read:suspend()->T,write:suspend(T)->R):R {
        val snapshot=(pendingIntents[id]?:read().let { pendingIntents.putIfAbsent(id,it)?:it }) as T
        val result=write(snapshot)
        pendingIntents.remove(id)
        return result
    }
    // Room moves its queries off Main; downstream presentation work needs its own
    // dispatcher too. A hit in the active diary must not rebuild an unchanged history.
    override val active=journal.active.distinctUntilChanged().map { it?.presentation() }.flowOn(Dispatchers.Default)
    override val history=summaries(journal.history)
    override val trash=summaries(journal.trashHistory)

    private fun summaries(source:Flow<List<JournalDetails>>):Flow<List<SessionSummary>> = flow {
        var previous=emptyMap<String,Pair<JournalDetails,SessionSummary>>()
        source.distinctUntilChanged().collect { rows ->
            val next=LinkedHashMap<String,Pair<JournalDetails,SessionSummary>>(rows.size)
            val values=rows.map { details ->
                val cached=previous[details.session.id]?.takeIf { it.first==details }
                val entry=cached ?: (details to details.summary())
                next[details.session.id]=entry
                entry.second
            }
            // Cache belongs to this collection and only the current list: removal,
            // restore and edits cannot retain a stale summary or grow it indefinitely.
            previous=next
            emit(values)
        }
    }.flowOn(Dispatchers.Default)
    private fun checked(result:JournalWrite):JournalWrite.Saved=when(result) {
        is JournalWrite.Saved->result
        is JournalWrite.Conflict->error("REVISION_CONFLICT:${result.currentRevision}")
        is JournalWrite.Rejected->error("WRITE_REJECTED:${result.reason}")
    }
    override suspend fun start(title:String,distance:Double,diameterMm:Int,arrows:Int,operationId:String) { checked(journal.start(title,BlockPlan(distance,diameterMm,arrows),operationId));clearUndoSnapshots() }
    override suspend fun startPlan(title:String,plan:BlockPlan,operationId:String) { checked(journal.start(title,plan,operationId));clearUndoSnapshots() }
    override suspend fun add(endId:String,point:TargetPoint?,numeric:Int?,operationId:String):ShotEntity? {
        val saved=checked(if(point!=null)journal.point(endId,point,operationId)else journal.numeric(endId,requireNotNull(numeric),operationId))
        return dao.shot(saved.id)?.presentation()
    }
    override suspend fun addNumbered(endId: String, point: TargetPoint?, numeric: Int?,
        physicalArrowNumber: Int?, operationId: String): ShotEntity? {
        val saved = checked(if (point != null) journal.point(endId, point, operationId, physicalArrowNumber)
            else journal.numeric(endId, requireNotNull(numeric), operationId, physicalArrowNumber))
        return dao.shot(saved.id)?.presentation()
    }
    override suspend fun addX(endId:String,operationId:String):ShotEntity? { val saved=checked(journal.numericX(endId,operationId));return dao.shot(saved.id)?.presentation() }
    override suspend fun revise(value:ShotEntity,operationId:String):ShotEntity?=intent(operationId,{requireNotNull(dao.shot(value.id))}) { old ->
        val keepUnverified=old.positionStatus=="unverified"&&value.x==null
        val sameScore = old.presentation().copy(physicalArrowNumber = value.physicalArrowNumber) == value
        if (sameScore) {
            val saved=checked(journal.revise(old.copy(physicalArrowNumber=value.physicalArrowNumber),value.revision.toLong(),operationId))
            if(!saved.replayed)undoSnapshots.compute(old.id) {_,previous ->previous.orEmpty()+old}
            return@intent old.presentation()
        }
        val saved=checked(journal.revise(old.copy(points=value.points,zoneCode=value.zoneCode,x=if(keepUnverified)old.x else value.x,y=if(keepUnverified)old.y else value.y,
            scoreSource=if(value.origin=="target")"target_computed"else"manual_edit",
            positionStatus=if(keepUnverified)"unverified"else if(value.x==null)"unknown"else"known",positionSource=if(keepUnverified)old.positionSource else if(value.x==null)"none"else"manual_target",
            physicalArrowNumber=value.physicalArrowNumber),value.revision.toLong(),operationId))
        if(!saved.replayed)undoSnapshots.compute(old.id) {_,previous ->previous.orEmpty()+old}
        old.presentation()
    }
    override suspend fun undoRevision(value:ShotEntity,operationId:String) {
        intent(operationId,{
            requireNotNull(undoReceipts[operationId] ?: undoSnapshots[value.id]?.lastOrNull()) {
                "UNDO_SNAPSHOT_NOT_FOUND"
            }
        }) { original ->
            require(original.presentation().copy(revision=value.revision)==value) {"UNDO_SNAPSHOT_MISMATCH"}
            val saved=checked(journal.restoreRevision(original,value.revision.toLong(),operationId))
            undoReceipts[operationId]=original
            if(!saved.replayed)undoSnapshots.compute(original.id) {_,previous ->
                previous?.takeIf {it.lastOrNull()==original}?.dropLast(1) ?: previous
            }
            Unit
        }
    }
    override suspend fun undoInserted(id:String,endId:String,operationId:String) { intent(operationId,{requireNotNull(dao.shot(id))}) { shot->require(shot.endId==endId);checked(journal.removeShot(id,shot.revision,operationId));Unit } }
    override suspend fun next(endId:String,operationId:String) { intent(operationId,{requireNotNull(dao.end(endId)).revision}) { checked(journal.next(endId,it,operationId=operationId));Unit };clearUndoSnapshots() }
    override suspend fun startNextRound(id:String,operationId:String) {
        intent(operationId,{requireNotNull(dao.session(id)).revision}) {
            checked(journal.startNextRound(id,it,operationId));Unit
        }
        clearUndoSnapshots()
    }
    override suspend fun nextPartial(endId:String,operationId:String) { intent(operationId,{requireNotNull(dao.end(endId)).revision}) { checked(journal.next(endId,it,true,operationId));Unit };clearUndoSnapshots() }
    override suspend fun complete(id:String,operationId:String) { intent(operationId,{requireNotNull(dao.session(id)).revision}) { checked(journal.complete(id,it,operationId));Unit };clearUndoSnapshots() }
    override suspend fun details(id:String,operationId:String)=journal.details(id)?.presentation()
    override suspend fun delete(id:String,operationId:String) { intent(operationId,{requireNotNull(dao.session(id)).revision}) { checked(journal.trash(id,it,operationId));Unit } }
    override suspend fun block(id:String,plan:BlockPlan,allowPartial:Boolean,operationId:String) { intent(operationId,{requireNotNull(dao.session(id)).revision}) { checked(journal.startBlock(id,plan,it,allowPartial,operationId));Unit } }
    override suspend fun count(endId:String,count:Int,operationId:String) { intent(operationId,{requireNotNull(dao.end(endId)).revision}) { checked(journal.setCount(endId,count,it,operationId));Unit } }
    override suspend fun warmup(endId:String,enabled:Boolean,operationId:String) { intent(operationId,{requireNotNull(dao.end(endId)).revision}) { checked(journal.role(endId,if(enabled)"warmup"else"scored",it,operationId));Unit } }
    override suspend fun restore(id:String,operationId:String) { intent(operationId,{requireNotNull(dao.session(id)).revision}) { checked(journal.restore(id,it,operationId));Unit } }
    override suspend fun pause(id:String,operationId:String) { intent(operationId,{requireNotNull(dao.session(id)).revision}) { checked(journal.pause(id,it,operationId));Unit } }
    override suspend fun resume(id:String,operationId:String) { intent(operationId,{requireNotNull(dao.session(id)).revision}) { checked(journal.resume(id,it,operationId));Unit } }
    override suspend fun rename(id:String,title:String,operationId:String) { intent(operationId,{requireNotNull(dao.session(id)).revision}) { checked(journal.rename(id,title,it,operationId));Unit } }
    override suspend fun removeShot(id:String,revision:Long,operationId:String) { checked(journal.removeShot(id,revision,operationId)) }
    override suspend fun removeEnd(endId:String,revision:Long,operationId:String) {
        checked(journal.removeEnd(endId,revision,operationId));clearUndoSnapshots()
    }
    override suspend fun removeRound(sessionId:String,firstEndId:String,revision:Long,operationId:String) {
        checked(journal.removeRound(sessionId,firstEndId,revision,operationId));clearUndoSnapshots()
    }
    override suspend fun reviseCount(endId:String,count:Int,revision:Long,operationId:String) { checked(journal.reviseCount(endId,count,revision,operationId)) }
    override suspend fun reviseJournal(value:JournalShot,operationId:String) { checked(journal.revise(value,value.revision,operationId)) }
}

fun JournalShot.presentation()=ShotEntity(id,endId,inputIndex,points,x.takeIf{positionStatus=="known"},y.takeIf{positionStatus=="known"},when(scoreSource){"target_computed"->"target";"numeric_entry"->"numeric";else->"manual"},createdAtMs,revision.toInt(),zoneCode,physicalArrowNumber)

fun JournalDetails.presentation(onlyBlock:JournalBlockDetails?=null,scoredOnly:Boolean=false):SessionDetails {
    val selected=onlyBlock?:currentBlock
    val conditions=selected?.block
    val shown=if(onlyBlock!=null)listOf(onlyBlock)else orderedBlocks
    val ends=shown.flatMap { it.orderedEnds }.filter { !scoredOnly||it.end.role=="scored" }
    return SessionDetails(SessionEntity(session.id,session.title,session.startedAtMs?:session.createdAtMs,conditions?.distanceMeters?:0.0,conditions?.targetDiameterMm?:0,conditions?.defaultArrowsPerEnd?:3,conditions?.targetProfileId?:"count-only",session.state,session.completedAtMs),
        ends.mapIndexed { n,e->EndWithShots(EndEntity(e.end.id,session.id,n+1,e.end.plannedCount,e.end.state=="closed"),e.shots.sortedBy{it.inputIndex}.map{it.presentation()}) },this)
}

fun JournalDetails.summary():SessionSummary = summaryParts(true)
private fun JournalDetails.summaryParts(includeParts:Boolean):SessionSummary {
    val first=orderedBlocks.firstOrNull()?.block
    val scored=orderedBlocks.filter{it.block.mode=="scored"}.flatMap{it.orderedEnds}.filter{it.end.role=="scored"}.flatMap{it.shots}
    val volume=orderedBlocks.flatMap{it.orderedEnds}.sumOf{it.volume}
    val conditions=orderedBlocks.filter{it.block.mode=="scored"}.map{it.block.analyticsIdentity()}.distinct()
    val progressScope=reportScopes().firstOrNull { it.id=="all" }
    val progress=progressScope?.merged()?.let(::journalProgress)
    val progressSources=progressScope?.baseline?.takeIf { progress!=null }
        ?.let { org.json.JSONArray(it.sourceSessionsJson).length() }
    val importedProgressCondition = first?.takeIf { session.sourceKind == "mytargets" }
        ?.let { importedProgressCondition(it.targetSnapshotJson, it.equipmentSnapshotJson) }
    return SessionSummary(session.id,session.title,session.startedAtMs?:session.createdAtMs,session.state,volume,scored.sumOf{it.points},first?.distanceMeters?:0.0,first?.targetDiameterMm?:0,first?.targetProfileId?:"count-only",
        JournalSummaryMeta(blocks.size,scored.size,conditions.size==1&&blocks.all{it.block.mode=="scored"&&it.block.distanceMeters!=null&&it.block.targetDiameterMm!=null},blocks.all{it.block.mode=="count_only"},conditions.singleOrNull()?.joinToString("|"),session.localDate,session.localDate!=null||session.startedAtMs!=null,first?.distanceMeters!=null,first?.targetDiameterMm!=null,session.revision,progress?.percentagePoints,progress?.fullRankAvailable?:false,(0..10).map{zone->scored.count{it.points==zone}},scored.count{it.zoneCode=="X"},if(orderedBlocks.all{it.block.mode=="scored"&&it.block.verifiedTarget()!=null})scored.mapNotNull{if(it.positionStatus=="known"&&it.faceId=="main"&&it.x!=null&&it.y!=null)app.fableshot.android.domain.TargetPoint(it.x,it.y)else null}else null,if(includeParts&&blocks.size>1)orderedBlocks.groupBy{listOf(it.block.mode)+it.block.analyticsIdentity()}.values.map{part->copy(blocks=part).summaryParts(false)}else null,equipmentLabel=first?.equipmentSnapshotJson?.let{raw->runCatching{org.json.JSONObject(raw).getJSONObject("selection").getString("name")}.getOrNull()},rankResults=if(includeParts)fullRankResults()else emptyList(),seriesRecords=if(includeParts)fullSeriesRecords()else emptyList(),importedProgressCondition=importedProgressCondition,progressRelativePercent=progress?.relativePercent,progressBaselineAverage=progress?.baselineAverage,progressCurrentAverage=progress?.currentAverage,progressSourceCount=progressSources,roundRanks=if(includeParts)roundRankSummaries()else emptyList()))
}

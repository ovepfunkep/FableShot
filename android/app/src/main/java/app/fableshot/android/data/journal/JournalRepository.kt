package app.fableshot.android.data.journal

import androidx.room.withTransaction
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.domain.TargetScoring
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

enum class WriteIssue { NOT_FOUND, INACTIVE, CLOSED, FULL, INCOMPLETE, INVALID, WRONG_MODE, OPERATION_REUSED }
sealed interface JournalWrite {
    data class Saved(val id:String,val revision:Long,val sessionId:String,val replayed:Boolean=false):JournalWrite
    data class Rejected(val reason:WriteIssue):JournalWrite
    data class Conflict(val currentRevision:Long):JournalWrite
}
data class BlockPlan(val distanceMeters:Double?,val diameterMm:Int?,val arrows:Int=3,val mode:String="scored",val equipmentSnapshotJson:String?=null,val plannedEnds:Int?=null,val targetProfileId:String=PRACTICE_PROFILE,val techniqueSelection:app.fableshot.android.technique.TechniqueSelection?=null,val roundCount:Int=1,val rankCategory:String?=null,
    val seriesPerRound:Int?=null,val flexibleSeries:Boolean=false,val numberedArrows:Boolean?=null,
    val roundArrowLimit:Int?=null,
) {
    fun forOpenPractice() = if(flexibleSeries) this else copy(
        plannedEnds=null,roundCount=1,seriesPerRound=if(roundArrowLimit!=null)null else plannedEnds?.div(roundCount) ?: 10,flexibleSeries=true,
    )

    fun valid()=(roundArrowLimit==null||(flexibleSeries&&seriesPerRound==null&&roundArrowLimit in 1..MAX_SERIES_ARROWS))&&
        (if(flexibleSeries) plannedEnds==null&&roundCount==1&&(seriesPerRound==null||seriesPerRound in 1..200) else seriesPerRound==null)&&mode in setOf("scored","count_only")&&arrows in 1..12&&(distanceMeters==null||(distanceMeters.isFinite()&&distanceMeters>0))&&(diameterMm==null||diameterMm>0)&&(mode!="scored"||(distanceMeters!=null&&diameterMm!=null))&&roundCount in 1..20&&(if(plannedEnds==null)roundCount==1 else plannedEnds in 1..200&&plannedEnds%roundCount==0)&&(mode!="scored"||app.fableshot.android.domain.TargetCatalog.find(targetProfileId)?.acceptsDiameter(diameterMm?:0)==true)
}

/** Typed transactions for the next journal. No production database filename is selected here. */
class JournalRepository(private val db:JournalDatabase,private val gate:app.fableshot.android.data.WriteGate=app.fableshot.android.data.WriteGate(),private val now:()->Long=System::currentTimeMillis) {
    private var comparisonCategory:(suspend()->String?)?=null
    internal constructor(db:JournalDatabase,gate:app.fableshot.android.data.WriteGate,now:()->Long,
        comparisonCategory:(suspend()->String?)?):this(db,gate,now){this.comparisonCategory=comparisonCategory}
    private val dao=db.journalDao()
    val achievements=AchievementEngine(db,gate,now)
    val recordEvents = dao.recordEvents()
    val active=dao.active()
    val history=dao.history()
    val trashHistory=dao.trash()
    suspend fun details(id:String)=dao.details(id)
    suspend fun claimRecordNotifications(ids: List<String>): List<PersonalRecordEvent> = gate.write {
        db.withTransaction {
            val claims = mutableListOf<PersonalRecordEvent>()
            val atMs = now()
            for (batch in ids.distinct().chunked(100)) {
                val pending = dao.pendingRecordEvents(batch).associateBy { it.id }
                for (id in batch) {
                    val event = pending[id] ?: continue
                    val session = dao.session(event.sessionId) ?: continue
                    if (session.state == "completed" && session.deletedAtMs == null && session.revision == event.sessionRevision) {
                        claims += event.copy(notifiedAtMs = atMs)
                    }
                }
                if (pending.isNotEmpty()) dao.acknowledgeRecordEvents(pending.keys.toList(), atMs)
            }
            claims
        }
    }
    private fun uuid()=UUID.randomUUID().toString()
    private fun hash(vararg values:Any?):String {
        val text=buildString{values.forEach{v->if(v==null)append("n;")else{
            // An absent new plan field must keep persisted pre-v16 start/block receipt hashes.
            val s=if(v is BlockPlan&&v.roundArrowLimit==null)
                v.toString().removeSuffix(", roundArrowLimit=null)")+")" else v.toString()
            append('s');append(s.length);append(':');append(s)
        }}}
        return MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
    }
    private suspend fun mutate(operationId:String,kind:String,payloadHash:String,body:suspend()->JournalWrite):JournalWrite=gate.write { db.withTransaction {
        if(operationId.isBlank()||operationId.length>128)return@withTransaction JournalWrite.Rejected(WriteIssue.INVALID)
        dao.receipt(operationId)?.let{receipt->
            return@withTransaction if(receipt.kind==kind&&receipt.payloadHash==payloadHash)JournalWrite.Saved(receipt.resultId,receipt.resultRevision,receipt.sessionId,true)else JournalWrite.Rejected(WriteIssue.OPERATION_REUSED)
        }
        val result=body()
        if(result is JournalWrite.Saved) {
            val atMs = now()
            val eventKind = when {
                kind == "next" && result.id == result.sessionId -> "complete"
                kind == "undo_edit" -> "revise"
                kind == "remove_end" || kind == "remove_round" -> "remove_shot"
                else -> kind
            }
            if (eventKind == "complete") {
                comparisonCategory?.let { achievements.captureComparisonCategory(result.sessionId, it()) }
                if (dao.firstNativeCompletion(result.sessionId)) {
                    val details = requireNotNull(dao.details(result.sessionId))
                    val category = db.achievementDao().enrollment(result.sessionId)?.rankCategory
                    dao.recordImprovements(details, category, atMs)
                }
            }
            dao.insert(MutationReceipt(operationId,result.sessionId,kind,payloadHash,result.id,result.revision,atMs))
            if(kind!="start")achievements.reconcile(result.sessionId,eventKind,operationId)
        }
        result
    }
    }
    private fun block(sessionId:String,ordinal:Int,plan:BlockPlan)=JournalBlock(uuid(),sessionId,ordinal,plan.mode,plan.distanceMeters,
        if(plan.mode=="scored")plan.targetProfileId else null,if(plan.mode=="scored")1 else null,plan.diameterMm,
        if(plan.mode=="scored")app.fableshot.android.domain.TargetCatalog.find(plan.targetProfileId)!!.snapshot(plan.diameterMm!!)else null,plan.equipmentSnapshotJson,plan.arrows)
    private data class Context(val session:JournalSession,val block:JournalBlock,val end:JournalEnd)
    private suspend fun context(endId:String):Context? {
        val end=dao.end(endId)?:return null
        val block=dao.block(end.blockId)?:return null
        val session=dao.session(block.sessionId)?:return null
        return Context(session,block,end)
    }
    private suspend fun writable(c:Context):WriteIssue?=when {
        c.session.deletedAtMs!=null||c.session.state!="active"->WriteIssue.INACTIVE
        c.end.state!="open"->WriteIssue.CLOSED
        dao.latestBlock(c.session.id)?.id!=c.block.id||dao.latestEnd(c.block.id)?.id!=c.end.id->WriteIssue.INACTIVE
        else->null
    }
    private suspend fun bump(c:Context){dao.bumpEnd(c.end.id);dao.bumpSession(c.session.id)}
    private fun denied(reason:WriteIssue)=JournalWrite.Rejected(reason)
    private suspend fun otherPlanEndsFull(c:Context):Boolean {
        val limit=dao.plan(c.session.id)?.takeUnless { it.rolling }?.plannedEnds?:return false
        val details=dao.details(c.session.id)!!
        return details.blocks.sumOf{b->b.ends.count{it.end.id!=c.end.id&&details.spendsPlanEnd(it)}}>=limit
    }

    suspend fun start(title:String,plan:BlockPlan,operationId:String=uuid()):JournalWrite=mutate(operationId,"start",hash(title,plan)) {
        if(title.isBlank()||!plan.valid())return@mutate denied(WriteIssue.INVALID)
        if(dao.activeSession()!=null)return@mutate denied(WriteIssue.INACTIVE)
        val instant=now();val zone=ZoneId.systemDefault();val id=uuid()
        val session=JournalSession(id,title.trim(),instant,instant,localDate=Instant.ofEpochMilli(instant).atZone(zone).toLocalDate().toString(),timeZoneId=zone.id,numberedArrows=plan.numberedArrows)
        val block=block(id,0,plan)
        dao.insert(session);dao.insert(block);dao.insert(JournalEnd(uuid(),block.id,0,plan.arrows,createdAtMs=instant))
        achievements.enroll(session,plan.rankCategory)
        if(plan.flexibleSeries) dao.insert(SessionPlan(id,plan.seriesPerRound ?: 0,rolling=true,roundArrowLimit=plan.roundArrowLimit))
        else plan.plannedEnds?.let{dao.insert(SessionPlan(id,it,plan.roundCount))}
        freezeProgress(db,session,block,instant)
        plan.techniqueSelection?.let{app.fableshot.android.technique.bindTechnique(db,id,it)}
        JournalWrite.Saved(id,1,id)
    }

    suspend fun numeric(endId:String,points:Int,operationId:String=uuid(),physicalArrowNumber:Int?=null)=
        append(endId,points,null,false,operationId,physicalArrowNumber=physicalArrowNumber)
    suspend fun point(endId:String,point:TargetPoint,operationId:String=uuid(),physicalArrowNumber:Int?=null)=
        append(endId,TargetScoring.score(point),point,true,operationId,physicalArrowNumber=physicalArrowNumber)
    suspend fun numericX(endId:String,operationId:String=uuid(),physicalArrowNumber:Int?=null)=
        append(endId,10,null,false,operationId,true,physicalArrowNumber)
    private suspend fun append(endId:String,points:Int,point:TargetPoint?,automatic:Boolean,operationId:String,
        requestedX:Boolean=false,physicalArrowNumber:Int?=null):JournalWrite {
        // Keep the pre-numbering operation hash for unnumbered retries created by an earlier app version.
        val payload = if (physicalArrowNumber == null) hash(endId,points,point?.x,point?.y,automatic,requestedX)
            else hash(endId,points,point?.x,point?.y,automatic,requestedX,physicalArrowNumber)
        return mutate(operationId,"append",payload) {
            val c=context(endId)?:return@mutate denied(WriteIssue.NOT_FOUND)
            writable(c)?.let{return@mutate denied(it)}
            if(c.block.mode!="scored")return@mutate denied(WriteIssue.WRONG_MODE)
            if(c.end.role=="scored"&&otherPlanEndsFull(c))return@mutate denied(WriteIssue.FULL)
            if(c.end.role=="scored"&&dao.details(c.session.id)!!.roundProgress(endId).let {
                it.roundArrowLimit!=null && it.ends.sumOf { entry -> entry.volume }>=it.roundArrowLimit
            })return@mutate denied(WriteIssue.FULL)
            val profile=c.block.verifiedTarget()?:return@mutate denied(WriteIssue.INVALID)
            val shaftDiameter = if (automatic) c.block.shaftDiameterMm() else null
            val zone=if(automatic)profile.scoreShaft(requireNotNull(point),shaftDiameter!!,c.block.targetDiameterMm!!)else app.fableshot.android.domain.TargetZone(if(requestedX)"X" else if(points==0)"M" else points.toString(),points,0.0)
            if(zone.points !in profile.values||(requestedX&&!profile.supportsX))return@mutate denied(WriteIssue.INVALID)
            val shots=dao.shots(endId)
            if (physicalArrowNumber != null && (c.block.physicalArrowSet()?.let { physicalArrowNumber in 1..it.count } != true ||
                shots.any { it.physicalArrowNumber == physicalArrowNumber })) return@mutate denied(WriteIssue.INVALID)
            if(shots.size>=c.end.plannedCount) {
                if(dao.plan(c.session.id)?.rolling!=true||shots.size>=MAX_SERIES_ARROWS)return@mutate denied(WriteIssue.FULL)
                dao.update(c.end.copy(plannedCount=shots.size+1))
            }
            val shot=JournalShot(uuid(),endId,shots.size,zone.points,zone.code,if(automatic)zone.points else null,if(automatic)profile.shaftRuleVersion else null,
                point?.x,point?.y,if(point!=null)"main"else null,if(automatic)"target_computed"else"numeric_entry",if(point!=null)"manual_target"else"none",if(point!=null)"known"else"unknown",physicalArrowNumber,now(),shaftDiameterMm=shaftDiameter)
            dao.insert(shot);bump(c);JournalWrite.Saved(shot.id,shot.revision,c.session.id)
        }
    }

    suspend fun revise(value:JournalShot,expectedRevision:Long=value.revision,operationId:String=uuid()):JournalWrite =
        writeRevision(value,expectedRevision,operationId,false)

    /** Only the adapter's captured pre-edit fact can use this path; moving a point uses normal revise. */
    internal suspend fun restoreRevision(value:JournalShot,expectedRevision:Long,operationId:String):JournalWrite =
        writeRevision(value,expectedRevision,operationId,true)

    private suspend fun writeRevision(value:JournalShot,expectedRevision:Long,operationId:String,restoreOriginal:Boolean):JournalWrite =
        mutate(operationId,if(restoreOriginal)"undo_edit"else"revise",
            if(restoreOriginal)hash(value,expectedRevision)else revisionHash(value,expectedRevision)) {
        val old=dao.shot(value.id)?:return@mutate denied(WriteIssue.NOT_FOUND)
        val c=context(old.endId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(c.session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
        if(old.revision!=expectedRevision)return@mutate JournalWrite.Conflict(old.revision)
        if(value.points !in 0..10||(value.x==null)!=(value.y==null))return@mutate denied(WriteIssue.INVALID)
        if(value.x!=null&&(!value.x.isFinite()||!value.y!!.isFinite()))return@mutate denied(WriteIssue.INVALID)
        if(value.shaftDiameterMm?.let { !app.fableshot.android.domain.ArrowShaft.validDiameter(it) } == true)return@mutate denied(WriteIssue.INVALID)
        if(value.scoreSource !in setOf("target_computed","numeric_entry","manual_edit","imported"))return@mutate denied(WriteIssue.INVALID)
        if(value.positionStatus !in setOf("known","unknown","unverified")||value.positionSource !in setOf("manual_target","manual_photo","imported","none"))return@mutate denied(WriteIssue.INVALID)
        if((value.positionStatus in setOf("known","unverified")&&(value.x==null||value.positionSource=="none"))||(value.positionStatus=="unknown"&&value.x!=null))return@mutate denied(WriteIssue.INVALID)
        if(value.physicalArrowNumber!=null&&value.physicalArrowNumber<=0)return@mutate denied(WriteIssue.INVALID)
        if (value.physicalArrowNumber != null && value.physicalArrowNumber != old.physicalArrowNumber) {
            if ((!restoreOriginal && c.block.physicalArrowSet()?.let { value.physicalArrowNumber in 1..it.count } != true) ||
                dao.shots(old.endId).any { it.id != old.id && it.physicalArrowNumber == value.physicalArrowNumber })
                return@mutate denied(WriteIssue.INVALID)
        }
        if (restoreOriginal) {
            val updated=value.copy(endId=old.endId,inputIndex=old.inputIndex,createdAtMs=old.createdAtMs,
                updatedAtMs=now(),revision=old.revision+1)
            dao.update(updated);bump(c);return@mutate JournalWrite.Saved(old.id,updated.revision,c.session.id)
        }
        val samePosition = value.x == old.x && value.y == old.y && value.positionStatus == old.positionStatus &&
            value.positionSource == old.positionSource
        if (samePosition && value.points == old.points && value.zoneCode == old.zoneCode && value.scoreSource == old.scoreSource) {
            // Assigning a number is not an instruction to re-judge historic native/imported coordinates.
            val updated = old.copy(physicalArrowNumber=value.physicalArrowNumber,updatedAtMs=now(),revision=old.revision+1)
            dao.update(updated);bump(c);return@mutate JournalWrite.Saved(old.id,updated.revision,c.session.id)
        }
        val profile=c.block.verifiedTarget()
        if(profile!=null&&value.points !in profile.values)return@mutate denied(WriteIssue.INVALID)
        val shaftDiameter = if (value.positionStatus != "known" || value.x == null) null
            else if (samePosition) old.shaftDiameterMm else c.block.shaftDiameterMm()
        val automaticZone = if (value.positionStatus == "known" && value.x != null && profile != null) {
            val point = TargetPoint(value.x,value.y!!)
            if (shaftDiameter == null) profile.score(point)
            else profile.scoreShaft(point,shaftDiameter,c.block.targetDiameterMm!!)
        } else null
        val automatic=automaticZone?.points
        if(value.scoreSource=="target_computed"&&(automatic==null||value.points!=automatic))return@mutate denied(WriteIssue.INVALID)
        val xZone=value.scoreSource!="target_computed"&&value.zoneCode=="X"
        if(xZone&&(value.points!=10||c.block.targetSnapshotJson?.let{runCatching{org.json.JSONObject(it).optBoolean("supportsX",false)}.getOrDefault(false)}!=true))return@mutate denied(WriteIssue.INVALID)
        val updated=value.copy(endId=old.endId,inputIndex=old.inputIndex,createdAtMs=old.createdAtMs,updatedAtMs=now(),revision=old.revision+1,
            zoneCode=if(value.scoreSource=="target_computed")automaticZone!!.code else if(xZone)"X"else if(value.points==0)"M"else value.points.toString(),automaticPoints=automatic,automaticRuleVersion=if(automatic!=null) { if(shaftDiameter!=null)profile!!.shaftRuleVersion else profile!!.rule } else null,faceId=if(value.x!=null&&value.positionStatus=="known")"main"else null,shaftDiameterMm=shaftDiameter)
        dao.update(updated);bump(c);JournalWrite.Saved(old.id,updated.revision,c.session.id)
    }

    private fun revisionHash(value: JournalShot, expectedRevision: Long): String {
        val values = arrayOf(value.id,expectedRevision,value.points,value.zoneCode,value.x,value.y,value.scoreSource,
            value.positionSource,value.positionStatus,value.physicalArrowNumber)
        // Preserve receipt hashes of pre-shaft edits retried after an app update.
        return if (value.shaftDiameterMm == null) hash(*values) else hash(*values,value.shaftDiameterMm)
    }

    suspend fun removeShot(id:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"remove_shot",hash(id,expectedRevision)) {
        val shot=dao.shot(id)?:return@mutate denied(WriteIssue.NOT_FOUND)
        val c=context(shot.endId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(c.session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
        if(shot.revision!=expectedRevision)return@mutate JournalWrite.Conflict(shot.revision)
        dao.deleteShot(id);dao.stageReorder(shot.endId,shot.inputIndex);dao.finishReorder(shot.endId,now());bump(c)
        JournalWrite.Saved(id,shot.revision+1,c.session.id)
    }

    suspend fun removeEnd(endId:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=
        mutate(operationId,"remove_end",hash(endId,expectedRevision)) {
            val c=context(endId)?:return@mutate denied(WriteIssue.NOT_FOUND)
            if(c.session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
            if(c.end.revision!=expectedRevision)return@mutate JournalWrite.Conflict(c.end.revision)
            val details=dao.details(c.session.id)!!
            removeEnds(details,setOf(endId))
            JournalWrite.Saved(endId,c.end.revision+1,c.session.id)
        }

    suspend fun removeRound(sessionId:String,firstEndId:String,expectedSessionRevision:Long,operationId:String=uuid()):JournalWrite=
        mutate(operationId,"remove_round",hash(sessionId,firstEndId,expectedSessionRevision)) {
            val details=dao.details(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
            if(details.session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
            if(details.session.revision!=expectedSessionRevision)return@mutate JournalWrite.Conflict(details.session.revision)
            val round=details.trainingRounds().firstOrNull { it.ends.firstOrNull()?.end?.id==firstEndId }
                ?:return@mutate denied(WriteIssue.NOT_FOUND)
            removeEnds(details,round.ends.map { it.end.id }.toSet())
            JournalWrite.Saved(firstEndId,details.session.revision+1,sessionId)
        }

    /** Freeze every surviving boundary before removing facts, including the first end of a round. */
    private suspend fun removeEnds(details:JournalDetails,ids:Set<String>) {
        val rounds=details.trainingRounds()
        for(round in rounds) {
            val first=round.ends.firstOrNull { it.end.id !in ids }?.end ?: continue
            if(!first.startsRound)dao.update(first.copy(startsRound=true,revision=first.revision+1))
        }
        val sqlite=db.openHelper.writableDatabase
        for(block in details.orderedBlocks) {
            val removed=block.ends.filter { it.end.id in ids }
            for(entry in removed) {
                dao.deleteEndNotes(entry.end.id)
                // Technique uses store ordinal anchors rather than foreign keys.
                sqlite.execSQL("DELETE FROM technique_uses WHERE sessionId=? AND blockOrdinal=? AND endOrdinal=?",
                    arrayOf(details.session.id,block.block.ordinal,entry.end.ordinal))
                dao.deleteEnd(entry.end.id)
            }
            if(removed.isEmpty())continue
            val survivors=block.orderedEnds.filter { it.end.id !in ids }
            sqlite.execSQL("UPDATE ends SET ordinal=ordinal+1000000 WHERE blockId=?",arrayOf(block.block.id))
            survivors.forEachIndexed { ordinal,entry ->
                sqlite.execSQL("UPDATE ends SET ordinal=?,revision=revision+1 WHERE id=?",arrayOf(ordinal,entry.end.id))
                sqlite.execSQL("UPDATE technique_uses SET endOrdinal=?,revision=revision+1 WHERE sessionId=? AND blockOrdinal=? AND endOrdinal=?",
                    arrayOf(ordinal,details.session.id,block.block.ordinal,entry.end.ordinal))
            }
        }
        if(details.session.state!="completed") {
            val block=details.currentBlock!!.block
            val last=dao.latestEnd(block.id)
            if(last==null || (details.currentEnd?.end?.id in ids && last.state!="open")) {
                val removedLastRound=rounds.lastOrNull()?.ends?.all { it.end.id in ids }==true
                dao.insert(JournalEnd(uuid(),block.id,(last?.ordinal?:-1)+1,block.defaultArrowsPerEnd,
                    createdAtMs=now(),startsRound=removedLastRound&&rounds.size>1))
            }
        }
        // Receipts and imported_rows are durable tombstones: retries/import must not resurrect facts.
        dao.bumpSession(details.session.id)
    }

    suspend fun setCount(endId:String,count:Int,expectedEndRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"count",hash(endId,count,expectedEndRevision)) {
        val c=context(endId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        writable(c)?.let{return@mutate denied(it)}
        if(c.block.mode!="count_only")return@mutate denied(WriteIssue.WRONG_MODE)
        if(c.end.role=="scored"&&otherPlanEndsFull(c))return@mutate denied(WriteIssue.FULL)
        if(c.end.revision!=expectedEndRevision)return@mutate JournalWrite.Conflict(c.end.revision)
        val flexible=dao.plan(c.session.id)?.rolling==true
        if(count !in 0..(if(flexible) MAX_SERIES_ARROWS else c.end.plannedCount))return@mutate denied(WriteIssue.INVALID)
        if(c.end.role=="scored") {
            val round=dao.details(c.session.id)!!.roundProgress(endId)
            if(round.roundArrowLimit!=null && round.ends.filter { it.end.id!=endId }.sumOf { it.volume }+count>round.roundArrowLimit)
                return@mutate denied(WriteIssue.FULL)
        }
        if(count>c.end.plannedCount)dao.update(c.end.copy(plannedCount=count))
        val previous=dao.count(endId);val instant=now()
        dao.put(JournalCount(endId,count,previous?.createdAtMs?:instant,instant,(previous?.revision?:0)+1));bump(c)
        JournalWrite.Saved(endId,c.end.revision+1,c.session.id)
    }

    suspend fun startNextRound(sessionId:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=
        mutate(operationId,"new_round",hash(sessionId,expectedRevision)) {
            val session=dao.session(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
            if(session.state!="active"||session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
            if(session.revision!=expectedRevision)return@mutate JournalWrite.Conflict(session.revision)
            val details=dao.details(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
            val block=details.currentBlock?.block?:return@mutate denied(WriteIssue.NOT_FOUND)
            val current=details.currentEnd?:return@mutate denied(WriteIssue.NOT_FOUND)
            if(current.end.role!="scored")return@mutate denied(WriteIssue.WRONG_MODE)
            if(details.roundProgress().ends.sumOf { it.volume }==0)return@mutate denied(WriteIssue.INCOMPLETE)
            val plan=dao.plan(sessionId)
            if(plan==null)dao.put(SessionPlan(sessionId,0,rolling=true))
            else if(!plan.rolling)dao.put(plan.copy(rolling=true))
            val instant=now()
            val next=if(current.volume==0&&current.end.state=="open") {
                current.end.copy(startsRound=true,revision=current.end.revision+1).also { dao.update(it) }
            } else {
                if(current.end.state=="open")dao.update(current.end.copy(state="closed",closedAtMs=instant,
                    revision=current.end.revision+1))
                JournalEnd(uuid(),block.id,current.end.ordinal+1,block.defaultArrowsPerEnd,
                    createdAtMs=instant,startsRound=true).also { dao.insert(it) }
            }
            dao.bumpSession(sessionId)
            JournalWrite.Saved(next.id,next.revision,sessionId)
        }

    suspend fun next(endId:String,expectedEndRevision:Long,allowPartial:Boolean=false,operationId:String=uuid()):JournalWrite=mutate(operationId,"next",hash(endId,expectedEndRevision,allowPartial)) {
        val c=context(endId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        writable(c)?.let{return@mutate denied(it)}
        if(c.end.revision!=expectedEndRevision)return@mutate JournalWrite.Conflict(c.end.revision)
        val volume=if(c.block.mode=="scored")dao.shots(endId).size else dao.count(endId)?.count?:0
        val plan=dao.plan(c.session.id)
        val rolling=plan?.rolling==true
        if(volume<c.end.plannedCount&&!allowPartial&&!rolling)return@mutate denied(WriteIssue.INCOMPLETE)
        if(volume==0&&(rolling||(c.end.role=="scored"&&(plan?.roundCount?:1)>1)))return@mutate denied(WriteIssue.INCOMPLETE)
        val instant=now();dao.update(c.end.copy(state="closed",closedAtMs=instant,revision=c.end.revision+1))
        if(c.end.role=="scored"&&volume>0&&plan!=null&&!rolling&&dao.details(c.session.id)!!.usedPlanEnds>=plan.plannedEnds) {
            dao.update(c.session.copy(state="completed",completedAtMs=instant,revision=c.session.revision+1))
            return@mutate JournalWrite.Saved(c.session.id,c.session.revision+1,c.session.id)
        }
        val startsRound=c.end.role=="scored" && dao.details(c.session.id)!!.roundProgress(endId).let {
            it.roundArrowLimit!=null && it.ends.sumOf { entry -> entry.volume }>=it.roundArrowLimit
        }
        val next=JournalEnd(uuid(),c.block.id,c.end.ordinal+1,c.block.defaultArrowsPerEnd,role=c.end.role,createdAtMs=instant,startsRound=startsRound)
        dao.insert(next);dao.bumpSession(c.session.id);JournalWrite.Saved(next.id,1,c.session.id)
    }

    suspend fun reviseCount(endId:String,count:Int,expectedEndRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"revise_count",hash(endId,count,expectedEndRevision)) {
        val c=context(endId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(c.session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
        if(c.block.mode!="count_only")return@mutate denied(WriteIssue.WRONG_MODE)
        if(c.end.revision!=expectedEndRevision)return@mutate JournalWrite.Conflict(c.end.revision)
        val flexible=dao.plan(c.session.id)?.rolling==true
        if(count !in 0..(if(flexible) MAX_SERIES_ARROWS else c.end.plannedCount))return@mutate denied(WriteIssue.INVALID)
        if(count>c.end.plannedCount)dao.update(c.end.copy(plannedCount=count))
        val previous=dao.count(endId);val instant=now()
        dao.put(JournalCount(endId,count,previous?.createdAtMs?:instant,instant,(previous?.revision?:0)+1));bump(c)
        JournalWrite.Saved(endId,c.end.revision+1,c.session.id)
    }

    suspend fun startBlock(sessionId:String,plan:BlockPlan,expectedSessionRevision:Long,allowPartial:Boolean=false,operationId:String=uuid()):JournalWrite=mutate(operationId,"block",hash(sessionId,plan,expectedSessionRevision,allowPartial)) {
        val session=dao.session(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(session.state!="active"||session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
        if(session.revision!=expectedSessionRevision)return@mutate JournalWrite.Conflict(session.revision)
        if(!plan.valid())return@mutate denied(WriteIssue.INVALID)
        val sessionPlan=dao.plan(sessionId)
        sessionPlan?.takeUnless { it.rolling }?.let{if(dao.details(sessionId)!!.usedPlanEnds>=it.plannedEnds)return@mutate denied(WriteIssue.FULL)}
        val previous=dao.latestBlock(sessionId)
        var startsRound=dao.details(sessionId)!!.roundProgress().let {
            it.roundArrowLimit!=null && it.ends.sumOf { entry -> entry.volume }>=it.roundArrowLimit
        }
        if(previous!=null)dao.latestEnd(previous.id)?.let{end->
            if(end.state=="open") {
                val volume=if(previous.mode=="scored")dao.shots(end.id).size else dao.count(end.id)?.count?:0
                if(volume<end.plannedCount&&!allowPartial)return@mutate denied(WriteIssue.INCOMPLETE)
                if(volume==0&&(sessionPlan?.rolling==true||(sessionPlan?.roundCount?:1)>1)) {
                    startsRound=startsRound||end.startsRound
                    dao.deleteEnd(end.id)
                }
                else dao.update(end.copy(state="closed",closedAtMs=now(),revision=end.revision+1))
            }
        }
        val block=block(sessionId,(previous?.ordinal?:-1)+1,plan)
        dao.insert(block);dao.insert(JournalEnd(uuid(),block.id,0,plan.arrows,createdAtMs=now(),startsRound=startsRound))
        dao.update(session.copy(revision=session.revision+1,numberedArrows=plan.numberedArrows ?: session.numberedArrows))
        freezeProgress(db,session,block,now())
        JournalWrite.Saved(block.id,block.revision,sessionId)
    }

    suspend fun complete(sessionId:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"complete",hash(sessionId,expectedRevision)) {
        val session=dao.session(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(session.deletedAtMs!=null||session.state=="completed")return@mutate denied(WriteIssue.INACTIVE)
        if(session.revision!=expectedRevision)return@mutate JournalWrite.Conflict(session.revision)
        dao.latestBlock(sessionId)?.let{block->dao.latestEnd(block.id)?.let{end->
            if(dao.shots(end.id).isEmpty()&&(dao.count(end.id)?.count?:0)==0)dao.deleteEnd(end.id)
            else if(end.state=="open")dao.update(end.copy(state="closed",closedAtMs=now(),revision=end.revision+1))
        }}
        dao.update(session.copy(state="completed",completedAtMs=now(),revision=session.revision+1))
        JournalWrite.Saved(sessionId,session.revision+1,sessionId)
    }

    suspend fun trash(sessionId:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"trash",hash(sessionId,expectedRevision)) {
        val session=dao.session(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(session.revision!=expectedRevision)return@mutate JournalWrite.Conflict(session.revision)
        if(session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
        dao.update(session.copy(state=if(session.state=="active")"paused"else session.state,deletedAtMs=now(),revision=session.revision+1))
        JournalWrite.Saved(sessionId,session.revision+1,sessionId)
    }

    suspend fun restore(sessionId:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"restore",hash(sessionId,expectedRevision)) {
        val session=dao.session(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(session.revision!=expectedRevision)return@mutate JournalWrite.Conflict(session.revision)
        if(session.deletedAtMs==null)return@mutate denied(WriteIssue.INVALID)
        dao.update(session.copy(deletedAtMs=null,revision=session.revision+1));JournalWrite.Saved(sessionId,session.revision+1,sessionId)
    }

    suspend fun resume(sessionId:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"resume",hash(sessionId,expectedRevision)) {
        val session=dao.session(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(session.state !in setOf("paused","completed")||session.deletedAtMs!=null||dao.activeSession()!=null)return@mutate denied(WriteIssue.INACTIVE)
        if(session.revision!=expectedRevision)return@mutate JournalWrite.Conflict(session.revision)
        val block=dao.latestBlock(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        val last=dao.latestEnd(block.id)
        if(last?.state!="open") {
            val plan=dao.plan(sessionId)
            if(plan!=null&&!plan.rolling)dao.put(plan.copy(rolling=true))
            if(plan==null)dao.put(SessionPlan(sessionId,0,rolling=true))
            val startsRound=dao.details(sessionId)!!.roundProgress().let {
                it.roundArrowLimit!=null && it.ends.sumOf { entry -> entry.volume }>=it.roundArrowLimit
            }
            dao.insert(JournalEnd(uuid(),block.id,(last?.ordinal?:-1)+1,block.defaultArrowsPerEnd,createdAtMs=now(),startsRound=startsRound))
        }
        dao.update(session.copy(state="active",completedAtMs=null,revision=session.revision+1))
        JournalWrite.Saved(sessionId,session.revision+1,sessionId)
    }

    suspend fun pause(sessionId:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"pause",hash(sessionId,expectedRevision)) {
        val session=dao.session(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(session.state!="active"||session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
        if(session.revision!=expectedRevision)return@mutate JournalWrite.Conflict(session.revision)
        dao.update(session.copy(state="paused",revision=session.revision+1));JournalWrite.Saved(sessionId,session.revision+1,sessionId)
    }

    suspend fun role(endId:String,role:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"role",hash(endId,role,expectedRevision)) {
        val c=context(endId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(c.session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
        if(c.end.revision!=expectedRevision)return@mutate JournalWrite.Conflict(c.end.revision)
        if(role !in setOf("warmup","scored"))return@mutate denied(WriteIssue.INVALID)
        if(c.session.state=="active"&&role=="scored"&&otherPlanEndsFull(c))return@mutate denied(WriteIssue.FULL)
        dao.update(c.end.copy(role=role,revision=c.end.revision+1));dao.bumpSession(c.session.id)
        JournalWrite.Saved(endId,c.end.revision+1,c.session.id)
    }

    suspend fun rename(sessionId:String,title:String,expectedRevision:Long,operationId:String=uuid()):JournalWrite=mutate(operationId,"rename",hash(sessionId,title,expectedRevision)) {
        val session=dao.session(sessionId)?:return@mutate denied(WriteIssue.NOT_FOUND)
        if(session.deletedAtMs!=null)return@mutate denied(WriteIssue.INACTIVE)
        if(session.revision!=expectedRevision)return@mutate JournalWrite.Conflict(session.revision)
        if(title.isBlank()||title.length>100)return@mutate denied(WriteIssue.INVALID)
        dao.update(session.copy(title=title.trim(),revision=session.revision+1))
        JournalWrite.Saved(sessionId,session.revision+1,sessionId)
    }
}

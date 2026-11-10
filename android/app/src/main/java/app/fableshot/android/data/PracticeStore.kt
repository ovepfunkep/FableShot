package app.fableshot.android.data

import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.flow.Flow
import java.util.UUID

/** UI boundary; schema-1 fixtures and the current journal share the accepted target editor. */
interface PracticeStore {
    val active:Flow<SessionDetails?>
    val history:Flow<List<SessionSummary>>
    val trash:Flow<List<SessionSummary>> get()=kotlinx.coroutines.flow.flowOf(emptyList())
    suspend fun start(title:String,distance:Double,diameterMm:Int,arrows:Int,operationId:String=UUID.randomUUID().toString())
    suspend fun startPlan(title:String,plan:BlockPlan,operationId:String=UUID.randomUUID().toString()) { start(title,requireNotNull(plan.distanceMeters),requireNotNull(plan.diameterMm),plan.arrows,operationId) }
    suspend fun add(endId:String,point:TargetPoint?,numeric:Int?,operationId:String=UUID.randomUUID().toString()):ShotEntity?
    suspend fun addNumbered(endId: String, point: TargetPoint?, numeric: Int?, physicalArrowNumber: Int?,
        operationId: String = UUID.randomUUID().toString()): ShotEntity? {
        require(physicalArrowNumber == null) { "Numbered arrows require journal storage" }
        return add(endId, point, numeric, operationId)
    }
    suspend fun addX(endId:String,operationId:String):ShotEntity? { error("Unsupported storage") }
    suspend fun revise(value:ShotEntity,operationId:String=UUID.randomUUID().toString()):ShotEntity?
    suspend fun undoRevision(value:ShotEntity,operationId:String=UUID.randomUUID().toString()) { revise(value,operationId) }
    suspend fun undoInserted(id:String,endId:String,operationId:String=UUID.randomUUID().toString())
    suspend fun next(endId:String,operationId:String=UUID.randomUUID().toString())
    suspend fun startNextRound(id:String,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun complete(id:String,operationId:String=UUID.randomUUID().toString())
    suspend fun details(id:String,operationId:String=UUID.randomUUID().toString()):SessionDetails?
    suspend fun delete(id:String,operationId:String=UUID.randomUUID().toString())
    suspend fun block(id:String,plan:BlockPlan,allowPartial:Boolean,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun count(endId:String,count:Int,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun warmup(endId:String,enabled:Boolean,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun nextPartial(endId:String,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun restore(id:String,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun pause(id:String,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun resume(id:String,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun rename(id:String,title:String,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun removeShot(id:String,revision:Long,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun removeEnd(endId:String,revision:Long,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun removeRound(sessionId:String,firstEndId:String,revision:Long,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun reviseCount(endId:String,count:Int,revision:Long,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
    suspend fun reviseJournal(value:JournalShot,operationId:String=UUID.randomUUID().toString()) { error("Unsupported storage") }
}


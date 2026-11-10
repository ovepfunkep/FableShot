package app.fableshot.android.data.journal

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import app.fableshot.android.importing.*

/** Current journal schema; the legacy PracticeDatabase remains available only for old fixtures. */
@Entity(tableName="sessions",indices=[Index(value=["state","deletedAtMs"])])
data class JournalSession(
    @PrimaryKey val id:String,
    val title:String,
    val createdAtMs:Long,
    val startedAtMs:Long?,
    val completedAtMs:Long?=null,
    val localDate:String?=null,
    val timeZoneId:String?=null,
    val timeSource:String="app_clock",
    val state:String="active",
    val kind:String="training",
    val sourceKind:String="native",
    val revision:Long=1,
    val deletedAtMs:Long?=null,
    val numberedArrows:Boolean?=null,
)

@Entity(tableName="blocks",foreignKeys=[ForeignKey(entity=JournalSession::class,parentColumns=["id"],childColumns=["sessionId"],onDelete=ForeignKey.CASCADE)],indices=[Index(value=["sessionId","ordinal"],unique=true)])
data class JournalBlock(
    @PrimaryKey val id:String,
    val sessionId:String,
    val ordinal:Int,
    val mode:String,
    val distanceMeters:Double?,
    val targetProfileId:String?,
    val targetProfileVersion:Int?,
    val targetDiameterMm:Int?,
    val targetSnapshotJson:String?,
    val equipmentSnapshotJson:String?,
    val defaultArrowsPerEnd:Int,
    val revision:Long=1,
)

@Entity(tableName="ends",foreignKeys=[ForeignKey(entity=JournalBlock::class,parentColumns=["id"],childColumns=["blockId"],onDelete=ForeignKey.CASCADE)],indices=[Index(value=["blockId","ordinal"],unique=true)])
data class JournalEnd(
    @PrimaryKey val id:String,
    val blockId:String,
    val ordinal:Int,
    val plannedCount:Int,
    val role:String="scored",
    val state:String="open",
    val createdAtMs:Long?=null,
    val closedAtMs:Long?=null,
    val revision:Long=1,
    @ColumnInfo(defaultValue="0") val startsRound:Boolean=false,
)

@Entity(tableName="shots",foreignKeys=[ForeignKey(entity=JournalEnd::class,parentColumns=["id"],childColumns=["endId"],onDelete=ForeignKey.CASCADE)],indices=[Index(value=["endId","inputIndex"],unique=true)])
data class JournalShot(
    @PrimaryKey val id:String,
    val endId:String,
    val inputIndex:Int,
    val points:Int,
    val zoneCode:String?,
    val automaticPoints:Int?,
    val automaticRuleVersion:String?,
    val x:Double?,
    val y:Double?,
    val faceId:String?,
    val scoreSource:String,
    val positionSource:String,
    val positionStatus:String,
    val physicalArrowNumber:Int?,
    val createdAtMs:Long,
    val updatedAtMs:Long?=null,
    val revision:Long=1,
    @ColumnInfo(defaultValue="NULL") val shaftDiameterMm:Double?=null,
)

@Entity(tableName="unscored_counts",foreignKeys=[ForeignKey(entity=JournalEnd::class,parentColumns=["id"],childColumns=["endId"],onDelete=ForeignKey.CASCADE)])
data class JournalCount(@PrimaryKey val endId:String,val count:Int,val createdAtMs:Long,val updatedAtMs:Long,val revision:Long=1)

/** Persistent receipts make retry safe even after process death or removal of a shot. */
@Entity(tableName="mutation_receipts",indices=[Index("sessionId")])
data class MutationReceipt(@PrimaryKey val operationId:String,val sessionId:String,val kind:String,val payloadHash:String,val resultId:String,val resultRevision:Long,val appliedAtMs:Long)

data class JournalEndDetails(
    @Embedded val end:JournalEnd,
    @Relation(parentColumn="id",entityColumn="endId") val shots:List<JournalShot>,
    @Relation(parentColumn="id",entityColumn="endId") val counts:List<JournalCount>,
) {
    val volume get()=shots.size+counts.sumOf{it.count}
    val full get()=volume==end.plannedCount
}
data class JournalBlockDetails(@Embedded val block:JournalBlock,@Relation(entity=JournalEnd::class,parentColumn="id",entityColumn="blockId") val ends:List<JournalEndDetails>,@Relation(parentColumn="id",entityColumn="blockId") val baselines:List<ProgressBaseline> = emptyList()) {
    val orderedEnds get()=ends.sortedBy{it.end.ordinal}
}
data class JournalDetails(@Embedded val session:JournalSession,@Relation(entity=JournalBlock::class,parentColumn="id",entityColumn="sessionId") val blocks:List<JournalBlockDetails>,@Relation(parentColumn="id",entityColumn="sessionId") val plans:List<SessionPlan> = emptyList()) {
    val orderedBlocks get()=blocks.sortedBy{it.block.ordinal}
    val currentBlock get()=orderedBlocks.lastOrNull()
    val currentEnd get()=currentBlock?.orderedEnds?.lastOrNull()
    val allShots get()=orderedBlocks.flatMap{b->b.orderedEnds.flatMap{it.shots.sortedBy(JournalShot::inputIndex)}}
}

@Dao
interface JournalDao {
    @Upsert suspend fun put(plan:SessionPlan)
    @Query("SELECT * FROM session_plans WHERE sessionId=:id") suspend fun plan(id:String):SessionPlan?
    @Insert suspend fun insert(value:SessionPlan)
    @Transaction @Query("SELECT * FROM sessions WHERE id<>:id AND state='completed' AND deletedAtMs IS NULL AND completedAtMs<:cutoff AND createdAtMs<=:cutoff") suspend fun baselineCandidates(id:String,cutoff:Long):List<JournalDetails>
    @Query("SELECT * FROM progress_baselines WHERE blockId=:id") suspend fun baseline(id:String):ProgressBaseline?
    @Insert suspend fun insert(value:ProgressBaseline)
    @Transaction @Query("SELECT * FROM sessions WHERE state='active' AND deletedAtMs IS NULL ORDER BY createdAtMs DESC LIMIT 1") fun active():Flow<JournalDetails?>
    @Transaction @Query("SELECT * FROM sessions WHERE deletedAtMs IS NULL ORDER BY createdAtMs DESC") fun history():Flow<List<JournalDetails>>
    @Transaction @Query("SELECT * FROM sessions WHERE deletedAtMs IS NOT NULL ORDER BY deletedAtMs DESC") fun trash():Flow<List<JournalDetails>>
    @Transaction @Query("SELECT * FROM sessions WHERE id=:id") suspend fun details(id:String):JournalDetails?
    @Query("SELECT * FROM sessions WHERE id=:id") suspend fun session(id:String):JournalSession?
    @Query("SELECT * FROM sessions WHERE state='active' AND deletedAtMs IS NULL LIMIT 1") suspend fun activeSession():JournalSession?
    @Query("SELECT * FROM blocks WHERE id=:id") suspend fun block(id:String):JournalBlock?
    @Query("SELECT * FROM blocks WHERE sessionId=:id ORDER BY ordinal DESC LIMIT 1") suspend fun latestBlock(id:String):JournalBlock?
    @Query("SELECT * FROM ends WHERE id=:id") suspend fun end(id:String):JournalEnd?
    @Query("SELECT * FROM ends WHERE blockId=:id ORDER BY ordinal DESC LIMIT 1") suspend fun latestEnd(id:String):JournalEnd?
    @Query("SELECT * FROM shots WHERE id=:id") suspend fun shot(id:String):JournalShot?
    @Query("SELECT * FROM shots WHERE endId=:id ORDER BY inputIndex") suspend fun shots(id:String):List<JournalShot>
    @Query("SELECT * FROM unscored_counts WHERE endId=:id") suspend fun count(id:String):JournalCount?
    @Query("SELECT * FROM mutation_receipts WHERE operationId=:id") suspend fun receipt(id:String):MutationReceipt?
    @Query("""
        SELECT EXISTS(SELECT 1 FROM mutation_receipts WHERE sessionId = :id AND kind = 'start')
            AND NOT EXISTS(SELECT 1 FROM mutation_receipts
                WHERE sessionId = :id AND resultId = :id AND kind IN ('complete', 'next'))
    """)
    suspend fun firstNativeCompletion(id: String): Boolean
    @Transaction
    @Query("""
        SELECT * FROM sessions
        WHERE id <> :id AND state = 'completed' AND deletedAtMs IS NULL AND createdAtMs <= :atMs
            AND (completedAtMs IS NULL OR completedAtMs <= :atMs)
            AND (localDate IS NULL OR localDate <= :today)
    """)
    suspend fun recordCandidates(id: String, atMs: Long, today: String): List<JournalDetails>
    @Query("SELECT * FROM personal_record_events ORDER BY recordedAtMs DESC, kind, id")
    fun recordEvents(): Flow<List<PersonalRecordEvent>>
    @Query("SELECT * FROM personal_record_events WHERE id IN (:ids) AND notifiedAtMs IS NULL")
    suspend fun pendingRecordEvents(ids: List<String>): List<PersonalRecordEvent>
    @Query("UPDATE personal_record_events SET notifiedAtMs = :atMs WHERE id IN (:ids) AND notifiedAtMs IS NULL")
    suspend fun acknowledgeRecordEvents(ids: List<String>, atMs: Long)
    @Insert suspend fun insertRecordEvent(event: PersonalRecordEvent)
    @Query("""
        SELECT receipt.sessionId, receipt.kind, receipt.resultRevision, receipt.appliedAtMs,
            session.state AS sessionState, session.deletedAtMs IS NOT NULL AS trashed
        FROM mutation_receipts AS receipt JOIN sessions AS session ON session.id = receipt.sessionId
        WHERE receipt.resultId = receipt.sessionId
            AND receipt.kind IN ('start', 'resume', 'pause', 'complete', 'next', 'trash')
        ORDER BY receipt.sessionId, receipt.resultRevision, receipt.operationId
    """)
    fun trainingTimeEvents(): Flow<List<TrainingTimeEvent>>
    @Insert suspend fun insert(value:JournalSession)
    @Insert suspend fun insert(value:JournalBlock)
    @Insert suspend fun insert(value:JournalEnd)
    @Insert suspend fun insert(value:JournalShot)
    @Insert suspend fun insert(value:MutationReceipt)
    @Update suspend fun update(value:JournalSession)
    @Update suspend fun update(value:JournalEnd)
    @Update suspend fun update(value:JournalShot)
    @Upsert suspend fun put(value:JournalCount)
    @Query("UPDATE sessions SET revision=revision+1 WHERE id=:id") suspend fun bumpSession(id:String)
    @Query("UPDATE ends SET revision=revision+1 WHERE id=:id") suspend fun bumpEnd(id:String)
    @Query("DELETE FROM shots WHERE id=:id") suspend fun deleteShot(id:String)
    @Query("DELETE FROM ends WHERE id=:id") suspend fun deleteEnd(id:String)
    @Query("DELETE FROM diary_notes WHERE endId=:id") suspend fun deleteEndNotes(id:String)
    @Query("UPDATE shots SET inputIndex=inputIndex+1000000 WHERE endId=:endId AND inputIndex>:index") suspend fun stageReorder(endId:String,index:Int)
    @Query("UPDATE shots SET inputIndex=inputIndex-1000001,revision=revision+1,updatedAtMs=:now WHERE endId=:endId AND inputIndex>=1000000") suspend fun finishReorder(endId:String,now:Long)
}

@Database(entities=[JournalSession::class,JournalBlock::class,JournalEnd::class,JournalShot::class,JournalCount::class,MutationReceipt::class,ImportBatch::class,ImportedGroup::class,ImportedRow::class,ImportedEndSource::class,ProgressBaseline::class,SessionPlan::class,app.fableshot.android.technique.TechniqueDocument::class,app.fableshot.android.technique.TechniqueVersion::class,app.fableshot.android.technique.TechniqueUse::class,RankAssignment::class,DiaryNote::class,AchievementEnrollment::class,AchievementGrant::class,PersonalRecordEvent::class],version=16,exportSchema=true)
abstract class JournalDatabase:RoomDatabase() {
    abstract fun journalDao():JournalDao
    abstract fun importDao():ImportDao
    abstract fun techniqueDao():app.fableshot.android.technique.TechniqueDao
    abstract fun rankAssignmentDao():RankAssignmentDao
    abstract fun diaryNoteDao():DiaryNoteDao
    abstract fun achievementDao():AchievementDao
}

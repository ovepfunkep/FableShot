package app.fableshot.android.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey val id: String,
    val title: String,
    val startedAt: Long,
    val distanceMeters: Double,
    val targetDiameterMm: Int,
    val arrowsPerEnd: Int,
    val profileId: String = "practice-full-10-v1",
    val state: String = "active",
    val completedAt: Long? = null,
)

@Entity(
    tableName = "ends",
    foreignKeys = [ForeignKey(entity = SessionEntity::class, parentColumns = ["id"], childColumns = ["sessionId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("sessionId"), Index(value = ["sessionId", "number"], unique = true)],
)
data class EndEntity(
    @PrimaryKey val id: String,
    val sessionId: String,
    val number: Int,
    val plannedCount: Int,
    val closed: Boolean = false,
)

@Entity(
    tableName = "shots",
    foreignKeys = [ForeignKey(entity = EndEntity::class, parentColumns = ["id"], childColumns = ["endId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("endId"), Index(value = ["endId", "inputIndex"], unique = true)],
)
data class ShotEntity @Ignore constructor(
    @PrimaryKey val id: String,
    val endId: String,
    val inputIndex: Int,
    val points: Int,
    val x: Double?,
    val y: Double?,
    val origin: String,
    val createdAt: Long,
    val revision: Int = 1,
    @Ignore val zoneCode:String?,
    @Ignore val physicalArrowNumber:Int? = null,
) {
    constructor(id:String,endId:String,inputIndex:Int,points:Int,x:Double?,y:Double?,origin:String,createdAt:Long,revision:Int=1):this(id,endId,inputIndex,points,x,y,origin,createdAt,revision,null)
}

data class EndWithShots(
    @Embedded val end: EndEntity,
    @Relation(parentColumn = "id", entityColumn = "endId") val shots: List<ShotEntity>,
)

data class SessionDetails @Ignore constructor(
    @Embedded val session: SessionEntity,
    @Relation(entity = EndEntity::class, parentColumn = "id", entityColumn = "sessionId") val ends: List<EndWithShots>,
    @Ignore val journal: app.fableshot.android.data.journal.JournalDetails?,
) {
    constructor(session:SessionEntity,ends:List<EndWithShots>):this(session,ends,null)
    val orderedEnds get() = ends.sortedBy { it.end.number }
    val currentEnd get() = orderedEnds.lastOrNull()
    val allShots get() = orderedEnds.flatMap { it.shots.sortedBy(ShotEntity::inputIndex) }
}

data class SessionSummary @Ignore constructor(
    val id: String,
    val title: String,
    val startedAt: Long,
    val state: String,
    val shotCount: Int,
    val total: Int,
    val distanceMeters: Double,
    val targetDiameterMm: Int,
    val profileId: String,
    @Ignore val journalMeta: JournalSummaryMeta?,
) {
    constructor(id:String,title:String,startedAt:Long,state:String,shotCount:Int,total:Int,distanceMeters:Double,targetDiameterMm:Int,profileId:String):this(id,title,startedAt,state,shotCount,total,distanceMeters,targetDiameterMm,profileId,null)
    val scoredCount get()=journalMeta?.scoredCount?:shotCount
    val comparable get()=journalMeta?.comparable?:true
}

data class JournalSummaryMeta(val blockCount:Int,val scoredCount:Int,val comparable:Boolean,val countOnly:Boolean,val conditionsKey:String?=null,val localDate:String?=null,val dateKnown:Boolean=true,val distanceKnown:Boolean=true,val diameterKnown:Boolean=true,val sessionRevision:Long=1,val progressPercentagePoints:Double?=null,val progressReady:Boolean=false,val zoneCounts:List<Int>?=null,val xCount:Int?=null,val positions:List<app.fableshot.android.domain.TargetPoint>?=null,val analyticsParts:List<SessionSummary>?=null,val equipmentLabel:String?=null,
    val rankResults:List<app.fableshot.android.domain.RankEvaluation> = emptyList(),
    val seriesRecords:List<app.fableshot.android.domain.SeriesRecord> = emptyList(),
    val importedProgressCondition: ImportedProgressCondition? = null,
    val progressRelativePercent: Double? = null,
    val progressBaselineAverage: Double? = null,
    val progressCurrentAverage: Double? = null,
    val progressSourceCount: Int? = null,
    val roundRanks: List<app.fableshot.android.data.journal.JournalRoundRank> = emptyList())

@Dao
interface PracticeDao {
    @Transaction
    @Query("SELECT * FROM sessions WHERE state = 'active' ORDER BY startedAt DESC LIMIT 1")
    fun observeActive(): Flow<SessionDetails?>

    @Query("SELECT s.id,s.title,s.startedAt,s.state,s.distanceMeters,s.targetDiameterMm,s.profileId,COUNT(sh.id) AS shotCount,COALESCE(SUM(sh.points),0) AS total FROM sessions s LEFT JOIN ends e ON e.sessionId=s.id LEFT JOIN shots sh ON sh.endId=e.id GROUP BY s.id ORDER BY s.startedAt DESC")
    fun observeHistory(): Flow<List<SessionSummary>>

    @Transaction @Query("SELECT * FROM sessions WHERE id=:id")
    suspend fun details(id: String): SessionDetails?
    @Query("SELECT * FROM sessions WHERE state='active' LIMIT 1")
    suspend fun activeSession(): SessionEntity?
    @Query("SELECT * FROM ends WHERE id=:id")
    suspend fun end(id: String): EndEntity?
    @Query("SELECT * FROM ends WHERE sessionId=:sessionId ORDER BY number DESC LIMIT 1")
    suspend fun latestEnd(sessionId: String): EndEntity?
    @Query("SELECT * FROM shots WHERE endId=:endId ORDER BY inputIndex")
    suspend fun shots(endId: String): List<ShotEntity>
    @Query("SELECT * FROM shots WHERE id=:id")
    suspend fun shot(id: String): ShotEntity?
    @Insert suspend fun insertSession(value: SessionEntity)
    @Insert suspend fun insertEnd(value: EndEntity)
    @Insert suspend fun insertShot(value: ShotEntity)
    @Update suspend fun updateShot(value: ShotEntity)
    @Query("DELETE FROM shots WHERE id=:id") suspend fun deleteShot(id: String)
    @Query("UPDATE ends SET closed=1 WHERE id=:id") suspend fun closeEnd(id: String)
    @Query("UPDATE sessions SET state='completed',completedAt=:now WHERE id=:id")
    suspend fun completeSession(id: String, now: Long)
    @Query("DELETE FROM sessions WHERE id=:id") suspend fun deleteSession(id: String)
}

@Database(entities = [SessionEntity::class, EndEntity::class, ShotEntity::class], version = 1, exportSchema = true)
abstract class PracticeDatabase : RoomDatabase() {
    abstract fun practiceDao(): PracticeDao
}

fun analyticsRows(sessions:List<SessionSummary>)=sessions.flatMap{it.journalMeta?.analyticsParts?:listOf(it)}

fun analyticsConditionKey(row:SessionSummary)="${row.distanceMeters}|${row.targetDiameterMm}|${row.profileId}|${row.journalMeta?.conditionsKey.orEmpty()}"

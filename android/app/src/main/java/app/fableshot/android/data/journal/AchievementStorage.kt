package app.fableshot.android.data.journal

import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import app.fableshot.android.domain.*
import kotlinx.coroutines.flow.Flow

/** Created exclusively by native start, in the same transaction as the session itself. */
@Entity(tableName = "achievement_enrollments", foreignKeys = [ForeignKey(
    entity = JournalSession::class, parentColumns = ["id"], childColumns = ["sessionId"],
    onDelete = ForeignKey.CASCADE,
)])
data class AchievementEnrollment(
    @PrimaryKey val sessionId: String,
    val enrolledAtMs: Long,
    val localDate: String,
    val ruleIdsJson: String,
    val rankCategory: String?,
)

/** No FK to the diary: issuance/dismissal receipts survive deletion and archive replacement. */
@Entity(tableName = "achievement_grants", indices = [Index("sessionId")])
data class AchievementGrant(
    @PrimaryKey val key: String,
    val ruleId: String,
    val scope: String,
    val ruleVersion: Int,
    val title: String,
    val flavor: String,
    val description: String,
    val family: String,
    val rarity: Int,
    val priority: Int,
    val sessionId: String?,
    val endId: String?,
    val sourceDate: String?,
    val earnedAtMs: Long,
    val batchId: String,
    val notifiedAtMs: Long?,
    val valid: Boolean,
) {
    fun presentation() = EarnedAchievement(key, ruleId, scope, title, flavor, description, family,
        AchievementRarity.entries[rarity], priority, sessionId, endId, sourceDate, earnedAtMs,
        batchId, notifiedAtMs, valid)
}

data class AchievementRecordFact(
    val sessionId: String,
    val localDate: String?,
    val points: Int,
    val arrows: Int,
    val sessionArrows: Int = arrows,
    val countOnlyBlocks: Int = 0,
)

@Dao
interface AchievementDao {
    @Query("SELECT * FROM achievement_enrollments") fun observeEnrollments(): Flow<List<AchievementEnrollment>>
    @Query("SELECT * FROM achievement_enrollments") suspend fun enrollments(): List<AchievementEnrollment>
    @Query("SELECT * FROM achievement_enrollments WHERE sessionId=:id") suspend fun enrollment(id: String): AchievementEnrollment?
    @Query("DELETE FROM achievement_enrollments") suspend fun clearEnrollments()
    @Insert suspend fun enroll(value: AchievementEnrollment)
    @Update suspend fun update(value: AchievementEnrollment)
    @Query("SELECT * FROM achievement_grants") fun observeGrants(): Flow<List<AchievementGrant>>
    @Query("SELECT * FROM achievement_grants") suspend fun grants(): List<AchievementGrant>
    @Query("SELECT * FROM achievement_grants WHERE `key`=:key") suspend fun grant(key: String): AchievementGrant?
    @Query("DELETE FROM achievement_grants") suspend fun clearGrants()
    @Upsert suspend fun put(value: AchievementGrant)
    @Query("UPDATE achievement_grants SET notifiedAtMs=:now WHERE `key`=:key AND notifiedAtMs IS NULL")
    suspend fun claim(key: String, now: Long): Int
    @Transaction
    @Query("SELECT s.* FROM sessions s JOIN achievement_enrollments a ON a.sessionId=s.id WHERE s.deletedAtMs IS NULL AND s.sourceKind='native' AND s.timeSource='app_clock' AND s.localDate=a.localDate AND s.createdAtMs=a.enrolledAtMs ORDER BY s.createdAtMs,s.id")
    suspend fun eligibleDetails(): List<JournalDetails>
    @Transaction
    @Query("SELECT s.* FROM sessions s JOIN achievement_enrollments a ON a.sessionId=s.id WHERE s.deletedAtMs IS NULL AND s.sourceKind='native' AND s.timeSource='app_clock' AND s.localDate=a.localDate AND s.createdAtMs=a.enrolledAtMs ORDER BY s.createdAtMs,s.id")
    fun observeEligibleDetails(): Flow<List<JournalDetails>>

    @Query("""SELECT s.id AS sessionId,s.localDate,SUM(h.points) AS points,COUNT(h.id) AS arrows,
        (SELECT COUNT(*) FROM shots sh JOIN ends en ON en.id=sh.endId JOIN blocks bl ON bl.id=en.blockId
            WHERE bl.sessionId=s.id AND en.role='scored') AS sessionArrows,
        (SELECT COUNT(*) FROM blocks bl JOIN ends en ON en.blockId=bl.id
            WHERE bl.sessionId=s.id AND bl.mode='count_only' AND en.role='scored') AS countOnlyBlocks
        FROM sessions s JOIN blocks b ON b.sessionId=s.id JOIN ends e ON e.blockId=b.id JOIN shots h ON h.endId=e.id
        WHERE s.state='completed' AND s.deletedAtMs IS NULL AND s.id<>:sessionId AND s.createdAtMs<=:cutoff
        AND (s.completedAtMs IS NULL OR s.completedAtMs<=:cutoff) AND b.mode='scored' AND e.role='scored'
        AND b.distanceMeters=:distance AND b.targetProfileId=:profile AND b.targetDiameterMm=:diameter
        AND b.targetSnapshotJson=:target AND b.equipmentSnapshotJson=:equipment
        GROUP BY e.id HAVING COUNT(h.id)=e.plannedCount AND e.state='closed'""")
    suspend fun previousSeries(sessionId: String, cutoff: Long, distance: Double, profile: String,
        diameter: Int, target: String, equipment: String): List<AchievementRecordFact>
}

val MIGRATION_9_10: Migration = object : Migration(9, 10) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("""CREATE TABLE IF NOT EXISTS achievement_enrollments (
            sessionId TEXT NOT NULL PRIMARY KEY,enrolledAtMs INTEGER NOT NULL,localDate TEXT NOT NULL,
            ruleIdsJson TEXT NOT NULL,rankCategory TEXT,
            FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE CASCADE)""")
        db.execSQL("""CREATE TABLE IF NOT EXISTS achievement_grants (
            `key` TEXT NOT NULL PRIMARY KEY,ruleId TEXT NOT NULL,scope TEXT NOT NULL,ruleVersion INTEGER NOT NULL,
            title TEXT NOT NULL,flavor TEXT NOT NULL,description TEXT NOT NULL,family TEXT NOT NULL,
            rarity INTEGER NOT NULL,priority INTEGER NOT NULL,sessionId TEXT,endId TEXT,sourceDate TEXT,
            earnedAtMs INTEGER NOT NULL,batchId TEXT NOT NULL,notifiedAtMs INTEGER,valid INTEGER NOT NULL)""")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_achievement_grants_sessionId ON achievement_grants(sessionId)")
        // Deliberately no INSERT from old history, imports, settings or computed v1 badges.
    }
}

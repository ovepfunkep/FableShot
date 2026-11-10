package app.fableshot.android.data.journal

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import app.fableshot.android.domain.bestSeriesRecords
import app.fableshot.android.domain.rankClassLabel
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

@Entity(
    tableName = "personal_record_events",
    foreignKeys = [ForeignKey(entity = JournalSession::class, parentColumns = ["id"],
        childColumns = ["sessionId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("sessionId")],
)
data class PersonalRecordEvent(
    @PrimaryKey val id: String,
    val sessionId: String,
    val kind: String,
    val ruleVersion: Int,
    val label: String,
    val previousValue: Int,
    val value: Int,
    val previousSessionId: String,
    val sessionRevision: Long,
    val recordedAtMs: Long,
    val notifiedAtMs: Long? = null,
)

val MIGRATION_11_12: Migration = object : Migration(11, 12) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE personal_record_events (
                id TEXT NOT NULL PRIMARY KEY, sessionId TEXT NOT NULL, kind TEXT NOT NULL,
                ruleVersion INTEGER NOT NULL, label TEXT NOT NULL, previousValue INTEGER NOT NULL,
                value INTEGER NOT NULL, previousSessionId TEXT NOT NULL, sessionRevision INTEGER NOT NULL,
                recordedAtMs INTEGER NOT NULL, notifiedAtMs INTEGER,
                FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE CASCADE
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX index_personal_record_events_sessionId ON personal_record_events(sessionId)")
    }
}

/** Called inside the successful completion transaction. The report keeps the comparison as made then. */
internal suspend fun JournalDao.recordImprovements(
    details: JournalDetails,
    category: String?,
    atMs: Long,
) {
    val session = details.session
    val volume = details.recordVolume()
    if (session.sourceKind != "native" || volume == 0) return
    val today = Instant.ofEpochMilli(atMs).atZone(ZoneId.systemDefault()).toLocalDate().toString()
    val history = recordCandidates(session.id, atMs, today)
    if (history.isEmpty()) return

    suspend fun improve(kind: String, label: String, value: Int, previous: Int, sourceId: String) {
        if (value <= previous) return
        insertRecordEvent(PersonalRecordEvent(UUID.randomUUID().toString(), session.id, kind, 1, label,
            previous, value, sourceId, session.revision, atMs))
    }

    val series = details.fullSeriesRecords()
    if (series.isNotEmpty()) {
        val keys = series.map { it.conditions }.toSet()
        val previous = bestSeriesRecords(history.flatMap { it.fullSeriesRecords() }.filter { it.conditions in keys })
            .associateBy { it.conditions }
        for (entry in series) {
            val best = previous[entry.conditions] ?: continue
            val c = entry.conditions
            val label = "${measure(c.distanceMeters)} м · ${measure(c.diameterMm / 10.0)} см · " +
                "${c.arrows} в серии · ${entry.targetTitle} · ${entry.equipmentTitle.take(200)}"
            improve("series", label, entry.points, best.points, best.sessionId)
        }
    }

    val previousVolume = history.asSequence().map { it.session to it.recordVolume() }.filter { it.second > 0 }
        .minWithOrNull(compareByDescending<Pair<JournalSession, Int>> { it.second }
            .thenBy { it.first.localDate == null }.thenBy { it.first.localDate }.thenBy { it.first.id })
    if (previousVolume != null) {
        improve("volume", "Стрел за тренировку", volume, previousVolume.second, previousVolume.first.id)
    }

    val rank = details.rankAssessment(category).takeIf { it.finalResult }?.evaluation ?: return
    val previousRank = history.mapNotNull { other ->
        val assessment = other.rankAssessment(category)
        val result = assessment.evaluation?.takeIf { assessment.finalResult && it.exercise.id == rank.exercise.id }
        result?.let { other.session to it.points }
    }.minWithOrNull(compareByDescending<Pair<JournalSession, Int>> { it.second }
        .thenBy { it.first.startedAtMs ?: it.first.createdAtMs }.thenBy { it.first.id })
    if (previousRank != null) {
        val exercise = rank.exercise
        val label = "${rankClassLabel(exercise.bow, exercise.category)} · ${exercise.distance} м · ${exercise.arrows} стрел"
        improve("rank", label, rank.points, previousRank.second, previousRank.first.id)
    }
}

private fun JournalDetails.recordVolume() = blocks.sumOf { block -> block.ends.sumOf { it.volume } }

private fun measure(value: Double) = value.toString().removeSuffix(".0").replace('.', ',')

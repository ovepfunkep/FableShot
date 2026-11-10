package app.fableshot.android.data.journal

import app.fableshot.android.data.SessionSummary
import app.fableshot.android.domain.SeriesRecord
import app.fableshot.android.domain.SeriesRecordConditions
import app.fableshot.android.domain.bestSeriesRecords
import org.json.JSONObject

fun JournalDetails.fullSeriesRecords(): List<SeriesRecord> {
    if (session.state != "completed" || session.deletedAtMs != null) return emptyList()
    var sourceOrder = 0
    val candidates = orderedBlocks.flatMap {group ->
        val block = group.block
        val profile = block.verifiedTarget()
        val distance = block.distanceMeters
        val diameter = block.targetDiameterMm
        if (block.mode != "scored" || profile == null || distance == null || !distance.isFinite() || distance <= 0 || diameter == null) return@flatMap emptyList()
        val targetSnapshot = profile.snapshot(diameter)
        val equipmentTitle = block.equipmentSnapshotJson?.let {raw ->
            runCatching {JSONObject(raw).optJSONObject("selection")?.optString("name")?.takeIf {it.isNotBlank()}}.getOrNull()
                ?: "Сохранённое снаряжение"
        } ?: "Комплект не указан"
        group.orderedEnds.mapNotNull {entry ->
            val order = sourceOrder++
            if (entry.end.role != "scored" || entry.end.state != "closed" || !entry.full || entry.shots.size != entry.end.plannedCount || entry.counts.isNotEmpty()) return@mapNotNull null
            SeriesRecord(SeriesRecordConditions(distance, diameter, profile.id, requireNotNull(block.targetProfileVersion),
                targetSnapshot, block.equipmentSnapshotJson, entry.end.plannedCount),
                entry.shots.sumOf {it.points}, entry.end.plannedCount * profile.zones.maxOf {it.points}, session.id, entry.end.id,
                session.revision, session.localDate, order, 1, 1, profile.title, equipmentTitle)
        }
    }
    // Keep only per-session bests in the summary; no second database pass for the gallery.
    return bestSeriesRecords(candidates).map {record ->
        val location = roundProgress(record.endId)
        record.copy(round = location.number, series = location.seriesNumber)
    }
}

fun personalSeriesRecords(sessions: List<SessionSummary>) = bestSeriesRecords(sessions.filter {it.state == "completed"}
    .flatMap {it.journalMeta?.seriesRecords.orEmpty()})

fun personalVolumeRecord(sessions: List<SessionSummary>): SessionSummary? = sessions
    .filter {it.state == "completed" && it.shotCount > 0}.distinctBy {it.id}
    .minWithOrNull(compareByDescending<SessionSummary> {it.shotCount}
        .thenBy {it.journalMeta?.localDate == null}.thenBy {it.journalMeta?.localDate}.thenBy {it.id})

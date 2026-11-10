package app.fableshot.android.domain

data class SeriesRecordConditions(
    val distanceMeters: Double,
    val diameterMm: Int,
    val targetId: String,
    val targetVersion: Int,
    val targetSnapshot: String,
    val equipmentSnapshot: String?,
    val arrows: Int,
)

data class SeriesRecord(
    val conditions: SeriesRecordConditions,
    val points: Int,
    val maximum: Int,
    val sessionId: String,
    val endId: String,
    val sessionRevision: Long,
    val localDate: String?,
    val sourceOrder: Int,
    val round: Int,
    val series: Int,
    val targetTitle: String,
    val equipmentTitle: String,
    val ruleVersion: String = "full-series-classical-v1",
)

/** Equal scores keep the earliest known date, then a stable source. Ties are not improvements. */
fun bestSeriesRecords(records: List<SeriesRecord>): List<SeriesRecord> = records.groupBy {it.conditions}.values.map {
    it.minWith(compareByDescending<SeriesRecord> {record -> record.points}
        .thenBy {record -> record.localDate == null}.thenBy {record -> record.localDate}
        .thenBy {record -> record.sessionId}.thenBy {record -> record.sourceOrder}.thenBy {record -> record.endId})
}.sortedWith(compareBy<SeriesRecord> {it.conditions.distanceMeters}.thenBy {it.conditions.arrows}
    .thenBy {it.conditions.diameterMm}.thenBy {it.targetTitle}.thenBy {it.equipmentTitle}.thenBy {it.endId})

package app.fableshot.android.data.journal

data class ReportScope(val id: String, val title: String, val blocks: List<JournalBlockDetails>) {
    val volume get() = blocks.sumOf {it.ends.filter {end -> end.end.role == "scored"}.sumOf {end -> end.volume}}
    val baseline: ProgressBaseline? get() {
        val snapshots = blocks.map {it.baselines.singleOrNull()}
        val first = snapshots.firstOrNull() ?: return null
        fun comparable(value: ProgressBaseline) = value.copy(blockId="",baselineId="",frozenAtMs=0)
        return first.takeIf {snapshots.all {it != null && comparable(it) == comparable(first)}}
    }
    fun merged(): JournalBlockDetails = blocks.first().copy(
        ends = blocks.flatMap {it.orderedEnds}.filter {it.end.role == "scored"}
            .mapIndexed {index, entry -> entry.copy(end=entry.end.copy(ordinal=index))},
        baselines = listOfNotNull(baseline),
    )
}

/** Group semantic conditions, never physical block ids or round numbers. No facts are rewritten. */
fun JournalDetails.reportScopes(): List<ReportScope> {
    fun key(group: JournalBlockDetails): List<Any?> {
        val b=group.block
        return listOf(b.mode,b.distanceMeters,b.targetProfileId,b.targetProfileVersion,b.targetDiameterMm,
            b.verifiedTarget()?.snapshot(requireNotNull(b.targetDiameterMm)) ?: b.targetSnapshotJson,b.equipmentSnapshotJson)
    }
    val groups=orderedBlocks.groupBy(::key).values.toList()
    val combined=groups.mapIndexed {index, rows -> ReportScope(
        if (rows.size == blocks.size) "all" else "group-${rows.first().block.id}",
        if (rows.size == blocks.size) "Вся тренировка" else "Условия ${index+1}", rows)
    }
    val parts=groups.filter {it.size>1}.flatten().sortedBy {it.block.ordinal}.map {row ->
        ReportScope("part-${row.block.id}","Часть ${orderedBlocks.indexOf(row)+1}",listOf(row))
    }
    return combined + parts
}

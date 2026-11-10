package app.fableshot.android.data

import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.data.journal.JournalBlock
import app.fableshot.android.data.journal.verifiedTarget
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Display aggregation only. Original snapshots, verified geometry and PG1 stay separate. */
data class ImportedProgressCondition(
    val targetKey: String,
    val equipmentKey: String,
    val targetLabel: String?,
)

internal fun importedProgressCondition(targetJson: String?, equipmentJson: String?): ImportedProgressCondition? {
    val target = targetJson?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
    if (target.optString("scoringRuleVersion") != "mytargets-source-scores-v1" || target.optInt("maxPoints") != 10) return null
    // ZIP bookkeeping identifies an individual round, not a scoring condition.
    target.remove("sourceRoundKey")
    target.remove("sourceFormat")
    val equipmentKey = equipmentJson?.let { raw ->
        runCatching { stableJson(JSONObject(raw)) }.getOrDefault(raw)
    }.orEmpty()
    val label = target.optString("rawTargetLabel").trim().takeUnless { it.isBlank() || it == "null" }
    return ImportedProgressCondition(stableJson(target), equipmentKey, label)
}

private fun stableJson(value: Any?): String = when (value) {
    is JSONObject -> value.keys().asSequence().sorted().joinToString(prefix = "{", postfix = "}") { key ->
        "${JSONObject.quote(key)}:${stableJson(value.get(key))}"
    }
    is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { stableJson(value.get(it)) }
    is String -> JSONObject.quote(value)
    else -> value.toString()
}

internal data class ProgressConditionGroup(val key: String, val label: String, val rows: List<SessionSummary>)

/** Scoring identity for display reports excludes transport and per-round provenance. */
internal fun JournalBlock.analyticsIdentity(): List<Any?> {
    val profile = verifiedTarget()
    val target = if (profile != null) profile.id else targetSnapshotJson?.let { raw ->
        runCatching {
            val source = JSONObject(raw)
            source.remove("sourceRoundKey")
            source.remove("sourceFormat")
            stableJson(source)
        }.getOrDefault(raw)
    }
    val equipment = equipmentSnapshotJson?.let { raw ->
        runCatching {
            val source = JSONObject(raw)
            if (source.optJSONObject("selection")?.optString("kind") == "source" &&
                source.optJSONObject("bow") == null && source.optJSONObject("arrows") == null) null
            else stableJson(source)
        }.getOrDefault(raw)
    }
    return listOf(distanceMeters, targetProfileId, targetProfileVersion, target, targetDiameterMm, equipment)
}

internal fun progressConditionGroups(sessions: List<SessionSummary>): List<ProgressConditionGroup> {
    val dated = analyticsRows(sessions).mapNotNull { row ->
        if (row.state != "completed" || row.scoredCount <= 0 || !row.comparable) return@mapNotNull null
        val date = row.journalMeta?.localDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?: if (row.journalMeta?.dateKnown == false) return@mapNotNull null
            else Instant.ofEpochMilli(row.startedAt).atZone(ZoneId.systemDefault()).toLocalDate()
        row to date
    }
    val groups = dated.groupBy { (row, _) -> progressConditionGroupKey(row) }.map { (key, members) ->
        val ordered = members.sortedWith(compareBy<Pair<SessionSummary, LocalDate>> { it.second }
            .thenBy { it.first.startedAt }.thenBy { it.first.id }).map { it.first }
        val rows = if (ordered.first().journalMeta?.importedProgressCondition != null) {
            ordered.groupBy { it.id }.values.map(::mergeImportedProgressRounds)
        } else ordered
        ProgressConditionGroup(key, progressConditionLabel(rows.first()), rows)
    }
    val labelCounts = groups.groupingBy { it.label }.eachCount()
    val duplicates = mutableMapOf<String, Int>()
    return groups.map { group ->
        if (labelCounts.getValue(group.label) == 1) group
        else {
            val number = duplicates.getOrDefault(group.label, 0) + 1
            duplicates[group.label] = number
            group.copy(label = "${group.label} · вариант $number")
        }
    }
}

private fun progressConditionGroupKey(row: SessionSummary): String {
    val imported = row.journalMeta?.importedProgressCondition ?: return analyticsConditionKey(row)
    return "mytargets|${row.distanceMeters}|${row.targetDiameterMm}|${row.profileId}|${imported.targetKey}|${imported.equipmentKey}"
}

private fun progressConditionLabel(row: SessionSummary): String {
    val distance = if (row.distanceMeters.isFinite()) decimal(BigDecimal.valueOf(row.distanceMeters)) else "—"
    val diameter = decimal(BigDecimal.valueOf(row.targetDiameterMm.toLong(), 1))
    val meta = row.journalMeta
    val target = meta?.importedProgressCondition?.targetLabel
        ?: TargetCatalog.find(row.profileId)?.title ?: "Исходная мишень"
    return listOfNotNull("$distance м", "$diameter см", target, meta?.equipmentLabel?.trim()?.takeIf(String::isNotBlank))
        .joinToString(" · ")
}

private fun decimal(value: BigDecimal): String = value.stripTrailingZeros().toPlainString().replace('.', ',')

private fun mergeImportedProgressRounds(rows: List<SessionSummary>): SessionSummary {
    val first = rows.first()
    if (rows.size == 1) return first
    val meta = requireNotNull(first.journalMeta)
    val zones = rows.mapNotNull { it.journalMeta?.zoneCounts?.takeIf { counts -> counts.size == 11 } }
    val x = rows.mapNotNull { it.journalMeta?.xCount }
    return first.copy(
        shotCount = rows.sumOf { it.shotCount },
        total = rows.sumOf { it.total },
        journalMeta = meta.copy(
            blockCount = rows.sumOf { it.journalMeta?.blockCount ?: 0 },
            scoredCount = rows.sumOf { it.scoredCount },
            zoneCounts = if (zones.size == rows.size) (0..10).map { zone -> zones.sumOf { it[zone] } } else null,
            xCount = if (x.size == rows.size) x.sum() else null,
            positions = rows.flatMap { it.journalMeta?.positions.orEmpty() }.takeIf { points ->
                rows.all { it.journalMeta?.positions != null } && points.isNotEmpty()
            },
            analyticsParts = null,
        ),
    )
}

package app.fableshot.android.importing

import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.domain.TargetProfile
import app.fableshot.android.domain.TargetPoint
import org.json.JSONObject

/** MyTargets exact positions are fractions of the nominal full face radius. */
internal fun myTargetsProfile(conditions: MyTargetsConditions, diameterMm: Int?): TargetProfile? {
    if (diameterMm == null) return null
    val targetId = conditions.sourceTargetId ?: when {
        conditions.target.startsWith("WA Full (") -> 0
        else -> return null
    }
    val style = conditions.sourceScoringStyle ?: 1
    return when (targetId) {
        0 -> when {
            diameterMm in listOf(400, 600) && style == 2 -> TargetCatalog.compound
            diameterMm in listOf(400, 600) && style in 0..1 -> TargetCatalog.indoor
            diameterMm in listOf(800, 1220) && style == 0 -> TargetCatalog.outdoor
            else -> null
        }
        1 -> TargetCatalog.reduced.takeIf { diameterMm == 800 && style == 0 }
        2 -> when {
            diameterMm in listOf(400, 600) && style == 2 -> TargetCatalog.indoorFiveCompound
            diameterMm in listOf(400, 600) && style in 0..1 -> TargetCatalog.indoorFive
            else -> null
        }
        else -> null
    }
}

internal fun mappedMyTargetsSnapshot(profile: TargetProfile, diameterMm: Int, source: JSONObject): String =
    JSONObject(profile.snapshot(diameterMm)).apply {
        listOf("rawTargetLabel", "sourceFormat", "sourceRoundKey", "sourceTargetId", "sourceScoringStyle")
            .forEach { key -> if (source.has(key)) put(key, source.get(key)) }
        put("sourceTargetSnapshot", source)
        put("sourceCoordinateConvention", "mytargets-full-radius-screen-v1")
    }.toString()

internal fun myTargetsPoint(row: MyTargetsRow, sourceFormat: String): TargetPoint? {
    if (row.positionStatus == "unknown" || row.x == null || row.y == null) return null
    val point = TargetPoint(row.x, -row.y)
    // CSV does not preserve End.exact. Its numeric-only zero position is ambiguous.
    // Saved scores and placements remain independent when they disagree.
    if (sourceFormat != "zip" && row.x == 0.0 && row.y == 0.0) return null
    return point
}

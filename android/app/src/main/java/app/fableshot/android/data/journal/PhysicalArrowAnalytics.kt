package app.fableshot.android.data.journal

import app.fableshot.android.domain.TargetPoint
import org.json.JSONObject
import java.security.MessageDigest
import kotlin.math.hypot
import kotlin.math.sqrt

data class PhysicalArrowResult(
    val number: Int,
    val shotCount: Int,
    val meanScore: Double,
    val knownPositionCount: Int,
    val rmsMm: Double?,
    val centerOffsetMm: Double?,
    val centroidX: Double? = null,
    val centroidY: Double? = null,
    val positions: List<TargetPoint> = emptyList(),
)

data class PhysicalArrowAnalysisGroup(
    val arrowsSetId: String,
    val arrowsSetName: String,
    val conditionKey: String,
    val conditionLabel: String,
    val arrows: List<PhysicalArrowResult>,
    val targetProfileId: String? = null,
    val targetDiameterMm: Int? = null,
)

private data class ArrowConditions(
    val distanceMeters: Double?,
    val targetProfileId: String?,
    val targetProfileVersion: Int?,
    val targetDiameterMm: Int?,
    val targetSnapshot: String?,
    val equipmentSnapshot: String,
    val unknownScope: String?,
) {
    fun stableKey(): String {
        val values = listOf(distanceMeters?.toString(), targetProfileId, targetProfileVersion?.toString(),
            targetDiameterMm?.toString(), targetSnapshot, equipmentSnapshot, unknownScope)
        val encoded = values.joinToString("") { value -> value?.let { "${it.length}:$it" } ?: "-1:" }
        return MessageDigest.getInstance("SHA-256").digest(encoded.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}

private class ArrowSample {
    var count = 0
    var sum = 0L
    val points = mutableListOf<TargetPoint>()

    fun result(number: Int, radiusMm: Double?): PhysicalArrowResult {
        var rms: Double? = null
        var offset: Double? = null
        var centroidX: Double? = null
        var centroidY: Double? = null
        if (radiusMm != null && points.size >= 3) {
            val cx = points.sumOf { it.x } / points.size
            val cy = points.sumOf { it.y } / points.size
            val measuredRms = sqrt(points.sumOf { point ->
                val dx = point.x - cx
                val dy = point.y - cy
                dx * dx + dy * dy
            } / points.size) * radiusMm
            val measuredOffset = hypot(cx, cy) * radiusMm
            if (measuredRms.isFinite() && measuredOffset.isFinite()) {
                rms = measuredRms
                offset = measuredOffset
                centroidX = cx
                centroidY = cy
            }
        }
        return PhysicalArrowResult(number, count, sum.toDouble() / count, points.size, rms, offset,
            centroidX, centroidY, points.toList())
    }
}

private data class ArrowGroupBuilder(
    val setId: String,
    val setName: String,
    val conditions: ArrowConditions,
    val label: String,
    val radiusMm: Double?,
    val samples: MutableMap<Int, ArrowSample> = sortedMapOf(),
)

/** Explicit physical numbers belong to their saved arrow set and immutable shooting conditions. */
fun physicalArrowAnalysis(details: List<JournalDetails>): List<PhysicalArrowAnalysisGroup> {
    val groups = linkedMapOf<Pair<String, ArrowConditions>, ArrowGroupBuilder>()
    val includedShots = mutableSetOf<String>()
    for (session in details.filter { it.session.deletedAtMs == null }) {
        for (part in session.orderedBlocks.filter { it.block.mode == "scored" }) {
            val block = part.block
            val snapshot = block.equipmentSnapshotJson ?: continue
            val equipment = runCatching { JSONObject(snapshot) }.getOrNull() ?: continue
            val arrows = equipment.optJSONObject("arrows") ?: continue
            if (arrows.optString("kind") != "arrows") continue
            val setId = (arrows.opt("id") as? String)?.takeIf { it.isNotBlank() && it != "null" } ?: continue
            val name = arrows.optString("name").takeIf { it.isNotBlank() && it != "null" } ?: "Набор стрел"
            val target = block.verifiedTarget()
            val bowId = (equipment.optJSONObject("bow")?.opt("id") as? String)?.takeIf { it.isNotBlank() }
            val comparable = target != null && block.distanceMeters?.let { it.isFinite() && it > 0 } == true && bowId != null
            val conditions = ArrowConditions(block.distanceMeters, block.targetProfileId, block.targetProfileVersion,
                block.targetDiameterMm, target?.snapshot(requireNotNull(block.targetDiameterMm)) ?: block.targetSnapshotJson,
                snapshot, if (comparable) null else "${session.session.id}:${block.id}")
            val label = listOfNotNull(
                block.distanceMeters?.let { "${compact(it)} м" },
                block.targetDiameterMm?.let { "Мишень ${compact(it / 10.0)} см" },
                target?.title ?: "Геометрия не подтверждена",
                equipment.optJSONObject("selection")?.optString("name")?.takeIf { it.isNotBlank() && it != "null" },
            ).joinToString(" · ")
            for (end in part.orderedEnds.filter { it.end.role == "scored" }) {
                for (shot in end.shots) {
                    val number = shot.physicalArrowNumber?.takeIf { it > 0 } ?: continue
                    if (!includedShots.add(shot.id)) continue
                    val group = groups.getOrPut(setId to conditions) {
                        ArrowGroupBuilder(setId, name, conditions, label,
                            if (target != null) block.targetDiameterMm!!.div(2.0) else null)
                    }
                    val sample = group.samples.getOrPut(number) { ArrowSample() }
                    sample.count++
                    sample.sum += shot.points
                    if (target != null && shot.positionStatus == "known" && shot.faceId == "main" &&
                        shot.x?.isFinite() == true && shot.y?.isFinite() == true) {
                        sample.points.add(TargetPoint(shot.x, shot.y))
                    }
                }
            }
        }
    }
    return groups.values.map { group ->
        PhysicalArrowAnalysisGroup(group.setId, group.setName, group.conditions.stableKey(), group.label,
            group.samples.map { (number, sample) -> sample.result(number, group.radiusMm) },
            group.conditions.targetProfileId.takeIf { group.radiusMm != null },
            group.conditions.targetDiameterMm.takeIf { group.radiusMm != null })
    }.sortedWith(compareBy<PhysicalArrowAnalysisGroup> { it.arrowsSetName }.thenBy { it.arrowsSetId }.thenBy { it.conditionKey })
}

private fun compact(value: Double): String = value.toString().removeSuffix(".0").replace('.', ',')

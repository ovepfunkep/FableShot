package app.fableshot.android.data

import app.fableshot.android.data.journal.BlockPlan
import app.fableshot.android.data.journal.JournalBlock
import org.json.JSONObject

/** Small UI preset, separate from the training that originally supplied it. */
object HabitualTraining {
    fun encode(plan: BlockPlan): String = JSONObject().apply {
        put("version", 1)
        put("distance", plan.distanceMeters)
        put("diameter", plan.diameterMm)
        put("arrows", plan.arrows)
        put("mode", plan.mode)
        put("equipment", plan.equipmentSnapshotJson)
        put("ends", plan.plannedEnds)
        put("rounds", plan.roundCount)
        put("target", plan.targetProfileId)
        put("flexibleSeries", plan.flexibleSeries)
        put("seriesPerRound", plan.seriesPerRound)
        put("numberedArrows", plan.numberedArrows)
        put("roundArrowLimit", plan.roundArrowLimit)
    }.toString()

    fun decode(raw: String?): BlockPlan? = runCatching {
        val json = JSONObject(raw ?: return null)
        require(json.getInt("version") == 1)
        require(json.isNull("numberedArrows") || json.opt("numberedArrows") is Boolean)
        require(json.isNull("roundArrowLimit") || json.opt("roundArrowLimit") is Int || json.opt("roundArrowLimit") is Long)
        if (!json.isNull("roundArrowLimit")) require((json.opt("roundArrowLimit") as Number).toLong() in 1..1_000_000L)
        BlockPlan(
            if(json.isNull("distance")) null else json.getDouble("distance"),
            if(json.isNull("diameter")) null else json.getInt("diameter"),
            json.getInt("arrows"), json.getString("mode"),
            if(json.isNull("equipment")) null else json.getString("equipment"),
            if(json.isNull("ends")) null else json.getInt("ends"), json.getString("target"), roundCount=json.optInt("rounds",1),
            flexibleSeries=json.optBoolean("flexibleSeries"),
            seriesPerRound=if(json.isNull("seriesPerRound")) null else json.getInt("seriesPerRound"),
            numberedArrows=if(json.isNull("numberedArrows")) null else json.getBoolean("numberedArrows"),
            roundArrowLimit=if(json.isNull("roundArrowLimit")) null else json.getInt("roundArrowLimit"),
        ).takeIf { it.valid() }
    }.getOrNull()

    fun block(plan: BlockPlan) = JournalBlock("habitual", "preset", 0, plan.mode,
        plan.distanceMeters, plan.targetProfileId, 1, plan.diameterMm, null,
        plan.equipmentSnapshotJson, plan.arrows)

    fun equipmentId(raw: String?): String? = raw?.takeIf(::isSetupSnapshot)?.let {
        runCatching { JSONObject(it).getJSONObject("selection").getString("id") }.getOrNull()
    }

    fun refreshEquipment(plan: BlockPlan, items: List<EquipmentItem>): BlockPlan? {
        if (plan.equipmentSnapshotJson == null) return plan
        val id = equipmentId(plan.equipmentSnapshotJson) ?: return null
        val selected = selectableEquipment(items).firstOrNull { it.kind == "setup" && it.id == id } ?: return null
        return plan.copy(equipmentSnapshotJson = equipmentSnapshot(selected,items))
    }
}

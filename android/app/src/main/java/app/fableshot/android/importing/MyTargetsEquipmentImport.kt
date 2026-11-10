package app.fableshot.android.importing

import androidx.room.withTransaction
import app.fableshot.android.data.EquipmentDatabase
import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.EquipmentRepository
import app.fableshot.android.data.equipmentSnapshot
import app.fableshot.android.data.persistRevision
import app.fableshot.android.data.selectableEquipment
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Gear rows present in a MyTargets ZIP, including cards not linked to a training. */
data class MyTargetsEquipmentCatalog(val bows: List<String>, val arrows: List<String>)

/** Stages additive local cards while the diary write gate is held. */
internal class MyTargetsEquipmentImport(items: List<EquipmentItem>, private val instant: Long) {
    private val catalog = items.associateByTo(linkedMapOf(), EquipmentItem::id)
    private val added = mutableListOf<EquipmentItem>()

    fun include(source: MyTargetsEquipmentCatalog?) {
        source?.bows?.forEach { item("bow", JSONObject(it)) }
        source?.arrows?.forEach { item("arrows", JSONObject(it)) }
    }

    fun link(raw: String): String {
        val source = JSONObject(raw)
        if (source.optJSONObject("selection")?.optString("kind") != "source") return raw
        val bow = item("bow", source.optJSONObject("bow"))
        val arrows = item("arrows", source.optJSONObject("arrows"))
        val parts = listOfNotNull(bow, arrows)
        if (parts.isEmpty() || parts.any { it.archived }) return raw
        val id = gearId("setup", bow?.id, arrows?.id)
        val kit = remember(EquipmentItem(id = id, kind = "setup",
            name = parts.joinToString(" · ") { it.name }.take(100), bowId = bow?.id, arrowsId = arrows?.id))
        val items = catalog.values.toList()
        return if (kit in selectableEquipment(items)) equipmentSnapshot(kit, items) else raw
    }

    suspend fun publish(db: EquipmentDatabase) {
        if (added.isEmpty()) return
        db.withTransaction {
            val dao = db.equipmentDao()
            added.forEach { dao.persistRevision(it, instant) }
        }
    }

    suspend fun rollBackNewCards(db: EquipmentDatabase) {
        if (added.isEmpty()) return
        db.withTransaction {
            val dao = db.equipmentDao()
            for (item in added.asReversed()) {
                dao.removeImportedRevision(item.id)
                dao.removeUneditedImportedItem(item.id)
            }
        }
    }

    private fun remember(item: EquipmentItem): EquipmentItem = catalog.getOrPut(item.id) {
        item.copy(revision = 1, createdAtMs = instant, updatedAtMs = instant).also(added::add)
    }

    private fun item(kind: String, raw: JSONObject?): EquipmentItem? {
        val name = raw?.text("name") ?: return null
        val category = raw.text("category")?.takeIf { kind == "bow" && it in EquipmentRepository.BOW_CATEGORIES }
        val drawWeight = raw.text("drawWeight")?.measure(pounds)
        val length = raw.text("length")?.measure(millimetres)
        val mass = raw.text("weight")?.measure(grains)
        val diameter = raw.text("diameter")?.measure(millimetres)
        val spine = raw.text("spine")?.toIntOrNull()?.takeIf { it > 0 }
        val numbered = raw.text("maxArrowNumber")?.toIntOrNull()?.takeIf { it in 1..1000 }
        val model = raw.text("model")
        val id = gearId(kind, raw.text("id"), name, category, model, drawWeight, spine, length, mass, diameter, numbered)
        return remember(EquipmentItem(id = id, kind = kind, name = name.take(100), category = category, model = model,
            notes = raw.text(if (kind == "bow") "description" else "comment"), drawWeightLb = drawWeight,
            spine = spine, lengthMm = length, massGrain = mass, diameterMm = diameter, numberedCount = numbered))
    }
}

private fun JSONObject.text(field: String): String? =
    if (isNull(field)) null else optString(field).trim().takeIf(String::isNotEmpty)

private fun gearId(vararg parts: Any?): String = UUID.nameUUIDFromBytes(
    ("fableshot-mytargets-equipment:" + JSONArray(parts.toList())).toByteArray(Charsets.UTF_8),
).toString()

private val numericMeasure = Regex("""([0-9]+(?:[.,][0-9]+)?)\s*([\p{L}"]+)""")
private val pounds = mapOf("lb" to 1.0, "lbs" to 1.0, "kg" to 2.20462262185)
private val millimetres = mapOf("mm" to 1.0, "cm" to 10.0, "in" to 25.4, "\"" to 25.4)
private val grains = mapOf("gr" to 1.0, "gn" to 1.0, "grain" to 1.0, "grains" to 1.0, "g" to 15.4323583529)

private fun String.measure(units: Map<String, Double>): Double? {
    val match = numericMeasure.matchEntire(this) ?: return null
    val value = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null
    val factor = units[match.groupValues[2].lowercase()] ?: return null
    return (value * factor).takeIf { it.isFinite() && it > 0 }
}

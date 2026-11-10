package app.fableshot.android.data.journal

import org.json.JSONObject
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

data class PhysicalArrowSet(val id: String, val name: String, val count: Int)

val MIGRATION_12_13: Migration = object : Migration(12, 13) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE sessions ADD COLUMN numberedArrows INTEGER")
    }
}

fun JournalDetails.numberedArrowsEnabled(block: JournalBlock): Boolean =
    block.mode == "scored" && block.physicalArrowSet() != null && session.numberedArrows != false

/** The training's frozen arrow set owns the number range, independently of today's equipment catalogue. */
fun JournalBlock.physicalArrowSet(): PhysicalArrowSet? {
    val arrows = equipmentSnapshotJson?.let { raw ->
        runCatching { JSONObject(raw).optJSONObject("arrows") }.getOrNull()
    } ?: return null
    val id = (arrows.opt("id") as? String)?.takeIf { it.isNotBlank() } ?: return null
    if (arrows.optString("kind") != "arrows") return null
    val value = (arrows.opt("numberedCount") as? Number)?.toDouble() ?: return null
    if (!value.isFinite() || value !in 1.0..1000.0 || value % 1.0 != 0.0) return null
    return PhysicalArrowSet(id, arrows.optString("name").ifBlank { "Набор стрел" }, value.toInt())
}

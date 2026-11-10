package app.fableshot.android.data.journal

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import app.fableshot.android.domain.ArrowShaft
import org.json.JSONObject

val MIGRATION_14_15: Migration = object : Migration(14, 15) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // NULL preserves the centre-based rule of every old native and imported shot.
        db.execSQL("ALTER TABLE shots ADD COLUMN shaftDiameterMm REAL DEFAULT NULL")
    }
}

/** Resolve only an explicit arrow diameter from the block's immutable equipment snapshot. */
fun JournalBlock.shaftDiameterMm(): Double = equipmentSnapshotJson?.let { raw ->
    runCatching {
        val snapshot = JSONObject(raw)
        val arrows = snapshot.optJSONObject("arrows")?.takeIf { it.optString("kind") == "arrows" }
            ?: snapshot.optJSONObject("selection")?.takeIf { it.optString("kind") == "arrows" }
        (arrows?.opt("diameterMm") as? Number)?.toDouble()?.takeIf(ArrowShaft::validDiameter)
    }.getOrNull()
} ?: ArrowShaft.DEFAULT_DIAMETER_MM

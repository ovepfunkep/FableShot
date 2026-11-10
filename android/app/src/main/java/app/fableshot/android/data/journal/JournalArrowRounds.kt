package app.fableshot.android.data.journal

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/** Missing means the exact earlier series plan, never an inferred arrow limit. */
val MIGRATION_15_16: Migration = object : Migration(15,16) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE session_plans ADD COLUMN roundArrowLimit INTEGER DEFAULT NULL")
    }
}

package app.fableshot.android.importing

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/** Add provenance only; no rewrite of the user's scored facts. */
val MIGRATION_2_3:Migration=object:Migration(2,3){
    override fun migrate(db:SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS import_batches (id TEXT NOT NULL PRIMARY KEY, source TEXT NOT NULL, fileHash TEXT NOT NULL, parserVersion TEXT NOT NULL, importedAtMs INTEGER NOT NULL, sourceName TEXT, rawSourcePath TEXT NOT NULL, status TEXT NOT NULL)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_import_batches_fileHash ON import_batches(fileHash)")
        db.execSQL("CREATE TABLE IF NOT EXISTS imported_groups (id TEXT NOT NULL PRIMARY KEY, batchId TEXT NOT NULL, sourceGroupKey TEXT NOT NULL, rawFingerprint TEXT NOT NULL, sessionId TEXT NOT NULL, mappingVersion TEXT NOT NULL, mappingJson TEXT NOT NULL, importOperationId TEXT NOT NULL, firstRecord INTEGER NOT NULL, lastRecord INTEGER NOT NULL, endFingerprintsJson TEXT NOT NULL, FOREIGN KEY(batchId) REFERENCES import_batches(id) ON UPDATE NO ACTION ON DELETE CASCADE, FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_imported_groups_batchId ON imported_groups(batchId)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_imported_groups_sessionId ON imported_groups(sessionId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_imported_groups_rawFingerprint ON imported_groups(rawFingerprint)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_imported_groups_importOperationId ON imported_groups(importOperationId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS imported_rows (batchId TEXT NOT NULL, sourceRecord INTEGER NOT NULL, shotId TEXT NOT NULL, groupId TEXT NOT NULL, PRIMARY KEY(batchId,sourceRecord), FOREIGN KEY(batchId) REFERENCES import_batches(id) ON UPDATE NO ACTION ON DELETE CASCADE, FOREIGN KEY(groupId) REFERENCES imported_groups(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_imported_rows_groupId ON imported_rows(groupId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_imported_rows_shotId ON imported_rows(shotId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS imported_end_sources (endId TEXT NOT NULL PRIMARY KEY,batchId TEXT NOT NULL,sourceKey TEXT NOT NULL,rawNumber TEXT NOT NULL,rawTimestamp TEXT NOT NULL,localTime TEXT,FOREIGN KEY(endId) REFERENCES ends(id) ON UPDATE NO ACTION ON DELETE CASCADE,FOREIGN KEY(batchId) REFERENCES import_batches(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_imported_end_sources_batchId ON imported_end_sources(batchId)")
    }
}

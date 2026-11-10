package app.fableshot.android.importing

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale
import java.util.UUID
import java.util.zip.CRC32
import java.util.zip.ZipFile

/** Reads the known MyTargets v27 backup into the same reviewed import pipeline as CSV. */
object MyTargetsArchiveReader {
    const val PARSER_VERSION = "mytargets-zip-sqlite27-v1"
    private const val MAX_EXPANDED = 100L * 1024 * 1024
    private const val MAX_DATABASE = 25L * 1024 * 1024
    private const val MAX_ENTRIES = 2000
    private const val MAX_SHOTS = 200_000

    fun isArchive(file: File): Boolean = file.inputStream().use { input ->
        val bytes = ByteArray(4)
        input.read(bytes) == 4 && bytes.contentEquals(byteArrayOf(80, 75, 3, 4))
    }

    suspend fun read(file: File, temporaryRoot: File, grouping: MyTargetsGrouping = MyTargetsGrouping(),
        checkCancelled: () -> Unit = {}, onRow: suspend (MyTargetsRow) -> Unit = {}): MyTargetsPreview {
        if (grouping.splitBeforeRecords.isNotEmpty() || grouping.joinBeforeRecords.isNotEmpty())
            throw ImportRejected("archive_boundaries_are_explicit")
        if (file.length() > MyTargetsReader.MAX_BYTES) throw ImportRejected("file_too_large")
        temporaryRoot.mkdirs()
        val workspace = File(temporaryRoot, "archive-read-${UUID.randomUUID()}").apply { check(mkdir()) }
        try {
            val beforeHash = hash(file, checkCancelled)
            val databaseFile = File(workspace, "source.db")
            val attachments = extractDatabase(file, databaseFile, checkCancelled)
            val result = SQLiteDatabase.openDatabase(databaseFile.path, null,
                SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS).use { database ->
                validate(database, checkCancelled)
                parse(database, beforeHash, file.length(), attachments, checkCancelled, onRow)
            }
            if (hash(file, checkCancelled) != beforeHash) throw ImportRejected("source_changed")
            return result
        } catch (error: android.database.sqlite.SQLiteException) {
            android.util.Log.e("FableMyTargets", "Read-only MyTargets database could not be read", error)
            throw ImportRejected("archive_database_corrupt").also { it.initCause(error) }
        } catch (error: java.util.zip.ZipException) {
            android.util.Log.e("FableMyTargets", "MyTargets ZIP could not be read", error)
            throw ImportRejected("archive_corrupt").also { it.initCause(error) }
        } finally {
            check(workspace.canonicalFile.parentFile == temporaryRoot.canonicalFile && workspace.name.startsWith("archive-read-"))
            workspace.deleteRecursively()
        }
    }

    private fun hash(file: File, checkCancelled: () -> Unit): String {
        val digest = MessageDigest.getInstance("SHA-256")
        var count = 0L
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                checkCancelled()
                val size = input.read(buffer)
                if (size < 0) break
                count += size
                if (count > MyTargetsReader.MAX_BYTES) throw ImportRejected("file_too_large")
                digest.update(buffer, 0, size)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun extractDatabase(source: File, output: File, checkCancelled: () -> Unit): Int {
        var databaseFound = false
        var attachments = 0
        var total = 0L
        val normalized = File(output.parentFile, "normalized.zip")
        val names = MyTargetsZipEnvelope.normalize(source, normalized, MAX_ENTRIES, checkCancelled)
        ZipFile(normalized).use { zip ->
            val seen = mutableSetOf<String>()
            val entries = zip.entries()
            while (entries.hasMoreElements()) {
                checkCancelled()
                if (seen.size >= MAX_ENTRIES) throw ImportRejected("archive_too_many_entries")
                val entry = entries.nextElement()
                // MyTargets itself writes /data.db. Only that exact historic root prefix is accepted.
                val name = names[entry.name] ?: throw ImportRejected("archive_corrupt")
                if (name.isEmpty() || name.length > 240 || name.any { it == '\\' || it == ':' || it.code < 32 } ||
                    name.split('/').any { it.isEmpty() || it == "." || it == ".." } || entry.isDirectory)
                    throw ImportRejected("archive_unsafe_path")
                if (!seen.add(name.lowercase(Locale.ROOT))) throw ImportRejected("archive_duplicate_entry")
                val isDatabase = name == "data.db"
                if (!isDatabase && !Regex("[A-Za-z0-9_-]+\\.(jpg|jpeg|png)", RegexOption.IGNORE_CASE).matches(name))
                    throw ImportRejected("archive_unsupported_entry")
                if (isDatabase) {
                    if (databaseFound) throw ImportRejected("archive_duplicate_entry")
                    databaseFound = true
                } else attachments++
                var size = 0L
                val crc = CRC32()
                val target = if (isDatabase) FileOutputStream(output) else null
                try {
                    zip.getInputStream(entry).use { input ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            checkCancelled()
                            val count = input.read(buffer)
                            if (count < 0) break
                            size += count; total += count
                            if (total > MAX_EXPANDED || isDatabase && size > MAX_DATABASE)
                                throw ImportRejected("archive_too_large")
                            crc.update(buffer, 0, count)
                            target?.write(buffer, 0, count)
                        }
                    }
                } finally { target?.close() }
                if (size != entry.size || crc.value != entry.crc) throw ImportRejected("archive_corrupt")
            }
        }
        if (!databaseFound) throw ImportRejected("archive_database_missing")
        return attachments
    }

    private fun validate(db: SQLiteDatabase, checkCancelled: () -> Unit) {
        if (db.version != 27) throw ImportRejected("archive_schema_unsupported")
        db.rawQuery("PRAGMA quick_check(1)", null).use {
            if (!it.moveToFirst() || it.getString(0) != "ok") throw ImportRejected("archive_database_corrupt")
        }
        val required = mapOf(
            "Training" to setOf("id", "title", "date", "standardRoundId", "bowId", "arrowId", "indoor"),
            "Round" to setOf("id", "trainingId", "index", "shotsPerEnd", "distance", "targetId", "targetScoringStyleIndex", "targetDiameter"),
            "End" to setOf("id", "roundId", "index", "exact", "saveTime", "reachedPoints", "shotCount"),
            "Shot" to setOf("id", "endId", "index", "x", "y", "scoringRing", "arrowNumber"),
            "StandardRound" to setOf("id", "name"),
            "Bow" to setOf("id", "name", "type"),
            "Arrow" to setOf("id", "name"),
        )
        for ((table, columns) in required) {
            checkCancelled()
            db.rawQuery("SELECT type,sql FROM sqlite_master WHERE name=?", arrayOf(table)).use {
                if (!it.moveToFirst() || it.getString(0) != "table" ||
                    !it.getString(1).trimStart().startsWith("CREATE TABLE", true))
                    throw ImportRejected("archive_schema_unsupported")
            }
            val actual = db.rawQuery("PRAGMA table_info(`$table`)", null).use { cursor ->
                buildSet { while (cursor.moveToNext()) add(cursor.getString(1)) }
            }
            if (!actual.containsAll(columns)) throw ImportRejected("archive_schema_unsupported")
            db.rawQuery("SELECT 1 FROM `$table` WHERE id IS NULL OR id<=0 UNION ALL SELECT 1 FROM `$table` GROUP BY id HAVING COUNT(*)>1 LIMIT 1", null).use {
                if (it.moveToFirst()) throw ImportRejected("archive_invalid_facts")
            }
            db.rawQuery("SELECT COUNT(*) FROM `$table`", null).use {
                it.moveToFirst()
                if (it.getLong(0) > MAX_SHOTS) throw ImportRejected("archive_too_many_rows")
            }
        }
        db.rawQuery("PRAGMA foreign_key_check", null).use {
            if (it.moveToFirst()) throw ImportRejected("archive_broken_relationship")
        }
        for (sql in listOf(
            "SELECT 1 FROM Training WHERE title IS NULL OR date IS NULL OR indoor IS NULL OR indoor NOT IN (0,1)",
            "SELECT 1 FROM Round WHERE trainingId IS NULL OR `index` IS NULL OR shotsPerEnd IS NULL OR distance IS NULL OR targetId IS NULL OR targetScoringStyleIndex IS NULL OR targetDiameter IS NULL",
            "SELECT 1 FROM End WHERE roundId IS NULL OR `index` IS NULL OR exact IS NULL OR reachedPoints IS NULL OR shotCount IS NULL",
            "SELECT 1 FROM Shot WHERE endId IS NULL OR `index` IS NULL OR x IS NULL OR y IS NULL OR scoringRing IS NULL",
            "SELECT 1 FROM Round r LEFT JOIN Training t ON t.id=r.trainingId WHERE t.id IS NULL",
            "SELECT 1 FROM End e LEFT JOIN Round r ON r.id=e.roundId WHERE r.id IS NULL",
            "SELECT 1 FROM Shot s LEFT JOIN End e ON e.id=s.endId WHERE e.id IS NULL",
            "SELECT 1 FROM Shot GROUP BY endId,`index` HAVING COUNT(*)>1",
            "SELECT 1 FROM Round WHERE shotsPerEnd NOT BETWEEN 1 AND 12 OR `index`<0",
            "SELECT 1 FROM End WHERE `index`<0 OR exact NOT IN (0,1)",
            "SELECT 1 FROM Shot WHERE `index`<0 OR `index`>11 OR scoringRing < -2",
        )) db.rawQuery("$sql LIMIT 1", null).use {
            if (it.moveToFirst()) throw ImportRejected("archive_invalid_facts")
        }
    }

    private fun Cursor.text(column: String): String = getColumnIndex(column).let { index ->
        if (index < 0 || isNull(index)) "" else getString(index).also {
            if (it.length > 8000 || it.any { character -> character == '\u0000' }) throw ImportRejected("archive_invalid_text")
        }
    }
    private fun Cursor.number(column: String): Int = getInt(getColumnIndexOrThrow(column))
    private fun Cursor.id(column: String = "id"): Long = getLong(getColumnIndexOrThrow(column))

    private data class SourceEquipment(val bow: String, val arrows: String, val category: String?, val snapshot: String?)
    private fun equipmentRow(cursor: Cursor): JSONObject = JSONObject().apply {
        for (index in 0 until cursor.columnCount) if (cursor.getType(index) != Cursor.FIELD_TYPE_BLOB) {
            val value = if (cursor.isNull(index)) null else cursor.getString(index)
            if (value != null && (value.length > 8000 || '\u0000' in value)) throw ImportRejected("archive_invalid_text")
            put(cursor.getColumnName(index), value ?: JSONObject.NULL)
        }
    }
    private fun bowCategory(source: JSONObject?): String? = when (source?.optString("type")?.toIntOrNull()) {
        0 -> "recurve"; 1 -> "compound"; 2 -> "longbow"; 3 -> "barebow"; else -> null
    }
    private fun equipmentCatalog(db: SQLiteDatabase, checkCancelled: () -> Unit): MyTargetsEquipmentCatalog {
        fun rows(table: String) = db.rawQuery("SELECT * FROM `$table` ORDER BY id", null).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    checkCancelled()
                    val raw = equipmentRow(cursor)
                    if (table == "Bow") raw.put("category", bowCategory(raw) ?: JSONObject.NULL)
                    add(raw.toString())
                }
            }
        }
        return MyTargetsEquipmentCatalog(rows("Bow"), rows("Arrow"))
    }
    private fun equipment(db: SQLiteDatabase, training: Cursor): SourceEquipment {
        fun row(table: String, id: String): JSONObject? {
            if (id.isBlank()) return null
            return db.rawQuery("SELECT * FROM `$table` WHERE id=?", arrayOf(id)).use { cursor ->
                if (cursor.moveToFirst()) equipmentRow(cursor) else null
            }
        }
        val bow = row("Bow", training.text("bowId"))
        val arrows = row("Arrow", training.text("arrowId"))
        val category = bowCategory(bow)
        val snapshot = if (bow == null && arrows == null) null else JSONObject().apply {
            put("schema", 1)
            put("selection", JSONObject().put("id", JSONObject.NULL).put("kind", "source").put("revision", JSONObject.NULL)
                .put("name", listOfNotNull(bow?.optString("name"), arrows?.optString("name")).joinToString(" · ")))
            put("bow", bow?.apply { put("category", category ?: JSONObject.NULL) } ?: JSONObject.NULL)
            put("arrows", arrows ?: JSONObject.NULL)
        }.toString()
        return SourceEquipment(bow?.optString("name").orEmpty(), arrows?.optString("name").orEmpty(), category, snapshot)
    }

    /** Explicit point tables, not a score recomputed from coordinates. -2 is an unfilled slot. */
    private fun zone(target: Int, style: Int, ring: Int): String? {
        if (target !in 0..2 || style !in 0..2) return null
        if (ring == -1) return "M"
        val size = when (target) { 0 -> 11; 1 -> 7; else -> 6 }
        if (ring !in 0 until size) return null
        if (ring == 0 && style == 0) return "X"
        return when { ring == 0 -> "10"; ring == 1 -> if (style == 2) "9" else "10"; else -> (11 - ring).toString() }
    }

    private suspend fun parse(db: SQLiteDatabase, hash: String, bytes: Long, attachments: Int,
        checkCancelled: () -> Unit, onRow: suspend (MyTargetsRow) -> Unit): MyTargetsPreview {
        val groups = mutableListOf<MyTargetsGroup>()
        var record = 1
        var emptySlots = 0
        db.rawQuery("SELECT * FROM Training ORDER BY date,id", null).use { training ->
            while (training.moveToNext()) {
                checkCancelled()
                val id = training.id()
                val key = "t$id"
                val title = training.text("title")
                val rawDate = training.text("date")
                val date = runCatching { LocalDate.parse(rawDate) }.getOrNull()
                val standard = db.rawQuery("SELECT name FROM StandardRound WHERE id=?", arrayOf(training.text("standardRoundId"))).use {
                    if (it.moveToFirst()) it.getString(0) else ""
                }
                val environment = if (training.number("indoor") == 1) "Indoor" else "Outdoor"
                val sourceEquipment = equipment(db, training)
                val blocks = mutableListOf<MyTargetsBlock>()
                val issues = mutableListOf<ImportIssue>()
                val groupStart = record + 1
                if (date == null) issues.add(ImportIssue("unknown_date", groupStart, false, groupStart))
                db.rawQuery("SELECT * FROM Round WHERE trainingId=? ORDER BY `index`,id", arrayOf(id.toString())).use { round ->
                    while (round.moveToNext()) {
                        checkCancelled()
                        val roundId = round.id()
                        val blockKey = "$key:r$roundId"
                        val target = round.number("targetId")
                        val style = round.number("targetScoringStyleIndex")
                        val distance = round.text("distance")
                        val diameter = round.text("targetDiameter")
                        val targetLabel = when (target) { 0 -> "WA Full"; 1 -> "WA 6 Ring"; 2 -> "WA 5 Ring"; else -> "MyTargets target $target" } + " ($diameter)"
                        val conditions = MyTargetsConditions((round.number("index") + 1).toString(), distance,
                            targetLabel, sourceEquipment.bow, sourceEquipment.arrows,
                            distanceMeters(distance), diameterMm(diameter), round.number("shotsPerEnd"),
                            sourceEquipment.snapshot, sourceEquipment.category, target in 0..2 && style in 0..2,
                            sourceTargetId = target, sourceScoringStyle = style)
                        val ends = mutableListOf<MyTargetsEnd>()
                        db.rawQuery("SELECT * FROM End WHERE roundId=? ORDER BY `index`,id", arrayOf(roundId.toString())).use { end ->
                            while (end.moveToNext()) {
                                checkCancelled()
                                val endId = end.id()
                                val endKey = "$blockKey:e$endId"
                                val first = record + 1
                                var points = 0
                                var count = 0
                                val digest = MessageDigest.getInstance("SHA-256")
                                val timestamp = end.text("saveTime")
                                val time = runCatching { LocalTime.parse(timestamp) }.getOrNull()
                                db.rawQuery("SELECT * FROM Shot WHERE endId=? ORDER BY `index`,id", arrayOf(endId.toString())).use { shot ->
                                    while (shot.moveToNext()) {
                                        checkCancelled()
                                        val ring = shot.number("scoringRing")
                                        if (ring == -2) { emptySlots++; continue }
                                        record++; count++
                                        val scoreZone = zone(target, style, ring)
                                        val score = when (scoreZone) { "M" -> 0; "X" -> 10; else -> scoreZone?.toIntOrNull() }
                                        if (score == null) issues.add(ImportIssue(
                                            if (scoreIsKnown(target, style)) "invalid_archive_score" else "unsupported_archive_target",
                                            record, true, record)) else points += score
                                        val rawX = shot.getDouble(shot.getColumnIndexOrThrow("x"))
                                        val rawY = shot.getDouble(shot.getColumnIndexOrThrow("y"))
                                        val fakeMiss = scoreZone == "M" && rawX == 0.0 && rawY == 0.0
                                        val coordinate = end.number("exact") == 1 && !fakeMiss && rawX.isFinite() && rawY.isFinite()
                                        val arrowText = shot.text("arrowNumber")
                                        val arrow = arrowText.toIntOrNull()?.takeIf { it > 0 }
                                        val raw = listOf(title, rawDate, standard, environment, sourceEquipment.bow,
                                            sourceEquipment.arrows, conditions.round, distance, targetLabel,
                                            (end.number("index") + 1).toString(), timestamp, scoreZone.orEmpty(), arrowText,
                                            rawX.toString(), rawY.toString())
                                        digest.update(raw.joinToString("\u0001").toByteArray(Charsets.UTF_8))
                                        onRow(MyTargetsRow(key, blockKey, endKey, record, record, score, scoreZone,
                                            arrow, rawX, rawY, if (coordinate) rawX else null, if (coordinate) rawY else null,
                                            if (coordinate) "unverified" else "unknown", raw))
                                    }
                                }
                                if (count > 0) {
                                    if (count > conditions.sourceArrowsPerEnd!! || count > 12)
                                        issues.add(ImportIssue("invalid_archive_series", first, true, first))
                                    if (count != end.number("shotCount") || scoreIsKnown(target, style) && points != end.number("reachedPoints"))
                                        issues.add(ImportIssue("archive_series_totals_mismatch", first, true, first))
                                    ends.add(MyTargetsEnd(endKey, (end.number("index") + 1).toString(), timestamp,
                                        time, count, points, digest.digest().joinToString("") { "%02x".format(it) }, first, record,
                                        MyTargetsOverlap.fingerprint(title, rawDate, conditions, timestamp)))
                                }
                            }
                        }
                        if (ends.isNotEmpty()) blocks.add(MyTargetsBlock(blockKey, conditions, ends))
                    }
                }
                if (blocks.isNotEmpty()) {
                    val fingerprint = MessageDigest.getInstance("SHA-256").digest(blocks.flatMap { it.ends }
                        .joinToString("|") { it.fingerprint }.toByteArray()).joinToString("") { "%02x".format(it) }
                    groups.add(MyTargetsGroup(key, title, date, rawDate, standard, environment, blocks, fingerprint,
                        groupStart, record, false, issues))
                }
            }
        }
        return MyTargetsPreview(hash, bytes, MyTargetsReader.HEADERS, groups, "zip", emptySlots, attachments,
            equipmentCatalog(db, checkCancelled))
    }

    private fun scoreIsKnown(target: Int, style: Int) = target in 0..2 && style in 0..2
    private fun distanceMeters(value: String): Double? {
        val match = Regex("^\\s*(\\d+(?:[.,]\\d+)?)\\s*(m|yd|ft)\\s*$", RegexOption.IGNORE_CASE).matchEntire(value) ?: return null
        val number = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null
        return (number * when (match.groupValues[2].lowercase()) { "yd" -> .9144; "ft" -> .3048; else -> 1.0 }).takeIf { it.isFinite() && it > 0 }
    }
    private fun diameterMm(value: String): Int? {
        val match = Regex("^\\s*(\\d+(?:[.,]\\d+)?)\\s*(cm|mm)\\s*$", RegexOption.IGNORE_CASE).matchEntire(value) ?: return null
        val number = (match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null) * if (match.groupValues[2].equals("cm", true)) 10 else 1
        return number.takeIf { it.isFinite() && it > 0 && it <= 100000 && it % 1 == 0.0 }?.toInt()
    }
}

/** A conservative overlap warning across CSV/ZIP; equality is never treated as automatic deduplication. */
internal object MyTargetsOverlap {
    fun fingerprint(title: String, date: String, conditions: MyTargetsConditions, timestamp: String): String? {
        if (timestamp.isBlank() || conditions.distanceMeters == null || conditions.diameterMm == null) return null
        val time = runCatching { LocalTime.parse(timestamp).toString() }.getOrNull() ?: return null
        val value = listOf("mytargets-end-overlap-v1", title, date, conditions.distanceMeters.toString(),
            conditions.diameterMm.toString(), conditions.bow, conditions.arrows, time).joinToString("\u0000")
        return MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}

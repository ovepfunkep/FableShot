package app.fableshot.android.importing

import androidx.room.withTransaction
import app.fableshot.android.data.journal.JournalDatabase
import app.fableshot.android.data.journal.JournalShot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.zip.GZIPInputStream

/** Replays the retained source to recover explicit scoring style and exact-position flags. */
internal suspend fun normalizeImportedTargets(db: JournalDatabase, filesRoot: File, stagingRoot: File): Int =
    withContext(Dispatchers.IO) {
        val imports = db.importDao()
        val journal = db.journalDao()
        var changed = 0
        for ((batchId, groups) in imports.groups().groupBy { it.batchId }) {
            val candidates = groups.mapNotNull { group ->
                journal.details(group.sessionId)?.takeIf { detail ->
                    detail.session.sourceKind == "mytargets" && detail.blocks.any {
                        it.block.revision == 1L && it.block.targetProfileId?.startsWith("mytargets-source-") == true
                    }
                }?.let { group to it }
            }
            if (candidates.isEmpty()) continue
            val batch = imports.batchById(batchId) ?: continue
            val source = File(filesRoot, batch.rawSourcePath)
            if (!source.isFile) continue
            require(source.canonicalFile.parentFile == File(filesRoot, "imports").canonicalFile)
            stagingRoot.mkdirs()
            val staged = File(stagingRoot, "target-upgrade-${UUID.randomUUID()}")
            try {
                GZIPInputStream(source.inputStream()).use { input ->
                    staged.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        var count = 0L
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val size = input.read(buffer)
                            if (size < 0) break
                            count += size
                            require(count <= MyTargetsReader.MAX_BYTES)
                            output.write(buffer, 0, size)
                        }
                    }
                }
                val records = imports.rows(batchId).associateBy { it.shotId }
                val relevantRecords = records.values.map { it.sourceRecord }.toSet()
                val parsed = mutableMapOf<String, Pair<MyTargetsPreview, Map<Int, MyTargetsRow>>>()
                for ((group, old) in candidates) {
                    val settings = JSONObject(group.mappingJson).optJSONObject("grouping")
                    fun set(key: String): Set<Int> {
                        val entries = settings?.optJSONArray(key) ?: return emptySet()
                        return (0 until entries.length()).map { entries.getInt(it) }.toSet()
                    }
                    val grouping = MyTargetsGrouping(set("split"), set("join"))
                    val parseKey = settings?.toString().orEmpty()
                    val result = parsed[parseKey] ?: run {
                        val positions = mutableMapOf<Int, MyTargetsRow>()
                        val coroutine = currentCoroutineContext()
                        val check = { coroutine.ensureActive() }
                        val preview = if (MyTargetsArchiveReader.isArchive(staged)) {
                            MyTargetsArchiveReader.read(staged, stagingRoot, grouping, check) { row ->
                                if (row.record in relevantRecords) positions[row.record] = row
                            }
                        } else MyTargetsReader.read(staged.inputStream(), grouping, check) { row ->
                            if (row.record in relevantRecords) positions[row.record] = row
                        }
                        (preview to positions.toMap()).also { parsed[parseKey] = it }
                    }
                    val (preview, sourceRows) = result
                    if (preview.fileHash != batch.fileHash) continue
                    val sourceBlocks = preview.groups.flatMap { it.blocks }.associateBy { it.key }
                    db.withTransaction {
                        val current = journal.details(old.session.id) ?: return@withTransaction
                        for (block in current.blocks) {
                            val saved = block.block
                            if (saved.revision != 1L || saved.targetProfileId?.startsWith("mytargets-source-") != true) continue
                            val rows = block.ends.flatMap { it.shots }.mapNotNull { shot ->
                                val record = records[shot.id]?.sourceRecord ?: return@mapNotNull null
                                sourceRows[record]?.let { shot to it }
                            }
                            val key = rows.map { it.second.blockKey }.distinct().singleOrNull() ?: continue
                            val conditions = sourceBlocks[key]?.conditions ?: continue
                            val profile = myTargetsProfile(conditions, saved.targetDiameterMm) ?: continue
                            val original = JSONObject(saved.targetSnapshotJson!!)
                                .put("sourceTargetId", conditions.sourceTargetId)
                                .put("sourceScoringStyle", conditions.sourceScoringStyle)
                            val target = mappedMyTargetsSnapshot(profile, requireNotNull(saved.targetDiameterMm), original)
                            db.openHelper.writableDatabase.execSQL(
                                "UPDATE blocks SET targetProfileId=?,targetProfileVersion=1,targetSnapshotJson=? WHERE id=? AND revision=1",
                                arrayOf(profile.id, target, saved.id),
                            )
                            for ((shot, row) in rows) {
                                if (!canRecoverPosition(shot, row)) continue
                                val point = myTargetsPoint(row, preview.sourceFormat) ?: continue
                                journal.update(shot.copy(x = point.x, y = point.y, faceId = "main", positionStatus = "known"))
                            }
                            changed++
                        }
                    }
                }
            } finally { staged.delete() }
        }
        changed
    }

private fun canRecoverPosition(shot: JournalShot, row: MyTargetsRow): Boolean =
    shot.revision == 1L && shot.scoreSource == "imported" && shot.positionSource == "imported" &&
        shot.positionStatus == "unverified" && shot.points == row.points && shot.x == row.x && shot.y == row.y

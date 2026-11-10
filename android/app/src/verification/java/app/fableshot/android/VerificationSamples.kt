package app.fableshot.android

import androidx.room.withTransaction
import app.fableshot.android.data.DiaryRuntime
import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.EquipmentRevision
import app.fableshot.android.data.equipmentSnapshot
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.domain.TargetPoint
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlin.math.cos
import kotlin.math.sin

private const val LEGACY_RECEIPT = "verification-numbered-arrows-v1"
private const val SAMPLE_RECEIPT = "verification-numbered-arrows-v2"
private val scoredDaysAgo = listOf(42, 29, 17, 9, 2, 1)
private const val COUNT_DAYS_AGO = 5
private fun sampleId(value: String) = UUID.nameUUIDFromBytes("fableshot-sample-v1:$value".toByteArray()).toString()

/** Adds named examples, keeping all existing rows. This entry is restricted to the installed test edition. */
internal suspend fun seedVerificationDiary(runtime: DiaryRuntime, updateOnly: Boolean = false) {
    check(runtime.context.packageName == "app.fableshot.android.verification")
    runtime.gate.write {
        val journal = runtime.journal.journalDao()
        if (journal.receipt(SAMPLE_RECEIPT) != null) return@write
        val now = System.currentTimeMillis()
        val legacy = journal.receipt(LEGACY_RECEIPT)
        if (legacy != null) {
            runtime.journal.withTransaction {
                rescheduleVerificationSamples(runtime.journal, legacy.appliedAtMs)
                journal.insert(legacy.copy(operationId = SAMPLE_RECEIPT, appliedAtMs = now))
            }
            return@write
        }
        if (updateOnly) return@write
        val today = LocalDate.now()
        val equipment = runtime.equipmentDatabase.equipmentDao()
        val examples = listOf("barebow", "compound").flatMap { category ->
            val bow = EquipmentItem(sampleId("$category-bow"), "bow",
                if (category == "barebow") "Демо · клубный баребоу" else "Демо · блочный лук",
                category = category, revision = 1, createdAtMs = now, updatedAtMs = now)
            val arrows = EquipmentItem(sampleId("$category-arrows"), "arrows", "Демо · шесть стрел ($category)",
                numberedCount = 6, spine = 700, revision = 1, createdAtMs = now, updatedAtMs = now)
            val setup = EquipmentItem(sampleId("$category-setup"), "setup",
                if (category == "barebow") "Демо · баребоу и номерные стрелы" else "Демо · блочный комплект",
                bowId = bow.id, arrowsId = arrows.id, revision = 1, createdAtMs = now, updatedAtMs = now)
            listOf(bow, arrows, setup)
        }
        runtime.equipmentDatabase.withTransaction {
            for (item in examples) if (equipment.item(item.id) == null) {
                equipment.put(item)
                val snapshot = equipmentSnapshot(item, examples)
                val selected = JSONObject(snapshot).getJSONObject("selection").toString()
                equipment.insert(EquipmentRevision(item.id, item.revision, selected, now))
            }
        }
        val items = equipment.all()
        runtime.journal.withTransaction {
            scoredDaysAgo.forEachIndexed { day, daysAgo ->
                val category = if (day == 5) "compound" else "barebow"
                val profile = if (category == "compound") TargetCatalog.compound else TargetCatalog.indoor
                val setup = items.first { it.id == sampleId("$category-setup") }
                val snapshot = equipmentSnapshot(setup, items)
                val date = today.minusDays(daysAgo.toLong())
                val start = date.atTime(18, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
                val finish = start + 3_600_000
                val sessionId = sampleId("session-$day")
                val blockId = sampleId("block-$day")
                journal.insert(JournalSession(sessionId,
                    if (day == 4) "Демо · пять рядом, шестая отдельно" else "Демо · тренировка " + (day + 1),
                    start, start, finish, date.toString(), ZoneId.systemDefault().id,
                    state = "completed", revision = 2, numberedArrows = true))
                val block = JournalBlock(blockId, sessionId, 0, "scored", 18.0, profile.id, 1, 400,
                    profile.snapshot(400), snapshot, 3)
                journal.insert(block)
                journal.insert(SessionPlan(sessionId, 10, rolling = true))
                freezeProgress(runtime.journal, requireNotNull(journal.session(sessionId)), block, start)
                repeat(20) { series ->
                    val endId = sampleId("end-$day-$series")
                    val endTime = start + series * 180_000L
                    journal.insert(JournalEnd(endId, blockId, series, 3, state = "closed",
                        createdAtMs = endTime, closedAtMs = endTime + 150_000))
                    repeat(3) { shot ->
                        val physical = series % 2 * 3 + shot + 1
                        val spread = listOf(.20, .15, .11, .075, .035, .06)[day]
                        val phase = series * 2.4 + physical * 1.7
                        val shiftX = if (physical == 6) .39 else .025 + physical * .004
                        val shiftY = if (physical == 6) .27 else -.02 + physical * .003
                        val point = TargetPoint(shiftX + cos(phase) * spread, shiftY + sin(phase) * spread)
                        val zone = profile.score(point)
                        journal.insert(JournalShot(sampleId("shot-$day-$series-$shot"), endId, shot,
                            zone.points, zone.code, zone.points, profile.rule, point.x, point.y, "main",
                            "target_computed", "manual_target", "known", physical, endTime + shot * 10_000L))
                    }
                }
                val hash = "0".repeat(64)
                journal.insert(MutationReceipt(sampleId("start-$day"), sessionId, "start", hash, sessionId, 1, start))
                journal.insert(MutationReceipt(sampleId("complete-$day"), sessionId, "complete", hash, sessionId, 2, finish))
            }
            val countDate = today.minusDays(COUNT_DAYS_AGO.toLong())
            val countStart = countDate.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            val countSession = sampleId("count-session")
            val countBlock = sampleId("count-block")
            journal.insert(JournalSession(countSession, "Демо · техника без оценки", countStart, countStart,
                countStart + 1_800_000, countDate.toString(), ZoneId.systemDefault().id,
                state = "completed", revision = 2, numberedArrows = false))
            journal.insert(JournalBlock(countBlock, countSession, 0, "count_only", 18.0,
                null, null, null, null, null, 3))
            journal.insert(SessionPlan(countSession, 10, rolling = true))
            repeat(15) { series ->
                val endId = sampleId("count-end-$series")
                val time = countStart + series * 120_000L
                journal.insert(JournalEnd(endId, countBlock, series, 3, state = "closed",
                    createdAtMs = time, closedAtMs = time + 100_000))
                journal.put(JournalCount(endId, 3, time, time))
            }
            journal.insert(MutationReceipt(sampleId("count-start"), countSession, "start", "0".repeat(64), countSession, 1, countStart))
            journal.insert(MutationReceipt(sampleId("count-complete"), countSession, "complete", "0".repeat(64), countSession, 2, countStart + 1_800_000))
            journal.insert(MutationReceipt(SAMPLE_RECEIPT, sampleId("session-0"), "verification_sample", "0".repeat(64),
                sampleId("session-0"), 1, now))
        }
    }
}

/** Moves only untouched v1 examples, keeping their identifiers, hits and durations. */
private suspend fun rescheduleVerificationSamples(db: JournalDatabase, seededAtMs: Long) {
    val journal = db.journalDao()
    val sql = db.openHelper.writableDatabase
    val scoredDates = scoredDaysAgo.mapIndexed { index, daysAgo -> sampleId("session-$index") to daysAgo }
    val rescheduled = mutableListOf<JournalDetails>()
    for ((id, daysAgo) in scoredDates + (sampleId("count-session") to COUNT_DAYS_AGO)) {
        val details = journal.details(id) ?: continue
        val session = details.session
        val oldStart = session.startedAtMs ?: continue
        if (session.revision != 2L || session.deletedAtMs != null || session.state != "completed") continue
        val zone = ZoneId.of(session.timeZoneId ?: continue)
        val date = Instant.ofEpochMilli(seededAtMs).atZone(zone).toLocalDate().minusDays(daysAgo.toLong())
        val start = date.atTime(Instant.ofEpochMilli(oldStart).atZone(zone).toLocalTime())
            .atZone(zone).toInstant().toEpochMilli()
        val shift = start - oldStart
        val moved = session.copy(
            createdAtMs = session.createdAtMs + shift,
            startedAtMs = start,
            completedAtMs = session.completedAtMs?.plus(shift),
            localDate = date.toString(),
        )
        journal.update(moved)
        for (block in details.blocks) for (series in block.ends) {
            journal.update(series.end.copy(
                createdAtMs = series.end.createdAtMs?.plus(shift),
                closedAtMs = series.end.closedAtMs?.plus(shift),
            ))
            series.shots.forEach { shot ->
                journal.update(shot.copy(createdAtMs = shot.createdAtMs + shift, updatedAtMs = shot.updatedAtMs?.plus(shift)))
            }
            series.counts.forEach { count ->
                journal.put(count.copy(createdAtMs = count.createdAtMs + shift, updatedAtMs = count.updatedAtMs + shift))
            }
        }
        sql.execSQL(
            "UPDATE mutation_receipts SET appliedAtMs=appliedAtMs+? WHERE sessionId=? AND kind IN ('start','complete')",
            arrayOf(shift, id),
        )
        rescheduled += details.copy(session = moved)
    }
    for (details in rescheduled) {
        for (block in details.blocks.filter { it.baselines.isNotEmpty() }) {
            sql.execSQL("DELETE FROM progress_baselines WHERE blockId=?", arrayOf(block.block.id))
            freezeProgress(db, details.session, block.block, requireNotNull(details.session.startedAtMs))
        }
    }
}

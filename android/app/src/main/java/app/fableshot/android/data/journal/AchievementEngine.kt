package app.fableshot.android.data.journal

import androidx.room.withTransaction
import app.fableshot.android.data.WriteGate
import app.fableshot.android.domain.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import kotlin.math.sqrt

private data class AchievementEvidence(
    val value: Long,
    val sessionId: String?,
    val endId: String? = null,
    val date: String? = null,
)

private val serviceRuleIds = setOf("APP01", "APP04", "APP08", "MIND03", "MIND04", "MIND08")
private val completionRuleIds = setOf("GEAR02", "GEAR03", "GEAR06", "PROGRESS08", "STORY01")

/** Receipts and native evidence are committed with diary mutations, never inferred from import time. */
class AchievementEngine(
    private val db: JournalDatabase,
    private val gate: WriteGate,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val dao = db.achievementDao()
    val board: Flow<AchievementBoard> = combine(dao.observeEligibleDetails(), dao.observeEnrollments(), dao.observeGrants()) {
        details, enrollments, grants ->
        val evidence = evaluate(details, enrollments)
        val awards = grants.map { it.presentation().copy(valid = effectiveValidity(it, evidence, details, enrollments)) }
        val byKey = awards.associateBy { it.key }
        val scopes = details.flatMap { it.blocks }.mapNotNull { bow(it.block) }
            .filter { it in achievementBowLabels }.toSet()
        val statuses = AchievementCatalog.rules.flatMap { rule ->
            scopesFor(rule).map { scope ->
                val key = "${rule.id}:$scope"
                AchievementStatus(rule, scope, evidence[key]?.value ?: 0, byKey[key]?.takeIf { it.valid })
            }
        }
        AchievementBoard(statuses, awards, scopes)
    }.flowOn(Dispatchers.Default).catch { error ->
        if (error is CancellationException) throw error
        android.util.Log.e("FableAchievements", "Achievement collection unavailable", error)
        emit(AchievementBoard(failed = true))
    }

    internal suspend fun enroll(session: JournalSession, category: String?) {
        dao.enroll(AchievementEnrollment(session.id, session.createdAtMs, requireNotNull(session.localDate),
            JSONArray(AchievementCatalog.rules.map { it.id }).toString(), category?.takeIf { it in setOf("male", "female") }))
    }

    internal suspend fun captureComparisonCategory(sessionId: String, category: String?) {
        if(category !in setOf("male","female"))return
        dao.enrollment(sessionId)?.let { enrollment ->
            if(enrollment.rankCategory!=category)dao.update(enrollment.copy(rankCategory=category))
        }
    }

    /** Runtime owner holds the write gate and transaction, including pending service commands. */
    internal suspend fun resetInTransaction() {
        dao.clearGrants()
        dao.clearEnrollments()
    }

    private fun scopesFor(rule: AchievementDefinition): Set<String> = when {
        !rule.categorySpecific -> setOf("global")
        rule.id.startsWith("RANK") || rule.id=="PROGRESS06" -> setOf("recurve","compound","barebow")
        else -> achievementBowLabels.keys
    }

    internal suspend fun reconcile(sessionId: String, kind: String, batch: String) {
        val details = dao.eligibleDetails()
        val enrollments = dao.enrollments()
        val evidence = evaluate(details, enrollments).toMutableMap()
        val freshEvidence = evaluate(details, enrollments, sessionId).toMutableMap()
        val existing = dao.grants()
        val recordIds = setOf("PROGRESS04", "PROGRESS06", "PROGRESS10")
        if (kind in setOf("complete", "revise", "remove_shot", "trash", "restore", "role")) {
            val recordSessions = existing.filter { it.ruleId in recordIds }.mapNotNull { it.sessionId }.toSet() + sessionId
            for (detail in details.filter { it.session.id in recordSessions && it.session.state == "completed" }) {
                val enrollment = enrollments.first { it.sessionId == detail.session.id }
                recordEvidence(detail, enrollment).forEach { (key, value) ->
                    evidence[key] = value
                    if(detail.session.id==sessionId)freshEvidence[key]=value
                }
            }
        } else {
            // Record evidence is expensive and only changes on completion/correction, not on each tap.
            existing.filter { it.ruleId in recordIds && it.valid }.forEach { grant ->
                evidence[grant.key] = AchievementEvidence(1, grant.sessionId, grant.endId, grant.sourceDate)
            }
        }
        val allowNew = kind in setOf("append", "count", "next", "complete", "block") ||
            (kind=="revise"&&details.any{it.session.id==sessionId&&it.session.state=="active"})
        for (rule in AchievementCatalog.rules.filterNot { it.id in serviceRuleIds }) {
            val scopes = scopesFor(rule)
            for (scope in scopes) {
                val key = "${rule.id}:$scope"
                val candidate = evidence[key]
                val valid = candidate != null && candidate.value >= rule.target
                val previous = existing.firstOrNull { it.key == key }
                if (previous != null) {
                    if (previous.valid != valid) dao.put(previous.copy(valid = valid))
                } else if (allowNew && (kind == "complete" || rule.id !in completionRuleIds) &&
                    (freshEvidence[key]?.value ?: 0) >= rule.target) {
                    val fresh = freshEvidence.getValue(key)
                    val trigger = details.firstOrNull { it.session.id == sessionId }
                    val permitted = enrollments.firstOrNull { it.sessionId == sessionId }?.let { rule.id in allowed(it) } == true
                    val freshGlobal = scope == "global" && permitted && trigger != null &&
                        (rule.family == "journey.volume" || kind == "complete")
                    if (fresh.sessionId == sessionId || freshGlobal)
                        grant(rule, scope, sessionId, fresh.endId, trigger?.session?.localDate ?: fresh.date, batch)
                }
            }
        }
    }

    /** Called only by successful new operations, never by scanning settings or old import batches. */
    suspend fun service(ruleId: String, operationId: String, occurredAtMs: Long = now(), sessionId: String? = null) =
        gate.write { db.withTransaction { serviceInTransaction(ruleId, operationId, occurredAtMs, sessionId) } }

    internal suspend fun serviceInTransaction(ruleId: String, operationId: String, occurredAtMs: Long, sessionId: String? = null) {
        require(ruleId in serviceRuleIds)
        require(operationId.isNotBlank() && operationId.length <= 128)
        require(occurredAtMs >= 0)
        if (dao.grant("$ruleId:global") != null) return
        grant(AchievementCatalog.byId.getValue(ruleId), "global", sessionId, null, null, operationId, occurredAtMs)
    }

    private suspend fun grant(rule: AchievementDefinition, scope: String, sessionId: String?, endId: String?,
        date: String?, batch: String, instant: Long = now()) {
        val comparison=if(rule.id.startsWith("RANK")&&sessionId!=null)
            dao.enrollment(sessionId)?.rankCategory?.let { rankClassLabel(scope,it) } else null
        val description=rule.description+(comparison?.let { "\nКатегория сравнения при получении: $it." } ?: "")
        dao.put(AchievementGrant("${rule.id}:$scope", rule.id, scope, 1, rule.title, rule.flavor,
            description, rule.family, rule.rarityFor(scope).ordinal, rule.priority, sessionId, endId,
            date, instant, batch, null, true))
    }

    suspend fun claimNotifications(keys: List<String>): List<EarnedAchievement> = gate.write { db.withTransaction {
        if(keys.isEmpty())return@withTransaction emptyList()
        val details = dao.eligibleDetails()
        val enrollments = dao.enrollments()
        val evidence = evaluate(details, enrollments)
        keys.distinct().mapNotNull { key ->
            val grant = dao.grant(key) ?: return@mapNotNull null
            if (dao.claim(key, now()) == 1 && effectiveValidity(grant, evidence, details, enrollments))
                grant.copy(notifiedAtMs = now()).presentation() else null
        }
    } }

    private fun effectiveValidity(grant: AchievementGrant, evidence: Map<String, AchievementEvidence>,
        details: List<JournalDetails>, enrollments: List<AchievementEnrollment>): Boolean {
        if(!grant.valid)return false
        if(grant.ruleId in serviceRuleIds)return true
        val rule=AchievementCatalog.byId[grant.ruleId] ?: return true
        if(grant.scope !in scopesFor(rule))return false
        if(grant.ruleId in setOf("PROGRESS04","PROGRESS06","PROGRESS10")) {
            val source=details.firstOrNull {it.session.id==grant.sessionId&&it.session.state=="completed"} ?: return false
            val enrollment=enrollments.firstOrNull {it.sessionId==source.session.id} ?: return false
            return grant.ruleId in allowed(enrollment)&&source.blocks.flatMap{it.ends}.all{owned(it,enrollment)}
        }
        return (evidence[grant.key]?.value ?: 0) >= rule.target
    }

    /** Restoring a diary cannot rewind the dismissal latch or manufacture a fresh celebration. */
    suspend fun mergeReceiptHistory(previous: List<AchievementGrant>) = gate.write { db.withTransaction {
        val incoming = dao.grants().associateBy { it.key }
        incoming.values.forEach { grant ->
            val seen = previous.firstOrNull { it.key == grant.key }?.notifiedAtMs ?: grant.notifiedAtMs ?: now()
            dao.put(grant.copy(notifiedAtMs = seen))
        }
        previous.filter { it.key !in incoming }.forEach { grant ->
            val independentAction = grant.ruleId in serviceRuleIds
            dao.put(grant.copy(valid = independentAction && grant.valid, notifiedAtMs = grant.notifiedAtMs ?: now()))
        }
    } }

    private fun bow(block: JournalBlock): String? = block.equipmentSnapshotJson?.let { json ->
        runCatching { JSONObject(json).optJSONObject("bow")?.optString("category")?.takeIf { it.isNotBlank() } }.getOrNull()
    }

    private fun allowed(enrollment: AchievementEnrollment): Set<String> {
        val array = JSONArray(enrollment.ruleIdsJson)
        return (0 until array.length()).map { array.getString(it) }.toSet()
    }

    private fun owned(entry: JournalEndDetails, enrollment: AchievementEnrollment): Boolean =
        entry.shots.all(enrollment::ownsShot) &&
            entry.counts.all { it.createdAtMs >= enrollment.enrolledAtMs }

    private fun ownedVolume(entry: JournalEndDetails, enrollment: AchievementEnrollment): Int =
        entry.shots.count(enrollment::ownsShot) +
            entry.counts.filter { it.createdAtMs >= enrollment.enrolledAtMs }.sumOf { it.count }

    private fun evaluate(details: List<JournalDetails>, enrollments: List<AchievementEnrollment>, triggerSessionId: String? = null): Map<String, AchievementEvidence> {
        val enrolled = enrollments.associateBy { it.sessionId }
        val permissions = enrollments.associate { it.sessionId to allowed(it) }
        val output = mutableMapOf<String, AchievementEvidence>()
        fun put(id: String, scope: String, value: Long, detail: JournalDetails, endId: String? = null) {
            if (id !in permissions[detail.session.id].orEmpty()) return
            val key = "$id:$scope"
            val prior = output[key]
            if (prior == null || value > prior.value) output[key] = AchievementEvidence(value, detail.session.id, endId, detail.session.localDate)
        }
        for (rule in AchievementCatalog.rules.filter { !it.categorySpecific && it.id.startsWith("START") }) {
            val eligible = details.filter { rule.id in permissions[it.session.id].orEmpty() }
            var total = 0L
            var crossing: JournalDetails? = null
            for (detail in eligible) {
                val enrollment = enrolled.getValue(detail.session.id)
                val volume = detail.blocks.flatMap { it.ends }.sumOf { ownedVolume(it, enrollment) }
                val increment = if (rule.family == "journey.volume") volume.toLong()
                    else if (detail.session.state == "completed" && volume > 0) 1L else 0L
                if (crossing == null && total < rule.target && total + increment >= rule.target) crossing = detail
                total += increment
            }
            val source = crossing ?: eligible.lastOrNull()
            if (source != null) output["${rule.id}:global"] = AchievementEvidence(total, source.session.id, date = source.session.localDate)
        }
        for (detail in details) {
            if(triggerSessionId!=null&&detail.session.id!=triggerSessionId)continue
            val enrollment = enrolled.getValue(detail.session.id)
            val groups = detail.reportScopes().filter { !it.id.startsWith("part-") && it.volume > 0 }
            seriesStories(detail, enrollment, groups, permissions.getValue(detail.session.id)) { id, category, endId ->
                put(id, category, 1, detail, endId)
            }
            for (group in groups) {
                val block = group.merged()
                val category = bow(block.block)?.takeIf { it in achievementBowLabels } ?: continue
                if (block.block.mode != "scored" || block.block.verifiedTarget() == null) continue
                val entries = block.orderedEnds.filter { it.end.role == "scored" && it.volume > 0 }
                val full = entries.filter { it.full && it.shots.size == it.end.plannedCount && owned(it, enrollment) }
                fun qualify(id: String, condition: Boolean, endId: String? = null) {
                    if (condition) put(id, category, 1, detail, endId)
                }
                val firstTen = full.firstOrNull { it.shots.any { shot -> shot.points == 10 } }
                qualify("START02", firstTen != null, firstTen?.end?.id)
                val noMiss = full.firstOrNull { it.shots.size >= 3 && it.shots.all { shot -> shot.points > 0 } }
                qualify("START03", noMiss != null, noMiss?.end?.id)
                if (block.block.distanceMeters != 18.0 || block.block.targetDiameterMm != 400) continue
                for (entry in full) {
                    val n = entry.shots.size
                    val mean = entry.shots.sumOf { it.points }.toDouble() / n
                    val perfect = entry.shots.all { it.points == 10 }
                    qualify("HIT01", n == 3 && perfect, entry.end.id)
                    qualify("HIT02", n == 6 && perfect, entry.end.id)
                    qualify("HIT03", entry.shots.any { it.zoneCode == "X" }, entry.end.id)
                    qualify("HIT04", n == 3 && entry.shots.all { it.zoneCode == "X" }, entry.end.id)
                    qualify("HIT05", n == 6 && entry.shots.all { it.zoneCode == "X" }, entry.end.id)
                    val points = entry.shots.mapNotNull { shot ->
                        if (shot.positionStatus == "known" && shot.faceId == "main" && shot.x != null && shot.y != null)
                            TargetPoint(shot.x, shot.y) else null
                    }
                    if (n >= 3 && points.size == n) {
                        val x = points.sumOf { it.x } / n
                        val y = points.sumOf { it.y } / n
                        val rms = sqrt(points.sumOf { (it.x - x) * (it.x - x) + (it.y - y) * (it.y - y) } / n)
                        val mm = rms * 200
                        qualify("GROUP01", mm <= 30 && mean >= 5, entry.end.id)
                        qualify("GROUP02", mm <= 15 && mean >= 7, entry.end.id)
                        qualify("GROUP03", mm <= 8 && mean >= 8, entry.end.id)
                        qualify("GROUP04", n >= 6 && mm <= 12 && mean >= 8, entry.end.id)
                        qualify("GROUP06", rms <= .03 && sqrt(x*x+y*y) > .15 && entry.shots.all { it.points > 0 }, entry.end.id)
                        qualify("GROUP08", n == 3 && mm <= 6 && mean >= 9, entry.end.id)
                    }
                }
                var run = 0
                var runArrows = 0
                for (entry in entries) {
                    if (entry in full && entry.shots.all { it.points == 10 }) { run++; runArrows += entry.shots.size }
                    else { run = 0; runArrows = 0 }
                    qualify("HIT06", run >= 3 && runArrows >= 9, entry.end.id)
                    qualify("HIT07", run >= 5 && runArrows >= 15, entry.end.id)
                    qualify("HIT08", run >= 10 && runArrows >= 30, entry.end.id)
                }
                val whole = detail.session.state == "completed" && groups.size == 1 && entries.isNotEmpty() && full.size == entries.size
                val shots = full.flatMap { it.shots }
                val n = shots.size
                val average = if (n > 0) shots.sumOf { it.points }.toDouble() / n else 0.0
                if (whole) {
                    listOf(5.0, 7.0, 8.0, 9.0, 9.5).forEachIndexed { index, threshold ->
                        qualify("SCORE0${index+1}", n >= (if (index < 3) 30 else 60) && average >= threshold)
                    }
                    qualify("SCORE06", n >= 30 && shots.all { it.points > 0 })
                    qualify("HIT09", n >= 30 && block.block.targetProfileId?.startsWith("wa-") == true && shots.count { it.points >= 9 } * 5 >= n * 4)
                    qualify("HIT10", n == 60 && shots.all { it.points == 10 })
                    val t = stability(full)
                    qualify("STEADY01", full.size >= 10 && n >= 30 && t != null && t >= .85 && average >= 6)
                    qualify("STEADY03", full.size >= 15 && t != null && t >= .95 && average >= 8)
                    val means = full.map { entry -> entry.shots.sumOf { it.points }.toDouble() / entry.shots.size }
                    qualify("STEADY04", full.size >= 10 && means.maxOrNull()!! - means.minOrNull()!! <= 1 && average >= 7)
                }
                entries.windowed(5).filter { window -> window.all { it in full } }.forEach { window ->
                    qualify("STEADY02", window.map { it.shots.size }.distinct().size == 1 && window.map { it.shots.sumOf { shot -> shot.points } }.distinct().size == 1 &&
                        window.sumOf { it.shots.size } >= 15 && window.flatMap { it.shots }.map { it.points }.average() >= 6)
                }
                if (entries.size >= 8 && entries.takeLast(5).all { it in full } && entries.take(3).all { it in full }) {
                    val last = entries.takeLast(5)
                    val lastMean = last.flatMap { it.shots }.map { it.points }.average()
                    val firstMean = entries.take(3).flatMap { it.shots }.map { it.points }.average()
                    val t = stability(last)
                    qualify("STEADY05", t != null && t >= .90 && lastMean >= 7)
                    qualify("STEADY06", t != null && t >= .90 && lastMean - firstMean >= 1)
                }
            }
            val permitted = permissions[detail.session.id].orEmpty()
            val clean = detail.blocks.flatMap { it.ends }.all { owned(it, enrollment) }
            if (clean && enrollment.rankCategory != null) {
                val assessment = detail.rankAssessment(enrollment.rankCategory)
                val result = assessment.evaluation
                if (assessment.finalResult && result != null) {
                    val labels = listOf("III юн.", "II юн.", "I юн.", "III", "II", "I", "КМС", "МС", "МСМК")
                    result.exercise.thresholds.filter { result.points >= it.score }.forEach { threshold ->
                        val index = labels.indexOf(threshold.label)
                        val id = "RANK${(index + 1).toString().padStart(2, '0')}"
                        if (index >= 0 && id in permitted) put(id, result.exercise.bow, 1, detail)
                    }
                }
            }
        }
        // Repeated whole-session stability cannot be earned by three windows of the same session.
        for (category in achievementBowLabels.keys) {
            val matching = details.filter { detail ->
                "STEADY08" in permissions[detail.session.id].orEmpty() && detail.session.state == "completed" &&
                    detail.reportScopes().filter { !it.id.startsWith("part-") && it.volume > 0 }.singleOrNull()?.merged()?.let { block ->
                        val ends = block.orderedEnds.filter { it.end.role == "scored" && it.volume > 0 }
                        bow(block.block) == category && block.block.verifiedTarget() != null && block.block.distanceMeters == 18.0 && block.block.targetDiameterMm == 400 &&
                            ends.size >= 8 && ends.all { it.full && owned(it, enrolled.getValue(detail.session.id)) } && (stability(ends) ?: -1.0) >= .90
                    } == true
            }
            val comparable = matching.groupBy { detail ->
                val b = detail.blocks.first().block
                listOf(b.distanceMeters, b.targetProfileId, b.targetDiameterMm, b.targetSnapshotJson, b.equipmentSnapshotJson)
            }.values.firstOrNull { it.size >= 3 && (triggerSessionId==null||it.any{d->d.session.id==triggerSessionId}) }
            if (comparable != null) put("STEADY08", category, 1,
                comparable.firstOrNull{it.session.id==triggerSessionId} ?: comparable[2])
        }
        val bySession = details.associateBy { it.session.id }
        for (evidence in achievementProgressEvidence(details, enrolled, triggerSessionId)) {
            put(evidence.ruleId, evidence.category, evidence.count, bySession.getValue(evidence.sessionId))
        }
        for (evidence in achievementGearEvidence(details, enrolled, triggerSessionId)) {
            put(evidence.ruleId, "global", evidence.count, bySession.getValue(evidence.sessionId))
        }
        return output
    }

    private fun seriesStories(
        detail: JournalDetails,
        enrollment: AchievementEnrollment,
        groups: List<ReportScope>,
        permissions: Set<String>,
        qualify: (id: String, category: String, endId: String) -> Unit,
    ) {
        val grouping = "GROUP05" in permissions
        val finale = "STORY01" in permissions && detail.session.state == "completed"
        if (!grouping && !finale) return
        val conditionByBlock = groups.flatMap { group -> group.blocks.map { it.block.id to group.id } }.toMap()
        val lastEnd = detail.orderedBlocks.asSequence().flatMap { it.orderedEnds.asSequence() }
            .lastOrNull { it.end.role == "scored" && (it.volume > 0 || it.end.state == "closed") }?.end?.id
        var fullCount = 0
        var previousCondition: String? = null
        val tight = ArrayDeque<ScoringEnd>()
        for (block in detail.orderedBlocks) {
            val condition = conditionByBlock[block.block.id]
            val category = bow(block.block)?.takeIf { it in achievementBowLabels }
            val scoring = block.scoringInput()
            if (condition != previousCondition) tight.clear()
            previousCondition = condition
            val scoringByEnd = scoring.ends.associateBy { it.id }
            for (entry in block.orderedEnds) {
                val end = scoringByEnd[entry.end.id] ?: continue
                val full = scoring.geometryVerified && end.closed && entry.full &&
                    end.shots.size == end.plannedCount && owned(entry, enrollment)
                if (finale && full && fullCount >= 5 && end.id == lastEnd && category != null &&
                    end.shots.all { it.points == scoring.maximumPerArrow }) {
                    qualify("STORY01", category, end.id)
                }
                if (full) fullCount++
                if (!grouping || condition == null || category == null || !full ||
                    end.shots.size < 3 || end.shots.any { it.position == null }) {
                    tight.clear()
                    continue
                }
                val q = CompositeScoring.calculate(listOf(end), end.number,
                    scoring.maximumPerArrow, scoring.geometryVerified, singleEnd = true).q
                if (q == null || q < .50) {
                    tight.clear()
                    continue
                }
                tight.addLast(end)
                if (tight.size > 5) tight.removeFirst()
                if (tight.size == 5 && tight.sumOf { series -> series.shots.sumOf { it.points } } >=
                    7 * tight.sumOf { it.shots.size }) {
                    qualify("GROUP05", category, end.id)
                }
            }
        }
    }

    private fun stability(ends: List<JournalEndDetails>): Double? = CompositeScoring.calculate(
        ends.mapIndexed { index, entry -> ScoringEnd(entry.end.id, index + 1, entry.end.plannedCount,
            entry.full, entry.shots.map { ScoringShot(it.id, it.points) }) }, ends.size, 10, false, CompositeProfile.ScoreOnly,
    ).stability

    private suspend fun recordEvidence(detail: JournalDetails, enrollment: AchievementEnrollment): Map<String, AchievementEvidence> {
        val result = mutableMapOf<String, AchievementEvidence>()
        val permissions = allowed(enrollment)
        for (scope in detail.reportScopes().filterNot { it.id.startsWith("part-") }) {
            val block = scope.merged()
            val b = block.block
            val category = bow(b)?.takeIf { it in achievementBowLabels } ?: continue
            if (b.mode != "scored" || b.verifiedTarget() == null || b.equipmentSnapshotJson == null || b.targetSnapshotJson == null || b.distanceMeters == null || b.targetDiameterMm == null || b.targetProfileId == null) continue
            val entries = block.orderedEnds.filter { it.end.role == "scored" && it.full && owned(it, enrollment) }
            if (entries.isEmpty()) continue
            val previous = dao.previousSeries(detail.session.id, detail.session.completedAtMs ?: detail.session.createdAtMs, b.distanceMeters,
                b.targetProfileId, b.targetDiameterMm, b.targetSnapshotJson, b.equipmentSnapshotJson)
            fun earned(id: String, endId: String? = null) {
                if (id in permissions) result["$id:$category"] = AchievementEvidence(1, detail.session.id, endId, detail.session.localDate)
            }
            fun monthHeld(points: Int, prior: List<AchievementRecordFact>): Boolean {
                val best = prior.maxOfOrNull { it.points } ?: return false
                if (points <= best) return false
                val previousDate = prior.filter { it.points == best }.mapNotNull { fact -> fact.localDate?.let { LocalDate.parse(it) } }.minOrNull() ?: return false
                val currentDate = detail.session.localDate?.let { LocalDate.parse(it) } ?: return false
                return currentDate >= previousDate.plusMonths(1)
            }
            for (entry in entries) {
                val points = entry.shots.sumOf { it.points }
                val prior = previous.filter { it.arrows == entry.shots.size }
                if (prior.isNotEmpty() && points > prior.maxOf { it.points }) {
                    earned("PROGRESS04", entry.end.id)
                    if (monthHeld(points, prior)) earned("PROGRESS10", entry.end.id)
                }
            }
            val assessment = detail.rankAssessment(enrollment.rankCategory ?: "male")
            if (assessment.finalResult && assessment.evaluation != null &&
                detail.reportScopes().count { !it.id.startsWith("part-") && it.volume > 0 } == 1) {
                val current = assessment.evaluation
                val prior = previous.groupBy { it.sessionId }.mapNotNull { (id, series) ->
                    if (series.sumOf { it.arrows } == current.exercise.arrows &&
                        series.first().sessionArrows == current.exercise.arrows && series.first().countOnlyBlocks == 0)
                        AchievementRecordFact(id, series.first().localDate, series.sumOf { it.points }, series.sumOf { it.arrows }) else null
                }
                if (prior.isNotEmpty() && current.points > prior.maxOf { it.points }) {
                    earned("PROGRESS06")
                    if (monthHeld(current.points, prior)) earned("PROGRESS10")
                }
            }
        }
        return result
    }
}

package app.fableshot.android.backup

import androidx.sqlite.db.SupportSQLiteDatabase
import java.time.LocalDate
import java.time.ZoneId

/** Validate facts only in the newly restored databases. Do not repair or reinterpret history. */
internal object ArchiveFacts {
    fun validate(j:SupportSQLiteDatabase,e:SupportSQLiteDatabase,check:()->Unit) {
        fun none(db:SupportSQLiteDatabase,sql:String,reason:String) {check();db.query(sql).use{if(it.moveToFirst())throw ArchiveInvalid(reason)}}
        for(db in listOf(j,e)) {
            check();db.query("PRAGMA integrity_check").use{if(!it.moveToFirst()||it.getString(0)!="ok")throw ArchiveInvalid("database_integrity")}
            none(db,"PRAGMA foreign_key_check","broken_relationship")
        }
        none(j,"SELECT 1 FROM achievement_enrollments WHERE enrolledAtMs<0 OR (rankCategory IS NOT NULL AND rankCategory NOT IN ('male','female')) LIMIT 1","invalid_achievement_enrollment")
        none(j,"SELECT 1 FROM achievement_enrollments a JOIN sessions s ON s.id=a.sessionId WHERE s.sourceKind<>'native' OR s.timeSource<>'app_clock' OR a.enrolledAtMs<>s.createdAtMs LIMIT 1","invalid_achievement_enrollment")
        j.query("SELECT localDate,ruleIdsJson FROM achievement_enrollments").use { cursor -> while(cursor.moveToNext()) {
            check()
            try { LocalDate.parse(cursor.getString(0)) } catch(_:Exception) { throw ArchiveInvalid("invalid_achievement_date") }
            val ids=ArchiveJson.parse(cursor.getString(1)) as? List<*> ?: throw ArchiveInvalid("invalid_achievement_rules")
            if(ids.isEmpty()||ids.size>200||ids.toSet().size!=ids.size||ids.any { it !is String||!Regex("[A-Z]+[0-9]{2}").matches(it) })
                throw ArchiveInvalid("invalid_achievement_rules")
        }}
        none(j,"SELECT 1 FROM achievement_grants WHERE ruleVersion<1 OR rarity NOT BETWEEN 0 AND 5 OR priority<0 OR earnedAtMs<0 OR notifiedAtMs<0 OR valid NOT IN (0,1) OR trim(title)='' OR trim(family)='' OR trim(scope)='' OR trim(batchId)='' OR length(batchId)>128 OR `key`<>ruleId||':'||scope LIMIT 1","invalid_achievement_grant")
        j.query("SELECT ruleId FROM achievement_grants").use { cursor -> while(cursor.moveToNext()) {
            check()
            if(!Regex("[A-Z]+[0-9]{2}").matches(cursor.getString(0)))throw ArchiveInvalid("invalid_achievement_grant")
        }}
        j.query("SELECT sourceDate FROM achievement_grants WHERE sourceDate IS NOT NULL").use { cursor -> while(cursor.moveToNext()) {
            check();try { LocalDate.parse(cursor.getString(0)) } catch(_:Exception) { throw ArchiveInvalid("invalid_achievement_date") }
        }}
        none(j,"""SELECT 1 FROM personal_record_events r JOIN sessions s ON s.id=r.sessionId
            WHERE r.kind NOT IN ('series','volume','rank') OR r.ruleVersion<>1 OR trim(r.label)=''
            OR r.previousValue<0 OR r.value<=r.previousValue OR r.value>${Int.MAX_VALUE}
            OR length(trim(r.previousSessionId))=0 OR length(r.previousSessionId)>128 OR r.previousSessionId=r.sessionId
            OR s.sourceKind<>'native' OR r.sessionRevision<1 OR r.sessionRevision>s.revision
            OR r.recordedAtMs<0 OR r.notifiedAtMs<0 LIMIT 1""","invalid_personal_record_event")
        for(table in ArchiveEnvelopeVerifier.journalTables) {
            val id=when(table){"session_plans","achievement_enrollments"->"sessionId";"achievement_grants"->"key";"progress_baselines"->"baselineId";"mutation_receipts"->"operationId";"unscored_counts","imported_end_sources"->"endId";"imported_rows"->"shotId";else->"id"}
            none(j,"SELECT 1 FROM `$table` WHERE length(`$id`)=0 OR length(`$id`)>128 LIMIT 1","invalid_identifier")
        }
        none(j,"SELECT 1 FROM sessions WHERE revision<1 OR trim(title)='' OR state NOT IN ('active','paused','completed') OR kind<>'training' OR sourceKind NOT IN ('native','mytargets') OR timeSource NOT IN ('app_clock','legacy_app_clock','source_date_only','import_unknown') OR (deletedAtMs IS NOT NULL AND state='active') LIMIT 1","invalid_session")
        none(j,"SELECT 1 FROM sessions WHERE numberedArrows NOT IN (0,1) LIMIT 1","invalid_numbered_arrows")
        none(j,"SELECT 1 FROM ends WHERE startsRound NOT IN (0,1) LIMIT 1","invalid_round_boundary")
        none(j,"SELECT 1 FROM sessions WHERE state='active' AND deletedAtMs IS NULL LIMIT 1 OFFSET 1","multiple_active_sessions")
        none(j,"SELECT 1 FROM blocks WHERE revision<1 OR ordinal<0 OR mode NOT IN ('scored','count_only') OR defaultArrowsPerEnd NOT BETWEEN 1 AND 12 OR distanceMeters<=0 OR targetDiameterMm<=0 OR targetProfileVersion<1 OR (mode='scored' AND (targetSnapshotJson IS NULL OR targetProfileId IS NULL OR targetProfileVersion IS NULL)) LIMIT 1","invalid_block")
        none(j,"SELECT 1 FROM sessions s LEFT JOIN blocks b ON b.sessionId=s.id WHERE b.id IS NULL LIMIT 1","session_without_block")
        none(j,"SELECT 1 FROM ends e JOIN blocks b ON b.id=e.blockId LEFT JOIN session_plans p ON p.sessionId=b.sessionId WHERE e.revision<1 OR e.ordinal<0 OR e.plannedCount NOT BETWEEN 1 AND CASE WHEN p.rolling=1 THEN ${app.fableshot.android.data.journal.MAX_SERIES_ARROWS} ELSE 12 END OR role NOT IN ('scored','warmup') OR state NOT IN ('open','closed') LIMIT 1","invalid_end")
        none(j,"SELECT 1 FROM blocks b JOIN sessions s ON s.id=b.sessionId LEFT JOIN ends e ON e.blockId=b.id WHERE e.id IS NULL AND s.state<>'completed' AND b.ordinal=(SELECT MAX(latest.ordinal) FROM blocks latest WHERE latest.sessionId=s.id) LIMIT 1","block_without_end")
        none(j,"SELECT 1 FROM shots WHERE revision<1 OR inputIndex<0 OR points NOT BETWEEN 0 AND 10 OR automaticPoints NOT BETWEEN 0 AND 10 OR (x IS NULL)!=(y IS NULL) OR physicalArrowNumber<=0 OR scoreSource NOT IN ('target_computed','numeric_entry','manual_edit','imported') OR positionSource NOT IN ('manual_target','manual_photo','imported','none') OR positionStatus NOT IN ('known','unknown','unverified') OR (positionStatus='unknown' AND x IS NOT NULL) OR (positionStatus IN ('known','unverified') AND (x IS NULL OR positionSource='none')) OR (zoneCode IS NOT NULL AND zoneCode<>CASE WHEN points=0 THEN 'M' ELSE CAST(points AS TEXT) END AND NOT(zoneCode='X' AND points=10)) LIMIT 1","invalid_shot")
        none(j,"SELECT 1 FROM shots s JOIN ends e ON e.id=s.endId JOIN blocks b ON b.id=e.blockId WHERE b.mode<>'scored' LIMIT 1","shot_in_count_mode")
        none(j,"SELECT 1 FROM shots WHERE shaftDiameterMm NOT BETWEEN 1 AND 20 OR (shaftDiameterMm IS NOT NULL AND (positionStatus<>'known' OR x IS NULL)) LIMIT 1","invalid_shaft_diameter")
        none(j,"SELECT 1 FROM shots GROUP BY endId HAVING MIN(inputIndex)<>0 OR MAX(inputIndex)<>COUNT(*)-1 LIMIT 1","invalid_shot_order")
        none(j,"SELECT 1 FROM unscored_counts c JOIN ends e ON e.id=c.endId JOIN blocks b ON b.id=e.blockId WHERE c.revision<1 OR c.count<0 OR c.count>e.plannedCount OR b.mode<>'count_only' LIMIT 1","invalid_count")
        none(j,"SELECT 1 FROM ends e JOIN shots s ON s.endId=e.id GROUP BY e.id HAVING COUNT(*)>e.plannedCount LIMIT 1","overfilled_end")
        none(j,"SELECT 1 FROM mutation_receipts WHERE resultRevision<1 OR length(payloadHash)<>64 OR length(kind)=0 LIMIT 1","invalid_receipt")
        none(j,"SELECT 1 FROM diary_notes WHERE revision<1 OR length(body)>8000 OR length(place)>120 OR length(feeling)>240 OR length(conditions)>500 OR (blockId IS NOT NULL AND sessionId IS NULL) OR (endId IS NOT NULL AND blockId IS NULL) LIMIT 1","invalid_diary_note")
        none(j,"SELECT 1 FROM diary_notes n JOIN blocks b ON b.id=n.blockId WHERE n.sessionId<>b.sessionId LIMIT 1","invalid_note_block_link")
        none(j,"SELECT 1 FROM diary_notes n JOIN ends e ON e.id=n.endId WHERE n.blockId<>e.blockId LIMIT 1","invalid_note_end_link")
        j.query("SELECT localDate,tagsJson,body,place,feeling,conditions FROM diary_notes").use { c ->while(c.moveToNext()) {
            check()
            val limits=listOf(8000,120,240,500)
            if((2..5).any {c.getString(it).length>limits[it-2]})throw ArchiveInvalid("invalid_diary_note")
            val tags=try {app.fableshot.android.data.journal.NoteTags.decode(c.getString(1))}catch(_:Exception){throw ArchiveInvalid("invalid_note_tags")}
            if(runCatching {LocalDate.parse(c.getString(0)).toString()==c.getString(0)}.getOrDefault(false)!=true)throw ArchiveInvalid("invalid_note_date")
            if(tags.isEmpty() && (2..5).all {c.getString(it).isBlank()})throw ArchiveInvalid("empty_diary_note")
        } }
        val disciplines=app.fableshot.android.data.journal.rankDisciplines.keys.joinToString(",") { "'$it'" }
        val levels=app.fableshot.android.data.journal.rankLevels.joinToString(",") { "'$it'" }
        none(j,"SELECT 1 FROM rank_assignments WHERE revision<1 OR discipline NOT IN ($disciplines) OR category NOT IN ('male','female') OR level NOT IN ($levels) OR current NOT IN (0,1) OR length(issuedBy)>120 OR length(reference)>500 OR (deletedAtMs IS NOT NULL AND current<>0) LIMIT 1","invalid_rank_assignment")
        none(j,"SELECT 1 FROM rank_assignments WHERE current=1 AND deletedAtMs IS NULL GROUP BY discipline,category HAVING COUNT(*)>1","multiple_current_rank_assignments")
        j.query("SELECT assignedOn FROM rank_assignments WHERE assignedOn IS NOT NULL").use { c ->
            while(c.moveToNext()) {
                check()
                if(runCatching {LocalDate.parse(c.getString(0)).toString()==c.getString(0)}.getOrDefault(false)!=true)
                    throw ArchiveInvalid("invalid_rank_assignment_date")
            }
        }
        none(j,"SELECT 1 FROM import_batches WHERE source<>'mytargets' OR status<>'committed' OR length(fileHash)<>64 LIMIT 1","invalid_import_batch")
        none(j,"SELECT 1 FROM imported_groups WHERE firstRecord<1 OR lastRecord<firstRecord OR length(rawFingerprint)<>64 LIMIT 1","invalid_import_group")
        none(j,"SELECT 1 FROM imported_rows r JOIN imported_groups g ON g.id=r.groupId WHERE r.batchId<>g.batchId OR r.sourceRecord<g.firstRecord OR r.sourceRecord>g.lastRecord LIMIT 1","invalid_import_row_relationship")
        // Missing shot IDs in imported_rows are deliberate durable deduplication markers.
        j.query("SELECT localDate,timeZoneId FROM sessions").use{c->while(c.moveToNext()){check();try{if(!c.isNull(0))LocalDate.parse(c.getString(0));if(!c.isNull(1))ZoneId.of(c.getString(1))}catch(_:Exception){throw ArchiveInvalid("invalid_session_date")}}}
        for((table,columns)in listOf("blocks" to listOf("targetSnapshotJson","equipmentSnapshotJson"),"imported_groups" to listOf("mappingJson","endFingerprintsJson"))) {
            j.query("SELECT ${columns.joinToString()} FROM `$table`").use{c->while(c.moveToNext()){check();for(i in columns.indices)if(!c.isNull(i)){val json=ArchiveJson.parse(c.getString(i));if(columns[i]=="endFingerprintsJson"){if(json !is List<*>||json.any{it !is String||!Regex("[0-9a-f]{64}").matches(it)})throw ArchiveInvalid("invalid_source_fingerprints")}else json.jsonObject()}}}
        }
        j.query("""SELECT b.targetSnapshotJson,s.scoreSource,se.sourceKind,
            EXISTS(SELECT 1 FROM imported_rows r WHERE r.shotId=s.id)
            FROM shots s JOIN ends e ON e.id=s.endId JOIN blocks b ON b.id=e.blockId
            JOIN sessions se ON se.id=b.sessionId WHERE s.zoneCode='X'""").use { cursor ->
            while (cursor.moveToNext()) {
                check()
                val target = ArchiveJson.parse(cursor.getString(0)).jsonObject()
                val original = target["sourceTargetSnapshot"] as? Map<*, *>
                val retainedImportedX = cursor.getString(1) == "imported" && cursor.getString(2) == "mytargets" &&
                    cursor.getInt(3) == 1 && original?.get("supportsX") == true &&
                    original?.get("scoringRuleVersion") == "mytargets-source-scores-v1"
                if (target["supportsX"] != true && !retainedImportedX) throw ArchiveInvalid("unsupported_x_zone")
            }
        }
        none(e,"SELECT 1 FROM equipment_items WHERE revision<1 OR length(id)=0 OR trim(name)='' OR kind NOT IN ('bow','arrows','setup') OR favorite NOT IN (0,1) OR archived NOT IN (0,1) OR (favorite=1 AND archived=1) OR drawWeightLb<=0 OR drawLengthIn<=0 OR spine<=0 OR lengthMm<=0 OR massGrain<=0 OR diameterMm<=0 OR numberedCount NOT BETWEEN 1 AND 1000 OR (kind<>'setup' AND (bowId IS NOT NULL OR arrowsId IS NOT NULL)) OR (category IS NOT NULL AND (kind<>'bow' OR category NOT IN ('barebow','recurve','compound','traditional','longbow','other'))) LIMIT 1","invalid_equipment")
        none(e,"SELECT 1 FROM equipment_items s LEFT JOIN equipment_items b ON b.id=s.bowId LEFT JOIN equipment_items a ON a.id=s.arrowsId WHERE (s.bowId IS NOT NULL AND (b.id IS NULL OR b.kind<>'bow')) OR (s.arrowsId IS NOT NULL AND (a.id IS NULL OR a.kind<>'arrows')) LIMIT 1","broken_equipment_relationship")
        none(e,"SELECT 1 FROM equipment_items i LEFT JOIN equipment_revisions r ON r.itemId=i.id AND r.revision=i.revision WHERE r.itemId IS NULL LIMIT 1","missing_equipment_revision")
        none(e,"SELECT 1 FROM equipment_revisions r LEFT JOIN equipment_items i ON i.id=r.itemId WHERE i.id IS NULL OR r.revision<1 OR r.revision>i.revision LIMIT 1","invalid_equipment_revision")
        e.query("SELECT itemId,revision,snapshotJson FROM equipment_revisions").use{c->while(c.moveToNext()){check();val snapshot=ArchiveJson.parse(c.getString(2)).jsonObject();if(snapshot["id"]!=c.getString(0)||snapshot["revision"]!=c.getLong(1))throw ArchiveInvalid("equipment_snapshot_mismatch")}}
        none(j,"SELECT 1 FROM session_plans WHERE rolling NOT IN (0,1) OR plannedEnds NOT BETWEEN CASE WHEN rolling=1 THEN 0 ELSE 1 END AND 200 OR roundCount NOT BETWEEN 1 AND 20 OR plannedEnds % roundCount <> 0 OR (roundArrowLimit IS NOT NULL AND (rolling<>1 OR plannedEnds<>0 OR roundCount<>1 OR roundArrowLimit NOT BETWEEN 1 AND ${app.fableshot.android.data.journal.MAX_SERIES_ARROWS})) LIMIT 1","invalid_session_plan")
        j.query("SELECT targetProfileId,targetProfileVersion,targetDiameterMm,targetSnapshotJson FROM blocks WHERE mode='scored'").use{c->while(c.moveToNext()){
            check();if(app.fableshot.android.domain.TargetCatalog.find(c.getString(0))!=null&&app.fableshot.android.data.journal.verifiedTarget(c.getString(0),c.getInt(1),c.getInt(2),c.getString(3))==null)throw ArchiveInvalid("invalid_target_geometry")
        }}
        j.query("SELECT s.points,b.targetProfileId FROM shots s JOIN ends e ON e.id=s.endId JOIN blocks b ON b.id=e.blockId").use{c->while(c.moveToNext()){
            check();val profile=app.fableshot.android.domain.TargetCatalog.find(c.getString(1));if(profile!=null&&c.getInt(0) !in profile.values)throw ArchiveInvalid("unsupported_target_score")
        }}
        validateShaftGeometry(j,check)
        none(j,"SELECT 1 FROM technique_documents WHERE archived NOT IN (0,1) OR isPrimary NOT IN (0,1) OR (archived=1 AND isPrimary=1) LIMIT 1","invalid_technique_document")
        none(j,"SELECT 1 FROM technique_documents WHERE isPrimary=1 LIMIT 1 OFFSET 1","multiple_primary_techniques")
        none(j,"SELECT 1 FROM technique_documents d WHERE isPrimary=1 AND NOT EXISTS(SELECT 1 FROM technique_versions v WHERE v.documentId=d.id) LIMIT 1","unpublished_primary_technique")
        none(j,"SELECT 1 FROM technique_versions WHERE number<1 LIMIT 1","invalid_technique_version")
        none(j,"SELECT 1 FROM technique_versions GROUP BY documentId HAVING MIN(number)<>1 OR MAX(number)<>COUNT(*) LIMIT 1","invalid_technique_version_order")
        none(j,"SELECT 1 FROM technique_uses WHERE sequence<1 OR blockOrdinal<0 OR endOrdinal<0 OR length(focus1)>200 OR length(focus2)>200 OR length(worked)>4000 OR length(question)>4000 OR revision<1 OR rating NOT IN ('yes','unstable','untracked') LIMIT 1","invalid_technique_use")
        for((table,column) in listOf("technique_documents" to "draftJson","technique_versions" to "payloadJson"))j.query("SELECT `$column` FROM `$table`").use{c->while(c.moveToNext()){check();try{app.fableshot.android.technique.TechniqueText.parse(c.getString(0),table=="technique_documents")}catch(_:Exception){throw ArchiveInvalid("invalid_technique_payload")}}}
        validateBaselines(j,check)
    }
    private fun validateShaftGeometry(db:SupportSQLiteDatabase,check:()->Unit) {
        db.query("""SELECT s.x,s.y,s.shaftDiameterMm,s.points,s.zoneCode,s.automaticPoints,s.automaticRuleVersion,
            s.scoreSource,b.targetProfileId,b.targetProfileVersion,b.targetDiameterMm,b.targetSnapshotJson
            FROM shots s JOIN ends e ON e.id=s.endId JOIN blocks b ON b.id=e.blockId
            WHERE s.shaftDiameterMm IS NOT NULL""").use { cursor -> while(cursor.moveToNext()) {
            check()
            val profile=app.fableshot.android.data.journal.verifiedTarget(cursor.getString(8),cursor.getInt(9),
                cursor.getInt(10),cursor.getString(11)) ?: throw ArchiveInvalid("invalid_shaft_geometry")
            val diameter=cursor.getDouble(2)
            val x=cursor.getDouble(0);val y=cursor.getDouble(1)
            if(!app.fableshot.android.domain.ArrowShaft.validDiameter(diameter)||!x.isFinite()||!y.isFinite())
                throw ArchiveInvalid("invalid_shaft_geometry")
            val zone=profile.scoreShaft(app.fableshot.android.domain.TargetPoint(x,y),diameter,cursor.getInt(10))
            if(cursor.isNull(5)||cursor.getInt(5)!=zone.points||cursor.getString(6)!=profile.shaftRuleVersion ||
                (cursor.getString(7)=="target_computed" && (cursor.getInt(3)!=zone.points||cursor.getString(4)!=zone.code)))
                throw ArchiveInvalid("invalid_shaft_score")
        }}
    }
    private fun validateBaselines(db:SupportSQLiteDatabase,check:()->Unit) {
        db.query("SELECT * FROM progress_baselines").use{c->while(c.moveToNext()){
            check()
            fun str(name:String)=c.getString(c.getColumnIndexOrThrow(name))
            fun long(name:String)=c.getLong(c.getColumnIndexOrThrow(name))
            val status=str("status");val raw=c.getColumnIndexOrThrow("conditionsJson");val maxColumn=c.getColumnIndexOrThrow("maximumPerArrow");val cutoffColumn=c.getColumnIndexOrThrow("sessionStartCutoffMs")
            if(str("policyVersion")!="progress-pg1-v1"||status !in setOf("ready","building","unknown_conditions"))throw ArchiveInvalid("invalid_progress_policy")
            val sources=ArchiveJson.parse(str("sourceSessionsJson")) as? List<*>?:throw ArchiveInvalid("invalid_progress_sources")
            if(sources.size>5)throw ArchiveInvalid("invalid_progress_sources")
            var count=0L;var sum=0L;val ids=mutableSetOf<String>()
            for(value in sources){val s=value.jsonObject();s.exactKeys(setOf("sessionId","revision","title","count","sum","startedAtMs","completedAtMs","sourceKind"))
                if(!ids.add(s.string("sessionId"))||s.string("sessionId").isBlank()||s.long("revision")<1||s.long("count")<12||s.long("count")>Int.MAX_VALUE||s.long("sum") !in 0..s.long("count")*10||s.long("completedAtMs")>=long("sessionStartCutoffMs"))throw ArchiveInvalid("invalid_progress_source")
                count+=s.long("count");sum+=s.long("sum")
            }
            if(count!=long("scoredCount")||sum!=long("scoreSum")||count>Int.MAX_VALUE||(!c.isNull(cutoffColumn)&&long("frozenAtMs")<long("sessionStartCutoffMs")))throw ArchiveInvalid("invalid_progress_aggregate")
            if(status=="unknown_conditions"){if(sources.isNotEmpty()||!c.isNull(raw)||!c.isNull(maxColumn))throw ArchiveInvalid("invalid_progress_unknown")}
            else {
                if(c.isNull(raw)||c.isNull(cutoffColumn)||c.isNull(maxColumn)||long("maximumPerArrow")!=10L||(status=="ready")!=(sources.size>=3))throw ArchiveInvalid("invalid_progress_state")
                val conditions=ArchiveJson.parse(str("conditionsJson")).jsonObject()
                db.query("SELECT sessionId FROM blocks WHERE id=?",arrayOf(str("blockId"))).use{block->if(!block.moveToFirst()||block.getString(0) in ids)throw ArchiveInvalid("progress_includes_current_session")}
                conditions.exactKeys(setOf("distanceMeters","diameterMm","profileId","profileVersion","geometry","rule","maximumPerArrow","bowCategory"))
                val profile=app.fableshot.android.domain.TargetCatalog.find(conditions["profileId"] as? String)?:throw ArchiveInvalid("invalid_progress_conditions")
                if(conditions["maximumPerArrow"]!=10L||conditions["profileVersion"]!=1L||conditions["geometry"]!="single-circle-main"||conditions["rule"]!=profile.rule||conditions["bowCategory"] !in app.fableshot.android.data.EquipmentRepository.BOW_CATEGORIES)throw ArchiveInvalid("invalid_progress_conditions")
            }
        }}
    }
}

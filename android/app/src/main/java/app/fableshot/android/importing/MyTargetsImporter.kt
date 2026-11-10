package app.fableshot.android.importing

import androidx.room.withTransaction
import app.fableshot.android.data.EquipmentDatabase
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.GZIPOutputStream

data class ImportBlockMapping(val key:String,val distanceMeters:Double?,val diameterMm:Int?,val arrowsPerEnd:Int,val scaleConfirmed:Boolean,val equipmentSnapshotJson:String?=null,val bowCategory:String?=null) {
    fun json()=JSONObject().apply{put("key",key);put("distanceMeters",distanceMeters?:JSONObject.NULL);put("diameterMm",diameterMm?:JSONObject.NULL);put("arrowsPerEnd",arrowsPerEnd);put("scaleConfirmed",scaleConfirmed);put("equipmentSnapshotJson",equipmentSnapshotJson?:JSONObject.NULL);put("bowCategory",bowCategory?:JSONObject.NULL)}
}
data class ImportChoice(val groupKey:String,val endKeys:Set<String>,val mappings:List<ImportBlockMapping>,val acceptAmbiguousBoundary:Boolean=false,val allowPossibleDuplicate:Boolean=false)
data class ImportInventory(val alreadyRecords:Set<Int>,val possibleEndFingerprints:Set<String>,val trashedSessionIds:List<String> = emptyList())
data class ImportResult(val batchId:String,val sessionIds:List<String>,val shotCount:Int,val replayed:Boolean)
data class ImportUndoItem(val id:String,val title:String,val revision:Long,val edited:Boolean,val trashed:Boolean)
data class ImportUndoPlan(val items:List<ImportUndoItem>)
class ImportRejected(val code:String):IllegalArgumentException(code)

fun suggestedMapping(block:MyTargetsBlock)=ImportBlockMapping(block.key,block.conditions.distanceMeters,block.conditions.diameterMm,
    block.conditions.sourceArrowsPerEnd?:block.ends.maxOfOrNull{it.shotCount}?:3,
    block.conditions.scaleVerified||block.conditions.target.startsWith("WA Full"),
    block.conditions.sourceEquipmentSnapshotJson,block.conditions.sourceBowCategory)
fun suggestedMappings(group:MyTargetsGroup)=group.blocks.map(::suggestedMapping)

/** Raw source + provenance + scored facts. No import is performed on construction or preview. */
class MyTargetsImporter(private val db:JournalDatabase,private val filesRoot:File,private val stagingRoot:File,private val gate:app.fableshot.android.data.WriteGate=app.fableshot.android.data.WriteGate(),private val equipmentDb:EquipmentDatabase?=null,private val now:()->Long=System::currentTimeMillis) {
    private val dao=db.importDao();private val journal=db.journalDao()
    private fun uuid()=UUID.randomUUID().toString()
    private fun digest(text:String)=MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).hex()
    private fun ByteArray.hex()=joinToString(""){"%02x".format(it)}
    private fun reject(code:String):Nothing=throw ImportRejected(code)
    suspend fun normalizeImportedTargets(): Int = gate.write {
        normalizeImportedTargets(db, filesRoot, stagingRoot)
    }
    suspend fun restoreImportedEquipment(): Int = gate.write {
        val equipment = equipmentDb ?: return@write 0
        withContext(Dispatchers.IO) {
            val staged = MyTargetsEquipmentImport(equipment.equipmentDao().all(), now())
            val links = mutableMapOf<String, String>()
            var committed = false
            try {
                val linked = db.withTransaction {
                    var count = 0
                    for (group in dao.groups()) {
                        val detail = journal.details(group.sessionId) ?: continue
                        if (detail.session.sourceKind != "mytargets") continue
                        for (part in detail.blocks) {
                            val block = part.block
                            val raw = block.equipmentSnapshotJson ?: continue
                            if (block.revision != 1L) continue
                            val source = JSONObject(raw)
                            if (source.optJSONObject("selection")?.optString("kind") != "source") continue
                            val snapshot = staged.link(raw)
                            if (snapshot == raw) continue
                            db.openHelper.writableDatabase.execSQL(
                                "UPDATE blocks SET equipmentSnapshotJson=? WHERE id=? AND revision=1 AND equipmentSnapshotJson=?",
                                arrayOf(snapshot, block.id, raw),
                            )
                            links[block.id] = snapshot
                            count++
                        }
                    }
                    staged.publish(equipment)
                    count
                }
                committed = true
                linked
            } finally {
                if (!committed) withContext(NonCancellable + Dispatchers.IO) {
                    val referenced = links.any { (id, snapshot) ->
                        db.openHelper.writableDatabase.query(
                            "SELECT 1 FROM blocks WHERE id=? AND equipmentSnapshotJson=?",
                            arrayOf(id, snapshot),
                        ).use { it.moveToFirst() }
                    }
                    if (!referenced) staged.rollBackNewCards(equipment)
                }
            }
        }
    }
    suspend fun stage(input:InputStream):File=withContext(Dispatchers.IO) {
        stagingRoot.mkdirs();val target=File(stagingRoot,"${uuid()}.csv");val context=currentCoroutineContext()
        try{input.use{source->FileOutputStream(target).use{output->var total=0L;val buffer=ByteArray(8192);while(true){context.ensureActive();val count=source.read(buffer);if(count<0)break;total+=count;if(total>MyTargetsReader.MAX_BYTES)reject("file_too_large");output.write(buffer,0,count)};output.fd.sync()}};target}
        catch(e:Exception){target.delete();throw e}
    }
    suspend fun analyze(file:File,grouping:MyTargetsGrouping=MyTargetsGrouping()):MyTargetsPreview=withContext(Dispatchers.IO){
        if(file.canonicalFile.parentFile!=stagingRoot.canonicalFile||!file.isFile)reject("invalid_staging_file")
        val context=currentCoroutineContext();readSource(file,grouping,{context.ensureActive()})
    }
    private suspend fun readSource(file:File,grouping:MyTargetsGrouping,check:()->Unit,onRow:suspend(MyTargetsRow)->Unit={}):MyTargetsPreview =
        if(MyTargetsArchiveReader.isArchive(file))MyTargetsArchiveReader.read(file,stagingRoot,grouping,check,onRow)
        else MyTargetsReader.read(file.inputStream(),grouping,check,onRow)
    suspend fun resultForOperation(operationId:String):ImportResult? {
        val receipt=journal.receipt(operationId)?.takeIf{it.kind=="import_mytargets"}?:return null
        val groups=dao.operationGroups(operationId)
        return ImportResult(receipt.resultId,groups.map{it.sessionId},groups.sumOf{g->dao.rows(g.batchId).count{it.groupId==g.id}},true)
    }
    suspend fun inventory(preview:MyTargetsPreview):ImportInventory {
        val batch=dao.batch(preview.fileHash)
        val rows=if(batch==null)emptySet()else dao.rows(batch.id).map{it.sourceRecord}.toSet()
        val groups=dao.groups()
        val known=knownFingerprints(groups)
        val trashed=groups.filter{it.batchId==batch?.id}.mapNotNull{journal.session(it.sessionId)}.filter{it.deletedAtMs!=null}.map{it.id}
        val possible=preview.groups.flatMap { it.blocks }.flatMap { it.ends }.filter { overlaps(it,known) }.map { it.fingerprint }.toSet()
        return ImportInventory(rows,possible,trashed)
    }
    private suspend fun knownFingerprints(groups:List<ImportedGroup>):Set<String> {
        val known=groups.flatMap { group ->
            val array=JSONArray(group.endFingerprintsJson)
            (0 until array.length()).map { array.getString(it) }
        }.toMutableSet()
        // Older CSV imports only stored raw fingerprints. Derive overlap warnings from their
        // durable source timestamp and stored conditions, without changing their diary facts.
        val sources=groups.map { it.batchId }.distinct().flatMap { dao.endSources(it) }.associateBy { it.endId }
        for(group in groups) {
            val detail=journal.details(group.sessionId)?:continue
            for(block in detail.blocks) {
                val target=runCatching { JSONObject(block.block.targetSnapshotJson!!).optString("rawTargetLabel") }.getOrDefault("")
                val equipment=runCatching { JSONObject(block.block.equipmentSnapshotJson!!) }.getOrNull()
                val conditions=MyTargetsConditions("","",target,equipment?.optJSONObject("bow")?.optString("name").orEmpty(),
                    equipment?.optJSONObject("arrows")?.optString("name").orEmpty(),block.block.distanceMeters,block.block.targetDiameterMm)
                for(end in block.ends) {
                    val timestamp=sources[end.end.id]?.rawTimestamp?:continue
                    MyTargetsOverlap.fingerprint(detail.session.title,detail.session.localDate.orEmpty(),conditions,timestamp)?.let { known.add(it) }
                }
            }
        }
        return known
    }
    private fun overlaps(end:MyTargetsEnd,known:Set<String>)=end.fingerprint in known||end.overlapFingerprint?.let { it in known }==true
    suspend fun undoPlan(importOperation:String):ImportUndoPlan=ImportUndoPlan(dao.operationGroups(importOperation).mapNotNull{group->journal.session(group.sessionId)}.map{ImportUndoItem(it.id,it.title,it.revision,it.revision>1&&it.deletedAtMs==null,it.deletedAtMs!=null)})
    suspend fun undoApplied(operation:String)=journal.receipt(operation)?.kind=="undo_import"
    suspend fun undo(importOperation:String,plan:ImportUndoPlan,allowEdited:Boolean,operationId:String=uuid()):List<String> = gate.write { db.withTransaction {
        if(operationId.isBlank()||operationId.length>128||plan.items.map{it.id}.distinct().size!=plan.items.size)reject("invalid_operation_id")
        val payload=digest(importOperation+"|"+plan.items.sortedBy{it.id}.joinToString{"${it.id}:${it.revision}"}+"|"+allowEdited)
        journal.receipt(operationId)?.let{receipt->if(receipt.kind!="undo_import"||receipt.payloadHash!=payload)reject("operation_reused");return@withTransaction dao.operationGroups(importOperation).map{it.sessionId}}
        val groups=dao.operationGroups(importOperation);val ids=groups.map{it.sessionId}.toSet()
        if(ids.isEmpty()||ids!=plan.items.map{it.id}.toSet())reject("undo_source_changed")
        val expected=plan.items.associate{it.id to it.revision}
        val sessions=ids.map{journal.session(it)?:reject("undo_source_changed")}
        if(sessions.any{it.revision!=expected[it.id]})reject("undo_source_changed")
        if(!allowEdited&&sessions.any{it.revision>1&&it.deletedAtMs==null})reject("edited_since_import")
        val instant=now()
        for(session in sessions)if(session.deletedAtMs==null)journal.update(session.copy(deletedAtMs=instant,state=if(session.state=="active")"paused"else session.state,revision=session.revision+1))
        journal.insert(MutationReceipt(operationId,sessions.first().id,"undo_import",payload,importOperation,1,instant))
        ids.toList()
    }
    }
    suspend fun commit(source:File,expectedHash:String,choices:List<ImportChoice>,grouping:MyTargetsGrouping=MyTargetsGrouping(),sourceName:String?=null,operationId:String=uuid(),onProgress:(Int)->Unit={}):ImportResult=gate.write { withContext(Dispatchers.IO) {
        if(source.canonicalFile.parentFile!=stagingRoot.canonicalFile||!source.isFile)reject("invalid_staging_file")
        if(operationId.isBlank()||operationId.length>128)reject("invalid_operation_id")
        val context=currentCoroutineContext()
        val preview=readSource(source,grouping,{context.ensureActive()})
        if(preview.fileHash!=expectedHash)reject("source_changed")
        if(choices.isEmpty()||choices.map{it.groupKey}.distinct().size!=choices.size)reject("empty_or_duplicate_selection")
        val requested=choices.sortedBy{it.groupKey}
        val payload=JSONObject().apply{
            put("fileHash",expectedHash);put("split",JSONArray(grouping.splitBeforeRecords.sorted()));put("join",JSONArray(grouping.joinBeforeRecords.sorted()))
            put("choices",JSONArray(requested.map{choice->JSONObject().apply{put("group",choice.groupKey);put("ends",JSONArray(choice.endKeys.sorted()));put("mappings",JSONArray(choice.mappings.sortedBy{it.key}.map{it.json()}));put("acceptBoundary",choice.acceptAmbiguousBoundary);put("allowDuplicate",choice.allowPossibleDuplicate)}}))
        }.toString()
        val requestHash=digest(payload)
        val selected=mutableMapOf<String,Triple<MyTargetsGroup,ImportChoice,List<MyTargetsEnd>>>()
        val knownGroups=preview.groups.associateBy{it.key}
        for(choice in requested) {
            val group=knownGroups[choice.groupKey]?:reject("group_missing")
            if(group.ambiguousBoundary&&!choice.acceptAmbiguousBoundary)reject("ambiguous_boundary")
            val ends=group.blocks.flatMap{it.ends}.filter{it.key in choice.endKeys}
            if(ends.isEmpty()||ends.size!=choice.endKeys.size)reject("invalid_end_selection")
            if(group.issues.any{issue->issue.blocking&&ends.any{issue.record in it.firstRecord..it.lastRecord}})reject("invalid_selected_rows")
            val mappings=choice.mappings.associateBy{it.key}
            for(block in group.blocks.filter{b->b.ends.any{it.key in choice.endKeys}}) {
                val mapping=mappings[block.key]?:reject("mapping_missing")
                if(!mapping.scaleConfirmed||mapping.arrowsPerEnd !in 1..12||mapping.distanceMeters?.let{!it.isFinite()||it<=0}==true||mapping.diameterMm?.let{it<=0}==true)reject("invalid_mapping")
                if(block.ends.any{it.key in choice.endKeys&&it.shotCount>mapping.arrowsPerEnd})reject("plan_smaller_than_series")
                if(mapping.equipmentSnapshotJson!=null)try{
                    val snapshot=JSONObject(mapping.equipmentSnapshotJson)
                    if(snapshot.optInt("schema")!=1)reject("invalid_equipment_snapshot")
                    val category=snapshot.optJSONObject("bow")?.optString("category")?.takeIf{it.isNotBlank()&&it!="null"}
                    if(category!=null&&mapping.bowCategory!=null&&category!=mapping.bowCategory)reject("equipment_category_conflict")
                }catch(_:org.json.JSONException){reject("invalid_equipment_snapshot")}
                if(mapping.bowCategory!=null&&mapping.bowCategory !in app.fableshot.android.data.EquipmentRepository.BOW_CATEGORIES)reject("invalid_bow_category")
            }
            selected[group.key]=Triple(group,choice,ends)
        }
        val candidateBatch=uuid();val rawDirectory=File(filesRoot,"imports").apply{mkdirs()}
        val candidate=File(rawDirectory,"$candidateBatch.csv.gz")
        val existing=dao.batch(expectedHash)
        if(existing==null) {
            val temporary=File(rawDirectory,"$candidateBatch.tmp")
            try {
                val sourceDigest=MessageDigest.getInstance("SHA-256")
                FileOutputStream(temporary).use{output->GZIPOutputStream(output).use{gzip->DigestInputStream(source.inputStream(),sourceDigest).use{input->val buffer=ByteArray(8192);while(true){context.ensureActive();val n=input.read(buffer);if(n<0)break;gzip.write(buffer,0,n)}};gzip.finish();gzip.flush();output.fd.sync()}}
                if(sourceDigest.digest().hex()!=expectedHash)reject("source_changed")
                if(!temporary.renameTo(candidate))reject("source_copy_failed")
            }finally{temporary.delete()}
        } else if(!File(filesRoot,existing.rawSourcePath).canonicalFile.let{it.parentFile==rawDirectory.canonicalFile&&it.isFile})reject("preserved_source_missing")
        var importedEquipment: MyTargetsEquipmentImport? = null
        try {
            db.withTransaction {
                journal.receipt(operationId)?.let{receipt->
                    if(receipt.kind!="import_mytargets"||receipt.payloadHash!=requestHash)reject("operation_reused")
                    val groups=dao.operationGroups(operationId)
                    return@withTransaction ImportResult(receipt.resultId,groups.map{it.sessionId},groups.sumOf{g->dao.rows(g.batchId).count{it.groupId==g.id}},true)
                }
                val parserVersion=if(preview.sourceFormat=="zip")MyTargetsArchiveReader.PARSER_VERSION else MyTargetsReader.PARSER_VERSION
                val batch=dao.batch(expectedHash)?:ImportBatch(candidateBatch,"mytargets",expectedHash,parserVersion,now(),sourceName?.take(200),"imports/$candidateBatch.csv.gz","committed").also{dao.insert(it)}
                val previousRows=java.util.TreeSet(dao.rows(batch.id).map{it.sourceRecord})
                val previousFingerprints=knownFingerprints(dao.groups())
                for((_,selection)in selected) {
                    val (_,choice,ends)=selection
                    if(ends.any{end->previousRows.ceiling(end.firstRecord)?.let{it<=end.lastRecord}==true})reject("already_imported_records")
                    if(!choice.allowPossibleDuplicate&&ends.any{overlaps(it,previousFingerprints)})reject("possible_duplicate")
                }
                val sessions=mutableListOf<String>();val endIds=mutableMapOf<String,String>();val groupIds=mutableMapOf<String,String>();val indices=mutableMapOf<String,Int>()
                val mappedProfiles=mutableMapOf<String,app.fableshot.android.domain.TargetProfile>()
                val instant=now()
                if (equipmentDb != null) {
                    importedEquipment = MyTargetsEquipmentImport(equipmentDb.equipmentDao().all(), instant).also {
                        it.include(preview.equipmentCatalog)
                    }
                }
                for((key,selection)in selected) {
                    val (group,choice,ends)=selection;val id=uuid();val groupId=uuid();sessions.add(id);groupIds[key]=groupId
                    journal.insert(JournalSession(id,group.title.trim().ifBlank{"MyTargets"},instant,null,localDate=group.date?.toString(),timeSource=if(group.date==null)"import_unknown"else"source_date_only",state="completed",sourceKind="mytargets"))
                    val mappingJson=JSONObject().apply{put("version","mytargets-mapping-v1");put("blocks",JSONArray(choice.mappings.map{it.json()}));put("endKeys",JSONArray(choice.endKeys.sorted()));put("grouping",JSONObject().put("split",JSONArray(grouping.splitBeforeRecords.sorted())).put("join",JSONArray(grouping.joinBeforeRecords.sorted())));put("allowPossibleDuplicate",choice.allowPossibleDuplicate)}.toString()
                    dao.insert(ImportedGroup(groupId,batch.id,key,group.fingerprint,id,"mytargets-mapping-v1",mappingJson,operationId,ends.minOf{it.firstRecord},ends.maxOf{it.lastRecord},JSONArray(ends.flatMap{listOfNotNull(it.fingerprint,it.overlapFingerprint)}.distinct()).toString()))
                    var ordinal=0
                    for(block in group.blocks) {
                        val included=block.ends.filter{it.key in choice.endKeys};if(included.isEmpty())continue
                        val mapping=choice.mappings.single{it.key==block.key};val blockId=uuid()
                        val native = myTargetsProfile(block.conditions, mapping.diameterMm)
                        val profile=native?.id ?: ("mytargets-source-10-"+digest(block.conditions.target).take(16))
                        val sourceTarget=JSONObject().apply{
                            put("snapshotVersion",1);put("profileId",profile);put("profileVersion",1);put("geometryType","unverified")
                            put("maxPoints",10);put("supportsX",true);put("rawTargetLabel",block.conditions.target)
                            put("scoringRuleVersion","mytargets-source-scores-v1");put("diameterMm",mapping.diameterMm?:JSONObject.NULL)
                            put("sourceTargetId",block.conditions.sourceTargetId?:JSONObject.NULL)
                            put("sourceScoringStyle",block.conditions.sourceScoringStyle?:JSONObject.NULL)
                            if(preview.sourceFormat=="zip") { put("sourceFormat","mytargets-zip-v27");put("sourceRoundKey",block.key) }
                        }.toString()
                        val target = if (native != null) {
                            mappedProfiles[block.key] = native
                            mappedMyTargetsSnapshot(native, requireNotNull(mapping.diameterMm), JSONObject(sourceTarget))
                        } else sourceTarget
                        val sourceEquipment=mapping.equipmentSnapshotJson?.let{json->JSONObject(json).apply{if(mapping.bowCategory!=null){val bow=optJSONObject("bow")?:JSONObject().put("name",block.conditions.bow.takeIf{it.isNotBlank()}?:JSONObject.NULL);bow.put("category",mapping.bowCategory);put("bow",bow)}}.toString()}?:sourceEquipment(block.conditions,mapping.bowCategory)
                        val equipment=importedEquipment?.link(sourceEquipment) ?: sourceEquipment
                        journal.insert(JournalBlock(blockId,id,ordinal++,"scored",mapping.distanceMeters,profile,1,mapping.diameterMm,target,equipment,mapping.arrowsPerEnd))
                        for((index,end)in included.withIndex()) {
                            val endId=uuid();endIds[end.key]=endId;indices[end.key]=0
                            journal.insert(JournalEnd(endId,blockId,index,mapping.arrowsPerEnd,state="closed"))
                            dao.insert(ImportedEndSource(endId,batch.id,end.key,end.number,end.timestamp,end.time?.toString()))
                        }
                    }
                }
                var shots=0
                val expectedShots=selected.values.sumOf{it.third.sumOf(MyTargetsEnd::shotCount)}
                val verified=readSource(source,grouping,{context.ensureActive()}) {row->
                    val endId=endIds[row.endKey]
                    if(endId!=null) {
                        val points=row.points?:reject("invalid_selected_score");val shotId=uuid();val index=indices.getValue(row.endKey)
                        val position = mappedProfiles[row.blockKey]?.let { myTargetsPoint(row, preview.sourceFormat) }
                        journal.insert(JournalShot(shotId,endId,index,points,row.zone,null,null,position?.x?:row.x,position?.y?:row.y,
                            if(position!=null)"main"else null,"imported",if(row.x==null)"none"else"imported",
                            if(position!=null)"known"else row.positionStatus,row.arrowNumber,instant))
                        dao.insert(ImportedRow(batch.id,row.record,shotId,groupIds.getValue(row.groupKey)));indices[row.endKey]=index+1;shots++
                        if(shots%250==0||shots==expectedShots)onProgress(shots)
                    }
                }
                if(verified.fileHash!=expectedHash||shots!=expectedShots)reject("source_changed")
                if (equipmentDb != null) importedEquipment?.publish(equipmentDb)
                journal.insert(MutationReceipt(operationId,sessions.first(),"import_mytargets",requestHash,batch.id,1,instant))
                if(shots>0)app.fableshot.android.data.journal.AchievementEngine(db,gate,now)
                    .serviceInTransaction("APP01",operationId,instant)
                ImportResult(batch.id,sessions,shots,false)
            }
        }finally{
            if (equipmentDb != null && importedEquipment != null) withContext(NonCancellable + Dispatchers.IO) {
                if (journal.receipt(operationId) == null) importedEquipment?.rollBackNewCards(equipmentDb)
            }
            if(candidate.isFile)withContext(NonCancellable+Dispatchers.IO){if(dao.batchById(candidateBatch)==null)candidate.delete()}
        }
    }
    }
    private fun sourceEquipment(c:MyTargetsConditions,category:String?):String=JSONObject().apply {
        put("schema",1);put("selection",JSONObject().put("id",JSONObject.NULL).put("kind","source").put("revision",JSONObject.NULL).put("name",listOf(c.bow,c.arrows).filter{it.isNotBlank()}.joinToString(" · ")))
        put("bow",if(c.bow.isBlank())JSONObject.NULL else JSONObject().put("name",c.bow).put("category",category?:JSONObject.NULL))
        put("arrows",if(c.arrows.isBlank())JSONObject.NULL else JSONObject().put("name",c.arrows))
    }.toString()
}

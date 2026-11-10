package app.fableshot.android

import androidx.datastore.preferences.core.*
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.*
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.importing.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.util.UUID
import java.util.zip.*

class JournalArchiveTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var folder:File
    private lateinit var j:JournalDatabase
    private lateinit var e:EquipmentDatabase
    private lateinit var p:UserPreferences
    private lateinit var scope:CoroutineScope
    private lateinit var archive:JournalArchive
    @Before fun setup()=runBlocking(Dispatchers.IO) {
        folder=File(context.cacheDir,"verification-archive-${UUID.randomUUID()}").apply{mkdirs()}
        j=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build()
        e=Room.inMemoryDatabaseBuilder(context,EquipmentDatabase::class.java).build()
        scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        p=UserPreferences(PreferenceDataStoreFactory.create(scope=scope,produceFile={File(folder,"test.preferences_pb")}))
        archive=JournalArchive(context,j,e,p,File(folder,"files"),File(folder,"staging"))
        p.style(DesignStyle.Pop);p.appearance(Appearance.Dark);p.finishOnboarding("skipped");p.finishTutorial();p.displayName("Лучник 🎯")
        Unit
    }
    @After fun cleanup()=runBlocking(Dispatchers.IO) {
        j.close();e.close();scope.coroutineContext[Job]!!.cancelAndJoin()
        check(folder.canonicalFile.parentFile==context.cacheDir.canonicalFile&&folder.name.startsWith("verification-archive-"));folder.deleteRecursively();Unit
    }
    private suspend fun fixture() {
        val catalog=EquipmentRepository(e){9007199254740993L}
        val bow=catalog.save(EquipmentItem(kind="bow",name="Bow",category="barebow"))
        val arrows=catalog.save(EquipmentItem(kind="arrows",name="Arrows",spine=600))
        val setup=catalog.save(EquipmentItem(kind="setup",name="Setup",bowId=bow.id,arrowsId=arrows.id))
        val repo=JournalRepository(j){9007199254740993L}
        repo.start("Native",BlockPlan(18.0,800,equipmentSnapshotJson=catalog.snapshot(setup.id),plannedEnds=10,roundCount=2,targetProfileId="wa-outdoor-full-v1"))
        var active=repo.active.first()!!
        repo.point(active.currentEnd!!.end.id,app.fableshot.android.domain.TargetPoint(.01,.01))
        repo.numeric(active.currentEnd!!.end.id,0)
        active=repo.active.first()!!;repo.role(active.currentEnd!!.end.id,"warmup",active.currentEnd!!.end.revision)
        active=repo.active.first()!!;repo.startBlock(active.session.id,BlockPlan(null,null,6,"count_only"),active.session.revision,true)
        active=repo.active.first()!!;repo.setCount(active.currentEnd!!.end.id,4,active.currentEnd!!.end.revision)
        active=repo.active.first()!!
        val techniques=app.fableshot.android.technique.TechniqueRepository(j,WriteGate());val docId=techniques.create();val doc=techniques.library.first().single().document;val version=techniques.publish(docId,doc.draftJson,doc.draftJson);techniques.bind(active.session.id,app.fableshot.android.technique.TechniqueSelection(version.id,"Проверяемый фокус"))
        active=repo.active.first()!!;repo.complete(active.session.id,active.session.revision)
        val complete=repo.details(active.session.id)!!
        j.journalDao().insertRecordEvent(PersonalRecordEvent("fixture-record",complete.session.id,"volume",1,"Объём",
            5,6,"removed-previous-session",complete.session.revision,9007199254740993L))
        repo.trash(complete.session.id,complete.session.revision)
        catalog.save(bow.copy(name="New bow name"))
        val input=File(folder,"import-stage").apply{mkdirs()};val csv=File(input,"test.csv")
        InstrumentationRegistry.getInstrumentation().context.assets.open("mytargets-sample.csv").use{source->csv.outputStream().use{source.copyTo(it)}}
        val preview=MyTargetsReader.read(csv.inputStream());val group=preview.groups.single()
        val imported=MyTargetsImporter(j,File(folder,"files"),input).commit(csv,preview.fileHash,listOf(ImportChoice(group.key,group.blocks.flatMap{b->b.ends.map{it.key}}.toSet(),suggestedMappings(group))))
        val shot=repo.details(imported.sessionIds.single())!!.allShots.first();repo.removeShot(shot.id,shot.revision)
        val ranks=RankAssignmentRepository(j)
        ranks.save(RankAssignment(discipline="barebow",level="III",assignedOn="2025-10-10",issuedBy="Fixture club"))
        ranks.save(RankAssignment(discipline="barebow",level="II",assignedOn="2026-10-10",reference="Order fixture"))
        p.saveTrainingPreset(TrainingPreset(name="Indoor fixture",plan=BlockPlan(18.0,400,6,plannedEnds=20,roundCount=2)))
        val notes=DiaryNoteRepository(j)
        notes.save(DiaryNote(body="Standalone observation",tagsJson=NoteTags.encode("focus, club"),place="Test range"))
        notes.save(DiaryNote(sessionId=complete.session.id,blockId=complete.currentBlock!!.block.id,endId=complete.currentEnd!!.end.id,
            body="Series observation",localDate="2026-11-02",feeling="User-entered feeling",conditions="User-entered conditions"))
        val removed=notes.save(DiaryNote(body="Removed observation"));notes.remove(removed)
    }
    private fun rows(db:androidx.sqlite.db.SupportSQLiteDatabase,table:String,excludedColumns:Set<String> = emptySet()):List<String> = db.query("SELECT * FROM `$table`").use{c->
        val columns=(0 until c.columnCount).filterNot {c.getColumnName(it) in excludedColumns}
        buildList{while(c.moveToNext())add(columns.joinToString("|"){i->if(c.isNull(i))"<null>"else c.getString(i)})}.sorted()
    }
    private suspend fun reject(file:File,reason:String?=null) {
        val before=ArchiveEnvelopeVerifier.journalTables.associateWith{rows(j.openHelper.writableDatabase,it)}
        try {archive.prepare(file);fail("Invalid archive accepted")}
        catch(ex:Exception) {
            if(ex is CancellationException)throw ex
            if(reason!=null)assertEquals(reason,(ex as? ArchiveInvalid)?.reason)
        }
        assertEquals(before,ArchiveEnvelopeVerifier.journalTables.associateWith{rows(j.openHelper.writableDatabase,it)})
    }
    private fun rewrite(file:File,path:String,change:(ByteArray)->ByteArray,updateManifest:Boolean=true):File {
        val data=ZipFile(file).use{zip->zip.entries().asSequence().associate{it.name to zip.getInputStream(it).readBytes()}.toMutableMap()}
        val old=ArchiveManifestCodec.decode(data.getValue("manifest.json"));data[path]=change(data.getValue(path))
        if(updateManifest)data["manifest.json"]=ArchiveManifestCodec.encode(old.createdAtMs,old.appVersion,old.rowCounts,old.envelope.payloads.map{payload->if(payload.path==path)ArchivePayload(path,data.getValue(path).size.toLong(),ArchiveEnvelopeVerifier.sha256(data.getValue(path)))else payload})
        val target=File(file.parentFile,"tampered-${UUID.randomUUID()}.fableshot")
        ZipOutputStream(target.outputStream()).use{zip->data.forEach{(name,bytes)->zip.putNextEntry(ZipEntry(name));zip.write(bytes);zip.closeEntry()}}
        return target
    }
    @Test fun completedEmptySessionRoundTripsWithoutInventingASeries()=runBlocking(Dispatchers.IO) {
        val repo=JournalRepository(j);repo.start("Empty completed",BlockPlan(18.0,600));val value=repo.active.first()!!
        repo.complete(value.session.id,value.session.revision)
        val export=archive.export();val prepared=archive.prepare(export.file)
        val restored=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
        try{assertTrue(restored.journalDao().details(value.session.id)!!.blocks.single().ends.isEmpty())}finally{restored.close()}
        Unit
    }
    @Test fun sourceMetadataDoesNotMakeNativeIndoorXValid() = runBlocking(Dispatchers.IO) {
        val repository = JournalRepository(j)
        repository.start("Indoor fixture", BlockPlan(18.0, 400))
        val current = repository.active.first()!!
        repository.numeric(current.currentEnd!!.end.id, 10)
        val details = repository.active.first()!!
        val block = details.blocks.single().block
        val snapshot = org.json.JSONObject(block.targetSnapshotJson!!).apply {
            put("sourceTargetSnapshot", org.json.JSONObject()
                .put("supportsX", true).put("scoringRuleVersion", "mytargets-source-scores-v1"))
        }
        j.openHelper.writableDatabase.execSQL("UPDATE blocks SET targetSnapshotJson=? WHERE id=?",
            arrayOf(snapshot.toString(), block.id))
        j.openHelper.writableDatabase.execSQL("UPDATE shots SET zoneCode='X' WHERE id=?",
            arrayOf(details.allShots.single().id))
        reject(archive.export().file, "unsupported_x_zone")
    }
    @Test fun allFactsSourcesTrashSnapshotsAndHiddenPreferencesSurviveRoundTrip()=runBlocking(Dispatchers.IO) {
        fixture();val exported=archive.export();val prepared=archive.prepare(exported.file)
        val restoredJ=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
        val restoredE=Room.databaseBuilder(context,EquipmentDatabase::class.java,prepared.equipmentFile.absolutePath).build()
        try {
            for(table in ArchiveEnvelopeVerifier.journalTables)assertEquals(table,rows(j.openHelper.writableDatabase,table),rows(restoredJ.openHelper.writableDatabase,table))
            for(table in ArchiveEnvelopeVerifier.equipmentTables)assertEquals(table,rows(e.openHelper.writableDatabase,table),rows(restoredE.openHelper.writableDatabase,table))
            assertEquals("skipped",prepared.preferences.getValue("onboardingDisposition").second)
            assertEquals("Лучник 🎯",prepared.preferences.getValue("displayName").second)
            assertEquals(1L,prepared.manifest.rowCounts.getValue("data/journal/unscored_counts.jsonl"))
            assertEquals(19L,prepared.manifest.rowCounts.getValue("data/journal/shots.jsonl"))
            assertEquals(1L,prepared.manifest.rowCounts.getValue("data/journal/personal_record_events.jsonl"))
            assertEquals(1,File(prepared.directory,"imports").listFiles()!!.size)
            val active=JournalRepository(restoredJ).history.first().single();val sourceBefore=JournalRepository(j).details(active.session.id)!!
            assertEquals(sourceBefore,active)
        } finally{restoredJ.close();restoredE.close();archive.discard(prepared.directory);archive.discard(exported.file)}
        Unit
    }
    @Test fun removingImportedSeriesAndRoundKeepsDeduplicationFactsThroughArchive()=runBlocking(Dispatchers.IO) {
        fixture()
        val repo=JournalRepository(j)
        val imported=repo.history.first().single { it.session.sourceKind=="mytargets" }
        val tombstones=rows(j.openHelper.writableDatabase,"imported_rows")
        val first=imported.trainingRounds().first().ends.first()
        assertTrue(repo.removeEnd(first.end.id,first.end.revision) is JournalWrite.Saved)
        var changed=repo.details(imported.session.id)!!
        assertTrue(changed.allShots.none { shot->first.shots.any { it.id==shot.id } })
        changed.trainingRounds().firstOrNull()?.let { round->
            assertTrue(repo.removeRound(changed.session.id,round.ends.first().end.id,changed.session.revision) is JournalWrite.Saved)
        }
        changed=repo.details(imported.session.id)!!
        assertEquals(tombstones,rows(j.openHelper.writableDatabase,"imported_rows"))
        val exported=archive.export()
        val prepared=archive.prepare(exported.file)
        val restored=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
        try {
            assertEquals(changed,restored.journalDao().details(imported.session.id))
            assertEquals(tombstones,rows(restored.openHelper.writableDatabase,"imported_rows"))
        } finally {restored.close();archive.discard(prepared.directory);archive.discard(exported.file)}
    }

    @Test fun checksummedButInvalidScoreOrLostRelationshipCannotReachLiveDiary()=runBlocking(Dispatchers.IO) {
        fixture();val exported=archive.export()
        reject(rewrite(exported.file,"data/journal/shots.jsonl",{it.toString(Charsets.UTF_8).replaceFirst("\"points\":10","\"points\":99").toByteArray()}))
        reject(rewrite(exported.file,"data/journal/blocks.jsonl",{it.toString(Charsets.UTF_8).replace(Regex("\"sessionId\":\"[^\"]+\""),"\"sessionId\":\"missing\"").toByteArray()}))
        assertEquals(1,File(folder,"staging").listFiles()!!.size);Unit
    }
    @Test fun payloadCorruptionWrongCountsAndNestedSourceCorruptionAreRejected()=runBlocking(Dispatchers.IO) {
        fixture();val exported=archive.export()
        reject(rewrite(exported.file,"data/preferences.json",{it+byteArrayOf(32)},false))
        reject(rewrite(exported.file,"data/journal/shots.jsonl",{byteArrayOf()}))
        val source=exported.manifest.envelope.payloads.single{it.path.startsWith("sources/")}.path
        val fake=java.io.ByteArrayOutputStream();GZIPOutputStream(fake).use{it.write("different CSV".toByteArray())}
        reject(rewrite(exported.file,source,{fake.toByteArray()}));Unit
    }
    @Test fun checksummedRecordEventsRequireARealImprovementAndMatchingRowCount()=runBlocking(Dispatchers.IO) {
        fixture()
        val exported=archive.export()
        val path="data/journal/personal_record_events.jsonl"
        reject(rewrite(exported.file,path,{bytes ->
            (org.json.JSONObject(bytes.toString(Charsets.UTF_8).trim()).put("value",5).toString()+"\n").toByteArray()
        }),"invalid_personal_record_event")
        reject(rewrite(exported.file,path,{bytes ->
            (org.json.JSONObject(bytes.toString(Charsets.UTF_8).trim()).put("value",2147483648L).toString()+"\n").toByteArray()
        }),"invalid_personal_record_event")
        reject(rewrite(exported.file,path,{byteArrayOf()}),"row_count_mismatch")
    }
    @Test fun unknownPreferencesAndExactLongRemainTypedWhileBadKnownSettingsFail()=runBlocking(Dispatchers.IO) {
        val exported=archive.export()
        val changed=rewrite(exported.file,"data/preferences.json",{it.toString(Charsets.UTF_8).replace("\"values\":{","\"values\":{\"futureLong\":{\"type\":\"long\",\"value\":9223372036854775807},").toByteArray()})
        val prepared=archive.prepare(changed);assertEquals(Long.MAX_VALUE,prepared.preferences.getValue("futureLong").second)
        reject(rewrite(exported.file,"data/preferences.json",{it.toString(Charsets.UTF_8).replace("\"pop\"","\"unrecognised\"").toByteArray()}));Unit
    }
    @Test fun openRoundsAndSeriesLongerThanTwelveSurviveArchive()=runBlocking(Dispatchers.IO) {
        val repo=JournalRepository(j)
        val id=(repo.start("Flexible archive",BlockPlan(18.0,600,seriesPerRound=10,flexibleSeries=true)) as JournalWrite.Saved).id
        val end=repo.details(id)!!.currentEnd!!.end
        repeat(13) { assertTrue(repo.numeric(end.id,9) is JournalWrite.Saved) }
        val before=repo.details(id)!!
        val exported=archive.export()
        val prepared=archive.prepare(exported.file)
        val restored=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
        try {
            val copy=restored.journalDao().details(id)!!
            assertEquals(before,copy)
            assertTrue(copy.plans.single().rolling)
            assertEquals(13,copy.currentEnd!!.volume)
        } finally { restored.close();archive.discard(prepared.directory);archive.discard(exported.file) }
    }
    @Test fun numberingChoiceRoundTripsAllThreeStatesAndRejectsNonBooleanSqlValues()=runBlocking(Dispatchers.IO) {
        val repo=JournalRepository(j)
        val choices=listOf<Boolean?>(null,false,true)
        val ids=choices.map { choice ->
            val id=(repo.start("Numbering choice",BlockPlan(18.0,600)) as JournalWrite.Saved).id
            var value=repo.details(id)!!
            assertTrue(repo.numeric(value.currentEnd!!.end.id,9) is JournalWrite.Saved)
            value=repo.details(id)!!
            assertTrue(repo.complete(id,value.session.revision) is JournalWrite.Saved)
            j.journalDao().update(repo.details(id)!!.session.copy(numberedArrows=choice))
            id
        }
        val exported=archive.export()
        assertEquals(14,exported.manifest.envelope.formatVersion)
        assertEquals(16,exported.manifest.envelope.journalSchema)
        val prepared=archive.prepare(exported.file)
        val restored=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
        try {
            assertEquals(choices,ids.map {restored.journalDao().session(it)!!.numberedArrows})
            for(id in ids)assertEquals(repo.details(id),restored.journalDao().details(id))
        } finally {restored.close();archive.discard(prepared.directory)}
        reject(rewrite(exported.file,"data/journal/sessions.jsonl",{data ->
            data.toString(Charsets.UTF_8).lineSequence().filter {it.isNotBlank()}.joinToString("\n",postfix="\n") {
                org.json.JSONObject(it).apply {remove("numberedArrows")}.toString()
            }.toByteArray()
        }))
        for((invalid,reason)in listOf(-1 to "invalid_numbered_arrows",2 to "invalid_numbered_arrows",
            "1" to "invalid_integer_column",1.5 to "invalid_integer_column",true to "invalid_integer_column")) {
            reject(rewrite(exported.file,"data/journal/sessions.jsonl",{data ->
                data.toString(Charsets.UTF_8).lineSequence().filter {it.isNotBlank()}.joinToString("\n",postfix="\n") {
                    org.json.JSONObject(it).put("numberedArrows",invalid).toString()
                }.toByteArray()
            }),reason)
        }
        archive.discard(exported.file)
    }
    @Test fun shaftTouchAndOutsideEdgeRoundTripAndTamperedDiameterOrScoreCannotReachTheDiary()=runBlocking(Dispatchers.IO) {
        val repo=JournalRepository(j)
        val id=(repo.start("Shaft archive",BlockPlan(18.0,400)) as JournalWrite.Saved).id
        val end=repo.details(id)!!.currentEnd!!.end.id
        assertTrue(repo.point(end,app.fableshot.android.domain.TargetPoint(.11,0.0)) is JournalWrite.Saved)
        assertTrue(repo.point(end,app.fableshot.android.domain.TargetPoint(1.015,0.0)) is JournalWrite.Saved)
        val before=repo.details(id)!!
        assertEquals(listOf(10,1),before.allShots.map {it.points})
        assertTrue(before.allShots.all {it.shaftDiameterMm==6.0})
        val exported=archive.export()
        assertEquals(14,exported.manifest.envelope.formatVersion)
        assertEquals(16,exported.manifest.envelope.journalSchema)
        val prepared=archive.prepare(exported.file)
        val restored=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
        try {assertEquals(before,restored.journalDao().details(id))}
        finally {restored.close();archive.discard(prepared.directory)}
        for(diameter in listOf(0,21))reject(rewrite(exported.file,"data/journal/shots.jsonl",{data ->
            data.toString(Charsets.UTF_8).lineSequence().filter {it.isNotBlank()}.joinToString("\n",postfix="\n") {
                org.json.JSONObject(it).put("shaftDiameterMm",diameter).toString()
            }.toByteArray()
        }),"invalid_shaft_diameter")
        reject(rewrite(exported.file,"data/journal/shots.jsonl",{data ->
            data.toString(Charsets.UTF_8).lineSequence().filter {it.isNotBlank()}.joinToString("\n",postfix="\n") {
                org.json.JSONObject(it).apply {if(getInt("points")==10) {put("points",9);put("zoneCode","9")}}.toString()
            }.toByteArray()
        }),"invalid_shaft_score")
        archive.discard(exported.file)
    }

    @Test fun legacyCentreResultAndImportedResultAreRetainedWithoutAnInventedShaft()=runBlocking(Dispatchers.IO) {
        val repo=JournalRepository(j)
        val id=(repo.start("Legacy geometry",BlockPlan(18.0,400)) as JournalWrite.Saved).id
        val end=repo.details(id)!!.currentEnd!!.end.id
        assertTrue(repo.point(end,app.fableshot.android.domain.TargetPoint(.11,0.0)) is JournalWrite.Saved)
        val native=repo.details(id)!!.allShots.single().copy(points=9,zoneCode="9",automaticPoints=9,
            automaticRuleVersion=app.fableshot.android.domain.TargetCatalog.practice.rule,shaftDiameterMm=null)
        j.journalDao().update(native)
        assertTrue(repo.point(end,app.fableshot.android.domain.TargetPoint(.112,0.0)) is JournalWrite.Saved)
        val imported=repo.details(id)!!.allShots.last().copy(points=8,zoneCode="8",scoreSource="imported",positionSource="imported",
            automaticPoints=null,automaticRuleVersion=null,shaftDiameterMm=null)
        j.journalDao().update(imported)
        val before=repo.details(id)!!
        val exported=archive.export();val prepared=archive.prepare(exported.file)
        val restored=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
        try {assertEquals(before,restored.journalDao().details(id))}
        finally {restored.close();archive.discard(prepared.directory);archive.discard(exported.file)}
    }
    @Test fun arrowLimitedPlanAndCompletedEmptyRoundsSurviveArchive()=runBlocking(Dispatchers.IO) {
        val repo=JournalRepository(j)
        val id=(repo.start("Arrow archive",BlockPlan(18.0,400,flexibleSeries=true,roundArrowLimit=5)) as JournalWrite.Saved).id
        val first=repo.details(id)!!.currentEnd!!.end
        repo.numeric(first.id,9)
        var details=repo.details(id)!!
        repo.complete(id,details.session.revision)
        details=repo.details(id)!!
        repo.removeRound(id,first.id,details.session.revision)
        val before=repo.details(id)!!
        assertEquals(5,before.plans.single().roundArrowLimit)
        assertNull(before.currentEnd)
        val exported=archive.export();val prepared=archive.prepare(exported.file)
        val restored=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
        try {assertEquals(before,restored.journalDao().details(id))}
        finally {restored.close();archive.discard(prepared.directory);archive.discard(exported.file)}
    }

    @Test fun allPreviousArchiveFormatsPreserveFactsAndLeaveFutureTablesEmpty()=runBlocking(Dispatchers.IO) {
        fixture()
        // This fixture represents facts written before shaft scoring, including its original rule.
        j.openHelper.writableDatabase.execSQL("UPDATE shots SET shaftDiameterMm=NULL,automaticRuleVersion=REPLACE(automaticRuleVersion,':shaft-v1','')")
        val exported=archive.export()
        for(schema in 3..15) {
            val entries=ZipFile(exported.file).use { zip ->zip.entries().asSequence().associate {it.name to zip.getInputStream(it).readBytes()}.toMutableMap() }
            val required=ArchiveEnvelopeVerifier.requiredPathsFor(schema)
            entries.keys.filter {it.startsWith("data/") && it !in required}.toList().forEach {entries.remove(it)}
            val sessionsPath="data/journal/sessions.jsonl"
            entries[sessionsPath]=entries.getValue(sessionsPath).toString(Charsets.UTF_8).lineSequence().filter {it.isNotBlank()}
                .joinToString("\n",postfix="\n") {org.json.JSONObject(it).apply {if(schema<13)remove("numberedArrows")}.toString()}.toByteArray()
            val endsPath="data/journal/ends.jsonl"
            entries[endsPath]=entries.getValue(endsPath).toString(Charsets.UTF_8).lineSequence().filter {it.isNotBlank()}
                .joinToString("\n",postfix="\n") {org.json.JSONObject(it).apply {if(schema<14)remove("startsRound")}.toString()}.toByteArray()
            val shotsPath="data/journal/shots.jsonl"
            entries[shotsPath]=entries.getValue(shotsPath).toString(Charsets.UTF_8).lineSequence().filter {it.isNotBlank()}
                .joinToString("\n",postfix="\n") {org.json.JSONObject(it).apply {if(schema<15)remove("shaftDiameterMm")}.toString()}.toByteArray()
            val plansPath="data/journal/session_plans.jsonl"
            if(plansPath in entries)entries[plansPath]=entries.getValue(plansPath).toString(Charsets.UTF_8)
                .lineSequence().filter {it.isNotBlank()}.joinToString("\n",postfix="\n") {line ->org.json.JSONObject(line).apply {if(schema<7)remove("roundCount");if(schema<11)remove("rolling");remove("roundArrowLimit")}.toString()}.toByteArray()
            val manifest=org.json.JSONObject(entries.getValue("manifest.json").toString(Charsets.UTF_8))
                .put("formatVersion",schema-2).put("journalSchema",schema)
            val counts=manifest.getJSONObject("rowCounts")
            counts.keys().asSequence().filter {it !in entries}.toList().forEach {counts.remove(it)}
            val payloads=org.json.JSONArray()
            entries.filterKeys {it!="manifest.json"}.forEach { (name,data) ->payloads.put(org.json.JSONObject()
                .put("path",name).put("bytes",data.size.toLong()).put("sha256",ArchiveEnvelopeVerifier.sha256(data))) }
            manifest.put("payloads",payloads);entries["manifest.json"]=manifest.toString().toByteArray()
            val bytes=java.io.ByteArrayOutputStream();ZipOutputStream(bytes).use {zip ->entries.forEach { (name,data) ->zip.putNextEntry(ZipEntry(name));zip.write(data);zip.closeEntry()} }
            val staged=archive.stage(bytes.toByteArray().inputStream());val prepared=archive.prepare(staged)
            val restored=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
            try {
                val oldTables=ArchiveEnvelopeVerifier.journalTablesFor(schema)
                for(table in oldTables) {
                    if(table=="sessions") {
                        assertEquals("schema $schema sessions",rows(j.openHelper.writableDatabase,table,setOf("numberedArrows")),
                            rows(restored.openHelper.writableDatabase,table,setOf("numberedArrows")))
                        restored.openHelper.writableDatabase.query("SELECT numberedArrows FROM sessions").use {c ->while(c.moveToNext())assertTrue(c.isNull(0))}
                    } else if(table=="session_plans" && schema<7) {
                        fun oldPlans(db:androidx.sqlite.db.SupportSQLiteDatabase)=db.query("SELECT sessionId,plannedEnds FROM session_plans ORDER BY sessionId").use {c ->buildList {while(c.moveToNext())add(c.getString(0) to c.getLong(1))} }
                        assertEquals(oldPlans(j.openHelper.writableDatabase),oldPlans(restored.openHelper.writableDatabase))
                        restored.openHelper.writableDatabase.query("SELECT roundCount FROM session_plans").use {c ->while(c.moveToNext())assertEquals(1,c.getInt(0))}
                    }else assertEquals("schema $schema: $table",rows(j.openHelper.writableDatabase,table),rows(restored.openHelper.writableDatabase,table))
                }
                for(table in ArchiveEnvelopeVerifier.journalTables.filterNot {it in oldTables})assertTrue("Invented $table in schema $schema",rows(restored.openHelper.writableDatabase,table).isEmpty())
                restored.openHelper.writableDatabase.query("SELECT shaftDiameterMm FROM shots").use {c ->while(c.moveToNext())assertTrue(c.isNull(0))}
                assertEquals(p.archiveSnapshot().getValue(TrainingPresets.KEY).second,prepared.preferences.getValue(TrainingPresets.KEY).second)
            }finally {restored.close();archive.discard(prepared.directory);archive.discard(staged)}
        }
        archive.discard(exported.file)
    }
    @Test fun cancellationAndMissingSourceNeverProduceSuccessfulBackup()=runBlocking(Dispatchers.IO) {
        fixture();val before=j.journalDao().history().first()
        val source=File(folder,"files/imports").listFiles()!!.single();source.delete()
        try{archive.export();fail("Missing source silently omitted")}catch(e:ArchiveInvalid){assertEquals("missing_import_source",e.reason)}
        assertTrue(File(folder,"staging").listFiles()!!.isEmpty())
        assertEquals(before,j.journalDao().history().first())
        val interrupted=object:java.io.InputStream(){var calls=0;override fun read():Int{if(++calls>10000)throw CancellationException("Interrupted source read");return 65}}
        try{archive.stage(interrupted);fail("Cancelled stage returned success")}catch(_:CancellationException){}
        assertTrue(File(folder,"staging").listFiles()!!.isEmpty());Unit
    }

    @Test fun invalidAssignedRankIsRejectedWithoutChangingLiveFacts()=runBlocking(Dispatchers.IO) {
        fixture();val exported=archive.export()
        reject(rewrite(exported.file,"data/journal/rank_assignments.jsonl",{it.toString(Charsets.UTF_8).replace("\"level\":\"II\"","\"level\":\"not-a-rank\"").toByteArray()}))
    }
    @Test fun invalidNoteDateAndBrokenScopeCannotReachLiveDiary()=runBlocking(Dispatchers.IO) {
        fixture();val exported=archive.export()
        reject(rewrite(exported.file,"data/journal/diary_notes.jsonl",{it.toString(Charsets.UTF_8).replace("2026-11-02","2026-02-30").toByteArray()}))
        reject(rewrite(exported.file,"data/journal/diary_notes.jsonl",{it.toString(Charsets.UTF_8).replace(Regex("\"sessionId\":\"[^\"]+\""),"\"sessionId\":\"missing\"").toByteArray()}))
        reject(rewrite(exported.file,"data/journal/diary_notes.jsonl",{data ->data.toString(Charsets.UTF_8).lineSequence().filter {it.isNotBlank()}
            .joinToString("\n",postfix="\n") {line ->org.json.JSONObject(line).put("body","\u0000"+"x".repeat(8001)).toString()}.toByteArray()}))
    }
}

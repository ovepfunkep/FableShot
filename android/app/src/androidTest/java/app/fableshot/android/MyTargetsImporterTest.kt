package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import app.fableshot.android.importing.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.util.UUID
import java.util.zip.GZIPInputStream

class MyTargetsImporterTest {
    private lateinit var db:JournalDatabase
    private lateinit var importer:MyTargetsImporter
    private lateinit var files:File
    private lateinit var staging:File
    private lateinit var source:File
    private lateinit var preview:MyTargetsPreview
    @Before fun prepare()=runBlocking(Dispatchers.IO) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build()
        files=File(context.cacheDir,"verification-import-files-${UUID.randomUUID()}").apply{mkdirs()}
        staging=File(context.cacheDir,"verification-import-stage-${UUID.randomUUID()}").apply{mkdirs()}
        source=File(staging,"fixture.csv")
        InstrumentationRegistry.getInstrumentation().context.assets.open("mytargets-sample.csv").use{input->source.outputStream().use{input.copyTo(it)}}
        importer=MyTargetsImporter(db,files,staging){1234567890L}
        preview=MyTargetsReader.read(source.inputStream())
    }
    @After fun cleanup(){db.close();val cache=InstrumentationRegistry.getInstrumentation().targetContext.cacheDir.canonicalFile;for(folder in listOf(files,staging)){check(folder.canonicalFile.parentFile==cache&&folder.name.startsWith("verification-import-"));folder.deleteRecursively()}}
    private fun choice(ends:List<MyTargetsEnd> = preview.groups.single().blocks.flatMap{it.ends},duplicate:Boolean=false)=ImportChoice(preview.groups.single().key,ends.map{it.key}.toSet(),suggestedMappings(preview.groups.single()),allowPossibleDuplicate=duplicate)
    private suspend fun commit(choice:ImportChoice=choice(),operation:String=UUID.randomUUID().toString())=importer.commit(source,preview.fileHash,listOf(choice),operationId=operation)
    private suspend fun rejected(code:String,action:suspend()->Unit){try{action();fail("Import accepted $code")}catch(e:ImportRejected){assertEquals(code,e.code)}}

    @Test fun fixtureImportRetainsSourceFactsAndLeavesActiveNativeTrainingUntouched()=runBlocking(Dispatchers.IO) {
        val native=JournalRepository(db);native.start("Native fixture",BlockPlan(18.0,600))
        native.numeric(native.active.first()!!.currentEnd!!.end.id,10)
        val before=native.active.first()!!
        assertEquals(JournalWrite.Rejected(WriteIssue.INVALID),native.revise(before.allShots.single().copy(zoneCode="X")))
        val result=commit()
        assertEquals(18,result.shotCount);assertEquals(before,native.active.first())
        val imported=native.details(result.sessionIds.single())!!
        assertEquals(99,imported.allShots.sumOf{it.points});assertEquals(18,imported.allShots.map{it.id}.distinct().size)
        assertEquals(3,imported.allShots.count{it.points==0&&it.x==null&&it.y==null})
        assertEquals(15,imported.allShots.count{it.positionStatus=="known"})
        assertTrue(imported.allShots.all{it.scoreSource=="imported"&&it.automaticPoints==null})
        assertEquals("2020-01-02",imported.session.localDate);assertNull(imported.session.timeZoneId);assertNull(imported.session.startedAtMs);assertNull(imported.session.completedAtMs)
        assertEquals("circle",JSONObject(imported.blocks.single().block.targetSnapshotJson!!).getString("geometryType"))
        assertEquals(18,db.importDao().rows(result.batchId).size);assertEquals(6,db.importDao().endSources(result.batchId).size)
        assertEquals("12:00:00",db.importDao().endSources(result.batchId).first().rawTimestamp)
        val batch=db.importDao().batchById(result.batchId)!!
        assertArrayEquals(source.readBytes(),GZIPInputStream(File(files,batch.rawSourcePath).inputStream()).use{it.readBytes()})
    }

    @Test fun durableReplayNeverDuplicatesOrResurrectsDeletedImportedShots()=runBlocking(Dispatchers.IO) {
        val operation=UUID.randomUUID().toString();val result=commit(operation=operation)
        assertTrue(commit(operation=operation).replayed)
        assertEquals(1,JournalRepository(db).history.first().size)
        rejected("already_imported_records"){commit()}
        val repo=JournalRepository(db);val shot=repo.details(result.sessionIds.single())!!.allShots.first()
        assertTrue(repo.removeShot(shot.id,shot.revision) is JournalWrite.Saved)
        assertTrue(commit(operation=operation).replayed)
        assertEquals(17,repo.details(result.sessionIds.single())!!.allShots.size)
        assertEquals(18,db.importDao().rows(result.batchId).size)
        val changed=choice().copy(mappings=choice().mappings.map{it.copy(arrowsPerEnd=6)})
        rejected("operation_reused"){commit(changed,operation)}
    }

    @Test fun partialSelectionThenRemainingEndsUsesOneSourceWithoutLosingRepeatedMisses()=runBlocking(Dispatchers.IO) {
        val ends=preview.groups.single().blocks.single().ends
        val first=commit(choice(ends.take(3)));val second=commit(choice(ends.drop(3)))
        assertEquals(first.batchId,second.batchId)
        val rows=JournalRepository(db).history.first()
        assertEquals(2,rows.size);assertEquals(18,rows.sumOf{it.allShots.size});assertEquals(99,rows.sumOf{it.allShots.sumOf{shot->shot.points}})
        assertEquals(18,db.importDao().rows(first.batchId).map{it.sourceRecord}.distinct().size)
        assertEquals(1,File(files,"imports").listFiles()!!.count{it.extension=="gz"})
    }

    @Test fun crossFileOverlapRequiresExplicitChoiceAndExactFileStillCannotDuplicate()=runBlocking(Dispatchers.IO) {
        commit()
        val changed=File(staging,"renamed-export.csv").apply{writeBytes(source.readBytes()+"\n".toByteArray())}
        val changedPreview=MyTargetsReader.read(changed.inputStream())
        assertNotEquals(preview.fileHash,changedPreview.fileHash)
        assertEquals(6,importer.inventory(changedPreview).possibleEndFingerprints.size)
        rejected("possible_duplicate"){importer.commit(changed,changedPreview.fileHash,listOf(choice()))}
        val explicit=importer.commit(changed,changedPreview.fileHash,listOf(choice(duplicate=true)))
        assertEquals(18,explicit.shotCount);assertEquals(2,JournalRepository(db).history.first().size)
        rejected("already_imported_records"){commit(choice(duplicate=true))}
    }

    @Test fun receiptFailureRollsBackBatchAllRowsAndNewRawFileBeforeRetry()=runBlocking(Dispatchers.IO) {
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER verification_import_receipt BEFORE INSERT ON mutation_receipts WHEN NEW.kind='import_mytargets' BEGIN SELECT RAISE(ABORT,'injected import receipt failure'); END")
        val operation=UUID.randomUUID().toString()
        try{commit(operation=operation);fail("Receipt error swallowed")}catch(e:Exception){assertTrue(e.toString().contains("injected import receipt failure"))}
        assertTrue(JournalRepository(db).history.first().isEmpty());assertNull(db.importDao().batch(preview.fileHash))
        assertTrue(File(files,"imports").listFiles()!!.isEmpty())
        db.openHelper.writableDatabase.execSQL("DROP TRIGGER verification_import_receipt")
        assertEquals(18,commit(operation=operation).shotCount)
    }

    @Test fun cancellationBeforeCommitLeavesNoScoredRowsProvenanceOrSourceFile()=runBlocking(Dispatchers.IO) {
        try{importer.commit(source,preview.fileHash,listOf(choice()),onProgress={throw CancellationException("fixture cancellation")});fail("Cancellation returned success")}catch(_:CancellationException){}
        assertTrue(JournalRepository(db).history.first().isEmpty());assertNull(db.importDao().batch(preview.fileHash))
        assertTrue(File(files,"imports").listFiles()!!.isEmpty())
    }

    @Test fun changedSourceAndInvalidPlanFailBeforeWritingAnything()=runBlocking(Dispatchers.IO) {
        val tooSmall=choice().copy(mappings=choice().mappings.map{it.copy(arrowsPerEnd=2)})
        rejected("plan_smaller_than_series"){commit(tooSmall)}
        source.appendText("\n")
        rejected("source_changed"){commit()}
        assertTrue(JournalRepository(db).history.first().isEmpty())
    }

    @Test fun sourceXAndUnknownConditionsRemainDistinctFromNativeGeometry()=runBlocking(Dispatchers.IO) {
        source.writeText(source.readText().replaceFirst("\"9\";\"\";","\"X\";\"\";").replace("\"10m\"","\"unknown\"").replace("\"WA Full (60cm)\"","\"Unmapped source\""))
        preview=MyTargetsReader.read(source.inputStream())
        val mapped=choice().copy(mappings=choice().mappings.map{it.copy(scaleConfirmed=true)})
        val result=commit(mapped);val saved=JournalRepository(db).details(result.sessionIds.single())!!
        assertEquals("X",saved.allShots.first().zoneCode);assertEquals(10,saved.allShots.first().points)
        assertNull(saved.blocks.single().block.distanceMeters);assertNull(saved.blocks.single().block.targetDiameterMm)
        assertFalse(saved.blocks.single().block.targetProfileId==PRACTICE_PROFILE)
        val repo=JournalRepository(db);val first=saved.allShots.first()
        val operation=UUID.randomUUID().toString()
        assertTrue(repo.revise(first.copy(zoneCode="10",scoreSource="manual_edit"),operationId=operation) is JournalWrite.Saved)
        assertEquals(JournalWrite.Rejected(WriteIssue.OPERATION_REUSED),repo.revise(first.copy(zoneCode="X",scoreSource="manual_edit"),operationId=operation))
        val revised=repo.details(result.sessionIds.single())!!.allShots.first()
        assertTrue(repo.revise(revised.copy(zoneCode="X")) is JournalWrite.Saved)
        assertEquals("X",repo.details(result.sessionIds.single())!!.allShots.first().zoneCode)
        assertEquals(first.x,repo.details(result.sessionIds.single())!!.allShots.first().x)
    }

    @Test fun undoPortionRequiresAcknowledgingEditsAndRetainsAllDataForRestoration()=runBlocking(Dispatchers.IO) {
        val operation=UUID.randomUUID().toString();val result=commit(operation=operation)
        val repo=JournalRepository(db);val id=result.sessionIds.single();val shot=repo.details(id)!!.allShots.first()
        assertTrue(repo.revise(shot.copy(points=8,zoneCode="8",scoreSource="manual_edit")) is JournalWrite.Saved)
        val plan=importer.undoPlan(operation);assertTrue(plan.items.single().edited)
        rejected("edited_since_import"){importer.undo(operation,plan,false)}
        assertEquals(1,repo.history.first().size)
        val undoOperation=UUID.randomUUID().toString();importer.undo(operation,plan,true,undoOperation)
        assertTrue(repo.history.first().isEmpty());assertEquals(18,repo.details(id)!!.allShots.size)
        val revision=repo.details(id)!!.session.revision
        importer.undo(operation,plan,true,undoOperation);assertEquals(revision,repo.details(id)!!.session.revision)
        assertEquals(listOf(id),importer.inventory(preview).trashedSessionIds)
        assertTrue(repo.restore(id,revision) is JournalWrite.Saved)
        assertEquals(18,repo.history.first().single().allShots.size)
        assertEquals(98,repo.details(id)!!.allShots.sumOf{it.points})
        val stale=importer.undoPlan(operation)
        repo.rename(id,"Changed after review",repo.details(id)!!.session.revision)
        rejected("undo_source_changed"){importer.undo(operation,stale,true)}
        assertEquals(1,repo.history.first().size)
    }

    @Test fun oversizedDocumentStopsCopyingAndRemovesItsUnconfirmedCacheFile()=runBlocking(Dispatchers.IO) {
        val input=object:java.io.InputStream(){var remaining=MyTargetsReader.MAX_BYTES+8192;override fun read():Int=if(remaining-- >0)'a'.code else -1;override fun read(buffer:ByteArray,offset:Int,length:Int):Int{if(remaining<=0)return -1;val count=minOf(length.toLong(),remaining).toInt();buffer.fill('a'.code.toByte(),offset,offset+count);remaining-=count;return count}}
        rejected("file_too_large"){importer.stage(input)}
        assertEquals(listOf(source.name),staging.listFiles()!!.map{it.name})
        assertTrue(JournalRepository(db).history.first().isEmpty())
    }
}


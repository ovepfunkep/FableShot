package app.fableshot.android
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.junit.*
import org.junit.Assert.*

class ProgressBaselineTest {
    private lateinit var db:JournalDatabase
    private lateinit var repo:JournalRepository
    private var instant=1_000_000L
    private val plan=BlockPlan(18.0,600,equipmentSnapshotJson="{\"bow\":{\"category\":\"barebow\"}}")
    @Before fun setup(){db=Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,JournalDatabase::class.java).build();repo=JournalRepository(db,now={instant})}
    @After fun cleanup()=runBlocking(Dispatchers.IO){db.close()}
    private suspend fun current()=repo.active.first()!!
    private suspend fun past(points:Int,n:Int=12,conditions:BlockPlan=plan):JournalDetails {
        instant+=1000;android.util.Log.i("PG1_TEST","start $instant / $n");assertTrue(repo.start("Past $instant",conditions) is JournalWrite.Saved)
        repeat(n){i->val v=current();assertTrue(repo.numeric(v.currentEnd!!.end.id,points) is JournalWrite.Saved);if(i<n-1&&(i+1)%3==0){val full=current();repo.next(full.currentEnd!!.end.id,full.currentEnd!!.end.revision)}}
        val v=current();instant+=100;repo.complete(v.session.id,v.session.revision);android.util.Log.i("PG1_TEST","complete $instant");return repo.details(v.session.id)!!
    }
    @Test fun weightedSnapshotSurvivesEditsTrashAndSameCategoryEquipmentChange()=runBlocking(Dispatchers.IO) {
        val a=past(5,12);past(8,24);past(10,36);instant+=1000
        repo.start("Current",plan.copy(equipmentSnapshotJson="{\"selection\":{\"name\":\"Other bow\"},\"bow\":{\"category\":\"barebow\"}}"))
        val value=current();val baseline=value.currentBlock!!.baselines.single()
        assertEquals("ready",baseline.status);assertEquals(72,baseline.scoredCount);assertEquals(612L,baseline.scoreSum)
        assertEquals(3,JSONArray(baseline.sourceSessionsJson).length());assertTrue(value.allShots.isEmpty())
        repo.revise(a.allShots.first().copy(points=1));val changed=repo.details(a.session.id)!!;repo.trash(a.session.id,changed.session.revision)
        assertEquals(baseline,db.journalDao().baseline(value.currentBlock!!.block.id))
    }
    @Test fun latestFiveExcludeUnknownCategoryOtherBowClassAndDistance()=runBlocking(Dispatchers.IO) {
        repeat(6){past(it+1)}
        past(10,conditions=plan.copy(equipmentSnapshotJson="{\"bow\":{\"category\":\"compound\"}}"))
        past(10,conditions=plan.copy(distanceMeters=30.0));past(10,conditions=plan.copy(equipmentSnapshotJson=null))
        instant+=1000;repo.start("Current",plan);val baseline=current().currentBlock!!.baselines.single()
        assertEquals(5,JSONArray(baseline.sourceSessionsJson).length());assertEquals(60,baseline.scoredCount);assertEquals(240L,baseline.scoreSum)
    }
    @Test fun unknownConditionsAndNoHistoryNeverBecomeFakeZeroLevel()=runBlocking(Dispatchers.IO) {
        repo.start("Unknown",plan.copy(equipmentSnapshotJson=null));var v=current();assertEquals("unknown_conditions",v.currentBlock!!.baselines.single().status)
        repo.complete(v.session.id,v.session.revision);instant+=1000;repo.start("Known",plan);v=current()
        assertEquals("building",v.currentBlock!!.baselines.single().status);assertEquals(0,v.currentBlock!!.baselines.single().scoredCount)
    }
    @Test fun failedBaselineInsertRollsBackStartAndRetryFreezesOnce()=runBlocking(Dispatchers.IO) {
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_baseline BEFORE INSERT ON progress_baselines BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
        try{repo.start("Fail",plan,operationId="retry");fail()}catch(_:Exception){}
        assertNull(repo.active.first());db.openHelper.writableDatabase.execSQL("DROP TRIGGER fail_baseline")
        val first=repo.start("Fail",plan,operationId="retry") as JournalWrite.Saved
        val second=repo.start("Fail",plan,operationId="retry") as JournalWrite.Saved
        assertEquals(first.id,second.id);assertTrue(second.replayed);assertEquals(1,current().currentBlock!!.baselines.size)
    }
    @Test fun archivePreservesFrozenSnapshotAndOldFormatDoesNotInventOne()=runBlocking(Dispatchers.IO) {
        val old=past(5);past(5);past(5);instant+=1000;repo.start("Current",plan)
        val value=current();val baseline=value.currentBlock!!.baselines.single()
        repo.revise(old.allShots.first().copy(points=10))
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val equipment=Room.inMemoryDatabaseBuilder(context,app.fableshot.android.data.EquipmentDatabase::class.java).build()
        val prefs=app.fableshot.android.data.UserPreferences(object:androidx.datastore.core.DataStore<androidx.datastore.preferences.core.Preferences>{override val data=kotlinx.coroutines.flow.flowOf(androidx.datastore.preferences.core.emptyPreferences());override suspend fun updateData(transform:suspend(androidx.datastore.preferences.core.Preferences)->androidx.datastore.preferences.core.Preferences)=transform(androidx.datastore.preferences.core.emptyPreferences())})
        val archive=app.fableshot.android.backup.JournalArchive(context,db,equipment,prefs)
        val export=archive.export()
        try {
            val prepared=archive.prepare(export.file)
            val restored=Room.databaseBuilder(context,JournalDatabase::class.java,prepared.journalFile.absolutePath).build()
            try{assertEquals(baseline,restored.journalDao().baseline(value.currentBlock!!.block.id))}finally{restored.close();archive.discard(prepared.directory)}
            val entries=java.util.zip.ZipFile(export.file).use{zip->zip.entries().asSequence().associate{it.name to zip.getInputStream(it).readBytes()}.toMutableMap()}
            
            val techniquePaths=setOf("data/journal/technique_documents.jsonl","data/journal/technique_versions.jsonl","data/journal/technique_uses.jsonl");techniquePaths.forEach{entries.remove(it)}
val path="data/journal/progress_baselines.jsonl";entries.remove(path);entries.remove("data/journal/session_plans.jsonl")
            val manifest=org.json.JSONObject(entries.getValue("manifest.json").toString(Charsets.UTF_8)).put("formatVersion",1).put("journalSchema",3)
            manifest.getJSONObject("rowCounts").remove(path);manifest.getJSONObject("rowCounts").remove("data/journal/session_plans.jsonl")
            techniquePaths.forEach{manifest.getJSONObject("rowCounts").remove(it)};val payloads=manifest.getJSONArray("payloads");val filtered=org.json.JSONArray();for(i in 0 until payloads.length())if(payloads.getJSONObject(i).getString("path") !in (setOf(path,"data/journal/session_plans.jsonl")+techniquePaths))filtered.put(payloads.getJSONObject(i));manifest.put("payloads",filtered)
            entries["manifest.json"]=manifest.toString().toByteArray()
            val output=java.io.ByteArrayOutputStream();java.util.zip.ZipOutputStream(output).use{zip->entries.forEach{(name,bytes)->zip.putNextEntry(java.util.zip.ZipEntry(name));zip.write(bytes);zip.closeEntry()}}
            val staged=archive.stage(output.toByteArray().inputStream())
            val legacy=archive.prepare(staged);val oldDb=Room.databaseBuilder(context,JournalDatabase::class.java,legacy.journalFile.absolutePath).build()
            try{assertTrue(oldDb.journalDao().details(value.session.id)!!.currentBlock!!.baselines.isEmpty())}finally{oldDb.close();archive.discard(legacy.directory);archive.discard(staged)}
        }finally{equipment.close();archive.discard(export.file)}
        Unit
    }
    @Test fun compatibleBlocksCountAsOnePastTrainingAndWarmupDoesNotFillMinimum()=runBlocking(Dispatchers.IO) {
        past(5,24)
        val warm=past(10,12);val first=warm.currentBlock!!.orderedEnds.first().end
        repo.role(first.id,"warmup",first.revision)
        instant+=1000;repo.start("Two compatible blocks",plan)
        repeat(2){blockIndex->
            repeat(6){i->val v=current();repo.numeric(v.currentEnd!!.end.id,5);if(i==2){val full=current();repo.next(full.currentEnd!!.end.id,full.currentEnd!!.end.revision)}}
            if(blockIndex==0){val full=current();repo.startBlock(full.session.id,plan,full.session.revision)}
        }
        var value=current();instant+=100;repo.complete(value.session.id,value.session.revision)
        instant+=1000;repo.start("Comparison",plan);value=current()
        val baseline=value.currentBlock!!.baselines.single()
        assertEquals(2,JSONArray(baseline.sourceSessionsJson).length());assertEquals("building",baseline.status)
        assertEquals(36,baseline.scoredCount);assertEquals(180L,baseline.scoreSum)
    }
}

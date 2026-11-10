package app.fableshot.android

import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.*
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.util.UUID

class DiaryReplacementTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var root:File
    private val managers=mutableListOf<DiaryManager>()
    private val runtimes=mutableListOf<DiaryRuntime>()
    private val exports=mutableListOf<Pair<JournalArchive,File>>()
    @Before fun setup(){root=File(context.cacheDir,"verification-replace-${UUID.randomUUID()}").apply{mkdirs()}}
    @After fun cleanup()=runBlocking(Dispatchers.IO){managers.forEach{it.close()};runtimes.forEach{it.close()};exports.forEach{(archive,file)->archive.discard(file)};check(root.canonicalFile.parentFile==context.cacheDir.canonicalFile&&root.name.startsWith("verification-replace-"));root.deleteRecursively();Unit}
    private fun fakeGeneration(store:DiaryGenerations):File=store.newFolder().apply{for(name in listOf("journal.db","equipment.db","preferences.preferences_pb"))File(this,name).writeText(name)}
    private suspend fun fixture(store:DiaryGenerations,name:String,score:Int):DiaryRuntime {
        val folder=store.newFolder();val runtime=DiaryRuntime(context,folder.name,folder);runtimes.add(runtime)
        runtime.warmUp();runtime.preferences.displayName(name);runtime.preferences.finishOnboarding("completed")
        runtime.repository.journal.start(name,BlockPlan(18.0,600));val active=runtime.repository.journal.active.first()!!
        runtime.repository.journal.numeric(active.currentEnd!!.end.id,score)
        runtime.equipment.save(EquipmentItem(kind="bow",name="$name bow"))
        store.seal(folder);return runtime
    }
    private suspend fun managed():DiaryManager {
        val store=DiaryGenerations(root);val old=fixture(store,"Old",8);old.close()
        File(root,"selection.json").writeText("{\"version\":1,\"current\":\"${old.id}\",\"previous\":null}")
        return DiaryManager(context,root,store).also{managers.add(it)}
    }
    private suspend fun exported():File {
        val sourceRoot=File(root,"source");val store=DiaryGenerations(sourceRoot);val source=fixture(store,"New",10)
        val archive=source.archive;val file=archive.export().file;exports.add(archive to file);source.close();return file
    }
    @Test fun interruptionBeforeCommitKeepsOldSelectionAndAfterCommitRecoversNewSelection() {
        val normal=DiaryGenerations(root);val a=fakeGeneration(normal);normal.seal(a);normal.activate(a.name,DiarySelection())
        val before=normal.read();val b=fakeGeneration(normal);normal.seal(b)
        val failing=DiaryGenerations(root){if(it=="before_selection")throw java.io.IOException("injected before commit")}
        try{failing.activate(b.name,before);fail()}catch(_:java.io.IOException){}
        assertEquals(before,DiaryGenerations(root).read())
        val after=DiaryGenerations(root){if(it=="after_selection")throw java.io.IOException("injected after commit")}.activate(b.name,before)
        assertEquals(b.name,after.current);assertEquals(a.name,after.previous);assertEquals(after,DiaryGenerations(root).read())
    }
    @Test fun unreadyGenerationAndUnsafePointerNeverOpenAnEmptyFallback() {
        val store=DiaryGenerations(root);val incomplete=store.newFolder()
        try{store.activate(incomplete.name,DiarySelection());fail()}catch(_:ArchiveInvalid){}
        assertEquals(DiarySelection(),store.read())
        File(root,"selection.json").writeText("{\"version\":1,\"current\":\"../outside\",\"previous\":null}")
        try{store.read();fail()}catch(_:ArchiveInvalid){}
    }
    @Test fun writerDrainRetirementAndFailedCommitRespectOneBoundary()=runBlocking {
        val gate=WriteGate();val entered=CompletableDeferred<Unit>();val finish=CompletableDeferred<Unit>();val events=mutableListOf<String>()
        val writer=launch{gate.write{entered.complete(Unit);finish.await();events.add("write")}}
        entered.await();val retire=launch{gate.retire{events.add("commit")}}
        yield();assertTrue(events.isEmpty());finish.complete(Unit);writer.join();retire.join()
        assertEquals(listOf("write","commit"),events)
        try{gate.write{fail("Stale writer accepted")};fail()}catch(e:IllegalStateException){assertEquals("DIARY_REPLACED",e.message)}
        val retry=WriteGate();try{retry.retire{throw java.io.IOException("before commit")}}catch(_:java.io.IOException){}
        assertEquals(42,retry.write{42})
    }
    @Test fun replacementSwitchesAllStoresRejectsStaleWritesAndUndoRestoresOldDiary()=runBlocking(Dispatchers.IO) {
        val manager=managed();val source=exported();val old=manager.current
        manager.restore(source);val restored=manager.current
        assertNotEquals(old.id,restored.id);assertEquals(10,restored.repository.journal.active.first()!!.allShots.single().points)
        assertEquals("New",(restored.preferences.state.first() as SettingsRead.Ready).value.displayName)
        assertEquals("New bow",restored.equipment.items.first().single().name)
        try{old.preferences.displayName("stale");fail()}catch(e:IllegalStateException){assertEquals("DIARY_REPLACED",e.message)}
        try{old.equipment.save(EquipmentItem(kind="bow",name="stale"));fail()}catch(_:IllegalStateException){}
        try{old.repository.journal.numeric(old.repository.journal.active.first()!!.currentEnd!!.end.id,1);fail()}catch(_:IllegalStateException){}
        manager.releaseRetired(old);manager.undoReplacement()
        assertEquals(old.id,manager.current.id);assertEquals(8,manager.current.repository.journal.active.first()!!.allShots.single().points)
        assertEquals("Old",(manager.current.preferences.state.first() as SettingsRead.Ready).value.displayName)
        manager.releaseRetired(restored);Unit
    }
    @Test fun restartUsesCommittedGenerationAndInvalidArchiveDoesNotSwitch()=runBlocking(Dispatchers.IO) {
        var manager=managed();val source=exported();val original=manager.current.id
        val broken=manager.current.archive.stage("broken zip".byteInputStream())
        try{manager.restore(broken);fail()}catch(_:java.util.zip.ZipException){}
        assertEquals(original,manager.current.id);manager.current.archive.discard(broken)
        manager.restore(source);val committed=manager.current.id;manager.close()
        manager=DiaryManager(context,root).also{managers.add(it)}
        assertEquals(committed,manager.current.id);assertEquals(10,manager.current.repository.journal.active.first()!!.allShots.single().points)
        manager.undoReplacement();assertEquals(original,manager.current.id);Unit
    }

    @Test fun restoreAndUndoKeepRecordEventsButDoNotPresentTheirPendingNotifications()=runBlocking(Dispatchers.IO) {
        suspend fun seedRecords(runtime:DiaryRuntime,prefix:String) {
            val repo=runtime.repository.journal
            val active=repo.active.first()!!.session
            assertTrue(repo.complete(active.id,active.revision) is JournalWrite.Saved)
            val revision=repo.details(active.id)!!.session.revision
            val pending=PersonalRecordEvent("$prefix-pending",active.id,"series",1,"Серия",7,9,
                "previous-source-without-row",revision,1000L)
            val dao=runtime.journal.journalDao()
            dao.insertRecordEvent(pending)
            dao.insertRecordEvent(pending.copy(id="$prefix-shown",kind="rank",label="Норматив",notifiedAtMs=1001L))
        }
        suspend fun notifications(runtime:DiaryRuntime):Map<String,Long?> =
            runtime.journal.journalDao().recordEvents().first().associate {it.id to it.notifiedAtMs}

        val manager=managed()
        val old=manager.current
        seedRecords(old,"old")
        val source=fixture(DiaryGenerations(File(root,"record-source")),"Incoming",9)
        seedRecords(source,"new")
        val archive=source.archive
        val file=archive.export().file
        exports.add(archive to file)
        source.close()

        manager.restore(file)
        val restored=notifications(manager.current)
        assertEquals(setOf("new-pending","new-shown"),restored.keys)
        assertTrue(restored.getValue("new-pending")!!>=1000L)
        assertEquals(1001L,restored.getValue("new-shown"))
        assertNull(notifications(old).getValue("old-pending"))

        manager.undoReplacement()
        assertEquals(old.id,manager.current.id)
        val returned=notifications(manager.current)
        assertEquals(setOf("old-pending","old-shown"),returned.keys)
        assertTrue(returned.getValue("old-pending")!!>=1000L)
        assertEquals(1001L,returned.getValue("old-shown"))
    }

    @Test fun emptyPreferencesRestoreAsEmptyAndCancellationCannotPublishPartialGeneration()=runBlocking(Dispatchers.IO) {
        val file=File(root,"empty.preferences_pb");DiaryRuntime.writePreferences(context,file,emptyMap());assertTrue(file.isFile)
        val manager=managed();val source=exported();val original=manager.current.id
        val job=launch(start=CoroutineStart.LAZY){manager.restore(source)};job.cancelAndJoin()
        assertEquals(original,manager.current.id);Unit
    }
}

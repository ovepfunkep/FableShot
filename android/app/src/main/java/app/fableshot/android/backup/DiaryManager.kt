package app.fableshot.android.backup

import android.content.Context
import androidx.room.withTransaction
import app.fableshot.android.data.DiaryRuntime
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Only this owner can change which complete diary is visible. It never writes over an open DB. */
class DiaryManager(
    private val context:Context,
    private val root:File=File(context.filesDir,"diary-generations"),
    private val generations:DiaryGenerations=DiaryGenerations(root),
    val recoveryBackups:LocalRecoveryBackups=LocalRecoveryBackups(File(root,"recovery-backups")),
) {
    private val initial=generations.read().also{generations.validate(it.current)}
    private val _runtime=MutableStateFlow(open(initial.current))
    val runtime=_runtime.asStateFlow()
    val current get()=_runtime.value
    private val retired=java.util.concurrent.ConcurrentHashMap<String,DiaryRuntime>()
    private val operations=Mutex()
    suspend fun restore(source:File){operations.withLock{restoreInternal(source)}}
    suspend fun undoReplacement(){operations.withLock{undoInternal()}}
    suspend fun resetAccount():RecoveryBackup=operations.withLock{resetInternal()}
    suspend fun resetAchievements():RecoveryBackup=operations.withLock {
        withContext(Dispatchers.IO) {
            val runtime = current
            runtime.warmUp()
            var exported: ExportedArchive? = null
            try {
                runtime.gate.write {
                    val snapshot = runtime.archive.export().also { exported = it }
                    val backup = recoveryBackups.save(runtime.archive, snapshot)
                    currentCoroutineContext().ensureActive()
                    withContext(NonCancellable) { runtime.resetAchievementsWithGateHeld() }
                    backup
                }
            } finally {
                withContext(NonCancellable) { exported?.let { runtime.archive.discard(it.file) } }
            }
        }
    }
    fun previousAvailable()=generations.read().previous!=null
    private fun open(id:String,discardPendingNameEvent:Boolean=false)=
        DiaryRuntime(context,id,if(id=="legacy")null else generations.folder(id),discardPendingNameEvent)
    private suspend fun resetInternal():RecoveryBackup=withContext(Dispatchers.IO) {
        val old=current
        val selection=generations.read()
        val directory=generations.newFolder()
        var candidate:DiaryRuntime?=null
        var exported:ExportedArchive?=null
        try {
            // Empty persisted keys also reset onboarding, hidden settings and pending APP08 events.
            DiaryRuntime.writePreferences(context,File(directory,"preferences.preferences_pb"),emptyMap())
            val next=open(directory.name,discardPendingNameEvent=true)
            candidate=next
            next.warmUp()
            for(database in listOf(next.journal,next.equipmentDatabase)) {
                database.openHelper.writableDatabase.query("PRAGMA wal_checkpoint(TRUNCATE)").use { it.moveToFirst() }
            }
            for(name in listOf("journal.db","equipment.db","preferences.preferences_pb")) {
                DiaryGenerations.syncFile(File(directory,name))
            }
            DiaryGenerations.syncDirectory(directory)
            generations.seal(directory)
            // Export does not enter the write gate. Holding it here drains all writes and keeps
            // the backup and retired diary identical through the selection commit boundary.
            old.gate.retireAfterPreparation(
                prepare={
                    val snapshot=old.archive.export().also { exported=it }
                    recoveryBackups.save(old.archive,snapshot)
                },
                commit={
                    generations.activate(directory.name,selection)
                    retired[old.id]=old
                    _runtime.value=next
                    candidate=null
                },
            )
        } finally {
            withContext(NonCancellable) {
                candidate?.close()
                exported?.let { old.archive.discard(it.file) }
            }
        }
    }
    private suspend fun restoreInternal(source:File):Unit=withContext(Dispatchers.IO) {
        val old=current;val selection=generations.read()
        val prepared=old.archive.prepare(source)
        var candidate:DiaryRuntime?=null
        try {
            val directory=generations.newFolder()
            for(name in listOf("journal.db","equipment.db")){File(prepared.directory,name).copyTo(File(directory,name));DiaryGenerations.syncFile(File(directory,name))}
            val imports=File(prepared.directory,"imports")
            if(imports.exists()) {
                val destination=File(directory,"imports").apply{mkdirs()}
                for(file in imports.listFiles().orEmpty()){currentCoroutineContext().ensureActive();require(file.isFile&&file.canonicalFile.parentFile==imports.canonicalFile);file.copyTo(File(destination,file.name));DiaryGenerations.syncFile(File(destination,file.name))}
                DiaryGenerations.syncDirectory(destination)
            }
            DiaryRuntime.writePreferences(context,File(directory,"preferences.preferences_pb"),prepared.preferences)
            val next=open(directory.name,discardPendingNameEvent=true);candidate=next;next.warmUp()
            generations.seal(directory)
            currentCoroutineContext().ensureActive()
            withContext(NonCancellable) {old.gate.retire {
                next.repository.journal.achievements.mergeReceiptHistory(old.journal.achievementDao().grants())
                markRestoredRecordsShown(next)
                generations.activate(directory.name,selection);retired[old.id]=old;_runtime.value=next;candidate=null
            }}
            candidate=null // Owned by runtime from the commit boundary onwards.
        }finally{withContext(NonCancellable){candidate?.close();old.archive.discard(prepared.directory)}}
    }
    private suspend fun undoInternal():Unit=withContext(Dispatchers.IO) {
        val old=current;val selection=generations.read();val previous=selection.previous?:throw ArchiveInvalid("no_previous_diary")
        generations.validate(previous);retired.remove(previous)?.close();val candidate=open(previous,discardPendingNameEvent=true)
        try {
            candidate.warmUp()
            withContext(NonCancellable){old.gate.retire{
                candidate.repository.journal.achievements.mergeReceiptHistory(old.journal.achievementDao().grants())
                markRestoredRecordsShown(candidate)
                generations.activate(previous,selection);retired[old.id]=old;_runtime.value=candidate
            }}
        }catch(e:Exception){withContext(NonCancellable){if(current!==candidate)candidate.close()};throw e}
    }
    private suspend fun markRestoredRecordsShown(runtime:DiaryRuntime) = runtime.journal.withTransaction {
        runtime.journal.openHelper.writableDatabase.execSQL(
            "UPDATE personal_record_events SET notifiedAtMs=MAX(recordedAtMs,?) WHERE notifiedAtMs IS NULL",
            arrayOf(System.currentTimeMillis()),
        )
    }
    suspend fun releaseRetired(runtime:DiaryRuntime){if(runtime!==current){retired.remove(runtime.id,runtime);runtime.close()}}
    suspend fun close(){operations.withLock{(retired.values.toList()+current).distinct().forEach{it.close()};retired.clear()}}
}

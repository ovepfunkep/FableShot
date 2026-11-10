package app.fableshot.android.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.room.Room
import androidx.room.withTransaction
import app.fableshot.android.backup.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.importing.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File

/** A generation owns its Room connections and DataStore job; it can be retired independently. */
class DiaryRuntime(
    val context:Context,
    val id:String,
    val directory:File?,
    discardPendingNameEvent:Boolean=false,
) {
    val gate=WriteGate()
    private val preferenceScope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private fun databaseFile(name:String)=directory?.let{File(it,name)}?:context.getDatabasePath(if(name=="journal.db")"fableshot.db"else"fableshot-equipment.db")
    val journal=Room.databaseBuilder(context,JournalDatabase::class.java,databaseFile("journal.db").absolutePath).addMigrations(MIGRATION_1_2,MIGRATION_2_3,MIGRATION_3_4,app.fableshot.android.data.journal.MIGRATION_4_5,app.fableshot.android.technique.MIGRATION_5_6,app.fableshot.android.data.journal.MIGRATION_6_7,app.fableshot.android.data.journal.MIGRATION_7_8,app.fableshot.android.data.journal.MIGRATION_8_9,app.fableshot.android.data.journal.MIGRATION_9_10,app.fableshot.android.data.journal.MIGRATION_10_11,app.fableshot.android.data.journal.MIGRATION_11_12,app.fableshot.android.data.journal.MIGRATION_12_13,app.fableshot.android.data.journal.MIGRATION_13_14,app.fableshot.android.data.journal.MIGRATION_14_15,app.fableshot.android.data.journal.MIGRATION_15_16).build()
    val equipmentDatabase=Room.databaseBuilder(context,EquipmentDatabase::class.java,databaseFile("equipment.db").absolutePath).build()
    private val preferenceFile=directory?.let{File(it,"preferences.preferences_pb")}?:File(context.filesDir,"datastore/fableshot_preferences.preferences_pb")
    internal val preferenceStore=PreferenceDataStoreFactory.create(scope=preferenceScope,produceFile={preferenceFile})
    val preferences=UserPreferences(preferenceStore,gate)
    val repository=JournalPracticeStore(journal,gate,preferences::rankCategorySnapshot)
    private val nameEventReadiness=preferenceScope.async {
        if(discardPendingNameEvent)preferences.discardPendingAchievementNameEvent()
    }
    private val achievementNameObserver=preferenceScope.launch {
        try {
            nameEventReadiness.await()
        }catch(error:CancellationException) {
            throw error
        }catch(error:Exception) {
            // warmUp propagates this failure to the replacement caller before publication.
            android.util.Log.e("FableAchievements","Restored name event could not be discarded",error)
            return@launch
        }
        preferences.achievementNameEvents.filterNotNull().distinctUntilChanged().onEach { (id, instant) ->
            gate.write {
                if (preferences.achievementNameEventSnapshot() == "$id|$instant") {
                    journal.withTransaction {
                        repository.journal.achievements.serviceInTransaction("APP08", id, instant)
                    }
                }
            }
        }.retryWhen { error, _ ->
            if(error is CancellationException)throw error
            android.util.Log.e("FableAchievements","Deferred profile achievement will retry",error)
            delay(5000);true
        }.collect()
    }
    val equipment=EquipmentRepository(equipmentDatabase,gate)
    private val sources=directory?:context.filesDir
    val importer=MyTargetsImporter(journal,sources,File(context.cacheDir,"mytargets-staging"),gate,equipmentDb=equipmentDatabase)
    val archive=JournalArchive(context,journal,equipmentDatabase,preferences,sources)
    private val closeMutex=Mutex()
    private val preparationMutex=Mutex()
    private var prepared=false
    private var closed=false
    suspend fun close(){closeMutex.withLock{if(!closed){preferenceScope.coroutineContext[Job]!!.cancelAndJoin();journal.close();equipmentDatabase.close();closed=true}}}
    suspend fun warmUp() = preparationMutex.withLock {
        if (!prepared) {
            nameEventReadiness.await()
            preferences.archiveSnapshot()
            withContext(Dispatchers.IO) {
                journal.openHelper.writableDatabase
                equipmentDatabase.openHelper.writableDatabase
                importer.restoreImportedEquipment()
                importer.normalizeImportedTargets()
            }
            prepared = true
        }
    }

    /** DiaryManager owns the gate from the verified pre-reset backup through this commit. */
    internal suspend fun resetAchievementsWithGateHeld() {
        val pendingName = preferences.achievementNameEventSnapshot()
        var discarded = false
        try {
            journal.withTransaction {
                repository.journal.achievements.resetInTransaction()
                preferences.replaceAchievementNameEventWithGateHeld(null)
                discarded = true
            }
        } catch (error: Throwable) {
            // DataStore and SQLite have separate commits. Compensate a failed SQLite commit
            // before releasing the gate, so a failed reset retains its pending command.
            if (discarded) withContext(NonCancellable) {
                try {
                    preferences.replaceAchievementNameEventWithGateHeld(pendingName)
                } catch (restoreError: Throwable) {
                    error.addSuppressed(restoreError)
                }
            }
            throw error
        }
    }

    companion object {
        suspend fun writePreferences(context:Context,file:File,values:Map<String,Pair<String,Any>>) {
            val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
            try {
                val store=PreferenceDataStoreFactory.create(scope=scope,produceFile={file})
                // Force creation even for a valid archive with zero stored keys.
                store.edit{it[stringPreferencesKey("__restore_seed") ]="temporary"}
                store.edit { p->
                    p.clear()
                    values.forEach{(key,entry)->val (type,value)=entry;when(type){
                        "string"->p[stringPreferencesKey(key)]=value as String
                        "boolean"->p[booleanPreferencesKey(key)]=value as Boolean
                        "int"->p[intPreferencesKey(key)]=(value as Number).toInt()
                        "long"->p[longPreferencesKey(key)]=(value as Number).toLong()
                        "float"->p[floatPreferencesKey(key)]=(value as Number).toFloat()
                        "double"->p[doublePreferencesKey(key)]=(value as Number).toDouble()
                        "stringSet"->{@Suppress("UNCHECKED_CAST") val strings=value as List<String>;p[stringSetPreferencesKey(key)]=strings.toSet()}
                        "bytes"->p[byteArrayPreferencesKey(key)]=android.util.Base64.decode(value as String,android.util.Base64.NO_WRAP)
                        else->throw ArchiveInvalid("invalid_preference_value")
                    }}
                }
            }finally{scope.coroutineContext[Job]!!.cancelAndJoin()}
            DiaryGenerations.syncFile(file)
        }
    }
}

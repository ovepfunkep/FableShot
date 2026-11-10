package app.fableshot.android

import android.app.Application
import app.fableshot.android.backup.DiaryManager
import kotlinx.coroutines.*

open class FableShotApplication : Application() {
    val diaries by lazy { DiaryManager(this) }
    val cleanupScope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    val repository get()=diaries.current.repository
    val preferences get()=diaries.current.preferences
    val equipment get()=diaries.current.equipment
    val importer get()=diaries.current.importer
    val archive get()=diaries.current.archive
}

package app.fableshot.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import app.fableshot.android.backup.DiaryManager
import app.fableshot.android.data.DiaryRuntime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Retain commands/Undo across rotation; discard them when a different diary becomes visible. */
class GenerationViewModels:ViewModel() {
    private val store=ViewModelStore()
    private var active:DiaryRuntime?=null
    private var model:PracticeViewModel?=null
    private var cleanup:(()->Unit)?=null
    fun select(runtime:DiaryRuntime,manager:DiaryManager,scope:CoroutineScope):PracticeViewModel {
        if(active!==runtime) {
            store.clear();cleanup?.invoke()
            active=runtime
            val next=ViewModelProvider(store,PracticeViewModel.Factory(runtime.repository))[PracticeViewModel::class.java]
            model=next
            cleanup={scope.launch{next.awaitStopped();manager.releaseRetired(runtime)}}
        }
        return requireNotNull(model)
    }
    override fun onCleared(){store.clear();cleanup?.invoke()}
}

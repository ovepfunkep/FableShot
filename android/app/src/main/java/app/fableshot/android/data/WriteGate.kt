package app.fableshot.android.data

import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One diary generation: drain existing mutations, then permanently reject stale writers. */
class WriteGate {
    private val mutex=Mutex()
    private var retired=false
    suspend fun <T> write(block:suspend()->T):T=mutex.withLock {
        check(!retired){"DIARY_REPLACED"};block()
    }
    suspend fun <T> retire(commit:suspend()->T):T=mutex.withLock {
        check(!retired){"DIARY_REPLACED"}
        val result=commit();retired=true;result
    }

    /** Keep the snapshot stable while preparing, then publish and retire as one cancellation boundary. */
    suspend fun <T> retireAfterPreparation(prepare:suspend()->T,commit:suspend(T)->Unit):T=mutex.withLock {
        check(!retired){"DIARY_REPLACED"}
        val prepared=prepare()
        currentCoroutineContext().ensureActive()
        withContext(NonCancellable) {
            commit(prepared)
            // Cancellation on return to the caller must never leave a published old gate writable.
            retired=true
        }
        prepared
    }
}

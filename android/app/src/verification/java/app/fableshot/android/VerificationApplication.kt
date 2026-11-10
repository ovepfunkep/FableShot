package app.fableshot.android

import android.util.AtomicFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.File

/** The test edition supplies reviewable examples once. A reset remains empty on subsequent launches. */
class VerificationApplication : FableShotApplication() {
    override fun onCreate() {
        super.onCreate()
        cleanupScope.launch {
            val marker = AtomicFile(File(filesDir, "verification-samples-v2.done"))
            if (marker.baseFile.exists()) return@launch
            try {
                val alreadySeeded = File(filesDir, "verification-samples-v1.done").exists()
                seedVerificationDiary(diaries.current, updateOnly = alreadySeeded)
                val stream = marker.startWrite()
                try {
                    stream.write("numbered-arrows-v2".toByteArray())
                    marker.finishWrite(stream)
                } catch (error: Exception) {
                    marker.failWrite(stream)
                    throw error
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                android.util.Log.e("FableVerificationSamples", "Could not create test diary examples", error)
            }
        }
    }
}

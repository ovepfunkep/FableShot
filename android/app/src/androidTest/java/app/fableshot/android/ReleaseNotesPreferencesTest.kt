package app.fableshot.android

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.DiaryRuntime
import app.fableshot.android.data.LAST_SEEN_RELEASE_CODE_KEY
import app.fableshot.android.data.SettingsRead
import app.fableshot.android.data.UserPreferences
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class ReleaseNotesPreferencesTest {
    @Test fun acknowledgementCannotRegressAndSurvivesReopenAndPreferenceRestore() = runBlocking(Dispatchers.IO) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "release-notes-${UUID.randomUUID()}").apply { mkdirs() }
        val file = File(folder, "original.preferences_pb")
        val restoredFile = File(folder, "restored.preferences_pb")
        var scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val restoredScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            var preferences = UserPreferences(PreferenceDataStoreFactory.create(scope = scope, produceFile = { file }))
            assertNull((preferences.state.first() as SettingsRead.Ready).value.lastSeenReleaseCode)
            preferences.acknowledgeReleaseNotes(51)
            coroutineScope {
                launch { preferences.acknowledgeReleaseNotes(53) }
                launch { preferences.acknowledgeReleaseNotes(52) }
            }
            preferences.acknowledgeReleaseNotes(47)
            assertEquals(53, (preferences.state.first() as SettingsRead.Ready).value.lastSeenReleaseCode)
            val archived = preferences.archiveSnapshot()
            assertEquals("int" to 53, archived.getValue(LAST_SEEN_RELEASE_CODE_KEY))

            scope.coroutineContext[Job]!!.cancelAndJoin()
            scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            preferences = UserPreferences(PreferenceDataStoreFactory.create(scope = scope, produceFile = { file }))
            assertEquals(53, (preferences.state.first() as SettingsRead.Ready).value.lastSeenReleaseCode)
            DiaryRuntime.writePreferences(context, restoredFile, archived)
            val restored = UserPreferences(PreferenceDataStoreFactory.create(
                scope = restoredScope, produceFile = { restoredFile },
            ))
            assertEquals(53, (restored.state.first() as SettingsRead.Ready).value.lastSeenReleaseCode)
        } finally {
            scope.coroutineContext[Job]!!.cancelAndJoin()
            restoredScope.coroutineContext[Job]!!.cancelAndJoin()
            check(folder.canonicalFile.parentFile == context.cacheDir.canonicalFile)
            folder.deleteRecursively()
        }
    }
}

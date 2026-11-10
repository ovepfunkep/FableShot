package app.fableshot.android

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class UserPreferencesTest {
    @Test fun preferencesSurviveReopenAndChoicesAreIndependent()=runBlocking {
        val file=File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir,"verification-${UUID.randomUUID()}.preferences_pb")
        var scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        try {
            var store=PreferenceDataStoreFactory.create(scope=scope,produceFile={file})
            var prefs=UserPreferences(store)
            assertTrue((prefs.state.first() as SettingsRead.Ready).value.trainingOnLockScreen)
            prefs.trainingOnLockScreen(false)
            prefs.style(DesignStyle.Pop);prefs.appearance(Appearance.Dark);prefs.animations(false);prefs.displayName("  Лучник  ");prefs.finishOnboarding("skipped")
            prefs.style(DesignStyle.Minimal)
            prefs.timerDurations(90, 45)
            prefs.hideCurrentScores(true)
            prefs.showAchievements(false)
            assertThrows(IllegalArgumentException::class.java) {runBlocking {prefs.timerDurations(0, 10)}}
            var read=(prefs.state.first() as SettingsRead.Ready).value
            assertEquals(Appearance.Dark,read.appearance);assertEquals(DesignStyle.Minimal,read.style)
            scope.coroutineContext[Job]!!.cancelAndJoin()
            scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
            store=PreferenceDataStoreFactory.create(scope=scope,produceFile={file});prefs=UserPreferences(store)
            read=(prefs.state.first() as SettingsRead.Ready).value
            assertEquals("Лучник",read.displayName);assertFalse(read.animations);assertEquals(1,read.onboardingVersion)
            assertEquals(90,read.seriesTimerSeconds);assertEquals(45,read.restTimerSeconds)
            assertTrue(read.hideCurrentScores)
            assertFalse(read.showAchievements)
            assertFalse(read.trainingOnLockScreen)
            assertEquals(Appearance.Dark,read.appearance);assertEquals(DesignStyle.Minimal,read.style)
            store.edit{it[stringPreferencesKey("designStyle")]="future_style"}
            val fallback=(prefs.state.first() as SettingsRead.Ready).value
            assertEquals(DesignStyle.Sport,fallback.style);assertEquals(Appearance.Dark,fallback.appearance);assertEquals("Лучник",fallback.displayName)
        } finally {scope.coroutineContext[Job]!!.cancelAndJoin();file.delete()}
    }
    @Test fun readFailureDoesNotPretendTheUserHasEmptySettings()=runBlocking {
        val broken=object:DataStore<Preferences>{override val data:Flow<Preferences> = flow{throw IOException("Fixture read failure")};override suspend fun updateData(transform:suspend(Preferences)->Preferences):Preferences=throw IOException("Fixture write failure")}
        val prefs=UserPreferences(broken)
        assertEquals(SettingsRead.Failed,prefs.state.first())
        prefs.retry();assertEquals(SettingsRead.Failed,prefs.state.first())
    }
    @Test fun appScaleDefaultsToStandardAndChoiceSurvivesReopenAndArchive() = runBlocking(Dispatchers.IO) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "app-scale-preferences-${UUID.randomUUID()}").apply { mkdirs() }
        val originalFile = File(folder, "original.preferences_pb")
        val restoredFile = File(folder, "restored.preferences_pb")
        var originalScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val restoredScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            var store = PreferenceDataStoreFactory.create(scope = originalScope, produceFile = { originalFile })
            var preferences = UserPreferences(store)
            assertFalse((preferences.state.first() as SettingsRead.Ready).value.useSystemScale)
            preferences.appearance(Appearance.Dark)
            preferences.useSystemScale(true)
            val archived = preferences.archiveSnapshot()
            originalScope.coroutineContext[Job]!!.cancelAndJoin()
            originalScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            store = PreferenceDataStoreFactory.create(scope = originalScope, produceFile = { originalFile })
            preferences = UserPreferences(store)
            val reopened = (preferences.state.first() as SettingsRead.Ready).value
            assertTrue(reopened.useSystemScale)
            assertEquals(Appearance.Dark, reopened.appearance)

            DiaryRuntime.writePreferences(context, restoredFile, archived)
            val restored = UserPreferences(PreferenceDataStoreFactory.create(scope = restoredScope, produceFile = { restoredFile }))
            assertTrue((restored.state.first() as SettingsRead.Ready).value.useSystemScale)
            preferences.useSystemScale(false)
            assertFalse((preferences.state.first() as SettingsRead.Ready).value.useSystemScale)
            assertTrue((restored.state.first() as SettingsRead.Ready).value.useSystemScale)
            assertEquals(Appearance.Dark, (preferences.state.first() as SettingsRead.Ready).value.appearance)
        } finally {
            originalScope.coroutineContext[Job]!!.cancelAndJoin()
            restoredScope.coroutineContext[Job]!!.cancelAndJoin()
            check(folder.canonicalFile.parentFile == context.cacheDir.canonicalFile)
            folder.deleteRecursively()
        }
    }
    @Test fun statisticsVisibilitySurvivesConcurrentChangesReopenAndArchivePreferences() = runBlocking(Dispatchers.IO) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "statistics-preferences-${UUID.randomUUID()}").apply { mkdirs() }
        val originalFile = File(folder, "original.preferences_pb")
        val restoredFile = File(folder, "restored.preferences_pb")
        var originalScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val restoredScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            var store = PreferenceDataStoreFactory.create(scope = originalScope, produceFile = { originalFile })
            var preferences = UserPreferences(store)
            assertTrue((preferences.state.first() as SettingsRead.Ready).value.disabledStatistics.isEmpty())
            val futureFlag = "future-statistic"
            store.edit { it[stringSetPreferencesKey(DISABLED_STATISTICS_KEY)] = setOf(futureFlag) }
            coroutineScope {
                listOf(StatisticFeature.Average, StatisticFeature.Grouping, StatisticFeature.Norms).forEach { feature ->
                    launch { preferences.statistic(feature, false) }
                }
            }
            preferences.statistic(StatisticFeature.Average, true)
            val expected = setOf(futureFlag, StatisticFeature.Grouping.wire, StatisticFeature.Norms.wire)
            assertEquals(expected, (preferences.state.first() as SettingsRead.Ready).value.disabledStatistics)
            val archived = preferences.archiveSnapshot()
            assertEquals("stringSet", archived.getValue(DISABLED_STATISTICS_KEY).first)
            originalScope.coroutineContext[Job]!!.cancelAndJoin()
            originalScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            store = PreferenceDataStoreFactory.create(scope = originalScope, produceFile = { originalFile })
            preferences = UserPreferences(store)
            assertEquals(expected, (preferences.state.first() as SettingsRead.Ready).value.disabledStatistics)

            DiaryRuntime.writePreferences(context, restoredFile, archived)
            val restored = UserPreferences(PreferenceDataStoreFactory.create(scope = restoredScope, produceFile = { restoredFile }))
            assertEquals(expected, (restored.state.first() as SettingsRead.Ready).value.disabledStatistics)
            preferences.resetStatistics()
            assertEquals(setOf(futureFlag), (preferences.state.first() as SettingsRead.Ready).value.disabledStatistics)
            assertEquals(expected, (restored.state.first() as SettingsRead.Ready).value.disabledStatistics)
        } finally {
            originalScope.coroutineContext[Job]!!.cancelAndJoin()
            restoredScope.coroutineContext[Job]!!.cancelAndJoin()
            check(folder.canonicalFile.parentFile == context.cacheDir.canonicalFile)
            folder.deleteRecursively()
        }
    }
    @Test fun averagePrecisionSurvivesReopenWithoutChangingOtherSettings()=runBlocking {
        val file=File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,"average-precision-"+UUID.randomUUID()+".preferences_pb")
        var scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        try {
            var preferences=UserPreferences(PreferenceDataStoreFactory.create(scope=scope,produceFile={file}))
            assertFalse((preferences.state.first() as SettingsRead.Ready).value.averageHundredths)
            assertTrue((preferences.state.first() as SettingsRead.Ready).value.keepAwake)
            preferences.averageHundredths(true)
            val snapshot=preferences.archiveSnapshot()
            assertEquals("boolean" to true,snapshot["average_hundredths_v1"])
            scope.coroutineContext[Job]!!.cancelAndJoin()
            scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
            preferences=UserPreferences(PreferenceDataStoreFactory.create(scope=scope,produceFile={file}))
            assertTrue((preferences.state.first() as SettingsRead.Ready).value.averageHundredths)
            preferences.averageHundredths(false)
            assertFalse((preferences.state.first() as SettingsRead.Ready).value.averageHundredths)
        } finally {scope.coroutineContext[Job]!!.cancelAndJoin();file.delete()}
    }

}

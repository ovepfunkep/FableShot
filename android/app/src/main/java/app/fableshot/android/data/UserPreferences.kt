package app.fableshot.android.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import androidx.datastore.core.DataStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import java.io.IOException

private val Context.fablePreferences by preferencesDataStore("fableshot_preferences")

enum class DesignStyle(val wire: String) { Sport("sport"), Pop("pop"), Minimal("minimal") }
enum class Appearance(val wire: String) { System("system"), Light("light"), Dark("dark") }
internal const val SHOOTING_BASE_MINUTES_KEY = "shooting_base_minutes_v1"
internal const val MAX_SHOOTING_BASE_MINUTES = 59_999_999L

data class UserSettings(
    val style: DesignStyle = DesignStyle.Sport,
    val appearance: Appearance = Appearance.System,
    val animations: Boolean = true,
    val haptics: Boolean = false,
    val sound: Boolean = false,
    val keepAwake: Boolean = true,
    val displayName: String = "",
    val onboardingVersion: Int = 0,
    val tutorialVersion: Int = 0,
    val techniqueHome:Boolean=true,val techniqueFocus:Boolean=true,val techniqueReflection:Boolean=true,
    val rankCategory: String? = null,
    val trainingPresetsJson:String?=null,
    val seriesTimerSeconds: Int = 120,
    val restTimerSeconds: Int = 60,
    val hideCurrentScores: Boolean = false,
    val showAchievements: Boolean = true,
    val shootingBaseMinutes: Long = 0,
    val disabledStatistics: Set<String> = emptySet(),
    val lastSeenReleaseCode: Int? = null,
    val useSystemScale: Boolean = false,
    val averageHundredths: Boolean = false,
    val trainingOnLockScreen: Boolean = true,
)

sealed interface SettingsRead {
    data object Loading : SettingsRead
    data class Ready(val value: UserSettings) : SettingsRead
    data object Failed : SettingsRead
}

/** Small preferences only. Training and equipment facts belong to Room. */
class UserPreferences(private val store: DataStore<Preferences>,private val gate:WriteGate=WriteGate()) {
    constructor(context: Context) : this(context.applicationContext.fablePreferences)
    private val retries = MutableStateFlow(0)
    private object Keys {
        val style = stringPreferencesKey("designStyle")
        val appearance = stringPreferencesKey("appearanceMode")
        val animations = booleanPreferencesKey("animationsEnabled")
        val haptics = booleanPreferencesKey("hapticsEnabled")
        val sound = booleanPreferencesKey("soundEnabled")
        val awake = booleanPreferencesKey("keepScreenAwake")
        val name = stringPreferencesKey("displayName")
        val achievementNameEvent = stringPreferencesKey("achievement_name_event_v2")
        val onboarding = intPreferencesKey("onboardingCompletedVersion")
        val disposition = stringPreferencesKey("onboardingDisposition")
        val tutorial = intPreferencesKey("targetTutorialVersion")
        val shootingBaseMinutes = longPreferencesKey(SHOOTING_BASE_MINUTES_KEY)
        val disabledStatistics = stringSetPreferencesKey(DISABLED_STATISTICS_KEY)
        val lastSeenReleaseCode = intPreferencesKey(LAST_SEEN_RELEASE_CODE_KEY)
        val systemScale = booleanPreferencesKey("use_system_scale_v1")
        val averageHundredths = booleanPreferencesKey("average_hundredths_v1")
        val trainingOnLockScreen = booleanPreferencesKey("training_on_lock_screen_v1")
    }
    @OptIn(ExperimentalCoroutinesApi::class)
    val state: Flow<SettingsRead> = retries.flatMapLatest {
        store.data.map<Preferences, SettingsRead> { p ->
            SettingsRead.Ready(UserSettings(
                DesignStyle.entries.firstOrNull { it.wire == p[Keys.style] } ?: DesignStyle.Sport,
                Appearance.entries.firstOrNull { it.wire == p[Keys.appearance] } ?: Appearance.System,
                p[Keys.animations] ?: true, p[Keys.haptics] ?: false, p[Keys.sound] ?: false,
                p[Keys.awake] ?: true, p[Keys.name].orEmpty(), p[Keys.onboarding] ?: 0, p[Keys.tutorial] ?: 0,
                p[booleanPreferencesKey("technique_home")]?:true,p[booleanPreferencesKey("technique_focus")]?:true,p[booleanPreferencesKey("technique_reflection")]?:true,
                p[stringPreferencesKey("rank_category_v1")]?.takeIf { it in setOf("male", "female") },
                p[stringPreferencesKey(TrainingPresets.KEY)],
                p[intPreferencesKey("series_timer_seconds_v1")] ?: 120,
                p[intPreferencesKey("rest_timer_seconds_v1")] ?: 60,
                p[booleanPreferencesKey("hide_current_scores_v1")] ?: false,
                p[booleanPreferencesKey("show_achievements_v1")] ?: true,
                p[Keys.shootingBaseMinutes] ?: 0L,
                disabledStatistics = p[Keys.disabledStatistics] ?: emptySet(),
                lastSeenReleaseCode = p[Keys.lastSeenReleaseCode]?.takeIf { it > 0 },
                useSystemScale = p[Keys.systemScale] ?: false,
                averageHundredths = p[Keys.averageHundredths] ?: false,
                trainingOnLockScreen = p[Keys.trainingOnLockScreen] ?: true,
            ))
        }.catch { if (it is IOException) emit(SettingsRead.Failed) else throw it }
    }
    fun retry() { retries.value++ }
    suspend fun averageHundredths(value: Boolean) { edit { it[Keys.averageHundredths] = value } }
    suspend fun trainingOnLockScreen(value: Boolean) { edit { it[Keys.trainingOnLockScreen] = value } }
    private suspend fun edit(block:suspend(MutablePreferences)->Unit) {gate.write{store.edit(block)}}
    /** Snapshot the stored keys, including disposition and future keys hidden from UserSettings. */
    suspend fun archiveSnapshot(): Map<String, Pair<String, Any>> = store.data.first().asMap().map { (key,value) ->
        val typed = when(value) {
            is String -> "string" to value
            is Boolean -> "boolean" to value
            is Int -> "int" to value
            is Long -> "long" to value
            is Float -> "float" to value
            is Double -> "double" to value
            is Set<*> -> "stringSet" to value.map { require(it is String); it }.sorted()
            is ByteArray -> "bytes" to android.util.Base64.encodeToString(value,android.util.Base64.NO_WRAP)
            else -> error("Unsupported preference type")
        }
        key.name to typed
    }.toMap()
    suspend fun style(value: DesignStyle) { edit { it[Keys.style] = value.wire } }
    suspend fun appearance(value: Appearance) { edit { it[Keys.appearance] = value.wire } }
    suspend fun useSystemScale(value: Boolean) { edit { it[Keys.systemScale] = value } }
    suspend fun animations(value: Boolean) { edit { it[Keys.animations] = value } }
    suspend fun rankCategory(value: String) {
        require(value in setOf("male", "female"))
        edit { it[stringPreferencesKey("rank_category_v1")] = value }
    }
    internal suspend fun rankCategorySnapshot():String? = store.data.first()[stringPreferencesKey("rank_category_v1")]
        ?.takeIf {it in setOf("male","female")}
    suspend fun haptics(value: Boolean) { edit { it[Keys.haptics] = value } }
    suspend fun hideCurrentScores(value: Boolean) { edit {it[booleanPreferencesKey("hide_current_scores_v1")] = value} }
    suspend fun showAchievements(value: Boolean) { edit {it[booleanPreferencesKey("show_achievements_v1")] = value} }
    suspend fun statistic(feature: StatisticFeature, visible: Boolean) {
        edit { preferences ->
            val disabled = preferences[Keys.disabledStatistics].orEmpty()
            preferences[Keys.disabledStatistics] = if (visible) disabled - feature.wire else disabled + feature.wire
        }
    }
    suspend fun resetStatistics() {
        edit { preferences ->
            preferences[Keys.disabledStatistics] =
                preferences[Keys.disabledStatistics].orEmpty() - StatisticFeature.entries.map { it.wire }.toSet()
        }
    }
    suspend fun acknowledgeReleaseNotes(code: Int) {
        require(code > 0)
        edit { preferences ->
            preferences[Keys.lastSeenReleaseCode] = maxOf(preferences[Keys.lastSeenReleaseCode] ?: 0, code)
        }
    }
    suspend fun shootingBaseMinutes(value: Long) {
        require(value in 0..MAX_SHOOTING_BASE_MINUTES)
        edit { it[Keys.shootingBaseMinutes] = value }
    }
    suspend fun timerDurations(series: Int, rest: Int) {
        require(series in 1..3600 && rest in 1..3600)
        edit {
            it[intPreferencesKey("series_timer_seconds_v1")] = series
            it[intPreferencesKey("rest_timer_seconds_v1")] = rest
        }
    }
    suspend fun sound(value: Boolean) { edit { it[Keys.sound] = value } }
    suspend fun keepAwake(value: Boolean) { edit { it[Keys.awake] = value } }
    internal val achievementNameEvents = store.data.map { preferences ->
        preferences[Keys.achievementNameEvent]?.let { raw ->
            val parts = raw.split('|', limit = 2)
            if (parts.size == 2 && parts[1].toLongOrNull() != null) parts[0] to parts[1].toLong() else null
        }
    }
    internal suspend fun achievementNameEventSnapshot(): String? = store.data.first()[Keys.achievementNameEvent]

    /** Caller owns this generation's write gate, also while handling a queued name event. */
    internal suspend fun replaceAchievementNameEventWithGateHeld(value: String?) {
        store.edit { preferences ->
            if (value == null) preferences.remove(Keys.achievementNameEvent)
            else preferences[Keys.achievementNameEvent] = value
        }
    }
    /** Archive replacement restores receipts, never replays the saved command that created a name. */
    internal suspend fun discardPendingAchievementNameEvent() {
        edit { it.remove(Keys.achievementNameEvent) }
    }
    suspend fun displayName(value: String) { edit {
        val name = value.trim().take(40)
        it[Keys.name] = name
        if (name.isNotBlank()) it[Keys.achievementNameEvent] =
            "${java.util.UUID.randomUUID()}|${System.currentTimeMillis()}"
    } }
    suspend fun finishOnboarding(disposition: String) {
        require(disposition in setOf("completed", "skipped", "existing_user"))
        edit { it[Keys.onboarding] = 1; it[Keys.disposition] = disposition }
    }
    suspend fun techniqueVisibility(kind:String,value:Boolean){require(kind in listOf("home","focus","reflection"));edit{it[booleanPreferencesKey("technique_$kind")]=value}}
    suspend fun habitualTraining(): String? = store.data.first()[stringPreferencesKey("habitual_training_v1")]
    suspend fun habitualTraining(value: String) { edit { it[stringPreferencesKey("habitual_training_v1")] = value } }
    suspend fun finishTutorial() { edit { it[Keys.tutorial] = 1 } }
    suspend fun saveTrainingPreset(value:TrainingPreset) {
        edit {p ->
            val key=stringPreferencesKey(TrainingPresets.KEY)
            p[key]=TrainingPresets.encode(TrainingPresets.save(TrainingPresets.decode(p[key]),value))
        }
    }
    suspend fun removeTrainingPreset(id:String) {
        edit {p ->
            val key=stringPreferencesKey(TrainingPresets.KEY)
            p[key]=TrainingPresets.encode(TrainingPresets.decode(p[key]).filterNot {it.id==id})
        }
    }
}

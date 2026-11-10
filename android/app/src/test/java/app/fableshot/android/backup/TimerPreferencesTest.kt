package app.fableshot.android.backup

import org.junit.Assert.*
import org.junit.Test

class TimerPreferencesTest {
    @Test fun durationPreferencesRoundTripWithoutTimerRuntime() {
        val source = mapOf("series_timer_seconds_v1" to ("int" to 120), "rest_timer_seconds_v1" to ("int" to 3600))
        val decoded = ArchivePreferences.decode(ArchivePreferences.encode(source))
        assertEquals("int" to 120L, decoded["series_timer_seconds_v1"])
        assertEquals("int" to 3600L, decoded["rest_timer_seconds_v1"])
    }

    @Test fun invalidDurationsCannotBeRestored() {
        for (value in listOf("int" to 0, "int" to 3601, "string" to "120", "long" to 120L)) {
            assertThrows(ArchiveInvalid::class.java) {ArchivePreferences.encode(mapOf("series_timer_seconds_v1" to value))}
        }
    }

    @Test fun visibilityPreferenceIsTypedAndDoesNotDiscardDurations() {
        val values = mapOf("hide_current_scores_v1" to ("boolean" to true), "series_timer_seconds_v1" to ("int" to 90))
        val restored = ArchivePreferences.decode(ArchivePreferences.encode(values))
        assertEquals("boolean" to true, restored["hide_current_scores_v1"])
        assertEquals("int" to 90L, restored["series_timer_seconds_v1"])
        assertThrows(ArchiveInvalid::class.java) {
            ArchivePreferences.encode(mapOf("hide_current_scores_v1" to ("string" to "true")))
        }
    }

    @Test fun achievementsPreferenceRoundTripsAndRejectsAnInvalidType() {
        val result = ArchivePreferences.decode(ArchivePreferences.encode(mapOf("show_achievements_v1" to ("boolean" to false))))
        assertEquals("boolean" to false, result["show_achievements_v1"])
        assertThrows(ArchiveInvalid::class.java) {
            ArchivePreferences.encode(mapOf("show_achievements_v1" to ("int" to 1)))
        }
    }
}

package app.fableshot.android

import app.fableshot.android.data.AppReleases
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.pendingVersions
import org.junit.Assert.*
import org.junit.Test

class ReleaseNotesPolicyTest {
    @Test fun freshInstallationDoesNotOpenOldReleaseNotes() {
        assertTrue(UserSettings().pendingVersions(53, existingInstallation = false).isEmpty())
    }

    @Test fun skippedVersionsIncludeBothImportantAndQuietChanges() {
        val delta = UserSettings(lastSeenReleaseCode = 46).pendingVersions(53, existingInstallation = true)
        assertEquals((53 downTo 47).toList(), delta.map { it.versionCode })
        assertTrue(delta.any { it.important })
        assertTrue(delta.any { !it.important })
    }

    @Test fun maintenanceUpdatePreservesBoundaryWithoutAutomaticPopup() {
        val delta = UserSettings(lastSeenReleaseCode = 47).pendingVersions(48, existingInstallation = true)
        assertEquals(listOf(48), delta.map { it.versionCode })
        assertFalse(delta.any { it.important })
        assertTrue(delta.flatMap { it.highlights }.isEmpty())
    }

    @Test fun consolidatedDeltaRetainsEveryVersionButContainsOnlyMajorHighlights() {
        val delta = UserSettings(lastSeenReleaseCode = 40).pendingVersions(54, existingInstallation = true)
        assertEquals((54 downTo 41).toList(), delta.map { it.versionCode })
        val maintenance = delta.single { it.versionCode == 48 }
        assertFalse(maintenance.important)
        assertTrue(maintenance.highlights.isEmpty())
        val quietFeature = delta.single { it.versionCode == 41 }
        assertFalse(quietFeature.important)
        assertTrue(quietFeature.highlights.isNotEmpty())
        assertTrue(delta.filter { it.important }.all { it.highlights.isNotEmpty() })
        assertEquals(listOf("Достижения можно сбросить отдельно от тренировок и статистики."), delta.first().highlights)
    }

    @Test fun legacyBaselineAndAcknowledgedVersionsRespectInstalledEdition() {
        val legacy = UserSettings(lastSeenReleaseCode = 0).pendingVersions(52, existingInstallation = true)
        assertEquals(52, legacy.first().versionCode)
        assertEquals(40, legacy.last().versionCode)
        assertTrue(UserSettings(lastSeenReleaseCode = 53).pendingVersions(53, true).isEmpty())
        assertTrue(UserSettings(lastSeenReleaseCode = 53).pendingVersions(52, true).isEmpty())
        assertEquals(AppReleases.entries.size, AppReleases.entries.map { it.versionCode }.distinct().size)
    }
}

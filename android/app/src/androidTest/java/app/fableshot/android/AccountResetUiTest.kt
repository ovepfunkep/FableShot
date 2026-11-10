package app.fableshot.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.backup.*
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.util.UUID

class AccountResetUiTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var root: File
    private lateinit var manager: DiaryManager

    @Before fun setup() = runBlocking(Dispatchers.IO) {
        root = File(context.cacheDir, "verification-reset-ui-${UUID.randomUUID()}").apply { mkdirs() }
        val generations = DiaryGenerations(File(root, "generations"))
        val directory = generations.newFolder()
        val runtime = DiaryRuntime(context, directory.name, directory)
        try {
            runtime.warmUp()
            runtime.preferences.finishOnboarding("completed")
            runtime.preferences.showAchievements(false)
            runtime.repository.journal.start("Isolated UI fixture", BlockPlan(18.0, 400))
            runtime.repository.journal.numeric(runtime.repository.journal.active.first()!!.currentEnd!!.end.id, 8)
            generations.seal(directory)
        } finally { runtime.close() }
        generations.activate(directory.name, DiarySelection())
        manager = DiaryManager(context, directory.parentFile!!, recoveryBackups = LocalRecoveryBackups(File(root, "backups")))
        Unit
    }

    @After fun cleanup() = runBlocking(Dispatchers.IO) {
        manager.close()
        check(root.canonicalFile.parentFile == context.cacheDir.canonicalFile && root.name.startsWith("verification-reset-ui-"))
        root.deleteRecursively()
        Unit
    }

    private fun waitTag(tag: String) {
        ui.waitUntil(10_000) { ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun mountSettings(canReset: State<Boolean> = mutableStateOf(true)) {
        ui.setContent {
            val runtime by manager.runtime.collectAsState()
            var page by remember { mutableStateOf("settings") }
            key(runtime) {
                FableTheme(UserSettings(animations = false)) {
                    Surface {
                        if (page == "archive") ArchiveScreen(runtime.archive, diaries = manager)
                        else SettingsScreen(UserSettings(), {}, {}, {}, {}, {}, {}, {},
                            onArchive = { page = "archive" }, diaries = manager, canReset = canReset.value)
                    }
                }
            }
        }
        ui.onNodeWithText("Данные и перенос").performClick()
    }

    @Test fun resetRequiresIdleStateExplicitAcknowledgementAndCancelLeavesDiaryUntouched() {
        val canReset = mutableStateOf(false)
        val original = manager.current.id
        mountSettings(canReset)
        ui.onNodeWithTag("settings-screen").performScrollToNode(hasTestTag("account-reset"))
        ui.onNodeWithTag("account-reset").assertIsNotEnabled()
        ui.runOnIdle { canReset.value = true }
        ui.waitUntil(10_000) { ui.onAllNodes(hasTestTag("account-reset") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("account-reset").performClick()
        ui.onNodeWithTag("account-reset-confirm").assertIsNotEnabled()
        ui.onNodeWithText("В текущем дневнике: 1 тренировок и 1 стрел, включая корзину.").assertExists()
        ui.onNodeWithText("Отмена").performClick()
        assertEquals(original, manager.current.id)
        assertEquals(1, runBlocking { manager.current.repository.journal.active.first()!!.allShots.size })
        assertNull(runBlocking { manager.recoveryBackups.discover().latest })
    }

    @Test fun confirmedResetOffersBackupMetadataAndPreviewBeforeExplicitRestoration() {
        val original = manager.current.id
        mountSettings()
        ui.onNodeWithTag("settings-screen").performScrollToNode(hasTestTag("account-reset"))
        ui.waitUntil(10_000) { ui.onAllNodes(hasTestTag("account-reset") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithTag("account-reset").performClick()
        ui.onNodeWithTag("account-reset-ack").performClick()
        ui.onNodeWithTag("account-reset-confirm").assertIsEnabled().performClick()
        ui.waitUntil(20_000) { manager.current.id != original }
        val empty = manager.current.id
        assertTrue(runBlocking { manager.current.repository.journal.history.first().isEmpty() })
        assertEquals(UserSettings(), runBlocking { (manager.current.preferences.state.first() as SettingsRead.Ready).value })
        // The new runtime remounts settings at its first-level list.
        waitTag("settings-screen")
        ui.onNodeWithText("Данные и перенос").performClick()
        ui.onNodeWithTag("settings-screen").performScrollToNode(hasTestTag("open-archive"))
        ui.onNodeWithTag("open-archive").performClick()
        waitTag("recovery-backup-preview")
        ui.onNodeWithTag("recovery-backup-date").assertExists()
        ui.onNodeWithTag("recovery-backup-file").assertTextContains(".fableshot", substring = true)
        ui.onNodeWithTag("recovery-backup-counts").assertTextContains("1 тренировок · 1 стрел", substring = true)
        ui.onNodeWithTag("archive-screen").performScrollToNode(hasTestTag("recovery-backup-preview"))
        ui.onNodeWithTag("recovery-backup-preview").performClick()
        waitTag("archive-preview")
        assertEquals(empty, manager.current.id)
        ui.onNodeWithTag("archive-screen").performScrollToNode(hasTestTag("archive-apply"))
        ui.onNodeWithTag("archive-apply").performClick()
        ui.onNodeWithTag("archive-apply-confirm").assertIsNotEnabled()
        ui.onNodeWithTag("archive-ack").performClick()
        ui.onNodeWithTag("archive-apply-confirm").performClick()
        ui.waitUntil(20_000) { manager.current.id != empty }
        assertEquals(8, runBlocking { manager.current.repository.journal.active.first()!!.allShots.single().points })
        assertFalse(runBlocking { (manager.current.preferences.state.first() as SettingsRead.Ready).value.showAchievements })
        waitTag("archive-undo")
    }

    @Test fun recoveryCardDistinguishesNoBackupAndUnreadableCatalog() {
        val revision = mutableIntStateOf(0)
        ui.setContent {
            key(revision.intValue) {
                FableTheme(UserSettings(animations = false)) {
                    Surface { ArchiveScreen(manager.current.archive, diaries = manager) }
                }
            }
        }
        waitTag("recovery-backup-empty")
        File(root, "backups").writeText("Unreadable catalog fixture")
        ui.runOnIdle { revision.intValue++ }
        waitTag("recovery-backup-error")
        ui.onNodeWithTag("archive-export").assertIsEnabled()
        assertEquals(1, runBlocking { manager.current.repository.journal.active.first()!!.allShots.size })
    }

    @Test fun corruptNewerCopyIsExplainedWhileVerifiedOlderCopyRemainsAvailable() = runBlocking(Dispatchers.IO) {
        val backup = manager.resetAccount()
        File(backup.file.parentFile, "${backup.savedAtMs + 1000}-${UUID.randomUUID()}.fableshot").writeText("Corrupt newer fixture")
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Surface { ArchiveScreen(manager.current.archive, diaries = manager) }
            }
        }
        waitTag("recovery-backup-warning")
        ui.onNodeWithTag("recovery-backup-counts").assertTextContains("1 тренировок · 1 стрел", substring = true)
        ui.onNodeWithTag("recovery-backup-preview").assertIsEnabled()
        Unit
    }

    @Test fun achievementsCanBeResetSeparatelyAfterConfirmationWithBackup() {
        val originalId = manager.current.id
        runBlocking(Dispatchers.IO) { manager.current.repository.journal.achievements.service("APP04", "ui-reset-awards") }
        mountSettings()
        ui.onNodeWithTag("settings-screen").performScrollToNode(hasTestTag("achievement-reset"))
        ui.onNodeWithTag("achievement-reset").performClick()
        ui.onNodeWithTag("achievement-reset-dismiss").performClick()
        assertTrue(runBlocking { manager.current.journal.achievementDao().grants().isNotEmpty() })
        assertNull(runBlocking { manager.recoveryBackups.discover().latest })

        ui.onNodeWithTag("achievement-reset").performClick()
        ui.onNodeWithTag("achievement-reset-confirm").performClick()
        waitTag("achievement-reset-message")
        ui.onNodeWithTag("achievement-reset-message").assertTextEquals("Достижения сброшены. Резервная копия сохранена в «Архиве».")
        assertEquals(originalId, manager.current.id)
        assertEquals(1, runBlocking { manager.current.repository.journal.active.first()!!.allShots.size })
        assertTrue(runBlocking { manager.current.journal.achievementDao().grants().isEmpty() })
        assertTrue(runBlocking { manager.current.journal.achievementDao().enrollments().isEmpty() })
        assertFalse(runBlocking { (manager.current.preferences.state.first() as SettingsRead.Ready).value.showAchievements })
        assertNotNull(runBlocking { manager.recoveryBackups.discover().latest })
    }
}

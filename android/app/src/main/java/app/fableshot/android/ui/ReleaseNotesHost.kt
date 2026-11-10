package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import app.fableshot.android.BuildConfig
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.pendingVersions
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Installation notes are acknowledged separately from viewing the full history in Settings. */
@Composable
internal fun ReleaseNotesHost(
    settings: UserSettings,
    existingInstallation: Boolean,
    onAcknowledge: suspend (Int) -> Unit,
    editionVersionCode: Int = BuildConfig.VERSION_CODE,
) {
    var previousVersion by rememberSaveable(editionVersionCode) { mutableStateOf<Int?>(null) }
    // Only the persisted acknowledgement survives recreation; a cancelled write must not hide notes.
    var dismissed by remember(editionVersionCode) { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val acknowledge by rememberUpdatedState(onAcknowledge)
    val pending = settings.copy(lastSeenReleaseCode = previousVersion ?: settings.lastSeenReleaseCode)
        .pendingVersions(editionVersionCode, existingInstallation)
    val important = pending.any { it.important }

    suspend fun saveSeen() {
        try {
            acknowledge(editionVersionCode)
            failed = false
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            android.util.Log.e("FableReleaseNotes", "Could not save viewed release", error)
            failed = true
        } finally { saving = false }
    }
    fun dismiss() {
        if (saving) return
        dismissed = true
        saving = true
        scope.launch { saveSeen() }
    }
    LaunchedEffect(editionVersionCode, settings.lastSeenReleaseCode, existingInstallation, important) {
        if (!important && (settings.lastSeenReleaseCode ?: 0) < editionVersionCode && !saving) {
            saving = true
            saveSeen()
        }
    }
    if (important && !dismissed && settings.onboardingVersion > 0) {
        ReleaseNotesSheet(
            pending,
            onDismiss = ::dismiss,
            onPreviousVersion = if (settings.lastSeenReleaseCode == null) ({ previousVersion = it }) else null,
            previousVersionCode = previousVersion ?: settings.lastSeenReleaseCode,
        )
    }
    if (failed) AlertDialog(
        onDismissRequest = { failed = false },
        title = { Text("Не удалось сохранить просмотр") },
        text = { Text("Окно обновлений может появиться снова при следующем запуске.") },
        confirmButton = {
            TextButton(onClick = { if (!saving) { saving = true; scope.launch { saveSeen() } } }) { Text("Повторить") }
        },
        dismissButton = { TextButton(onClick = { failed = false }) { Text("Закрыть") } },
    )
}

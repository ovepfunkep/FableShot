package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledDropdownMenu as DropdownMenu

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.BuildConfig
import app.fableshot.android.data.AppRelease
import app.fableshot.android.data.AppReleases

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReleaseNotesSheet(
    releases: List<AppRelease>,
    onDismiss: () -> Unit,
    onPreviousVersion: ((Int) -> Unit)? = null,
    previousVersionCode: Int? = null,
    fullHistory: Boolean = false,
) {
    val newest = releases.maxByOrNull { it.versionCode }
    val previousLabel = AppReleases.entries.firstOrNull { it.versionCode == previousVersionCode }?.versionName
        ?: "0.18 и раньше"
    val latestLabel = newest?.versionName ?: BuildConfig.VERSION_NAME
    val deltaRange = "$previousLabel → $latestLabel"
    val highlights = releases.sortedByDescending { it.versionCode }.flatMap { it.highlights }.distinct()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(Modifier.fillMaxWidth().heightIn(max = 720.dp).navigationBarsPadding()
            .testTag("release-notes")) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FableIcon(Glyph.Spark, tint = MaterialTheme.colorScheme.primary)
                Text(if (fullHistory) "История обновлений" else "Что нового",
                    Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                IconButton(onDismiss, Modifier.testTag("release-notes-close")) {
                    FableIcon(Glyph.Close, description = "Закрыть")
                }
            }
            LazyColumn(
                Modifier.fillMaxWidth().weight(1f, fill = false),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                if (onPreviousVersion != null) item {
                    PreviousReleaseChoice(previousVersionCode ?: 0, onPreviousVersion)
                }
                if (fullHistory) {
                    items(releases.filter { it.highlights.isNotEmpty() }.sortedByDescending { it.versionCode },
                        key = { it.versionCode }) { release ->
                        Surface(
                            Modifier.fillMaxWidth().testTag("release-history-${release.versionCode}"),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f),
                            shape = MaterialTheme.shapes.large,
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text(release.versionName, color = MaterialTheme.colorScheme.primary,
                                    style = MaterialTheme.typography.labelLarge)
                                Text(release.title, style = MaterialTheme.typography.titleMedium)
                                release.highlights.distinct().forEach { ReleaseHighlight(it) }
                            }
                        }
                    }
                } else {
                    item {
                        Text(deltaRange, Modifier.testTag("release-notes-range"),
                            color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                    }
                    if (highlights.isEmpty()) item {
                        Text("В этом промежутке не было крупных обновлений.", style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    items(highlights) { ReleaseHighlight(it) }
                }
            }
            FablePrimaryButton(
                "Понятно", onDismiss,
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)
                    .testTag("release-notes-confirm"),
            )
        }
    }
}

@Composable
private fun ReleaseHighlight(text: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        FableIcon(Glyph.Check, Modifier.size(16.dp).padding(top = 2.dp),
            tint = MaterialTheme.colorScheme.primary)
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun PreviousReleaseChoice(selected: Int, onSelect: (Int) -> Unit) {
    var choosing by remember { mutableStateOf(false) }
    val label = AppReleases.entries.firstOrNull { it.versionCode == selected }?.versionName ?: "0.18 и раньше"
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Какая версия была до обновления?", style = MaterialTheme.typography.titleSmall)
        Box {
            OutlinedButton({ choosing = true }, Modifier.fillMaxWidth().testTag("release-notes-previous")) {
                Text(label, Modifier.weight(1f))
                FableIcon(Glyph.Next)
            }
            DropdownMenu(choosing, { choosing = false }, Modifier.heightIn(max = 320.dp)) {
                AppReleases.entries.filter { it.versionCode < BuildConfig.VERSION_CODE }.forEach { release ->
                    DropdownMenuItem(
                        text = { Text(release.versionName) },
                        onClick = { choosing = false; onSelect(release.versionCode) },
                        modifier = Modifier.testTag("release-previous-${release.versionCode}"),
                    )
                }
                DropdownMenuItem(
                    text = { Text("0.18 и раньше") },
                    onClick = { choosing = false; onSelect(0) },
                    modifier = Modifier.testTag("release-previous-0"),
                )
            }
        }
    }
}

@Composable
internal fun ReleaseVersionStrip(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().testTag("settings-version"),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .4f),
    ) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            FableIcon(Glyph.History, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("FableShot ${BuildConfig.VERSION_NAME}", Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
            Text("Что нового", style = MaterialTheme.typography.labelMedium)
            FableIcon(Glyph.Next, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

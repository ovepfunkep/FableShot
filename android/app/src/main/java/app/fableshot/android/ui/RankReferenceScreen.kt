package app.fableshot.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.fableshot.android.ui.ScaledDialog as Dialog
import androidx.compose.ui.window.DialogProperties
import app.fableshot.android.domain.*

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun RankReferenceScreen(initialBow: String?, initialCategory: String?, onClose: () -> Unit) {
    // Browsing the reference never changes the user's comparison category.
    var bow by rememberSaveable { mutableStateOf(initialBow ?: "barebow") }
    var category by rememberSaveable { mutableStateOf(initialCategory ?: "male") }
    val rows = SportRankReference.rows.filter { it.group == bow }
    val horizontal = rememberScrollState()
    val vertical = rememberScrollState()
    val cellWidth = (72 * LocalDensity.current.fontScale.coerceAtLeast(1f)).dp
    val uri = LocalUriHandler.current
    Dialog(onDismissRequest=onClose, properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxSize().testTag("rank-reference"), color=MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp),
                verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Text("Разрядная сетка",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                    IconButton(onClose) { FableIcon(Glyph.Close, description="Закрыть разрядную сетку") }
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf("recurve" to "КЛ", "barebow" to "КЛб", "compound" to "БЛ", "3d" to "3Д").forEach { (id, label) ->
                        FilterChip(bow==id, {bow=id}, { Text(label) }, Modifier.testTag("rank-grid-bow-$id"))
                    }
                }
                FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf("male" to "Мужчины", "female" to "Женщины").forEach { (id, label) ->
                        FilterChip(category==id, {category=id}, {Text(label)}, Modifier.testTag("rank-grid-category-$id"))
                    }
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment=Alignment.CenterVertically) {
                    Text("Нормы, очки ↔", Modifier.weight(1f), style=MaterialTheme.typography.labelLarge)
                    RankSourceHelp()
                }
                Box(Modifier.weight(1f).fillMaxWidth().testTag("rank-grid-scroll")) {
                    Column(Modifier.fillMaxSize().verticalScroll(vertical).horizontalScroll(horizontal)) {
                        Row(Modifier.background(MaterialTheme.colorScheme.surfaceVariant), verticalAlignment=Alignment.CenterVertically) {
                            Text("Дисциплина / упражнение",Modifier.width(220.dp).padding(10.dp),style=MaterialTheme.typography.labelMedium)
                            SportRankReference.labels.forEach { label ->
                                Box(Modifier.width(cellWidth).padding(8.dp), contentAlignment=Alignment.Center) {
                                    Text(label,style=MaterialTheme.typography.labelMedium,maxLines=1)
                                }
                            }
                        }
                        rows.forEachIndexed { index, row ->
                            Row(Modifier.testTag("rank-grid-row-${row.sourceRow}")
                                .background(if (index % 2 == 0) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.35f)),
                                verticalAlignment=Alignment.CenterVertically) {
                                Column(Modifier.width(220.dp).padding(10.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                                    Text(row.title,style=MaterialTheme.typography.bodySmall,fontWeight=FontWeight.SemiBold)
                                    if (row.volume.isNotBlank()) Text(row.volume,style=MaterialTheme.typography.labelSmall)
                                    if (row.condition.isNotBlank()) Text(row.condition,style=MaterialTheme.typography.labelSmall,
                                        color=MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                val scores = if (category == "male") row.male else row.female
                                scores.forEachIndexed { column, score ->
                                    Box(Modifier.width(cellWidth).padding(8.dp),contentAlignment=Alignment.Center) {
                                        Text(score?.toString() ?: "—",Modifier.testTag("rank-grid-cell-${row.sourceRow}-$column"),
                                            style=MaterialTheme.typography.bodyMedium, maxLines=1)
                                    }
                                }
                            }
                            HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
                TextButton({uri.openUri(SportRankCatalog.DOCUMENT)},Modifier.fillMaxWidth()) {
                    Text("Полный документ ЕВСК · XLS",style=MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

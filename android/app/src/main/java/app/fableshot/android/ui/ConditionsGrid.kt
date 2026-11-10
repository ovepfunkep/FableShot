package app.fableshot.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

internal data class ConditionValue(val icon: Glyph, val value: String, val description: String)

/** One shared layout keeps condition values aligned on the home and history screens. */
@Composable
internal fun ConditionsGrid(
    values: List<ConditionValue>,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    if (values.isEmpty()) return
    val fontScale = LocalDensity.current.fontScale
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= (116 * fontScale.coerceAtMost(1.5f)).dp * 2 + 12.dp) 2 else 1
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            values.chunked(columns).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { condition ->
                        Row(Modifier.weight(1f).semantics(mergeDescendants = true) {
                            contentDescription = condition.description
                        }, verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            FableIcon(condition.icon, Modifier.size(18.dp), tint = color)
                            Text(condition.value, Modifier.weight(1f), color = color,
                                style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

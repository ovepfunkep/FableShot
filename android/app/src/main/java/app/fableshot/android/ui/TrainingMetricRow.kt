package app.fableshot.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Shared columns for series, round and pace; values never change the grid. */
@Composable
internal fun TrainingMetricRow(
    modifier: Modifier = Modifier,
    left: @Composable (Modifier) -> Unit,
    right: @Composable (Modifier) -> Unit,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(12.dp), verticalAlignment=Alignment.CenterVertically) {
        left(Modifier.weight(1f))
        right(Modifier.width(118.dp))
    }
}

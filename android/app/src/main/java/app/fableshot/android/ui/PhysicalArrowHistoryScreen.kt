package app.fableshot.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.journal.PhysicalArrowAnalysisGroup
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect

@Composable
fun PhysicalArrowHistoryScreen(
    arrowsSetId: String,
    analysis: Flow<List<PhysicalArrowAnalysisGroup>>,
) {
    var groups by remember(arrowsSetId) { mutableStateOf<List<PhysicalArrowAnalysisGroup>?>(null) }
    var failed by remember(arrowsSetId) { mutableStateOf(false) }
    var retry by remember(arrowsSetId) { mutableIntStateOf(0) }
    LaunchedEffect(arrowsSetId, analysis, retry) {
        failed = false
        try {
            analysis.collect { groups = it }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            android.util.Log.e("FableArrowAnalysis", "Could not load physical arrow history", error)
            failed = true
        }
    }
    when {
        failed -> Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Не удалось загрузить статистику стрел.", style = MaterialTheme.typography.bodyLarge)
            FablePrimaryButton("Повторить", { retry++ }, Modifier.testTag("physical-arrow-retry"))
        }
        groups == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else -> LazyColumn(Modifier.fillMaxSize().testTag("physical-arrow-history"),
            contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item { PhysicalArrowAnalysisCard(requireNotNull(groups)) }
        }
    }
}

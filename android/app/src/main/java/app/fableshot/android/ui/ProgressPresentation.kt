package app.fableshot.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.JournalSummaryMeta
import app.fableshot.android.domain.ScoreRounding
import java.math.BigDecimal

internal fun compactProgressNumber(value: Double): String = BigDecimal.valueOf(ScoreRounding.hundredths(value), 2)
    .stripTrailingZeros().toPlainString().replace('.', ',')

/** Display only. Frozen PG1 ranking/evidence continues to use its original formula. */
internal data class ProgressPresentation(val current: Double, val baseline: Double, val ready: Boolean) {
    val relativePercent: Double? get() = baseline.takeIf { it > 0 }?.let { 100 * (current - it) / it }
    val label: String get() {
        val value = relativePercent ?: (current - baseline)
        val rounded = ScoreRounding.hundredths(value)
        return (if (ready) "" else "≈ ") + (if (rounded > 0) "+" else "") +
            compactProgressNumber(value) + if (relativePercent != null) "%" else " к среднему"
    }
    fun explanation(sourceCount: Int? = null): String = buildString {
        append("Твой средний сейчас: ${compactProgressNumber(current)}. Обычный средний: ${compactProgressNumber(baseline)}.")
        append("\n\nСравниваем с последними похожими тренировками: та же дистанция, мишень и тип лука.")
        sourceCount?.takeIf { it > 0 }?.let { append(" В базе $it занятий.") }
        if (relativePercent != null) append("\n\nПроцент = (текущий средний / обычный средний − 1) × 100. Например, рост с 5 до 6 — это +20%.")
        else append("\n\nОбычный средний равен нулю, поэтому процент посчитать нельзя. Показываем прибавку среднего в баллах.")
        if (!ready) append("\n\nПредварительное сравнение: для уверенной оценки нужны хотя бы 3 базовых занятия и 12 стрел в полных сериях.")
        append("\n\nБаза зафиксирована до начала тренировки. M входит за ноль, невнесённые стрелы не учитываются.")
    }
}

internal fun progressPresentation(current: Double?, baseline: Double?, ready: Boolean): ProgressPresentation? =
    if (current == null || baseline == null || !current.isFinite() || !baseline.isFinite() || current < 0 || baseline < 0) null
    else ProgressPresentation(current, baseline, ready)

internal fun JournalSummaryMeta.progressPresentation() =
    progressPresentation(progressCurrentAverage, progressBaselineAverage, progressReady)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProgressChangeValue(value: ProgressPresentation, explanation: String = value.explanation(),
    modifier: Modifier = Modifier, style: TextStyle = MaterialTheme.typography.labelMedium) {
    var open by rememberSaveable { mutableStateOf(false) }
    Box(modifier.clickable { open = true }.semantics { contentDescription = "Прогресс ${value.label}. Показать сравнение" }) {
        androidx.compose.material3.Text(value.label, style = style, color = MaterialTheme.colorScheme.primary)
    }
    if (open) ScaledModalBottomSheet(onDismissRequest = { open = false },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            androidx.compose.material3.Text("Прогресс", style = MaterialTheme.typography.titleLarge)
            androidx.compose.material3.Text(explanation)
            Spacer(Modifier.height(24.dp))
        }
    }
}

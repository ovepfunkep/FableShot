package app.fableshot.android.ui
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.data.journal.*
@Composable fun PlanProgressLine(details:JournalDetails,modifier:Modifier=Modifier.padding(horizontal=20.dp,vertical=4.dp)) {
    details.plannedEnds?.let{limit->Text(stringResource(R.string.plan_progress,details.closedPlanEnds,limit,details.blocks.sumOf{it.ends.sumOf{e->e.volume}}),modifier.testTag("plan-progress"),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
}

internal fun nextTrainingAction(details:JournalDetails):Int {
    val round=details.roundProgress()
    return when {
        round.count!=null && round.number>=round.count && round.seriesLimit!=null && round.seriesNumber>=round.seriesLimit -> R.string.plan_finish
        round.endsRound -> R.string.next_round
        else -> R.string.next_end
    }
}

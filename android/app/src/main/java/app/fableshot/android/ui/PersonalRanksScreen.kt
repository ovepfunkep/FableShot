package app.fableshot.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.journal.bestRankResults
import app.fableshot.android.domain.rankClassLabel

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PersonalRanksScreen(sessions:List<SessionSummary>,onSession:(SessionSummary)->Unit) {
    val preferences=LocalRankPreferences.current
    val results=remember(sessions,preferences.category) { bestRankResults(sessions,preferences.category) }
    var reference by rememberSaveable { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize().testTag("personal-ranks-screen"),contentPadding=PaddingValues(20.dp),
        verticalArrangement=Arrangement.spacedBy(16.dp)) {
        item {
            FablePrimaryButton("Разрядная сетка",{reference=true},Modifier.fillMaxWidth().testTag("personal-rank-grid"),icon=Glyph.Book)
        }
        item {
            Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text("Лучшие по нормативам",style=MaterialTheme.typography.titleLarge)
                FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf("male" to "Мужчины","female" to "Женщины").forEach { (id,label) ->
                        FilterChip(preferences.category==id,{preferences.onCategory(id)},{Text(label)},Modifier.testTag("personal-rank-category-$id"))
                    }
                }
                RankSourceHelp()
            }
        }
        if(results.isEmpty()) item {
            Text(if(preferences.category==null) "Выбери категорию сравнения. Сетку можно открыть и без неё."
                else "Пока нет полного совместимого упражнения. Здесь появятся лучшие результаты отдельно для каждого формата.",
                Modifier.testTag("personal-ranks-empty"),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(results,key={it.evaluation.exercise.id}) { best ->
            val evaluation=best.evaluation
            val exercise=evaluation.exercise
            Surface(onClick={onSession(best.session)},modifier=Modifier.fillMaxWidth().testTag("personal-best-${exercise.id}"),
                shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surface,
                border=BorderStroke(1.dp,MaterialTheme.colorScheme.primary)) {
                Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        Text("${rankClassLabel(exercise.bow,exercise.category)} · ${exercise.distance} м · ${exercise.arrows} стрел",
                            Modifier.weight(1f),style=MaterialTheme.typography.titleSmall)
                        FableIcon(Glyph.Next,description="Открыть тренировку")
                    }
                    Text("${evaluation.points}/${exercise.arrows*10} · средний ${number(evaluation.average!!,2)}",
                        style=MaterialTheme.typography.titleMedium)
                    Text("По очкам: ${evaluation.result?.label ?: "ниже начального порога"}",style=MaterialTheme.typography.bodyMedium)
                    Text("${sessionDate(best.session)?.toString() ?: "Дата не указана"} · ${best.session.title}",
                        style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    evaluation.next?.let { Text("До ${it.label}: ${it.score-evaluation.points} очков",style=MaterialTheme.typography.labelMedium) }
                }
            }
        }
    }
    if(reference) RankReferenceScreen(results.firstOrNull()?.evaluation?.exercise?.bow,preferences.category) {reference=false}
}

@Composable
fun ProfileRankSummary(sessions:List<SessionSummary>,onOpen:()->Unit) {
    val category=LocalRankPreferences.current.category
    val results=remember(sessions,category) { bestRankResults(sessions,category) }
    val single = results.singleOrNull()
    val summary = when {
        results.size > 1 -> "${results.size} формата"
        single != null -> single.evaluation.result?.label ?: "${single.evaluation.points} оч."
        else -> "—"
    }
    MetricTile(summary,
        "Лучшие по нормативам", icon = Glyph.Podium, action = {
            IconButton(onOpen, Modifier.testTag("profile-rank-results")) {
                FableIcon(Glyph.Next, description = "Лучшие результаты и разрядная сетка")
            }
        })
}

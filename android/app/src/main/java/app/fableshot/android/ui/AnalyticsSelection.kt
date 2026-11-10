package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.analyticsRows
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ProgressScreen(sessions:List<SessionSummary>,loadDetails:(suspend (String)->app.fableshot.android.data.SessionDetails?)?=null,onRanks:(()->Unit)?=null) {
 var filters by rememberSaveable { mutableStateOf(false) }
 var period by rememberSaveable { mutableStateOf(0) }
 var from by rememberSaveable { mutableStateOf("") }
 var to by rememberSaveable { mutableStateOf("") }
 var manual by rememberSaveable { mutableStateOf(false) }
 var ids by rememberSaveable { mutableStateOf(arrayListOf<String>()) }
 var choosing by rememberSaveable { mutableStateOf(false) }
 val today=LocalDate.now()
 val start=if(period==-1)runCatching{LocalDate.parse(from)}.getOrNull() else if(period>0)today.minusDays(period.toLong()-1)else null
 val finish=if(period==-1)runCatching{LocalDate.parse(to)}.getOrNull()else if(period>0)today else null
 val valid=period!=-1||(start!=null&&finish!=null&&!start.isAfter(finish))
 val completed=sessions.filter{it.state=="completed"}
 val dated=if(!valid)emptyList()else completed.filter{row-> val d=sessionDate(row);period==0||(d!=null&&start!=null&&finish!=null&&!d.isBefore(start)&&!d.isAfter(finish))}
 val selected=dated.filter{!manual||it.id in ids}
 val excluded=analyticsRows(selected).count{!it.comparable||it.scoredCount==0||sessionDate(it)==null}
 Column(Modifier.fillMaxSize()) {
  Row(Modifier.fillMaxWidth().padding(horizontal=20.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
   OutlinedButton({filters=true},Modifier.weight(1f)) { Text(if(period==0) "Всё время" else if(period==-1) "$from — $to" else "$period дней") }
   AnalyticsExportButton(selected,if(period==0)"Всё время" else "$start — $finish",valid,loadDetails)
   if(onRanks!=null&&statisticVisible(app.fableshot.android.data.StatisticFeature.Norms))IconButton(onRanks,Modifier.testTag("progress-ranks")) {FableIcon(Glyph.Trophy,description="Нормативы и разрядная сетка")}
  }
  if(statisticVisible(app.fableshot.android.data.StatisticFeature.Volume))Text("Занятий: ${selected.size}",Modifier.padding(horizontal=20.dp),style=MaterialTheme.typography.labelMedium)
  if(filters) ModalBottomSheet(onDismissRequest={filters=false}) {
  Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
   Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
    listOf(0 to "Всё время",7 to "7 дней",30 to "30 дней",90 to "90 дней",-1 to "Свои даты").forEach{(n,label)->FilterChip(period==n,{period=n},{Text(label)},Modifier.testTag("analytics-period-$n"))}
   }
   if(period==-1) {
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
     OutlinedTextField(from,{from=it.take(10)},Modifier.weight(1f).testTag("analytics-from"),label={Text("С даты")},placeholder={Text("2026-10-01")},singleLine=true,isError=!valid)
     OutlinedTextField(to,{to=it.take(10)},Modifier.weight(1f).testTag("analytics-to"),label={Text("По дату")},placeholder={Text("2026-10-30")},singleLine=true,isError=!valid)
    }
    if(!valid)Text("Укажи даты ГГГГ-ММ-ДД. Начало должно быть не позже окончания.",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
   }
   Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
    OutlinedButton({choosing=true},Modifier.testTag("analytics-choose")){Text(if(manual)"Выбрано: ${selected.size}" else "Выбрать тренировки")}
    if(manual)TextButton({manual=false;ids=arrayListOf()},Modifier.testTag("analytics-reset")){Text("Все в периоде")}
   }
   Text("Завершённых занятий: ${selected.size}",style=MaterialTheme.typography.labelMedium,modifier=Modifier.testTag("analytics-count"))
   if(excluded>0)Text("Частей занятий вне сравнения по условиям: $excluded. Нет оценки, известной даты или условий.",style=MaterialTheme.typography.bodySmall)
   HelpButton("Как выбрать данные","Период включает обе указанные даты. Дата берётся из тренировки, а не из времени импорта. Без известной даты занятие доступно только за всё время. Ручной выбор действует вместе с периодом и сохраняется при его смене. Месячный график показывает подходящие тренировки из выбранного периода. В подробной статистике результаты разделены по сопоставимым условиям. Разминка не входит в средний балл. Отбор не пересчитывает ранее зафиксированный обычный уровень PG1.")
  }
   TextButton({filters=false}) { Text("Показать результаты") }
  }
  Box(Modifier.weight(1f)){ProgressResults(selected)}
 }
 if(choosing) {
  var draft by remember {mutableStateOf(if(manual)ids.toSet()else dated.map{it.id}.toSet())}
  AlertDialog(onDismissRequest={choosing=false},title={Text("Тренировки в периоде")},text={
   Column {
    Row {TextButton({draft=dated.map{it.id}.toSet()}){Text("Все")};TextButton({draft=emptySet()}){Text("Снять выбор")}}
    LazyColumn(Modifier.heightIn(max=360.dp)) {items(dated,key={it.id}){row->
     Row(Modifier.fillMaxWidth()){Checkbox(row.id in draft,{checked->draft=if(checked)draft+row.id else draft-row.id},Modifier.testTag("analytics-session-${row.id}"));Column(Modifier.weight(1f).padding(top=8.dp)){Text(row.title);Text(sessionDate(row)?.toString()?:"Дата неизвестна",style=MaterialTheme.typography.bodySmall)}}
    }}
    if(dated.isEmpty())Text("В этом периоде нет завершённых тренировок.")
   }
  },confirmButton={TextButton({ids=ArrayList(draft);manual=true;choosing=false},Modifier.testTag("analytics-apply")){Text("Применить")}},dismissButton={TextButton({choosing=false}){Text("Отмена")}})
 }
}

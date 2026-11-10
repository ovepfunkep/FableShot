package app.fableshot.android.ui
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.StatisticFeature

@Composable fun ZoneAnalytics(values:List<SessionSummary>) {
 val showDistribution=statisticVisible(StatisticFeature.Distribution)
 val showTrend=statisticVisible(StatisticFeature.ZoneTrend)
 if(!showDistribution&&!showTrend)return
 val known=values.filter{it.scoredCount>0&&it.journalMeta?.zoneCounts?.let{z->z.size==11&&z.sum()==it.scoredCount}==true}
 if(known.isEmpty())return
 val counts=(0..10).map{zone->known.sumOf{it.journalMeta!!.zoneCounts!![zone]}}
 val total=counts.sum()
 if(total==0)return
 var metric by rememberSaveable {mutableStateOf("10")}
 val series=if(metric=="X")known.filter{it.journalMeta?.xCount!=null}else known
 fun count(row:SessionSummary):Int=when(metric){"X"->row.journalMeta!!.xCount!!;"M"->row.journalMeta!!.zoneCounts!![0];else->row.journalMeta!!.zoneCounts!![10]}
 fun rate(row:SessionSummary)=100.0*count(row)/row.scoredCount
 val label=when(metric){"X"->"X";"M"->"промахов";else->"десяток, включая X"}
 if(showDistribution)FableCard {
 Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {FableIcon(Glyph.Progress,tint=MaterialTheme.colorScheme.primary);TermHelp("Распределение попаданий","Здесь только зачётные оценённые стрелы выбранной группы условий. M — промах; X входит в десятки и учитывается отдельно в динамике. Без координат распределение очков остаётся доступным. Данные отсутствующих зон не подменяются догадкой; занятия без сохранённого распределения исключены из этой карточки.")}
  Text("Зачётных стрел: $total · занятий: ${known.size} из ${values.size}",style=MaterialTheme.typography.bodySmall,modifier=Modifier.testTag("zones-coverage"))
  val max=counts.maxOrNull()!!.coerceAtLeast(1)
  (10 downTo 0).forEach{zone->Row(Modifier.fillMaxWidth().padding(vertical=3.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){
   Text(if(zone==0)"M"else zone.toString(),Modifier.width(24.dp))
   Box(Modifier.weight(1f).height(16.dp).background(MaterialTheme.colorScheme.surfaceVariant)){if(counts[zone]>0)Box(Modifier.fillMaxWidth(counts[zone].toFloat()/max).height(16.dp).background(MaterialTheme.colorScheme.primary))}
   Text("${counts[zone]} · ${number(100.0*counts[zone]/total,1)}%",Modifier.width(94.dp),style=MaterialTheme.typography.labelMedium)
  }}
  Text("Длина полосы — число стрел; справа число и доля в выборке.",style=MaterialTheme.typography.bodySmall)
 }
 if(showDistribution&&showTrend)Spacer(Modifier.height(16.dp))
 if(showTrend)FableCard {
  BlockHeading("Динамика доли $label",Glyph.Progress)
  Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
   listOf("10" to "10 + X","X" to "X","M" to "Промахи").forEach{(id,title)->FilterChip(metric==id,{metric=id},{Text(title)},Modifier.testTag("rate-$id"))}
  }
  if(series.isEmpty())Text("Нет данных X для этой выборки.")else {
   val shown=series.takeLast(12)
   var selectedId by rememberSaveable(metric) { mutableStateOf<String?>(null) }
   val selected=shown.indexOfFirst{it.id==selectedId}.takeIf{it>=0}?:shown.lastIndex
   val chosen=shown[selected]
   Text("Доля, % · от 0 до 100 · по порядку занятий",style=MaterialTheme.typography.bodySmall)
   Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
    Column(Modifier.width(42.dp).height(156.dp),verticalArrangement=Arrangement.SpaceBetween) {
     listOf("100%","50%","0%").forEach { Text(it,style=MaterialTheme.typography.labelSmall) }
    }
    Box(Modifier.weight(1f)) {
     SelectableTrendPlot(shown.mapIndexed{index,row->TrendPoint(index.toDouble(),rate(row))},
      if(shown.size==1)-.5 else 0.0,if(shown.size==1).5 else shown.lastIndex.toDouble(),
      100.0,selected,"Доля $label по тренировкам","${number(rate(chosen))}%",
      Modifier.testTag("rate-chart")) { selectedId=shown[it].id }
    }
   }
   Text("${number(rate(chosen))}% · ${count(chosen)} из ${chosen.scoredCount} · ${sessionDate(chosen)}",
    style=MaterialTheme.typography.titleMedium,modifier=Modifier.testTag("rate-selection"))
   Text("${sessionDate(shown.first())} — ${sessionDate(shown.last())} · показано ${shown.size} из ${series.size}",style=MaterialTheme.typography.bodySmall)
   Text("По всей выборке: ${number(100.0*series.sumOf{count(it)}/series.sumOf{it.scoredCount},1)}%",style=MaterialTheme.typography.titleMedium,modifier=Modifier.testTag("rate-total"))
   if(series.size>1) {
    val first=rate(series.first())
    val last=rate(series.last())
    val change=if(first>0)progressLabel(100*(last-first)/first,true) else "${number(first,1)}% → ${number(last,1)}%"
    GlossaryText("От первого к последнему: $change",mapOf(change to
     "Сравниваем долю $label в первом и последнем занятии: ${number(first,1)}% и ${number(last,1)}%. " +
     "Процент изменения = (последняя доля / первая доля − 1) × 100. Если первая доля нулевая, показываем обе доли вместо процента роста. " +
     "Для промахов уменьшение обычно лучше. Это сравнение выбранных занятий, а не база обычного результата."),modifier=Modifier.testTag("rate-change"))
   }
   shown.forEach{row->Text("${sessionDate(row)} · ${row.title}: ${count(row)} / ${row.scoredCount} · ${number(rate(row),1)}%",style=MaterialTheme.typography.bodySmall)}
  }
 }
}

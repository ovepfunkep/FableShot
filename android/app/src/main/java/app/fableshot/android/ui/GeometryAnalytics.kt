package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.SessionDetails
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.domain.*
import kotlin.math.*

@Composable fun GeometryAnalytics(values:List<SessionSummary>) {
 val showMap=statisticVisible(StatisticFeature.HitMap)
 val showGrouping=statisticVisible(StatisticFeature.Grouping)
 val showOffset=statisticVisible(StatisticFeature.Offset)
 val showVolume=statisticVisible(StatisticFeature.Volume)
 if(!showMap&&!showGrouping&&!showOffset)return
 val points=remember(values){values.flatMap{it.journalMeta?.positions.orEmpty()}}
 val total=values.sumOf{it.scoredCount}
 val radiusMm=values.firstOrNull()?.targetDiameterMm?.div(2.0)?:0.0
 val centre=remember(points){if(points.isEmpty())null else TargetPoint(points.sumOf{it.x}/points.size,points.sumOf{it.y}/points.size)}
 val rms=remember(points){TargetScoring.rms(points)}
 FableCard {
 Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {FableIcon(Glyph.Target,tint=MaterialTheme.colorScheme.primary);TermHelp(if(showMap)"Карта попаданий"else"Геометрия попаданий","Используются только подтверждённые координаты зачётных стрел известной одноцентровой мишени. Разминка, числовые оценки без координат и неподтверждённые позиции импорта не участвуют. Данные разных условий разделены. RMS измеряет разброс всех выбранных точек вокруг их общей средней: он включает смещение группы между занятиями и не равен внутриcерийной кучности CG3. Смещение показывает расстояние от центра мишени до средней точки. Это измерения отмеченных центров стрел. Тепловая карта считает стрелы в ячейках, без интерполяции; масштаб сетки зависит от охвата точек. Недостаток координат не превращается в нулевой разброс.")}
  if(showVolume)Text("Координаты: ${points.size} из $total зачётных стрел",style=MaterialTheme.typography.bodySmall,modifier=Modifier.testTag("geometry-coverage"))
  if(points.isEmpty())Text("Нет подтверждённых координат для карты и измерений.",modifier=Modifier.testTag("geometry-unavailable"))else {
   if(showMap)HitMap(points, values.first().profileId)
   if(showMap&&showOffset)Text("Белое кольцо — среднее попадание. X вправо, Y вверх.",style=MaterialTheme.typography.bodySmall)
   if(radiusMm>0){
    if(showGrouping)Text("Разброс RMS: ${rms?.let{number(it*radiusMm,1)+" мм"}?:"Нужно 3 координаты"}",Modifier.testTag("geometry-rms"))
    if(showOffset)centre?.let{c->Text("Смещение от центра: ${number(hypot(c.x,c.y)*radiusMm,1)} мм",modifier=Modifier.testTag("geometry-offset"));Text("По горизонтали: ${number(c.x*radiusMm,1)} мм · по вертикали: ${number(c.y*radiusMm,1)} мм",style=MaterialTheme.typography.bodySmall)}
   }
  }
 }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TrainingHitMap(details: SessionDetails, roundLabels: Map<String, String> = emptyMap(),
    coordinateEvidence: Map<String, Map<String, TargetPoint>>? = null) {
    val series = remember(details, roundLabels, coordinateEvidence) {
        trainingHitMapSeries(details, roundLabels, coordinateEvidence)
    }
    val scopeKey = series.map { it.id }
    var selected by rememberSaveable(details.session.id, scopeKey) { mutableStateOf<String?>(null) }
    var choosing by remember(details.session.id, scopeKey) { mutableStateOf(false) }
    var heat by rememberSaveable(details.session.id) { mutableStateOf(true) }
    val selection = remember(series, selected) { selectTrainingHitMapSeries(series, selected) }
    val position = series.indexOfFirst { it.id == selected } + 1
    val radiusMm = details.session.targetDiameterMm / 2.0
    val mapSelector: @Composable () -> Unit = {
        Row(Modifier.fillMaxWidth().testTag("training-map-series-controls"),
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            IconButton({ selected = series.getOrNull(position - 2)?.id }, enabled = position > 0,
                modifier = Modifier.testTag("training-map-prev-series")) {
                FableIcon(Glyph.Back, description = "Предыдущая серия на карте")
            }
            TextButton({ choosing = true }, Modifier.weight(1f, fill = false).testTag("training-map-select-series"),
                enabled = series.isNotEmpty()) { Text(selection.label) }
            IconButton({ selected = series.getOrNull(position)?.id }, enabled = position < series.size,
                modifier = Modifier.testTag("training-map-next-series")) {
                FableIcon(Glyph.Next, description = "Следующая серия на карте")
            }
        }
    }
    FableCard(Modifier.testTag("training-hit-map-card")) {
        BlockHeading("Карта попаданий", Glyph.Target)
        val summary = listOfNotNull(
            "Очки: ${selection.score}".takeIf { statisticVisible(StatisticFeature.Result) },
            "Стрелы: ${selection.shotCount}".takeIf { statisticVisible(StatisticFeature.Volume) },
        ).joinToString(" · ")
        if(summary.isNotEmpty())Text(summary, Modifier.testTag("training-map-score"), style = MaterialTheme.typography.bodyMedium)
        if(statisticVisible(StatisticFeature.Volume))Text("Координаты: ${selection.points.size} из ${selection.shotCount} зачётных стрел",
            Modifier.testTag("training-map-coverage"), style = MaterialTheme.typography.bodySmall)
        if(statisticVisible(StatisticFeature.Volume))Text("Промахи M: ${selection.missCount} · Без координат: ${selection.unknownCoordinateCount}",
            Modifier.testTag("training-map-missing"), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (selection.points.isNotEmpty()) {
            HitMap(selection.points, details.session.profileId, heat, { heat = it }, mapSelector)
            if (radiusMm > 0) {
                if(statisticVisible(StatisticFeature.Grouping))selection.rms?.let { Text("Разброс RMS: ${number(it * radiusMm, 1)} мм",
                    Modifier.testTag("training-map-rms"), style = MaterialTheme.typography.bodySmall) }
                if(statisticVisible(StatisticFeature.Offset))selection.centreOffset?.let { Text("Смещение от центра: ${number(it * radiusMm, 1)} мм",
                    Modifier.testTag("training-map-offset"), style = MaterialTheme.typography.bodySmall) }
            }
        } else {
            mapSelector()
            Text("Нет подтверждённых координат для выбранной области.",
                Modifier.testTag("training-map-unavailable"), style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (choosing) ModalBottomSheet(onDismissRequest = { choosing = false },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 560.dp).testTag("training-map-series-list"),
            contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Серия на карте", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                }
            }
            item {
                FilterChip(position == 0, { selected = null; choosing = false },
                    label = { Text("Все серии") }, modifier = Modifier.fillMaxWidth().testTag("training-map-series-all"))
            }
            items(series, key = { it.id }) { entry ->
                FilterChip(selected == entry.id, { selected = entry.id; choosing = false },
                    label = {
                        Column(Modifier.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(entry.label, style = MaterialTheme.typography.titleSmall)
                            Text("Очки: ${entry.shots.sumOf { it.points }} · Стрелы: ${entry.shots.size}",
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }, modifier = Modifier.fillMaxWidth().testTag("training-map-series-${entry.id}"))
            }
        }
    }
}

@Composable
internal fun HitMap(points: List<TargetPoint>, profileId: String, heatOverride: Boolean? = null,
    onHeatChange: ((Boolean) -> Unit)? = null, mapSelector: (@Composable () -> Unit)? = null) {
 val showOffset=statisticVisible(StatisticFeature.Offset)
 var savedHeat by rememberSaveable { mutableStateOf(true) }
 val heat = heatOverride ?: savedHeat
 fun setHeat(value: Boolean) { savedHeat = value; onHeatChange?.invoke(value) }
 val centre = remember(points) { TargetPoint(points.sumOf { it.x } / points.size, points.sumOf { it.y } / points.size) }
 val densityColors = listOf(Color(0xFFD0E8D2), Color(0xFF8DBA97), Color(0xFF417B55), Color(0xFF123E28))
   Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){FilterChip(!heat,{setHeat(false)},{Text("Попадания")},Modifier.testTag("geometry-points"));FilterChip(heat,{setHeat(true)},{Text("Плотность")},Modifier.testTag("geometry-heat"))}
   val limit=remember(points){max(1.15,points.maxOf{max(abs(it.x),abs(it.y))}+.1)}
   val cells=remember(points,limit){points.groupingBy{p->Pair(floor((p.x+limit)/(2*limit)*24).toInt().coerceIn(0,23),floor((p.y+limit)/(2*limit)*24).toInt().coerceIn(0,23))}.eachCount()}
   Column {
   Canvas(Modifier.fillMaxWidth().height(260.dp).clipToBounds().testTag("geometry-map").semantics{contentDescription="Карта ${points.size} попаданий; X вправо, Y вверх; круг — физическая мишень"}){
    val radius=(size.minDimension*.46f/limit).toFloat();val mid=center
    drawTargetFace(mid,radius,emptyList(),null,null,profile=TargetCatalog.find(profileId)?:TargetCatalog.practice)
    if(heat){val peak=cells.values.maxOrNull()?:1;val cell=(2*limit*radius/24).toFloat();cells.forEach{(index,count)->
     val x=(-limit+index.first*2*limit/24)*radius;val y=(-limit+(index.second+1)*2*limit/24)*radius
     drawRect(densityColors[(ceil(count.toDouble()/peak*4).toInt()-1).coerceIn(0,3)].copy(alpha=.65f),mid+Offset(x.toFloat(),-y.toFloat()),androidx.compose.ui.geometry.Size(cell,cell))
    }}else points.forEach{p->val pos=mid+Offset((p.x*radius).toFloat(),(-p.y*radius).toFloat());drawCircle(Color.Black,3.dp.toPx(),pos);drawCircle(Color.White,3.dp.toPx(),pos,style=Stroke(1.dp.toPx()))}
    if(showOffset)centre?.let{c->val pos=mid+Offset((c.x*radius).toFloat(),(-c.y*radius).toFloat());drawCircle(Color.Black,7.dp.toPx(),pos,style=Stroke(3.dp.toPx()));drawCircle(Color.White,7.dp.toPx(),pos,style=Stroke(1.dp.toPx()))}
   }
   mapSelector?.invoke()
   }
   if(heat) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(8.dp)) {
     densityColors.forEachIndexed { index, color ->
      Column(Modifier.weight(1f)) {
       androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().height(12.dp).then(Modifier.background(color.copy(alpha=.65f))))
       Text("${index*25}–${(index+1)*25}%", style=MaterialTheme.typography.labelSmall)
      }
     }
    }
    Text("Темнее — чаще. Доля от максимума в одной ячейке: ${cells.values.maxOrNull()} стрел. Сетка 24 × 24; пустые ячейки без заливки.",style=MaterialTheme.typography.bodySmall)
   }
}

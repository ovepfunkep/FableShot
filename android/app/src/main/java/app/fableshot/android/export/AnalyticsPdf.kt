package app.fableshot.android.export

import android.graphics.*
import android.graphics.pdf.PdfDocument
import app.fableshot.android.data.*
import app.fableshot.android.domain.*
import app.fableshot.android.ui.sessionDate
import java.io.File
import java.util.UUID
import kotlin.math.*

/** Read-only snapshot of the same selected sessions and condition groups as Progress. */
object AnalyticsPdf {
 fun groups(sessions:List<SessionSummary>)=analyticsRows(sessions).filter{it.state=="completed"&&it.scoredCount>0&&it.comparable&&sessionDate(it)!=null}.groupBy{analyticsConditionKey(it)}
 fun create(directory:File,sessions:List<SessionSummary>,period:String,normal:Typeface=Typeface.DEFAULT,boldFace:Typeface=Typeface.DEFAULT_BOLD):File {
  require(sessions.isNotEmpty());directory.mkdirs()
  val output=File(directory,"FableShot-${UUID.randomUUID()}.pdf")
  val pdf=PdfDocument();val paint=Paint(Paint.ANTI_ALIAS_FLAG);var page:PdfDocument.Page?=null;var y=0f;var index=0
  fun newPage(){page?.let{pdf.finishPage(it)};index++;page=pdf.startPage(PdfDocument.PageInfo.Builder(595,842,index).create());page!!.canvas.drawColor(Color.WHITE);y=48f;paint.typeface=normal;paint.textSize=9f;paint.color=Color.DKGRAY;page!!.canvas.drawText("FableShot   |   Отчёт по тренировкам",40f,24f,paint);page!!.canvas.drawText(index.toString(),545f,816f,paint)}
  fun room(height:Float){if(page==null||y+height>790)newPage()}
  fun text(raw:String,size:Float=11f,bold:Boolean=false){
   paint.typeface=if(bold)boldFace else normal;paint.textSize=size;paint.color=Color.rgb(25,35,42)
   val clean=raw.replace(Regex("[\\s]+")," ")
   var rest=clean
   val lines=mutableListOf<String>()
   while(rest.isNotEmpty()){
    var length=paint.breakText(rest,true,515f,null).coerceAtLeast(1)
    if(length<rest.length){val split=rest.lastIndexOf(' ',length-1);if(split>0)length=split}
    lines.add(rest.take(length));rest=rest.drop(length).trimStart()
   }
   if(lines.size*(size+5)+4<740)room(lines.size*(size+5)+4+if(bold)34 else 0)
   for(line in lines){room(size+6);paint.typeface=if(bold)boldFace else normal;paint.textSize=size;paint.color=Color.rgb(25,35,42);page!!.canvas.drawText(line,40f,y,paint);y+=size+5}
   y+=4
  }
  fun n(v:Double)=String.format(java.util.Locale.forLanguageTag("ru"),"%.1f",v)
  try {
   newPage();text("Отчёт по выбранным тренировкам",22f,true);text(period)
   text("Выбрано завершённых занятий: ${sessions.size}")
   val groups=groups(sessions);val all=analyticsRows(sessions);val included=groups.values.flatten()
   text("Групп условий: ${groups.size}; частей занятий вне расчётов: ${all.size-included.size}")
   text("Группы рассчитаны отдельно. Разминка и счётчик без оценки не входят в очковые показатели. PG1 фиксируется до тренировки и не пересчитывается по этому отчёту.",10f)
   groups.forEach{(_,raw)->
    val rows=raw.sortedWith(compareBy<SessionSummary>{sessionDate(it)}.thenBy{it.startedAt})
    val first=rows.first();val count=rows.sumOf{it.scoredCount};val sum=rows.sumOf{it.total.toLong()}
    room(110f);text("${n(first.distanceMeters)} м  |  ${first.targetDiameterMm/10} см",17f,true)
    text(TargetCatalog.find(first.profileId)?.title?:"Мишень из исходных данных",12f,true)
    first.journalMeta?.equipmentLabel?.let{text("Снаряжение: $it")}
    text("Занятий: ${rows.size}; зачётных стрел: $count; очков: $sum; средний балл: ${n(sum.toDouble()/count)} / 10")
    val known=rows.filter{it.journalMeta?.zoneCounts?.let{z->z.size==11&&z.sum()==it.scoredCount}==true}
    if(known.isNotEmpty()){
     val bins=(0..10).map{z->known.sumOf{it.journalMeta!!.zoneCounts!![z]}}
     text("Распределение зон: ${bins.sum()} из $count стрел",12f,true)
     room(178f);val max=bins.maxOrNull()!!.coerceAtLeast(1)
     for(z in 10 downTo 0){paint.textSize=10f;paint.color=Color.DKGRAY;page!!.canvas.drawText(if(z==0)"M"else z.toString(),40f,y,paint);paint.color=Color.rgb(70,110,77);page!!.canvas.drawRect(66f,y-8,66f+300f*bins[z]/max,y,paint);paint.color=Color.DKGRAY;page!!.canvas.drawText("${bins[z]}   ${n(100.0*bins[z]/bins.sum())}%",385f,y,paint);y+=15}
     y+=8;text("Длина полосы — число стрел. X входит в десятки.",9f)
    }
    val points=rows.flatMap{it.journalMeta?.positions.orEmpty()};text("Подтверждённые координаты: ${points.size} из $count стрел",12f,true)
    val profile=TargetCatalog.find(first.profileId)
    if(points.isNotEmpty()&&profile!=null){
     room(250f);val cx=297f;val cy=y+116;val limit=max(1.15,points.maxOf{max(abs(it.x),abs(it.y))}+.1);val radius=(110/limit).toFloat()
     val colors=listOf(Color.WHITE,Color.rgb(35,40,43),Color.rgb(50,149,199),Color.rgb(228,76,67),Color.rgb(244,206,68))
     profile.zones.asReversed().forEach{zone->paint.style=Paint.Style.FILL;paint.color=colors[(zone.points-1)/2];page!!.canvas.drawCircle(cx,cy,radius*zone.outerRadius.toFloat(),paint);paint.style=Paint.Style.STROKE;paint.strokeWidth=.5f;paint.color=Color.DKGRAY;page!!.canvas.drawCircle(cx,cy,radius*zone.outerRadius.toFloat(),paint)}
     points.forEach{p->paint.style=Paint.Style.FILL;paint.color=Color.BLACK;page!!.canvas.drawCircle(cx+(p.x*radius).toFloat(),cy-(p.y*radius).toFloat(),2f,paint);paint.style=Paint.Style.STROKE;paint.color=Color.WHITE;page!!.canvas.drawCircle(cx+(p.x*radius).toFloat(),cy-(p.y*radius).toFloat(),2f,paint)}
     paint.style=Paint.Style.FILL;y+=244
     val mx=points.sumOf{it.x}/points.size;val my=points.sumOf{it.y}/points.size;val mm=first.targetDiameterMm/2.0
     TargetScoring.rms(points)?.let{text("Общий разброс RMS: ${n(it*mm)} мм")}
     text("Смещение средней точки: ${n(hypot(mx,my)*mm)} мм; X: ${n(mx*mm)} мм; Y: ${n(my*mm)} мм")
     text("X направлена вправо, Y вверх. Общий RMS включает дрейф между занятиями и не равен внутриcерийному бонусу CG3.",9f)
    }else text("Нет подтверждённых координат для карты и измерений.")
    text("Занятия этой группы",12f,true)
    rows.forEach{row->text("${sessionDate(row)} — ${row.title}: ${row.total} / ${row.scoredCount*10L}; средний ${n(row.total.toDouble()/row.scoredCount)}; координаты ${row.journalMeta?.positions?.size?:0}/${row.scoredCount}")}
    y+=12
   }
   text("Полный состав выборки",15f,true)
   sessions.forEach{row->text("${sessionDate(row)?.toString()?:"Дата неизвестна"} — ${row.title}")}
   text("Этот PDF — отчёт, не резервная копия дневника. Неизвестные координаты и условия не подменяются нулями.",9f)
   page?.let{pdf.finishPage(it)};page=null;output.outputStream().use{pdf.writeTo(it)};return output
  }catch(e:Exception){output.delete();throw e}finally{page?.let{pdf.finishPage(it)};pdf.close()}
 }
}

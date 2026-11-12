package app.fableshot.android.export

import android.content.Context
import android.graphics.*
import androidx.core.content.res.ResourcesCompat
import app.fableshot.android.R
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.ScoreAvailability
import app.fableshot.android.domain.ScoreRounding
import org.json.JSONObject
import java.io.File
import java.util.UUID
import kotlin.math.max

data class PosterPalette(val background:Int,val surface:Int,val ink:Int,val muted:Int,val accent:Int,val onAccent:Int,val border:Int,val gold:Int)
data class PosterRow(val source:JournalEndDetails,val round:Int,val number:Int,val countOnly:Boolean,val condition:Int,val maximumPerArrow:Int?) {
    /** Displayed result covers entered shots; the saved series plan remains separate. */
    val resultMaximum: Int? get() = maximumPerArrow?.takeUnless { countOnly }?.times(source.shots.size)
}
data class PosterCard(val round:Int,val rows:List<PosterRow>,val part:Int,val parts:Int,val roundRows:List<PosterRow>)

internal fun posterResultMaximum(rows: List<PosterRow>): Int? =
    if (rows.isNotEmpty() && rows.all { it.resultMaximum != null }) rows.sumOf { requireNotNull(it.resultMaximum) }
    else null

object TrainingPoster {
    /** Every entered series appears exactly once, including historical out-of-score entries. */
    fun cards(details:JournalDetails):List<PosterCard> {
        val groups=details.reportScopes().filterNot {it.id.startsWith("part-")}
        val conditions=groups.flatMapIndexed {index,scope -> scope.blocks.map {it.block.id to index}}.toMap()
        val locations=details.roundLocations()
        var warmup=0
        val rows=details.orderedBlocks.flatMap {block ->
            val maximum=block.scoringInput().maximumPerArrow
            block.orderedEnds.filter {it.volume>0}.map {entry ->
            val location=locations[entry.end.id]
            PosterRow(entry,if(entry.end.role=="scored")location?.first ?: 1 else 0,
                if(entry.end.role=="scored")location?.second ?: 1 else ++warmup,block.block.mode=="count_only",conditions.getValue(block.block.id),maximum)
        }}
        return rows.groupBy {it.round}.values.flatMap {round ->
            val parts=round.chunked(10)
            parts.mapIndexed {index,part -> PosterCard(round.first().round,part,index+1,parts.size,round)}
        }
    }

    fun create(context:Context,details:JournalDetails,category:String?,palette:PosterPalette,check:()->Unit={}):List<File> {
        val cards=cards(details)
        require(cards.isNotEmpty()) {"No entered series"}
        val columns=if(cards.any {card -> card.rows.any {it.source.end.plannedCount>6}}||cards.flatMap {it.rows}.map {it.condition}.distinct().size>6)1 else 2
        val pages=cards.chunked(columns)
        val folder=File(context.cacheDir,"reports").apply {mkdirs()}
        val token=UUID.randomUUID().toString()
        val output=mutableListOf<File>()
        val bold=requireNotNull(ResourcesCompat.getFont(context,R.font.manrope_700))
        val normal=requireNotNull(ResourcesCompat.getFont(context,R.font.manrope_400))
        val scopes=details.reportScopes().filterNot {it.id.startsWith("part-")}
        val conditionLines=scopes.mapIndexed {index,scope ->
            val b=scope.blocks.first().block
            val snapshot=b.equipmentSnapshotJson?.let {runCatching {JSONObject(it)}.getOrNull()}
            val bow=snapshot?.optJSONObject("bow")?.optString("category")
            val bowTitle=mapOf("barebow" to "Баребоу","recurve" to "Классический","compound" to "Блочный","traditional" to "Традиционный","longbow" to "Лонгбоу")[bow]
            listOfNotNull(if(scopes.size>1)"${index+1}."else null,b.distanceMeters?.let {"${compact(it)} м"},
                b.targetDiameterMm?.let {"Мишень ${compact(it/10.0)} см"},bowTitle,
                b.verifiedTarget()?.title?.removePrefix("Indoor · "),snapshot?.optJSONObject("selection")?.optString("name")?.takeIf {it.isNotBlank()},
                if(b.mode=="count_only")"Учёт объёма"else null).joinToString(" · ").ifBlank {"Условия не указаны"}
        }
        val scored=cards.flatMap {it.rows}.filter {it.round>0&&!it.countOnly}
        val total=scored.sumOf {it.source.shots.sumOf {shot -> shot.points}}
        val maximum=posterResultMaximum(scored)
        val volume=cards.flatMap {it.rows}.sumOf {it.source.volume}
        val rankEvaluation=details.rankAssessment(category).takeIf {it.finalResult}?.evaluation
        val rank=rankEvaluation?.result?.label
        val interval=rankEvaluation?.let {PosterRankInterval.from(it)}
        val evaluatedArrows=scored.sumOf {it.source.shots.size}
        val average=if(evaluatedArrows>0)total.toDouble()/evaluatedArrows else null
        val cg=if(scopes.size==1&&scopes.first().blocks.all {it.block.mode=="scored"})scopes.first().merged().scoringInput().compositeReportScore()else null
        var bytes=0L
        try {
            pages.forEachIndexed {pageIndex,page ->
                check()
                val paint=Paint(Paint.ANTI_ALIAS_FLAG)
                fun setup(size:Float,color:Int=palette.ink,heavy:Boolean=false) {paint.textSize=size;paint.color=color;paint.typeface=if(heavy)bold else normal;paint.style=Paint.Style.FILL;paint.textAlign=Paint.Align.LEFT}
                fun wrap(text:String,size:Float,width:Float):List<String> {
                    setup(size)
                    var rest=text
                    val lines=mutableListOf<String>()
                    while(rest.isNotEmpty()) {
                        var count=paint.breakText(rest,true,width,null).coerceAtLeast(1)
                        if(count<rest.length)rest.lastIndexOf(' ',count-1).takeIf {it>0}?.let {count=it}
                        lines+=rest.substring(0,count).trim();rest=rest.substring(count).trimStart()
                    }
                    return lines
                }
                val used=page.flatMap {it.rows}.map {it.condition}.distinct().sorted()
                val lines=used.flatMap {wrap(conditionLines[it],30f,968f)}
                val heroTop=180f+lines.size*42f
                val heroHeight=if(interval!=null)394f else 296f
                val gridTop=heroTop+heroHeight+44f
                val cardHeight=110f+(page.maxOf {it.rows.size})*58f
                val height=max(1350,(gridTop+cardHeight+96).toInt())
                require(height<=4096) {"Poster page exceeds bounds"}
                val bitmap=Bitmap.createBitmap(1080,height,Bitmap.Config.ARGB_8888)
                val canvas=Canvas(bitmap)
                fun text(text:String,x:Float,y:Float,size:Float=30f,color:Int=palette.ink,heavy:Boolean=false,width:Float?=null) {
                    setup(size,color,heavy)
                    if(width!=null&&paint.measureText(text)>width)paint.textSize=size*width/paint.measureText(text)
                    canvas.drawText(text,x,y,paint)
                }
                fun card(left:Float,top:Float,right:Float,bottom:Float) {
                    paint.style=Paint.Style.FILL;paint.color=palette.surface;canvas.drawRoundRect(left,top,right,bottom,36f,36f,paint)
                    paint.style=Paint.Style.STROKE;paint.strokeWidth=2f;paint.color=palette.border;canvas.drawRoundRect(left,top,right,bottom,36f,36f,paint)
                    paint.style=Paint.Style.FILL
                }
                try {
                    canvas.drawColor(palette.background)
                    paint.color=(palette.accent and 0x00ffffff) or (18 shl 24);paint.style=Paint.Style.STROKE;paint.strokeWidth=2f
                    for(i in 1..4)canvas.drawCircle(1020f,190f,160f*i,paint)
                    for(i in 1..3)canvas.drawCircle(75f,height*.84f,55f*i,paint)
                    paint.style=Paint.Style.FILL
                    context.getDrawable(R.drawable.fableshot_icon)?.let {it.setBounds(56,48,120,112);it.draw(canvas)}
                    text("FableShot",138f,100f,48f,palette.accent,true)
                    text(details.session.localDate?.split('-')?.reversed()?.joinToString(".") ?: "Моя тренировка",56f,145f,26f,palette.muted)
                    text(if(details.session.state=="completed")"ТРЕНИРОВКА ЗАВЕРШЕНА"else"ТРЕНИРОВКА ПРОДОЛЖАЕТСЯ",520f,95f,22f,palette.muted,width=505f)
                    lines.forEachIndexed {i,line -> text(line,56f,188f+i*42f,30f)}
                    card(56f,heroTop,1024f,heroTop+heroHeight)
                    text(if(scored.isNotEmpty())"ОБЩИЙ РЕЗУЛЬТАТ"else"ВНЕСЕНО СТРЕЛ",88f,heroTop+49f,24f,palette.muted,true)
                    text(if(scored.isNotEmpty())maximum?.let {"$total / $it"} ?: "$total очков"else volume.toString(),88f,heroTop+158f,100f,palette.ink,true,if(rank==null)900f else 610f)
                    val volumeLine="${cards.sumOf {it.rows.size}} серий · $volume стрел"
                    text(average?.let {"Средний: ${decimal(it)} · $volumeLine"} ?: volumeLine,88f,heroTop+210f,28f,palette.muted,width=900f)
                    text(if(cg?.availability==ScoreAvailability.Available)"Общие очки: ${ScoreRounding.display(requireNotNull(cg.total)).replace('.',',')} / 105"
                        else if(scopes.size>1)"Общие очки — отдельно по условиям"else"Общие очки: недостаточно данных",88f,heroTop+260f,27f,palette.accent,true,width=900f)
                    if(rank!=null) {
                        text("УРОВЕНЬ ПО ОЧКАМ",740f,heroTop+52f,20f,palette.gold,true,width=250f)
                        text(rank,740f,heroTop+139f,70f,palette.gold,true,width=250f)
                        details.rankClassLabel(category)?.let {text(it,740f,heroTop+184f,26f,palette.muted,width=250f)}
                    }
                    interval?.let { band ->
                        val lowerLabel=band.lower?.let {"${it.label} · ${it.score} очк."} ?: "Начало шкалы · 0"
                        val upperLabel=band.upper?.let {"${it.label} · ${it.score} очк."} ?: "Максимум · ${band.upperScore} очк."
                        text(lowerLabel,88f,heroTop+300f,23f,palette.muted,true,width=420f)
                        text(upperLabel,590f,heroTop+300f,23f,palette.muted,true,width=400f)
                        val y=heroTop+327f
                        val marker=112f+856f*band.position
                        paint.style=Paint.Style.FILL;paint.strokeWidth=10f;paint.strokeCap=Paint.Cap.ROUND
                        paint.color=palette.border;canvas.drawLine(112f,y,968f,y,paint)
                        paint.color=palette.accent;canvas.drawLine(112f,y,marker,y,paint)
                        paint.strokeWidth=3f;paint.color=palette.muted
                        canvas.drawLine(112f,y-10f,112f,y+10f,paint)
                        canvas.drawLine(968f,y-10f,968f,y+10f,paint)
                        paint.color=palette.ink;canvas.drawCircle(marker,y,12f,paint)
                        paint.strokeCap=Paint.Cap.BUTT
                        text("+${band.aboveLower} очк. · +${decimal(band.aboveLower.toDouble()/band.arrows)} ср.",88f,heroTop+371f,23f,palette.accent,true,width=420f)
                        val upperGap=if(band.upper!=null)"Ещё ${band.toUpper} очк. · ${decimal(band.toUpper.toDouble()/band.arrows)} ср."
                            else if(band.toUpper==0)"Максимум. Без остатка."
                            else "До максимума: ${band.toUpper} очк."
                        text(upperGap,590f,heroTop+371f,23f,palette.accent,true,width=400f)
                    }
                    val width=if(columns==1)968f else 472f
                    page.forEachIndexed {column,section ->
                        check()
                        val left=56f+column*(width+24f)
                        card(left,gridTop,left+width,gridTop+110f+section.rows.size*58f)
                        val heading=if(section.round==0)"Вне зачёта"else"Раунд ${section.round}"
                        text(heading+(if(section.parts>1)" · ${section.part}/${section.parts}"else""),left+22f,gridTop+46f,34f,palette.ink,true,width=width-44)
                        val roundPoints=section.roundRows.sumOf {it.source.shots.sumOf {shot -> shot.points}}
                        val roundScored=section.roundRows.filterNot {it.countOnly}
                        val roundMax=posterResultMaximum(roundScored)
                        text(if(roundScored.isNotEmpty())(roundMax?.let {"$roundPoints / $it"} ?: "Очки: $roundPoints")+" · средний ${compact(roundPoints.toDouble()/section.roundRows.sumOf {it.source.shots.size})}"
                            else"Стрел: ${section.roundRows.sumOf {it.source.volume}}",left+22f,gridTop+84f,25f,palette.muted,width=width-44)
                        section.rows.forEachIndexed {i,row ->
                            check()
                            val top=gridTop+104f+i*58f
                            text(row.number.toString().padStart(2,'0'),left+22f,top+36f,25f,palette.muted,true)
                            if(row.countOnly)text("${row.source.volume} стрел без оценки",left+72f,top+36f,27f)
                            else {
                                val tile=if(row.source.end.plannedCount<=3)52f else 40f
                                val shots=row.source.shots.associateBy {it.inputIndex}
                                repeat(row.source.end.plannedCount) {index ->
                                    val shot=shots[index]
                                    val digits=row.number.toString().length
                                    val x=left+max(70f,22f+digits*16f+12f)+index*(tile+6f)
                                    val colors=shot?.let {zoneColors(it.points)}
                                    paint.style=Paint.Style.FILL;paint.color=colors?.first ?: palette.border
                                    canvas.drawRoundRect(x,top,x+tile,top+48f,9f,9f,paint)
                                    val label=shot?.let {if(it.zoneCode=="X")"X"else if(it.points==0)"M"else it.points.toString()} ?: "—"
                                    setup(if(tile>40)30f else 26f,colors?.second ?: palette.muted,true)
                                    canvas.drawText(label,x+(tile-paint.measureText(label))/2,top+35f,paint)
                                }
                                val sum=row.source.shots.sumOf {it.points}
                                val label=row.resultMaximum?.let {"$sum/$it"} ?: sum.toString()
                                setup(25f,palette.ink,true);canvas.drawText(label,left+width-22-paint.measureText(label),top+35f,paint)
                            }
                            if(scopes.size>1)text("У${row.condition+1}",left+22f,top+58f,15f,palette.muted)
                        }
                    }
                    text("Ещё одна история FableShot",56f,height-42f,28f,palette.accent,true)
                    if(pages.size>1)text("${pageIndex+1} / ${pages.size}",875f,height-42f,28f,palette.muted)
                    val file=File(folder,"FableShot-poster-$token-${pageIndex+1}.png");output+=file
                    file.outputStream().use {check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))}
                    bytes+=file.length();require(bytes<=100L*1024*1024) {"Poster exceeds 100 MiB"}
                } finally {bitmap.recycle()}
            }
            return output
        } catch(e:Exception) {output.forEach {it.delete()};throw e}
    }

    private fun compact(value:Double)=String.format(java.util.Locale.forLanguageTag("ru"),"%.1f",value).removeSuffix(",0")
    private fun decimal(value:Double)=String.format(java.util.Locale.forLanguageTag("ru"),"%.2f",value)
    private fun zoneColors(score:Int):Pair<Int,Int> = when(score) {
        9,10 -> Color.rgb(246,209,67) to Color.rgb(33,31,16)
        7,8 -> Color.rgb(223,77,69) to Color.WHITE
        5,6 -> Color.rgb(69,169,205) to Color.rgb(15,31,38)
        3,4 -> Color.rgb(40,49,55) to Color.WHITE
        1,2 -> Color.rgb(238,242,235) to Color.rgb(25,32,27)
        else -> Color.rgb(111,127,117) to Color.WHITE
    }
}

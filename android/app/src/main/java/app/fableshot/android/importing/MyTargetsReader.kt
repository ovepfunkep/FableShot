package app.fableshot.android.importing

import java.io.InputStream
import java.io.InputStreamReader
import java.nio.charset.CodingErrorAction
import java.security.DigestInputStream
import java.security.MessageDigest
import java.time.LocalDate
import java.time.LocalTime

data class ImportIssue(val code:String,val line:Int,val blocking:Boolean,val record:Int=0)
data class MyTargetsConditions(val round:String,val distance:String,val target:String,val bow:String,val arrows:String,val distanceMeters:Double?,val diameterMm:Int?,val sourceArrowsPerEnd:Int?=null,val sourceEquipmentSnapshotJson:String?=null,val sourceBowCategory:String?=null,val scaleVerified:Boolean=false,val sourceTargetId:Int?=null,val sourceScoringStyle:Int?=null)
data class MyTargetsEnd(val key:String,val number:String,val timestamp:String,val time:LocalTime?,val shotCount:Int,val points:Int,val fingerprint:String,val firstRecord:Int,val lastRecord:Int,val overlapFingerprint:String?=null)
data class MyTargetsBlock(val key:String,val conditions:MyTargetsConditions,val ends:List<MyTargetsEnd>) {
    val shotCount get()=ends.sumOf{it.shotCount}
    val points get()=ends.sumOf{it.points}
}
data class MyTargetsGroup(val key:String,val title:String,val date:LocalDate?,val rawDate:String,val standardRound:String,val environment:String,val blocks:List<MyTargetsBlock>,val fingerprint:String,val firstRecord:Int,val lastRecord:Int,val ambiguousBoundary:Boolean,val issues:List<ImportIssue>) {
    val shotCount get()=blocks.sumOf{it.shotCount}
    val points get()=blocks.sumOf{it.points}
    val endCount get()=blocks.sumOf{it.ends.size}
    val canImport get()=issues.none{it.blocking}
}
data class MyTargetsRow(val groupKey:String,val blockKey:String,val endKey:String,val record:Int,val line:Int,val points:Int?,val zone:String?,val arrowNumber:Int?,val rawX:Double?,val rawY:Double?,val x:Double?,val y:Double?,val positionStatus:String,val rawValues:List<String>)
data class MyTargetsPreview(val fileHash:String,val bytes:Long,val headers:List<String>,val groups:List<MyTargetsGroup>,val sourceFormat:String="csv",val skippedEmptySlots:Int=0,val ignoredAttachments:Int=0,val equipmentCatalog:MyTargetsEquipmentCatalog?=null)
data class MyTargetsGrouping(val splitBeforeRecords:Set<Int> = emptySet(),val joinBeforeRecords:Set<Int> = emptySet())

/** Two-pass friendly: preview retains aggregates, not a list of every arrow or raw CSV row. */
object MyTargetsReader {
    const val PARSER_VERSION="mytargets-csv-v1"
    const val MAX_BYTES=25L*1024*1024
    val HEADERS=listOf("Title","Date","Standard round","Indoor","Bow","Arrow","Round","Distance","Target","End","Timestamp","Points","Arrow numbers","x","y")
    private val russianHeaders = listOf("Название", "Дата", "Стандартный раунд", "В помещении", "Лук", "Стрела", "Раунд", "Дистанция", "Мишень", "Серия", "Временная отметка", "Очки", "Номера стрел", "x", "y")
    private val headerAliases = russianHeaders.zip(HEADERS).toMap()
    private fun sha()=MessageDigest.getInstance("SHA-256")
    private fun MessageDigest.cell(value:String){val bytes=value.toByteArray(Charsets.UTF_8);update(bytes.size.toString().toByteArray(Charsets.US_ASCII));update(':'.code.toByte());update(bytes)}
    private fun MessageDigest.hex()=digest().joinToString(""){"%02x".format(it)}
    private class EndBuilder(val key:String,val number:String,val timestamp:String,val time:LocalTime?,val first:Int){var last=first;var count=0;var points=0;val hash=sha();fun result()=MyTargetsEnd(key,number,timestamp,time,count,points,hash.hex(),first,last)}
    private class BlockBuilder(val key:String,val conditions:MyTargetsConditions){val ends=mutableListOf<MyTargetsEnd>();var end:EndBuilder?=null;fun finishEnd(){end?.let{ends.add(it.result())};end=null};fun result():MyTargetsBlock{finishEnd();return MyTargetsBlock(key,conditions,ends.toList())}}
    private class GroupBuilder(val key:String,val values:List<String>,val first:Int,val ambiguous:Boolean,val date:LocalDate?){var last=first;val blocks=mutableListOf<MyTargetsBlock>();var block:BlockBuilder?=null;val hash=sha();val issues=mutableListOf<ImportIssue>();fun finishBlock(){block?.let{blocks.add(it.result())};block=null};fun result():MyTargetsGroup{finishBlock();return MyTargetsGroup(key,values[0],date,values[1],values[2],values[3],blocks.toList(),hash.hex(),first,last,ambiguous,issues.toList())}}

    suspend fun read(input:InputStream,grouping:MyTargetsGrouping=MyTargetsGrouping(),checkCancelled:()->Unit={},onRow:suspend(MyTargetsRow)->Unit={}):MyTargetsPreview {
        val digest=sha();var byteCount=0L
        val limited=object:InputStream(){
            override fun read():Int=input.read().also{if(it>=0){byteCount++;if(byteCount>MAX_BYTES)throw IllegalArgumentException("CSV exceeds 25 MiB")}}
            override fun read(buffer:ByteArray,offset:Int,length:Int):Int=input.read(buffer,offset,length).also{if(it>0){byteCount+=it;if(byteCount>MAX_BYTES)throw IllegalArgumentException("CSV exceeds 25 MiB")}}
            override fun close()=input.close()
        }
        val decoder=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        val groups=mutableListOf<MyTargetsGroup>();var group:GroupBuilder?=null
        var headers=emptyList<String>();var normalizedHeaders=emptyList<String>();var indexes=emptyList<Int>();var canonical=emptyList<Int>();var lastRound:Int?=null;var lastEnd:Int?=null;var lastConditions:MyTargetsConditions?=null;var recordCursor=0
        fun issue(code:String,line:Int,blocking:Boolean){val current=requireNotNull(group);if(current.issues.size>=1000)throw IllegalArgumentException("More than 1000 issues in one group");current.issues.add(ImportIssue(code,line,blocking,recordCursor))}
        fun finishGroup(){group?.let{groups.add(it.result())};group=null}
        InputStreamReader(DigestInputStream(limited,digest),decoder).buffered().use { reader->
            for(record in SemicolonCsv.records(reader)) {
                checkCancelled()
                recordCursor=record.number
                if(record.values.all{it.isBlank()})continue
                if(headers.isEmpty()) {
                    headers=record.values.map{it.trim()}
                    require(headers.distinct().size==headers.size){"Duplicate CSV header"}
                    normalizedHeaders=headers.map { headerAliases[it] ?: it }
                    require(normalizedHeaders.distinct().size==normalizedHeaders.size){"Duplicate CSV header alias"}
                    require(HEADERS.all{it in normalizedHeaders}){"Unsupported MyTargets header"}
                    indexes=HEADERS.map{normalizedHeaders.indexOf(it)};canonical=headers.indices.sortedBy{normalizedHeaders[it]};continue
                }
                require(record.values.size==headers.size){"Column count differs at line ${record.line}"}
                val v=indexes.map{record.values[it]}
                val conditions=MyTargetsConditions(v[6],v[7],v[8],v[4],v[5],distance(v[7]),diameter(v[8]))
                val round=v[6].toIntOrNull();val endNumber=v[9].toIntOrNull()
                val identity=v.take(4)
                val changedIdentity=group?.values!=identity
                val reset=group!=null&&!changedIdentity&&lastConditions?.copy(round=conditions.round)==conditions&&((round!=null&&lastRound!=null&&round<lastRound!!)||(round==lastRound&&endNumber!=null&&lastEnd!=null&&endNumber<lastEnd!!))
                val split=group==null||record.number in grouping.splitBeforeRecords||(changedIdentity&&record.number !in grouping.joinBeforeRecords)||(reset&&record.number !in grouping.joinBeforeRecords)
                if(split) {
                    finishGroup()
                    val date=runCatching{LocalDate.parse(v[1])}.getOrNull()
                    group=GroupBuilder("g${groups.size}",identity,record.number,reset,date)
                    if(date==null)issue("unknown_date",record.line,false)
                    if(reset)issue("ambiguous_session_boundary",record.line,false)
                    issue("unverified_coordinate_axes",record.line,false)
                }
                val g=requireNotNull(group);g.last=record.number
                if(g.block?.conditions!=conditions){g.finishBlock();g.block=BlockBuilder("${g.key}:b${g.blocks.size}",conditions);if(conditions.distanceMeters==null)issue("unknown_distance_unit",record.line,false);if(conditions.diameterMm==null)issue("unknown_target_size",record.line,false)}
                val b=requireNotNull(g.block)
                if(b.end?.number!=v[9]||b.end?.timestamp!=v[10]) {
                    b.finishEnd();val time=runCatching{LocalTime.parse(v[10])}.getOrNull()
                    b.end=EndBuilder("${b.key}:e${b.ends.size}",v[9],v[10],time,record.number)
                    if(time==null)issue("unknown_end_time",record.line,false)
                }
                val e=requireNotNull(b.end);e.last=record.number;e.count++
                if(round==null||round<1||endNumber==null||endNumber<1)issue("invalid_round_or_end_number",record.line,true)
                val rawScore=v[11].trim();val zone=when(rawScore.uppercase()){ "M"->"M";"X"->"X";else->rawScore.toIntOrNull()?.takeIf{it in 0..10}?.let{if(it==0)"M"else it.toString()} }
                val points=when(zone){"M"->0;"X"->10;else->zone?.toIntOrNull()}
                if(points==null)issue("unsupported_score",record.line,true)else e.points+=points
                val x=v[13].toDoubleOrNull()?.takeIf{it.isFinite()};val y=v[14].toDoubleOrNull()?.takeIf{it.isFinite()}
                val paired=x!=null&&y!=null
                if(!paired&&(v[13].isNotBlank()||v[14].isNotBlank()))issue("invalid_coordinate_pair",record.line,false)
                val fakeMiss=zone=="M"&&x==0.0&&y==0.0&&v[8].startsWith("WA Full")
                val usable=paired&&!fakeMiss
                val arrow=v[12].trim().takeIf{it.isNotEmpty()}?.toIntOrNull()?.takeIf{it>0}
                if(v[12].isNotBlank()&&arrow==null)issue("invalid_arrow_number",record.line,false)
                for(index in canonical){g.hash.cell(normalizedHeaders[index]);g.hash.cell(record.values[index]);e.hash.cell(normalizedHeaders[index]);e.hash.cell(record.values[index])}
                onRow(MyTargetsRow(g.key,b.key,e.key,record.number,record.line,points,zone,arrow,x,y,if(usable)x else null,if(usable)y else null,if(usable)"unverified"else"unknown",record.values))
                lastRound=round;lastEnd=endNumber;lastConditions=conditions
            }
        }
        require(headers.isNotEmpty()){"Empty CSV"};finishGroup()
        val withOverlap=groups.map { value -> value.copy(blocks=value.blocks.map { block ->
            block.copy(ends=block.ends.map { end -> end.copy(overlapFingerprint=
                MyTargetsOverlap.fingerprint(value.title,value.rawDate,block.conditions,end.timestamp)) })
        }) }
        return MyTargetsPreview(digest.hex(),byteCount,headers,withOverlap)
    }

    private fun distance(text:String):Double? {
        val match=Regex("^\\s*(\\d+(?:[.,]\\d+)?)\\s*(m|yd|ft)\\s*$",RegexOption.IGNORE_CASE).matchEntire(text)?:return null
        val value=match.groupValues[1].replace(',','.').toDoubleOrNull()?:return null
        val result=value*when(match.groupValues[2].lowercase()){ "yd"->.9144;"ft"->.3048;else->1.0 }
        return result.takeIf{it.isFinite()&&it>0}
    }
    private fun diameter(text:String):Int? {
        val match=Regex("\\((\\d+(?:[.,]\\d+)?)\\s*(cm|mm)\\)",RegexOption.IGNORE_CASE).find(text)?:return null
        val result=(match.groupValues[1].replace(',','.').toDoubleOrNull()?:return null)*if(match.groupValues[2].lowercase()=="cm")10 else 1
        return result.takeIf{it.isFinite()&&it>0&&it<=100000&&it%1.0==0.0}?.toInt()
    }
}

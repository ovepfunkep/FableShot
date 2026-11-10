package app.fableshot.android.export

import app.fableshot.android.data.journal.*
import java.io.File
import java.io.Writer
import java.util.UUID

/** UTF-8 BOM, semicolon-separated RFC-style quoting; typed numbers remain numeric. */
object AnalyticsCsv {
 val columns=listOf("format","record_type","session_id","session_revision","title","local_date","time_zone","time_source","source","block_id","block_number","mode","distance_m","target_profile","target_version","target_diameter_mm","target_snapshot","equipment_snapshot","end_id","end_number","end_role","end_state","planned_arrows","shot_id","input_order","points","zone","automatic_points","automatic_rule","x","y","face_id","score_source","position_source","position_status","physical_arrow_number","shot_created_ms","shot_updated_ms","shot_revision","count")
 fun cell(value:Any?):String {
  var text=value?.toString().orEmpty()
  if(value is String&&(text.firstOrNull() in listOf('\t','\r','\n')||text.trimStart().firstOrNull() in listOf('=','+','-','@')))text="'"+text
  return "\""+text.replace("\"","\"\"")+"\""
 }
 fun write(out:Writer,sessions:List<JournalDetails>){
  require(sessions.isNotEmpty())
  fun emit(base:Map<String,Any?>){out.write(columns.joinToString(";"){cell(base[it])});out.write("\r\n")}
  out.write("\uFEFF");out.write(columns.joinToString(";"){cell(it)});out.write("\r\n")
  sessions.forEach{d->
   val s=d.session
   val base=mapOf<String,Any?>("format" to "fableshot-shots-v1","session_id" to s.id,"session_revision" to s.revision,"title" to s.title,"local_date" to s.localDate,"time_zone" to s.timeZoneId,"time_source" to s.timeSource,"source" to s.sourceKind)
   if(d.blocks.isEmpty())emit(base+mapOf("record_type" to "session"))
   d.orderedBlocks.forEach{b->val block=b.block
    val bm=base+mapOf("block_id" to block.id,"block_number" to block.ordinal+1,"mode" to block.mode,"distance_m" to block.distanceMeters,"target_profile" to block.targetProfileId,"target_version" to block.targetProfileVersion,"target_diameter_mm" to block.targetDiameterMm,"target_snapshot" to block.targetSnapshotJson,"equipment_snapshot" to block.equipmentSnapshotJson)
    if(b.ends.isEmpty())emit(bm+mapOf("record_type" to "block"))
    b.orderedEnds.forEach{e->val end=e.end;val em=bm+mapOf("end_id" to end.id,"end_number" to end.ordinal+1,"end_role" to end.role,"end_state" to end.state,"planned_arrows" to end.plannedCount)
     if(e.shots.isEmpty()&&e.counts.isEmpty())emit(em+mapOf("record_type" to "empty_end"))
     e.shots.sortedBy{it.inputIndex}.forEach{shot->emit(em+mapOf("record_type" to "shot","shot_id" to shot.id,"input_order" to shot.inputIndex+1,"points" to shot.points,"zone" to shot.zoneCode,"automatic_points" to shot.automaticPoints,"automatic_rule" to shot.automaticRuleVersion,"x" to shot.x,"y" to shot.y,"face_id" to shot.faceId,"score_source" to shot.scoreSource,"position_source" to shot.positionSource,"position_status" to shot.positionStatus,"physical_arrow_number" to shot.physicalArrowNumber,"shot_created_ms" to shot.createdAtMs,"shot_updated_ms" to shot.updatedAtMs,"shot_revision" to shot.revision))}
     e.counts.forEach{count->emit(em+mapOf("record_type" to "count","count" to count.count))}
    }
   }
  }
 }
 fun create(directory:File,sessions:List<JournalDetails>):File {
  directory.mkdirs();val file=File(directory,"FableShot-${UUID.randomUUID()}.csv")
  try{file.bufferedWriter(Charsets.UTF_8).use{write(it,sessions)};return file}catch(e:Exception){file.delete();throw e}
 }
}

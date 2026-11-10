package app.fableshot.android.data.journal

import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

@Entity(tableName="progress_baselines",foreignKeys=[ForeignKey(entity=JournalBlock::class,parentColumns=["id"],childColumns=["blockId"],onDelete=ForeignKey.CASCADE)],indices=[Index(value=["baselineId"],unique=true)])
data class ProgressBaseline(@PrimaryKey val blockId:String,val baselineId:String,val policyVersion:String,val frozenAtMs:Long,val sessionStartCutoffMs:Long?,val conditionsJson:String?,val maximumPerArrow:Int?,val status:String,val sourceSessionsJson:String,val scoredCount:Int,val scoreSum:Long)

val MIGRATION_3_4:Migration=object:Migration(3,4){override fun migrate(db:SupportSQLiteDatabase){
    db.execSQL("CREATE TABLE IF NOT EXISTS progress_baselines (blockId TEXT NOT NULL PRIMARY KEY,baselineId TEXT NOT NULL,policyVersion TEXT NOT NULL,frozenAtMs INTEGER NOT NULL,sessionStartCutoffMs INTEGER,conditionsJson TEXT,maximumPerArrow INTEGER,status TEXT NOT NULL,sourceSessionsJson TEXT NOT NULL,scoredCount INTEGER NOT NULL,scoreSum INTEGER NOT NULL,FOREIGN KEY(blockId) REFERENCES blocks(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
    db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_progress_baselines_baselineId ON progress_baselines(baselineId)")
}}

/** An unknown bow category or unverified target never silently becomes a comparable condition. */
internal fun progressConditions(block:JournalBlock):String? {
    if(block.mode!="scored"||block.distanceMeters?.let{it.isFinite()&&it>0}!=true||block.targetDiameterMm?.let{it>0}!=true)return null
    val profile=block.verifiedTarget()?:return null
    val category=runCatching{JSONObject(block.equipmentSnapshotJson!!).getJSONObject("bow").getString("category")}.getOrNull()
    if(category !in app.fableshot.android.data.EquipmentRepository.BOW_CATEGORIES)return null
    return JSONObject().put("distanceMeters",block.distanceMeters).put("diameterMm",block.targetDiameterMm).put("profileId",block.targetProfileId).put("profileVersion",1).put("geometry","single-circle-main").put("rule",profile.rule).put("maximumPerArrow",10).put("bowCategory",category).toString()
}

/** Called only inside the transaction that creates a native block. Never backfill old history. */
internal suspend fun freezeProgress(db:JournalDatabase,session:JournalSession,block:JournalBlock,now:Long) {
    val key=progressConditions(block);val cutoff=session.startedAtMs
    val sources=JSONArray();var count=0;var total=0L
    if(key!=null&&cutoff!=null) {
        val candidates=db.journalDao().baselineCandidates(session.id,cutoff)
            .sortedWith(compareByDescending<JournalDetails>{it.session.startedAtMs?:Long.MIN_VALUE}.thenBy{it.session.id})
        for(candidate in candidates) {
            val shots=candidate.blocks.filter{progressConditions(it.block)==key}.flatMap{it.ends.filter{e->e.end.role=="scored"}.flatMap{it.shots}}
            if(shots.size<12)continue
            val sum=shots.sumOf{it.points.toLong()};count+=shots.size;total+=sum
            sources.put(JSONObject().put("sessionId",candidate.session.id).put("revision",candidate.session.revision).put("title",candidate.session.title).put("count",shots.size).put("sum",sum).put("startedAtMs",candidate.session.startedAtMs?:JSONObject.NULL).put("completedAtMs",candidate.session.completedAtMs).put("sourceKind",candidate.session.sourceKind))
            if(sources.length()==5)break
        }
    }
    db.journalDao().insert(ProgressBaseline(block.id,UUID.randomUUID().toString(),"progress-pg1-v1",now,cutoff,key,if(key!=null)10 else null,if(key==null||cutoff==null)"unknown_conditions"else if(sources.length()>=3)"ready"else"building",sources.toString(),count,total))
}

fun journalProgress(block:JournalBlockDetails):app.fableshot.android.domain.ProgressResult? {
    val baseline=block.baselines.singleOrNull()?:return null
    if(baseline.status !in setOf("ready","building")||baseline.maximumPerArrow==null)return null
    val input=block.scoringInput();val shots=input.ends.flatMap{it.shots}
    return app.fableshot.android.domain.ProgressScoring.calculate(shots.sumOf{it.points.toLong()},shots.size,baseline.scoreSum,baseline.scoredCount,JSONArray(baseline.sourceSessionsJson).length(),baseline.maximumPerArrow,input.ends.all{it.closed&&it.shots.size==it.plannedCount})
}

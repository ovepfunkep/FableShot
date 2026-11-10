package app.fableshot.android.data.journal
import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

val MIGRATION_13_14:Migration=object:Migration(13,14) {
    override fun migrate(db:SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE ends ADD COLUMN startsRound INTEGER NOT NULL DEFAULT 0")
    }
}
@Entity(tableName="session_plans",foreignKeys=[ForeignKey(entity=JournalSession::class,parentColumns=["id"],childColumns=["sessionId"],onDelete=ForeignKey.CASCADE)])
data class SessionPlan(@PrimaryKey val sessionId:String,val plannedEnds:Int,@ColumnInfo(defaultValue="1") val roundCount:Int=1,
    @ColumnInfo(defaultValue="0") val rolling:Boolean=false,
    @ColumnInfo(defaultValue="NULL") val roundArrowLimit:Int?=null,
) {
    val seriesLimit get()=if(roundArrowLimit!=null)null else (plannedEnds/roundCount).takeIf { it>0 }
}

val MIGRATION_10_11:Migration=object:Migration(10,11) {
    override fun migrate(db:SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE session_plans ADD COLUMN rolling INTEGER NOT NULL DEFAULT 0")
    }
}
val MIGRATION_4_5:Migration=object:Migration(4,5){override fun migrate(db:SupportSQLiteDatabase){
    db.execSQL("CREATE TABLE IF NOT EXISTS session_plans (sessionId TEXT NOT NULL PRIMARY KEY,plannedEnds INTEGER NOT NULL,FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
}}
val JournalDetails.rollingRounds get()=plans.singleOrNull()?.rolling==true
val JournalDetails.plannedEnds get()=plans.singleOrNull()?.takeUnless { it.rolling }?.plannedEnds
internal const val MAX_SERIES_ARROWS = 1_000_000
fun JournalDetails.spendsPlanEnd(end:JournalEndDetails):Boolean = end.end.role=="scored" &&
    (end.volume>0 || ((rollingRounds||(plans.singleOrNull()?.roundCount?:1)>1) && end.end.state=="closed"))
val JournalDetails.usedPlanEnds get()=blocks.sumOf { b->b.ends.count { spendsPlanEnd(it) } }
val JournalDetails.closedPlanEnds get()=blocks.sumOf { b->b.ends.count { it.end.state=="closed" && spendsPlanEnd(it) } }
val JournalDetails.finishesPlanOnNext get()=plannedEnds?.let{usedPlanEnds>=it&&currentEnd?.end?.role=="scored"}?:false

val MIGRATION_6_7:Migration=object:Migration(6,7) {
    override fun migrate(db:SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE session_plans ADD COLUMN roundCount INTEGER NOT NULL DEFAULT 1")
    }
}

data class RoundProgress(
    val number:Int,
    val count:Int?,
    val seriesNumber:Int,
    val seriesLimit:Int?,
    val ends:List<JournalEndDetails>,
    val maximum:Int?,
    val roundArrowLimit:Int?=null,
    val plannedArrowCount:Int?=null,
) {
    val title get()="Раунд $number${count?.let { "/$it" }.orEmpty()} · Серия $seriesNumber${seriesLimit?.let { "/$it" }.orEmpty()}"
    val endsRound get()=(roundArrowLimit?.let { limit -> ends.sumOf { it.volume }>=limit }
        ?: (seriesLimit!=null && seriesNumber>=seriesLimit)) && (count==null||number<count)
}

/** Native boundaries follow the saved plan; ZIP imports may carry explicit source round IDs. */
fun JournalDetails.roundProgress(endId:String?=currentEnd?.end?.id):RoundProgress {
    val groups=roundGroups(endId)
    val index=groups.indexOfFirst { entries -> entries.any { it.end.id==endId } }.coerceAtLeast(0)
    val ends=groups.getOrNull(index).orEmpty()
    val series=ends.indexOfFirst { it.end.id==endId }.coerceAtLeast(0)+1
    val imported=importedRoundGroups()!=null
    val plan=plans.singleOrNull()
    val limit=if(imported)null else plan?.seriesLimit
    val arrows=ends.firstOrNull { it.end.id==endId }?.end?.plannedCount ?: currentBlock?.block?.defaultArrowsPerEnd ?: 3
    val arrowLimit=if(imported)null else plan?.roundArrowLimit
    val knownScore=ends.all { entry -> orderedBlocks.first { it.block.id==entry.end.blockId }.block.let {
        it.mode=="scored" && it.verifiedTarget()?.values?.maxOrNull()==10
    } }
    val maximum=if(knownScore)ends.sumOf { it.shots.size }*10 else null
    val plannedArrows=arrowLimit ?: limit?.let {
        ends.sumOf { e->e.end.plannedCount }+(it-ends.size).coerceAtLeast(0)*arrows
    }
    val count=if(imported) groups.size.takeUnless { rollingRounds } else plan?.takeUnless { it.rolling }?.roundCount
    return RoundProgress(index+1,count,series,limit,ends,maximum,arrowLimit,plannedArrows)
}

private fun splitRoundGroups(entries:List<JournalEndDetails>,limit:Int?):List<List<JournalEndDetails>> {
    val groups=mutableListOf<MutableList<JournalEndDetails>>()
    entries.forEach { entry ->
        if(groups.isEmpty() || entry.end.startsRound || (limit!=null && groups.last().size>=limit))
            groups.add(mutableListOf())
        groups.last().add(entry)
    }
    return groups
}

private fun JournalDetails.roundGroups(endId:String?) = importedRoundGroups()?.flatMap { splitRoundGroups(it,null) }
    ?: splitRoundGroups(roundSequence(endId),plans.singleOrNull()?.seriesLimit)

/** Real saved boundaries, including a currently open empty series. */
fun JournalDetails.trainingRounds():List<RoundProgress> = roundGroups(currentEnd?.end?.id).map { entries ->
    roundProgress(entries.last().end.id)
}

val JournalDetails.canStartNextRound:Boolean get()=session.state=="active"&&session.deletedAtMs==null&&
    currentEnd?.end?.role=="scored"&&roundProgress().ends.sumOf { it.volume }>0

/** A preview never silently combines shots from earlier rounds. Original facts stay unchanged. */
fun JournalDetails.currentRoundDetails(endId:String?=currentEnd?.end?.id):JournalDetails {
    val ids=roundProgress(endId).ends.map { it.end.id }.toSet()
    return copy(blocks=orderedBlocks.mapNotNull { entry ->
        entry.ends.filter { it.end.id in ids }.takeIf { it.isNotEmpty() }?.let { entry.copy(ends=it) }
    },plans=emptyList())
}

private fun JournalDetails.roundSequence(endId:String?)=orderedBlocks.flatMap {it.orderedEnds}
    .filter {it.end.role=="scored"&&(spendsPlanEnd(it)||it.end.id==endId)}

private fun JournalDetails.importedRoundGroups():List<List<JournalEndDetails>>? {
    if(session.sourceKind!="mytargets"||orderedBlocks.isEmpty())return null
    val grouped=linkedMapOf<String,MutableList<JournalEndDetails>>()
    for(block in orderedBlocks) {
        val source=block.block.targetSnapshotJson?.let { text -> runCatching { org.json.JSONObject(text) }.getOrNull() }
           
        val sourceKey=source?.takeIf { it.optString("sourceFormat")=="mytargets-zip-v27" }
            ?.optString("sourceRoundKey")?.takeIf { it.isNotBlank() }
        val key=sourceKey ?: if(grouped.isNotEmpty()) block.block.id else return null
        val entries=block.orderedEnds.filter { it.end.role=="scored"&&(it.volume>0||it.end.state=="open") }
        if(entries.isNotEmpty())grouped.getOrPut(key){mutableListOf()}.addAll(entries)
    }
    return grouped.values.map { it.toList() }.takeIf { it.isNotEmpty() }
}

fun JournalDetails.roundLocations():Map<String,Pair<Int,Int>> {
    return roundGroups(currentEnd?.end?.id).flatMapIndexed { round,ends ->
        ends.mapIndexed { series,entry -> entry.end.id to (round+1 to series+1) }
    }.toMap()
}

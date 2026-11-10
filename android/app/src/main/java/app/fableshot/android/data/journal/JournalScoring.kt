package app.fableshot.android.data.journal

import app.fableshot.android.domain.*
import org.json.JSONObject

data class JournalScoringInput(val ends:List<ScoringEnd>,val maximumPerArrow:Int?,val geometryVerified:Boolean,val radiusMm:Double?,val scopeId:String="") {
    fun score(slice:Int=ends.size,profile:CompositeProfile=CompositeProfile.Standard,singleEnd:Boolean=false)=CompositeScoring.calculate(ends,slice,maximumPerArrow,geometryVerified,profile,singleEnd)
}

val JournalScoringInput.hasCompleteReportEnds: Boolean
    get() = ends.any { it.plannedCount > 0 && it.shots.size == it.plannedCount }

/** Report comparison excludes incomplete series; saved series numbers and facts never change. */
fun JournalScoringInput.compositeReportScore(
    slice: Int = ends.size,
    profile: CompositeProfile = CompositeProfile.Standard,
    singleEnd: Boolean = false,
): CompositeBreakdown {
    val complete = ends.filter { end ->
        (if (singleEnd) end.number == slice else end.number <= slice) &&
            end.plannedCount > 0 && end.shots.size == end.plannedCount
    }.sortedBy { it.number }.mapIndexed { index, end ->
        // A completely entered open series is already a complete sample, before pressing Next.
        end.copy(number = index + 1, closed = true)
    }
    return CompositeScoring.calculate(complete, complete.size, maximumPerArrow, geometryVerified, profile, singleEnd)
}

/** Explicit profile knowledge only: imported source coordinates remain unverified. */
fun JournalBlockDetails.scoringInput():JournalScoringInput {
    val snapshot=block.targetSnapshotJson?.let{runCatching{JSONObject(it)}.getOrNull()}
    val practice=block.verifiedTarget()!=null
    val imported=block.targetProfileId?.startsWith("mytargets-source-10-")==true&&snapshot?.optString("profileId")==block.targetProfileId&&snapshot?.optString("scoringRuleVersion")=="mytargets-source-scores-v1"&&snapshot.optInt("maxPoints")==10
    val maximum=if(practice||imported)10 else null
    val selected=orderedEnds.filter{it.end.role=="scored"}.toMutableList()
    // An unused next end is navigation state, not a missing completed series. Keep partial ends.
    if(selected.lastOrNull()?.let{it.end.state=="open"&&it.shots.isEmpty()}==true)selected.removeAt(selected.lastIndex)
    val ends=selected.mapIndexed{index,end->ScoringEnd(end.end.id,index+1,end.end.plannedCount,end.end.state=="closed",end.shots.map{shot->
        val point=if(shot.positionStatus=="known"&&shot.faceId=="main"&&shot.x!=null&&shot.y!=null)TargetPoint(shot.x,shot.y)else null
        ScoringShot(shot.id,shot.points,point)
    })}
    return JournalScoringInput(ends,maximum,practice,block.targetDiameterMm?.takeIf{it>0}?.div(2.0),block.id)
}

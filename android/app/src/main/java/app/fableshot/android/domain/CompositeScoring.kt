package app.fableshot.android.domain

import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.sqrt

enum class CompositeProfile(val id:String){Standard("cg3-standard-v1"),ScoreOnly("cg3-score-only-v1")}
enum class ScoreAvailability { Available,NoData,IncompleteSlice,IncompleteEnd,InsufficientEndShots,InsufficientEnds,MissingCoordinates,UnverifiedGeometry,UnknownMaximum,InvalidData }
enum class CompositePhase { Single,Early,Full }
data class ScoringShot(val id:String,val points:Int,val position:TargetPoint?=null)
data class ScoringEnd(val id:String,val number:Int,val plannedCount:Int,val closed:Boolean,val shots:List<ScoringShot>)
data class CompositeBreakdown(
    val profile:CompositeProfile,val availability:ScoreAvailability,val phase:CompositePhase,
    val slice:Int,val endCount:Int,val shotCount:Int,val knownPositions:Int,val classic:Long,val maximum:Long?,
    val base:Double?=null,val rms:Double?=null,val q:Double?=null,val deviation:Double?=null,val stability:Double?=null,
    val groupBonus:Double?=null,val stabilityBonus:Double?=null,val total:Double?=null,
) {
    val fullRankAvailable get()=availability==ScoreAvailability.Available&&phase==CompositePhase.Full
    val hundredths get()=total?.let(ScoreRounding::hundredths)
    val rawEquivalent get()=if(total!=null&&maximum!=null)total*maximum/100.0 else null
}

object ScoreRounding {
    /** Remove binary arithmetic dust at 12 decimals, then decimal half-up to displayed hundredths. */
    fun hundredths(value:Double):Long {
        require(value.isFinite())
        return BigDecimal.valueOf(value).setScale(12,RoundingMode.HALF_EVEN).movePointRight(2).setScale(0,RoundingMode.HALF_UP).longValueExact()
    }
    fun display(value:Double):String=BigDecimal.valueOf(hundredths(value),2).toPlainString()
    fun competitionRanks(values:List<Double?>):List<Int?> {
        val rounded=values.map{it?.let(::hundredths)}
        return rounded.map{value->value?.let{1+rounded.count{other->other!=null&&other>value}}}
    }
}

/** Pure versioned CG3. Neither clipping the target drawing nor later ends affect this result. */
object CompositeScoring {
    fun calculate(ends:List<ScoringEnd>,slice:Int,maximumPerArrow:Int?,geometryVerified:Boolean,profile:CompositeProfile=CompositeProfile.Standard,singleEnd:Boolean=false):CompositeBreakdown {
        val chosen=ends.filter{if(singleEnd)it.number==slice else it.number<=slice}.sortedBy{it.number}
        val shots=chosen.flatMap{it.shots};val count=shots.size;val known=shots.count{it.position!=null}
        val phase=if(singleEnd)CompositePhase.Single else if(slice<3)CompositePhase.Early else CompositePhase.Full
        val classic=shots.sumOf{it.points.toLong()};val maximum=maximumPerArrow?.takeIf{it>0}?.let{it.toLong()*count}
        val result=CompositeBreakdown(profile,ScoreAvailability.Available,phase,slice,chosen.size,count,known,classic,maximum)
        fun unavailable(reason:ScoreAvailability)=result.copy(availability=reason)
        if(slice<1)return unavailable(ScoreAvailability.NoData)
        if(chosen.size!=(if(singleEnd)1 else slice)||chosen.withIndex().any{(index,end)->end.number!=(if(singleEnd)slice else index+1)})return unavailable(ScoreAvailability.IncompleteSlice)
        if(shots.isEmpty())return unavailable(ScoreAvailability.NoData)
        val h=maximumPerArrow?.takeIf{it>0}?:return unavailable(ScoreAvailability.UnknownMaximum)
        if(chosen.map{it.id}.distinct().size!=chosen.size||shots.map{it.id}.distinct().size!=shots.size||chosen.any{it.plannedCount<1||it.shots.size>it.plannedCount}||shots.any{it.points !in 0..h||it.position?.let{p->!p.x.isFinite()||!p.y.isFinite()}==true})return unavailable(ScoreAvailability.InvalidData)
        val a=classic.toDouble()/requireNotNull(maximum)
        val base=result.copy(base=100*a)
        if(chosen.any{!it.closed||it.shots.size!=it.plannedCount})return base.copy(availability=ScoreAvailability.IncompleteEnd)
        if(profile==CompositeProfile.Standard&&chosen.any{it.shots.size<3})return base.copy(availability=ScoreAvailability.InsufficientEndShots)
        if(profile==CompositeProfile.ScoreOnly&&(singleEnd||chosen.size<3||count<9))return base.copy(availability=ScoreAvailability.InsufficientEnds)
        if(profile==CompositeProfile.Standard&&!geometryVerified)return base.copy(availability=ScoreAvailability.UnverifiedGeometry)
        if(profile==CompositeProfile.Standard&&shots.any{it.points>0&&it.position==null})
            return base.copy(availability=ScoreAvailability.MissingCoordinates)
        val full=!singleEnd&&chosen.size>=3&&count>=9
        val deviation=if(full)sqrt(chosen.sumOf{end->val mean=end.shots.sumOf{it.points.toLong()}.toDouble()/(h.toDouble()*end.shots.size);end.shots.size*(mean-a)*(mean-a)}/count)else null
        val stability=deviation?.let{(1-it/.15).coerceIn(0.0,1.0)}
        val rms=if(profile==CompositeProfile.Standard)groupRms(chosen)else null
        if(rms?.isFinite()==false)return base.copy(availability=ScoreAvailability.InvalidData)
        val q=if(profile==CompositeProfile.Standard)rms?.let{(1-it/.10).coerceIn(0.0,1.0)}?:0.0 else null
        val groupBonus=q?.let{it*if(full)4 else 5}
        val stabilityBonus=stability?.let{it*if(profile==CompositeProfile.ScoreOnly)5 else 1}
        val total=100*a+(groupBonus?:0.0)+(stabilityBonus?:0.0)
        return base.copy(rms=rms,q=q,deviation=deviation,stability=stability,groupBonus=groupBonus,stabilityBonus=stabilityBonus,total=total.coerceIn(0.0,105.0))
    }

    private fun groupRms(ends:List<ScoringEnd>):Double? {
        var squaredDistance=0.0
        var pointCount=0
        for(end in ends) {
            // A recorded zero without a position counts toward the score, but provides no geometry.
            val points=end.shots.mapNotNull {it.position}
            if(points.size<2)continue
            val cx=points.sumOf {it.x}/points.size
            val cy=points.sumOf {it.y}/points.size
            squaredDistance+=points.sumOf {point ->
                val dx=point.x-cx
                val dy=point.y-cy
                dx*dx+dy*dy
            }
            pointCount+=points.size
        }
        return if(pointCount>0)sqrt(squaredDistance/pointCount)else null
    }
}

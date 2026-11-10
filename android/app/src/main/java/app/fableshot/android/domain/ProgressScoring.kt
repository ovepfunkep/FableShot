package app.fableshot.android.domain

data class ProgressResult(val percentagePoints:Double?,val relativePercent:Double?,val baselineAverage:Double?,val currentAverage:Double?,val fullRankAvailable:Boolean)
object ProgressScoring {
    fun calculate(currentSum:Long,currentCount:Int,baselineSum:Long,baselineCount:Int,sourceSessions:Int,maximum:Int,currentComplete:Boolean):ProgressResult {
        require(maximum>0&&currentCount>=0&&baselineCount>=0&&sourceSessions in 0..5)
        require(currentSum in 0..currentCount.toLong()*maximum&&baselineSum in 0..baselineCount.toLong()*maximum)
        require((sourceSessions==0)==(baselineCount==0))
        val current=if(currentCount>0)currentSum.toDouble()/currentCount else null
        val base=if(baselineCount>0)baselineSum.toDouble()/baselineCount else null
        val points=if(current!=null&&base!=null)100*(current-base)/maximum else null
        val relative=if(current!=null&&base!=null&&base>0)100*(current-base)/base else null
        return ProgressResult(points,relative,base,current,points!=null&&sourceSessions>=3&&currentCount>=12&&currentComplete)
    }
}

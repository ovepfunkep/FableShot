package app.fableshot.android.domain

import kotlin.math.hypot

data class TargetZone(val code:String,val points:Int,val outerRadius:Double)
data class TargetProfile(val id:String,val title:String,val diameters:List<Int>,val zones:List<TargetZone>,val rule:String,val source:String?=null) {
    val supportsX get()=zones.any{it.code=="X"}
    val values get()=zones.map{it.points}.distinct()+0
    fun acceptsDiameter(mm:Int)=mm>0&&(diameters.isEmpty()||mm in diameters)
    fun score(p:TargetPoint):TargetZone=zones.firstOrNull{hypot(p.x,p.y)<=it.outerRadius+1e-9}?:TargetZone("M",0,Double.POSITIVE_INFINITY)
    /** Score the nearest edge of the shaft; the supplied centre remains unchanged for geometry metrics. */
    fun scoreShaft(point: TargetPoint, shaftDiameterMm: Double, targetDiameterMm: Int): TargetZone {
        require(ArrowShaft.validDiameter(shaftDiameterMm))
        require(acceptsDiameter(targetDiameterMm))
        val nearestEdge = (hypot(point.x, point.y) - shaftDiameterMm / targetDiameterMm).coerceAtLeast(0.0)
        return zones.firstOrNull { nearestEdge <= it.outerRadius + 1e-9 }
            ?: TargetZone("M", 0, Double.POSITIVE_INFINITY)
    }
    val shaftRuleVersion: String get() = "$rule:shaft-v1"
    fun snapshot(mm:Int):String {
        require(acceptsDiameter(mm))
        val rows=zones.joinToString(","){"{\"code\":\"${it.code}\",\"points\":${it.points},\"outerRadius\":${it.outerRadius},\"isX\":${it.code=="X"}}"}
        return "{\"snapshotVersion\":1,\"profileId\":\"$id\",\"profileVersion\":1,\"geometryType\":\"circle\",\"scoringRuleVersion\":\"$rule\",\"boundaryRule\":\"greater-score\",\"boundaryEpsilon\":1e-9,\"diameterMm\":$mm,\"supportsX\":$supportsX,\"faces\":[{\"faceId\":\"main\",\"zones\":[$rows]}]}"
    }
}

/** Coordinates use the radius of the full nominal face, also for a reduced face. */
object TargetCatalog {
    const val SOURCE="WA Book 2, 2026-01-27, 7.2.2.1–7.2.2.3"
    private fun rings(low:Int=1,compound:Boolean=false)=(10 downTo low).map{TargetZone(it.toString(),it,if(it==10&&compound).05 else (11-it)/10.0)}
    val practice=TargetProfile("practice-full-10-v1","Учебная · свой диаметр",emptyList(),rings(),"practice-point-10-v1")
    val outdoor=TargetProfile("wa-outdoor-full-v1","Полная · 1–10 и X",listOf(800,1220),listOf(TargetZone("X",10,.05))+rings(),"wa-outdoor-point-v1",SOURCE)
    val indoor=TargetProfile("wa-indoor-outer-v1","Indoor · обычная десятка",listOf(400,600),rings(),"wa-indoor-outer-point-v1",SOURCE)
    val compound=TargetProfile("wa-indoor-inner-v1","Indoor · малая десятка",listOf(400,600),rings(compound=true),"wa-indoor-inner-point-v1",SOURCE)
    val reduced=TargetProfile("wa-outdoor-six-v1","80 см · зоны 5–10 и X",listOf(800),listOf(TargetZone("X",10,.05))+rings(5),"wa-outdoor-six-point-v1",SOURCE)
    val indoorFive=TargetProfile("wa-indoor-five-outer-v1","Indoor · зоны 6–10",listOf(400,600),rings(6),"wa-indoor-five-outer-point-v1",SOURCE)
    val indoorFiveCompound=TargetProfile("wa-indoor-five-inner-v1","Indoor · зоны 6–10, малая десятка",listOf(400,600),rings(6,true),"wa-indoor-five-inner-point-v1",SOURCE)
    val all=listOf(practice,outdoor,indoor,compound,reduced,indoorFive,indoorFiveCompound)
    fun find(id:String?)=all.firstOrNull{it.id==id}
}

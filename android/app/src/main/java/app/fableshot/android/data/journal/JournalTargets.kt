package app.fableshot.android.data.journal

import app.fableshot.android.domain.*
import org.json.JSONObject

/** A matching name alone does not verify imported or restored geometry. */
fun JournalBlock.verifiedTarget():TargetProfile? = verifiedTarget(targetProfileId,targetProfileVersion,targetDiameterMm,targetSnapshotJson)
fun verifiedTarget(targetProfileId:String?,targetProfileVersion:Int?,targetDiameterMm:Int?,targetSnapshotJson:String?):TargetProfile? {
    val p=TargetCatalog.find(targetProfileId)?:return null
    if(targetProfileVersion!=1||targetDiameterMm?.let(p::acceptsDiameter)!=true)return null
    return runCatching {
        val s=JSONObject(targetSnapshotJson!!)
        require(s.getString("profileId")==p.id&&s.getInt("profileVersion")==1&&s.getString("geometryType")=="circle"&&s.getString("scoringRuleVersion")==p.rule)
        require(s.getInt("diameterMm")==targetDiameterMm&&s.getString("boundaryRule")=="greater-score"&&s.getDouble("boundaryEpsilon")==1e-9&&s.optBoolean("supportsX",false)==p.supportsX)
        val faces=s.getJSONArray("faces");require(faces.length()==1)
        val face=faces.getJSONObject(0);require(face.getString("faceId")=="main")
        val zones=face.getJSONArray("zones");require(zones.length()==p.zones.size)
        for(i in p.zones.indices){val z=zones.getJSONObject(i);val expected=p.zones[i];require(z.getString("code")==expected.code&&z.getInt("points")==expected.points&&z.getDouble("outerRadius")==expected.outerRadius&&z.getBoolean("isX")== (expected.code=="X"))}
        p
    }.getOrNull()
}

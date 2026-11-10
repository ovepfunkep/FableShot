package app.fableshot.android.data

import app.fableshot.android.data.journal.BlockPlan
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class TrainingPreset(val id:String=UUID.randomUUID().toString(),val name:String,val plan:BlockPlan,val revision:Long=0)
class TrainingPresetConflict:IllegalStateException("Training preset changed")
class TrainingPresetNameTaken:IllegalArgumentException("Training preset name already exists")

/** Named UI conditions, not completed training facts or a sequence of different conditions. */
object TrainingPresets {
    const val KEY="training_presets_v1"
    const val LIMIT=64
    fun decode(raw:String?):List<TrainingPreset> {
        if(raw==null)return emptyList()
        require(raw.toByteArray(Charsets.UTF_8).size<=512*1024)
        val root=JSONObject(raw)
        require(root.keys().asSequence().toSet()==setOf("version","presets") && root.opt("version")==1)
        val rows=root.getJSONArray("presets");require(rows.length()<=LIMIT)
        val result=(0 until rows.length()).map { index ->
            val row=rows.getJSONObject(index)
            require(row.keys().asSequence().toSet()==setOf("id","name","plan","revision"))
            val id=row.opt("id") as? String ?: error("Invalid preset ID")
            val name=row.opt("name") as? String ?: error("Invalid preset name")
            val revision=row.opt("revision") as? Number ?: error("Invalid preset revision")
            require((revision is Int || revision is Long) && revision.toLong()>0)
            val encoded=row.opt("plan") as? String ?: error("Invalid preset plan")
            val source=JSONObject(encoded)
            require(source.opt("version")==1)
            for(key in listOf("arrows","rounds")) {
                val value=source.opt(key)
                require(value is Int || value is Long)
                require((value as Number).toLong() in 1..(if(key=="arrows")12L else 20L))
            }
            require(source.isNull("ends") || source.opt("ends") is Int || source.opt("ends") is Long)
            if(!source.isNull("ends"))require((source.opt("ends") as Number).toLong() in 1..200L)
            if(source.has("flexibleSeries")) require(source.opt("flexibleSeries") is Boolean)
            require(source.isNull("numberedArrows") || source.opt("numberedArrows") is Boolean)
            if (!source.isNull("roundArrowLimit")) {
                val arrows = source.opt("roundArrowLimit")
                require((arrows is Int || arrows is Long) && (arrows as Number).toLong() in 1..1_000_000L)
            }
            if(!source.isNull("seriesPerRound")) {
                val series=source.opt("seriesPerRound")
                require((series is Int || series is Long) && (series as Number).toLong() in 1..200L)
            }
            if(!source.isNull("diameter")) {
                val diameter=source.opt("diameter")
                require((diameter is Int || diameter is Long) && (diameter as Number).toLong() in 1..Int.MAX_VALUE.toLong())
            }
            if(!source.isNull("distance"))require(source.opt("distance") is Number)
            val plan=requireNotNull(HabitualTraining.decode(encoded))
            validate(TrainingPreset(id,name,plan,revision.toLong()))
        }
        require(result.map {it.id}.distinct().size==result.size)
        require(result.map {it.name.lowercase(java.util.Locale.ROOT)}.distinct().size==result.size)
        return result
    }
    fun validate(value:TrainingPreset):TrainingPreset {
        require(runCatching {UUID.fromString(value.id).toString()==value.id}.getOrDefault(false))
        require(value.name.length in 1..60 && value.name==value.name.trim() && value.name.none {it.code<32})
        require(value.plan.valid() && value.plan.techniqueSelection==null && (value.plan.equipmentSnapshotJson==null || isSetupSnapshot(value.plan.equipmentSnapshotJson)))
        return value
    }
    fun encode(values:List<TrainingPreset>):String {
        require(values.size<=LIMIT)
        val json=JSONObject().put("version",1).put("presets",JSONArray().apply {
            values.forEach {value ->
                validate(value);require(value.revision>0)
                put(JSONObject().put("id",value.id).put("name",value.name).put("revision",value.revision)
                    .put("plan",HabitualTraining.encode(value.plan)))
            }
        }).toString()
        decode(json)
        return json
    }
    fun save(existing:List<TrainingPreset>,value:TrainingPreset):List<TrainingPreset> {
        val clean=validate(value.copy(name=value.name.trim(),plan=value.plan.copy(techniqueSelection=null)))
        val old=existing.firstOrNull {it.id==clean.id}
        if(existing.any {it.id!=clean.id && it.name.equals(clean.name,ignoreCase=true)}) throw TrainingPresetNameTaken()
        if(old!=null && old.name==clean.name && old.plan==clean.plan) return existing
        if((old==null && clean.revision!=0L) || (old!=null && old.revision!=clean.revision))throw TrainingPresetConflict()
        require(old!=null || existing.size<LIMIT)
        return (existing.filterNot {it.id==clean.id}+clean.copy(revision=(old?.revision ?: 0)+1))
            .sortedBy {it.name.lowercase(java.util.Locale.ROOT)}
    }
}

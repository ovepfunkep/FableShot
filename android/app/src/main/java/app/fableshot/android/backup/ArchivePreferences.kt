package app.fableshot.android.backup

import app.fableshot.android.data.MAX_SHOOTING_BASE_MINUTES
import app.fableshot.android.data.SHOOTING_BASE_MINUTES_KEY

internal object ArchivePreferences {
    fun encode(snapshot:Map<String,Pair<String,Any>>):ByteArray=ArchiveJson.encode(mapOf("format" to 1,"values" to snapshot.toSortedMap().mapValues{(_,pair)->mapOf("type" to pair.first,"value" to pair.second)})).toByteArray(Charsets.UTF_8).also{decode(it)}
    fun decode(bytes:ByteArray):Map<String,Pair<String,Any>> {
        if(bytes.size>1024*1024)throw ArchiveInvalid("preferences_too_large")
        val root=ArchiveJson.parse(ArchiveManifestCodec.utf8(bytes)).jsonObject();root.exactKeys(setOf("format","values"))
        if(root.long("format")!=1L)throw ArchiveInvalid("unsupported_preferences_version")
        val result=root["values"].jsonObject().mapValues { (key,raw)->
            if(key.length !in 1..200||key.any{it.code<32})throw ArchiveInvalid("invalid_preference_key")
            val entry=raw.jsonObject();entry.exactKeys(setOf("type","value"));val type=entry.string("type");val value=entry["value"]
            val valid=when(type) {
                "string"->value is String
                "boolean"->value is Boolean
                "int"->value is Long&&value in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()
                "long"->value is Long
                "float"->value is Number&&value.toDouble().isFinite()&&value.toFloat().isFinite()
                "double"->value is Number&&value.toDouble().isFinite()
                "stringSet"->value is List<*>&&value.all{it is String}&&value.distinct().size==value.size
                "bytes"->value is String&&Regex("(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?").matches(value)
                else->false
            }
            if(!valid)throw ArchiveInvalid("invalid_preference_value")
            type to requireNotNull(value)
        }
        val types=mapOf("technique_home" to "boolean","technique_focus" to "boolean","technique_reflection" to "boolean","designStyle" to "string","appearanceMode" to "string","animationsEnabled" to "boolean","hapticsEnabled" to "boolean","soundEnabled" to "boolean","keepScreenAwake" to "boolean","displayName" to "string","onboardingCompletedVersion" to "int","onboardingDisposition" to "string","targetTutorialVersion" to "int")
        result.forEach{(key,pair)->if(types[key]!=null&&types[key]!=pair.first)throw ArchiveInvalid("invalid_known_preference_type")}
        fun allowed(key:String,values:Set<String>){result[key]?.let{if(it.second !in values)throw ArchiveInvalid("invalid_known_preference_value")}}
        result["rank_category_v1"]?.let {
            if (it.first != "string" || it.second !in setOf("male", "female")) throw ArchiveInvalid("invalid_rank_category")
        }
        result[app.fableshot.android.data.TrainingPresets.KEY]?.let {
            if(it.first!="string")throw ArchiveInvalid("invalid_training_presets")
            try {app.fableshot.android.data.TrainingPresets.decode(it.second as String)}
            catch(_:Exception) {throw ArchiveInvalid("invalid_training_presets")}
        }
        allowed("designStyle",setOf("sport","pop","minimal"));allowed("appearanceMode",setOf("system","light","dark"));allowed("onboardingDisposition",setOf("completed","skipped","existing_user"))
        for (key in listOf("series_timer_seconds_v1", "rest_timer_seconds_v1")) {
            result[key]?.let {
                if (it.first != "int" || (it.second as? Long) !in 1L..3600L) throw ArchiveInvalid("invalid_timer_duration")
            }
        }
        result["hide_current_scores_v1"]?.let {
            if (it.first != "boolean") throw ArchiveInvalid("invalid_score_visibility")
        }
        result["show_achievements_v1"]?.let {
            if (it.first != "boolean") throw ArchiveInvalid("invalid_achievements_visibility")
        }
        result[SHOOTING_BASE_MINUTES_KEY]?.let {
            if (it.first != "long" || (it.second as? Long) !in 0L..MAX_SHOOTING_BASE_MINUTES)
                throw ArchiveInvalid("invalid_shooting_base_minutes")
        }
        for(key in listOf("onboardingCompletedVersion","targetTutorialVersion"))result[key]?.let{if((it.second as Long)<0)throw ArchiveInvalid("invalid_known_preference_value")}
        return result
    }
}

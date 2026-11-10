package app.fableshot.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.BlockPlan
import app.fableshot.android.backup.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TrainingPresetsTest {
    @Test fun arrowRoundPlansRoundTripAndLegacyPlansKeepTheirSeriesLimit() {
        val old=BlockPlan(18.0,400,flexibleSeries=true,seriesPerRound=10)
        val legacy=JSONObject(HabitualTraining.encode(old)).apply { remove("roundArrowLimit") }.toString()
        assertEquals(old,HabitualTraining.decode(legacy))
        val arrows=old.copy(seriesPerRound=null,roundArrowLimit=60)
        assertEquals(arrows,HabitualTraining.decode(HabitualTraining.encode(arrows)))
        val saved=TrainingPresets.save(emptyList(),TrainingPreset(name="60 arrows",plan=arrows))
        assertEquals(saved,TrainingPresets.decode(TrainingPresets.encode(saved)))
        for(invalid in listOf(-1L,0L,1_000_001L,4_294_967_356L)) {
            assertNull(HabitualTraining.decode(JSONObject(HabitualTraining.encode(arrows)).put("roundArrowLimit",invalid).toString()))
        }
    }

    @Test fun nullableNumberingPreferenceRoundTripsAndLegacyPlansKeepAnUnspecifiedChoice() {
        val bow=EquipmentItem(kind="bow",name="Bow",category="barebow")
        val arrows=EquipmentItem(kind="arrows",name="Arrows",numberedCount=12)
        val kit=EquipmentItem(kind="setup",name="Kit",bowId=bow.id,arrowsId=arrows.id)
        val base=BlockPlan(18.0,400,equipmentSnapshotJson=equipmentSnapshot(kit,listOf(bow,arrows,kit)))
        for(choice in listOf<Boolean?>(null,false,true)) {
            val plan=base.copy(numberedArrows=choice)
            assertEquals(plan,HabitualTraining.decode(HabitualTraining.encode(plan)))
            val saved=TrainingPresets.save(emptyList(),TrainingPreset(name="Numbered fixture",plan=plan))
            assertEquals(saved,TrainingPresets.decode(TrainingPresets.encode(saved)))
        }
        val legacy=JSONObject(HabitualTraining.encode(base)).apply {remove("numberedArrows")}.toString()
        assertNull(HabitualTraining.decode(legacy)!!.numberedArrows)
        val explicitNull=JSONObject(legacy).put("numberedArrows",JSONObject.NULL).toString()
        assertNull(HabitualTraining.decode(explicitNull)!!.numberedArrows)
        val saved=TrainingPresets.save(emptyList(),TrainingPreset(name="Old plan",plan=base))
        val root=JSONObject(TrainingPresets.encode(saved))
        val row=root.getJSONArray("presets").getJSONObject(0)
        row.put("plan",legacy)
        assertNull(TrainingPresets.decode(root.toString()).single().plan.numberedArrows)
        for(invalid in listOf(0,1,"true")) {
            val malformed=JSONObject(legacy).put("numberedArrows",invalid).toString()
            assertNull(HabitualTraining.decode(malformed))
            row.put("plan",malformed)
            try {TrainingPresets.decode(root.toString());fail("Numbering choice coerced from $invalid")}catch(_:IllegalArgumentException){}
            try {ArchivePreferences.encode(mapOf(TrainingPresets.KEY to ("string" to root.toString())));fail("Invalid numbering choice reached archive")}catch(_:ArchiveInvalid){}
        }
    }

    @Test fun namedConditionsRoundTripWithFreeAndPlannedVolumesAndBothModes() {
        val bow=EquipmentItem(kind="bow",name="Bow",category="barebow")
        val kit=EquipmentItem(kind="setup",name="Kit",bowId=bow.id)
        val planned=TrainingPreset(name="Club 18",plan=BlockPlan(18.0,400,6,equipmentSnapshotJson=equipmentSnapshot(kit,listOf(bow,kit)),
            plannedEnds=20,roundCount=2,targetProfileId="wa-indoor-outer-v1"))
        val free=TrainingPreset(name="Free",plan=BlockPlan(30.0,800,3,targetProfileId="wa-outdoor-full-v1"))
        val count=TrainingPreset(name="Volume",plan=BlockPlan(null,null,6,"count_only"))
        var saved=emptyList<TrainingPreset>()
        for(row in listOf(planned,free,count)) saved=TrainingPresets.save(saved,row)
        assertEquals(saved,TrainingPresets.decode(TrainingPresets.encode(saved)))
        assertEquals(saved,TrainingPresets.save(saved,planned))
        val json=TrainingPresets.encode(saved)
        val prefs=ArchivePreferences.decode(ArchivePreferences.encode(mapOf(TrainingPresets.KEY to ("string" to json))))
        assertEquals(saved,TrainingPresets.decode(prefs.getValue(TrainingPresets.KEY).second as String))
    }

    @Test fun staleEditDuplicateNameMalformedAndFractionalPlansAreRejected() {
        val preset=TrainingPreset(name="Club",plan=BlockPlan(18.0,400))
        val first=TrainingPresets.save(emptyList(),preset)
        val renamed=TrainingPresets.save(first,first.single().copy(name="Changed"))
        try {TrainingPresets.save(renamed,first.single().copy(name="Stale"));fail()}catch(_:TrainingPresetConflict){}
        try {TrainingPresets.save(first,TrainingPreset(name="club",plan=preset.plan));fail()}catch(_:TrainingPresetNameTaken){}
        val root=JSONObject(TrainingPresets.encode(first))
        val row=root.getJSONArray("presets").getJSONObject(0)
        val plan=JSONObject(row.getString("plan")).put("arrows",3.5)
        row.put("plan",plan.toString())
        try {TrainingPresets.decode(root.toString());fail("Fractional arrows truncated")}catch(_:IllegalArgumentException){}
        try {ArchivePreferences.encode(mapOf(TrainingPresets.KEY to ("string" to root.toString())));fail("Bad preset reached archive")}catch(_:ArchiveInvalid){}
        try {TrainingPresets.decode("broken");fail()}catch(_:Exception){}
        assertEquals(1,first.single().revision)
    }
}

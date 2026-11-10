package app.fableshot.android

import app.fableshot.android.data.journal.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Only explicit archived identities may distinguish imported rounds from condition changes. */
class ImportedRoundPresentationTest {
    private fun details(explicit: Boolean, source: String = "mytargets"): JournalDetails {
        val blocks = (0..1).map { round ->
            val snapshot = JSONObject().apply {
                put("geometryType", "unverified")
                if (explicit) {
                    put("sourceFormat", "mytargets-zip-v27")
                    put("sourceRoundKey", "training:round$round")
                }
            }.toString()
            val block = JournalBlock("block$round", "training", round, "scored", 18.0,
                "mytargets-source-10", 1, 400, snapshot, null, 3)
            val ends = (0..1).map { series ->
                val id = "end$round-$series"
                val end = JournalEnd(id, block.id, series, 3, state = "closed")
                val shot = JournalShot("shot$round-$series", id, 0, 9, "9", null, null,
                    null, null, null, "imported", "unknown", "unknown", null, 1)
                JournalEndDetails(end, listOf(shot), emptyList())
            }
            JournalBlockDetails(block, ends)
        }
        return JournalDetails(JournalSession("training", "Fixture", 1, null, state = "completed", sourceKind = source), blocks)
    }

    @Test fun explicitZipRoundIdentitiesReachReportsAndPosterLocations() {
        val journal = details(true)
        val second = journal.roundProgress("end1-0")
        assertEquals(2, second.number)
        assertEquals(2, second.count)
        assertEquals(1, second.seriesNumber)
        assertEquals(listOf("end1-0", "end1-1"), second.ends.map { it.end.id })
        assertNull(second.seriesLimit) // Recorded ends do not prove a planned fixed volume.
        assertNull(second.maximum)
        assertEquals(2 to 2, journal.roundLocations()["end1-1"])
        assertEquals(1 to 2, journal.roundLocations()["end0-1"])
    }

    @Test fun legacyCsvConditionBlocksDoNotBecomeInventedRounds() {
        val journal = details(false)
        assertEquals(1, journal.roundProgress("end1-0").number)
        assertEquals(3, journal.roundProgress("end1-0").seriesNumber)
        assertEquals(1 to 4, journal.roundLocations()["end1-1"])
    }

    @Test fun nativePlanRemainsAuthoritativeEvenIfSourceMetadataIsPresent() {
        val journal = details(true, "native").copy(plans = listOf(SessionPlan("training", 4, 2)))
        assertEquals(2, journal.roundProgress("end1-0").number)
        assertEquals(2, journal.roundProgress("end0-1").seriesNumber)
        assertNull(journal.roundProgress("end1-0").maximum)
        assertEquals(6, journal.roundProgress("end1-0").plannedArrowCount)
        assertEquals(2 to 1, journal.roundLocations()["end1-0"])
    }
}

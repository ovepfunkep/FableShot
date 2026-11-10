package app.fableshot.android.domain

import org.junit.Assert.*
import org.junit.Test

class SportRankReferenceTest {
    @Test fun sixClassLabelsDoNotGuessAnUnknownCategory() {
        for ((bow, code) in listOf("recurve" to "КЛ", "compound" to "БЛ", "barebow" to "КЛб")) {
            assertEquals("$code(М)", rankClassLabel(bow, "male"))
            assertEquals("$code(Ж)", rankClassLabel(bow, "female"))
        }
        assertNull(rankClassLabel("barebow", null))
        assertNull(rankClassLabel("traditional", "male"))
    }

    @Test fun fullReferencePreservesEveryAutoMatchedScoreAndMissingCells() {
        assertEquals(33, SportRankReference.rows.size)
        assertEquals(33, SportRankReference.rows.map { it.sourceRow }.distinct().size)
        for (exercise in SportRankCatalog.exercises) {
            val row = SportRankReference.rows.single { it.sourceRow == exercise.sourceRow }
            val scores = if (exercise.category == "male") row.male else row.female
            assertEquals(exercise.thresholds.associate { it.label to it.score },
                SportRankReference.labels.zip(scores).filter { it.second != null }.associate { it.first to it.second })
        }
        val twelve = SportRankReference.rows.single { it.sourceRow == 9 }
        assertNull(twelve.male.first())
        assertEquals(220, twelve.male[6])
        val ageLimited = SportRankReference.rows.single { it.sourceRow == 16 }
        assertTrue(ageLimited.condition.contains("14-17"))
        assertTrue(ageLimited.male.all { it == null })
        assertEquals(1230, ageLimited.female[2])
        val threeD = SportRankReference.rows.single { it.sourceRow == 44 }
        assertEquals("3d", threeD.group)
        assertEquals(980, threeD.male[0])
        assertEquals(920, threeD.female[0])
    }
}

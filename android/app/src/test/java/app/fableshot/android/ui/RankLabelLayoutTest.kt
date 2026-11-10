package app.fableshot.android.ui

import app.fableshot.android.domain.SportRankCatalog
import org.junit.Assert.*
import org.junit.Test

class RankLabelLayoutTest {
    @Test fun denseAndLargeLabelsStayInsideWithoutOverlappingOrMovingTicks() {
        for (exercise in SportRankCatalog.exercises) for (width in listOf(180, 320, 600)) for (scale in listOf(1f, 1.5f, 2f)) {
            val anchors=exercise.thresholds.map { it.score.toFloat() / (exercise.arrows * 10) * width }
            val labels=exercise.thresholds.map { (it.label.length * 8 * scale + 8).toInt() }
            val placed=rankLabelPlacements(anchors, labels, width, 6)
            placed.forEachIndexed { index, label ->
                assertEquals(anchors[index],label.anchor,0f)
                assertTrue(label.left>=0 && label.left+label.width<=width)
            }
            placed.groupBy { it.lane }.values.forEach { lane ->
                lane.zipWithNext().forEach { (a,b) -> assertTrue(a.left+a.width+6<=b.left) }
            }
        }
    }

    @Test fun edgeLabelsAreClampedButRetainTheirTrueAnchor() {
        val placed=rankLabelPlacements(listOf(0f,100f),listOf(30,40),100,6)
        assertEquals(0,placed[0].left)
        assertEquals(60,placed[1].left)
        assertEquals(100f,placed[1].anchor,0f)
        assertTrue(rankLabelPlacements(emptyList(),emptyList(),0,6).isEmpty())
    }
}

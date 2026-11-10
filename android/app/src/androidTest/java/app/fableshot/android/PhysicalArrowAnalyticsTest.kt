package app.fableshot.android

import app.fableshot.android.data.EquipmentItem
import app.fableshot.android.data.equipmentSnapshot
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetCatalog
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.ui.physicalArrowMapExtent
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.sqrt

internal fun physicalArrowFixture(
    sessionId: String = "physical-session",
    setId: String = "set-a",
    distance: Double = 18.0,
): JournalDetails {
    val target = TargetCatalog.indoor
    val bow = EquipmentItem(id = "physical-bow", kind = "bow", name = "Fixture bow", category = "barebow")
    val arrows = EquipmentItem(id = setId, kind = "arrows", name = "Стрелы $setId", numberedCount = 6)
    val setup = EquipmentItem(id = "setup-$setId", kind = "setup", name = "Fixture setup", bowId = bow.id, arrowsId = arrows.id)
    val block = JournalBlock("$sessionId-block", sessionId, 0, "scored", distance, target.id, 1, 400,
        target.snapshot(400), equipmentSnapshot(setup, listOf(bow, arrows, setup)), 4)
    val end = JournalEnd("$sessionId-end", block.id, 0, 4, state = "closed")
    val positions = listOf(TargetPoint(.1, 0.0), TargetPoint(.2, 0.0), TargetPoint(.3, 0.0), null)
    val shots = listOf(10, 9, 8, 0).mapIndexed { index, points ->
        val position = positions[index]
        JournalShot("$sessionId-shot-$index", end.id, index, points, if (points == 0) "M" else points.toString(),
            null, null, position?.x, position?.y, if (position != null) "main" else null, "numeric_entry",
            if (position != null) "manual_target" else "none", if (position != null) "known" else "unknown", 1, 100)
    }
    return JournalDetails(JournalSession(sessionId, "Fixture", 100, 100, state = "completed"),
        listOf(JournalBlockDetails(block, listOf(JournalEndDetails(end, shots, emptyList())))))
}

internal fun physicalArrowComparisonFixture(): JournalDetails {
    val source = physicalArrowFixture("comparison")
    val block = source.blocks.single()
    val template = block.ends.single()
    val ends = (0..2).map { series ->
        val id = "comparison-end-$series"
        val end = template.end.copy(id = id, ordinal = series, plannedCount = 6)
        val shots = (1..6).map { number ->
            val x = (if (number == 6) 1.6 else number * .01) + (series - 1) * .01
            template.shots.first().copy(id = "$id-shot-$number", endId = id, inputIndex = number - 1,
                points = if (number == 6) 0 else 9, zoneCode = if (number == 6) "M" else "9",
                x = x, y = if (number == 6) -.3 else .02, physicalArrowNumber = number)
        }
        JournalEndDetails(end, shots, emptyList())
    }
    return source.copy(blocks = listOf(block.copy(block = block.block.copy(defaultArrowsPerEnd = 6), ends = ends)))
}

class PhysicalArrowAnalyticsTest {
    @Test fun physicalNumberScoreAndGeometryCoverageUseAllExplicitShots() {
        val source = physicalArrowFixture()
        val result = physicalArrowAnalysis(listOf(source)).single()
        assertEquals("set-a", result.arrowsSetId)
        val arrow = result.arrows.single()
        assertEquals(1, arrow.number)
        assertEquals(4, arrow.shotCount)
        assertEquals(6.75, arrow.meanScore, 0.0)
        assertEquals(3, arrow.knownPositionCount)
        assertEquals(sqrt(2.0 / 300) * 200, arrow.rmsMm!!, 1e-9)
        assertEquals(40.0, arrow.centerOffsetMm!!, 1e-9)
        assertEquals(.2, arrow.centroidX!!, 1e-9)
        assertEquals(0.0, arrow.centroidY!!, 0.0)
        assertEquals(3, arrow.positions.size)
        assertEquals(TargetCatalog.indoor.id, result.targetProfileId)
        assertEquals(400, result.targetDiameterMm)
        assertEquals(4, source.allShots.size)
        assertEquals(4, physicalArrowAnalysis(listOf(source, source)).single().arrows.single().shotCount)
    }

    @Test fun sameNumbersFromDifferentSetsDistancesOrEquipmentSnapshotsNeverMerge() {
        val first = physicalArrowFixture()
        val otherSet = physicalArrowFixture("other-set", "set-b")
        val otherDistance = physicalArrowFixture("other-distance", distance = 30.0)
        val repeated = physicalArrowFixture("same-conditions")
        val groups = physicalArrowAnalysis(listOf(first, otherSet, otherDistance, repeated))
        assertEquals(3, groups.size)
        assertEquals(3, groups.map { it.conditionKey }.distinct().size)
        assertEquals(listOf(4, 8), groups.filter { it.arrowsSetId == "set-a" }.map { it.arrows.single().shotCount }.sorted())
        val block = repeated.blocks.single()
        val changedEquipment = repeated.copy(blocks = listOf(block.copy(block = block.block.copy(
            equipmentSnapshotJson = block.block.equipmentSnapshotJson!!.replace("Fixture bow", "Revised bow")))))
        assertEquals(2, physicalArrowAnalysis(listOf(first, changedEquipment)).size)
    }

    @Test fun incompleteGeometryKeepsScoresWithoutCreatingAnRms() {
        val first = physicalArrowFixture()
        val block = first.blocks.single()
        val end = block.ends.single()
        val unverified = end.copy(shots = end.shots.map { it.copy(positionStatus = "unverified") })
        val result = physicalArrowAnalysis(listOf(first.copy(blocks = listOf(block.copy(ends = listOf(unverified))))))
            .single().arrows.single()
        assertEquals(4, result.shotCount)
        assertEquals(6.75, result.meanScore, 0.0)
        assertEquals(0, result.knownPositionCount)
        assertNull(result.rmsMm)
        assertNull(result.centerOffsetMm)
        assertNull(result.centroidX)
        assertTrue(result.positions.isEmpty())
        val twoKnown = end.copy(shots = end.shots.take(2))
        val sparse = physicalArrowAnalysis(listOf(first.copy(blocks = listOf(block.copy(ends = listOf(twoKnown))))))
            .single().arrows.single()
        assertEquals(2, sparse.knownPositionCount)
        assertNull(sparse.rmsMm)
        assertNull(sparse.centroidX)
        assertEquals(2, sparse.positions.size)
        val unknownTarget = first.copy(blocks = listOf(block.copy(block = block.block.copy(targetSnapshotJson = "{}"))))
        val unknown = physicalArrowAnalysis(listOf(unknownTarget)).single().arrows.single()
        assertEquals(4, unknown.shotCount)
        assertEquals(0, unknown.knownPositionCount)
        assertNull(unknown.rmsMm)
        val second = physicalArrowFixture("unknown-second").let { detail ->
            detail.copy(blocks = detail.blocks.map { it.copy(block = it.block.copy(targetSnapshotJson = "{}")) })
        }
        assertEquals(2, physicalArrowAnalysis(listOf(unknownTarget, second)).size)
    }

    @Test fun everyPhysicalNumberHasItsOwnScoreAndRealFarMissIsNotClipped() {
        val source = physicalArrowFixture()
        val block = source.blocks.single()
        val end = block.ends.single()
        val numbered = end.copy(shots = end.shots.mapIndexed { index, shot ->
            shot.copy(physicalArrowNumber = index % 2 + 1)
        })
        val arrows = physicalArrowAnalysis(listOf(source.copy(blocks = listOf(block.copy(ends = listOf(numbered))))))
            .single().arrows
        assertEquals(listOf(1, 2), arrows.map { it.number })
        assertEquals(listOf(9.0, 4.5), arrows.map { it.meanScore })
        assertTrue(arrows.all { it.rmsMm == null && it.shotCount == 2 })
        val far = end.copy(shots = end.shots.map { shot ->
            if (shot.points == 0) shot.copy(x = 10.0, y = 0.0, faceId = "main", positionStatus = "known", positionSource = "manual_target")
            else shot
        })
        val measured = physicalArrowAnalysis(listOf(source.copy(blocks = listOf(block.copy(ends = listOf(far))))))
            .single().arrows.single()
        assertEquals(4, measured.knownPositionCount)
        assertTrue(measured.rmsMm!! > 800.0)
        assertTrue(measured.positions.any { it.x == 10.0 })
    }

    @Test fun comparisonRetainsSixIndependentCentersAndFitsRealOutliersAndRmsCircles() {
        val group = physicalArrowAnalysis(listOf(physicalArrowComparisonFixture())).single()
        assertEquals(6, group.arrows.size)
        assertTrue(group.arrows.all { it.knownPositionCount == 3 && it.positions.size == 3 })
        assertTrue(group.arrows.take(5).all { it.centroidX!! < .06 && it.meanScore == 9.0 })
        val sixth = group.arrows.last()
        assertEquals(1.6, sixth.centroidX!!, 1e-9)
        assertEquals(-.3, sixth.centroidY!!, 1e-9)
        assertEquals(0.0, sixth.meanScore, 0.0)
        val extent = physicalArrowMapExtent(group)
        assertEquals(1.61, extent, 1e-9)
        for (arrow in group.arrows) {
            assertTrue(arrow.positions.all { kotlin.math.abs(it.x) <= extent && kotlin.math.abs(it.y) <= extent })
            assertTrue(kotlin.math.abs(arrow.centroidX!!) + arrow.rmsMm!! / 200 <= extent + 1e-9)
        }
        assertEquals(1.0, physicalArrowMapExtent(group.copy(targetDiameterMm = null)), 0.0)
    }

    @Test fun missingNumbersMissingSetWarmupAndTrashDoNotInventArrowIdentity() {
        val source = physicalArrowFixture()
        val block = source.blocks.single()
        val end = block.ends.single()
        val noNumbers = end.copy(shots = end.shots.map { it.copy(physicalArrowNumber = null) })
        assertTrue(physicalArrowAnalysis(listOf(source.copy(blocks = listOf(block.copy(ends = listOf(noNumbers)))))).isEmpty())
        val unknownSet = source.copy(blocks = listOf(block.copy(block = block.block.copy(equipmentSnapshotJson = """{"arrows":{"name":"Labels only"}}"""))))
        assertTrue(physicalArrowAnalysis(listOf(unknownSet)).isEmpty())
        val wrongKind = source.copy(blocks = listOf(block.copy(block = block.block.copy(
            equipmentSnapshotJson = """{"arrows":{"id":"set-a","kind":"bow","name":"Wrong kind"}}"""))))
        assertTrue(physicalArrowAnalysis(listOf(wrongKind)).isEmpty())
        val warmup = source.copy(blocks = listOf(block.copy(ends = listOf(end.copy(end = end.end.copy(role = "warmup"))))))
        assertTrue(physicalArrowAnalysis(listOf(warmup)).isEmpty())
        assertTrue(physicalArrowAnalysis(listOf(source.copy(session = source.session.copy(deletedAtMs = 1000)))).isEmpty())
        val invalid = end.copy(shots = end.shots.map { it.copy(x = Double.NaN) })
        val analyzed = physicalArrowAnalysis(listOf(source.copy(blocks = listOf(block.copy(ends = listOf(invalid)))))).single().arrows.single()
        assertEquals(0, analyzed.knownPositionCount)
    }
}

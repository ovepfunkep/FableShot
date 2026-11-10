package app.fableshot.android.domain

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class AchievementGalleryTest {
    private fun status(id: String, priority: Int, rarity: AchievementRarity, value: Long = 0,
        earned: Boolean = false, family: String = "volume", scope: String = "barebow"): AchievementStatus {
        val definition = AchievementDefinition(id, id, "Реплика", "Условие", family, rarity, 100,
            categorySpecific = true, priority = priority)
        val award = if (earned) EarnedAchievement("$id:$scope", id, scope, id, "Реплика", "Условие", family,
            rarity, priority, "session", "end", "2026-11-03", Instant.parse("2026-11-04T07:30:00Z").toEpochMilli(),
            "batch", 1, true) else null
        return AchievementStatus(definition, scope, value, award)
    }

    @Test fun nextTierUsesPriorityWhileFartherProgressStaysLocked() {
        val first = status("FIRST", 1, AchievementRarity.Common, 100, earned = true)
        val next = status("NEXT", 2, AchievementRarity.Rare, 30)
        val far = status("FAR", 3, AchievementRarity.Mythic, 30)
        val family = achievementGalleryFamilies(listOf(far, first, next)).single()
        assertEquals(first.key, family.main.key)
        assertEquals(next.key, family.next?.key)
        assertEquals(AchievementGalleryState.Earned, family.stateOf(first))
        assertEquals(AchievementGalleryState.InProgress, family.stateOf(next))
        assertEquals(AchievementGalleryState.Locked, family.stateOf(far))
        assertEquals(listOf(first.key, next.key, far.key), family.details.map { it.key })
    }

    @Test fun noProgressStillHighlightsNearestStepAndUsesRarityWithinEachState() {
        val next = status("NEXT", 1, AchievementRarity.Common)
        val rare = status("RARE", 2, AchievementRarity.Rare)
        val mythic = status("MYTHIC", 3, AchievementRarity.Mythic)
        val family = achievementGalleryFamilies(listOf(rare, mythic, next)).single()
        assertEquals(next.key, family.main.key)
        assertEquals(AchievementGalleryState.Next, family.stateOf(next))
        assertEquals(listOf(mythic.key, rare.key), family.locked.map { it.key })
    }

    @Test fun familiesAndEarnedStepsAreRarityFirstAndBowsNeverMerge() {
        val common = status("COMMON", 1, AchievementRarity.Common, earned = true)
        val epic = status("EPIC", 2, AchievementRarity.Epic, earned = true)
        val mythic = status("MYTHIC", 1, AchievementRarity.Mythic, family = "records")
        val compound = status("EPIC", 2, AchievementRarity.Epic, earned = true, scope = "compound")
        val families = achievementGalleryFamilies(listOf(common, compound, mythic, epic))
        assertEquals("records:barebow", families.first().key)
        assertEquals(3, families.size)
        val barebow = families.single { it.key == "volume:barebow" }
        assertEquals(listOf(epic.key, common.key), barebow.earned.map { it.key })
        assertEquals(epic.key, barebow.main.key)
    }

    @Test fun invalidReceiptDoesNotPresentAsEarned() {
        val source = status("FIRST", 1, AchievementRarity.Rare, 30, earned = true)
        val invalid = source.copy(earned = source.earned!!.copy(valid = false))
        val family = achievementGalleryFamilies(listOf(invalid)).single()
        assertTrue(family.earned.isEmpty())
        assertEquals(AchievementGalleryState.InProgress, family.stateOf(family.main))
    }

    @Test fun realCompoundTenFamilyStartsWithFirstTenBeforeThreeTensWithoutChangingPriorities() {
        val statuses = AchievementCatalog.rules.filter { it.family == "hits.ten" }
            .map { AchievementStatus(it, "compound") }
        assertEquals("START02", achievementGalleryFamilies(statuses).single().next?.definition?.id)
        val first = statuses.single { it.definition.id == "START02" }
        val receipt = status("START02", first.definition.priority, first.definition.rarityFor("compound"),
            earned = true, family = "hits.ten", scope = "compound").earned!!
        val afterFirst = statuses.map { if (it.key == first.key) it.copy(earned = receipt) else it }
        assertEquals("HIT01", achievementGalleryFamilies(afterFirst).single().next?.definition?.id)
        assertEquals(2, first.definition.priority)
        assertEquals(2, receipt.priority)
    }

    @Test fun cleanerRemovesOnlyKnownRepeatedNoticesWithoutChangingReceipt() {
        val description = "Сохраните три десятки.\n18 м · мишень 40 см.\nСчитаются новые тренировки FableShot, импорт не участвует."
        val award = status("FIRST", 1, AchievementRarity.Common, earned = true).earned!!.copy(description = description)
        assertEquals("Сохраните три десятки.\n18 м · мишень 40 см.", achievementDescriptionForDisplay(award.description))
        assertEquals(description, award.description)
        assertEquals("Условие.", achievementDescriptionForDisplay("Условие. Только новые допустимые факты; импортированные попадания не засчитываются."))
        assertEquals("Импортируйте непустой архив.", achievementDescriptionForDisplay("Импортируйте непустой архив."))
    }

    @Test fun receiptMomentUsesItsOwnDateAcrossMidnightAndForServiceWithoutSourceDate() {
        val award = status("FIRST", 1, AchievementRarity.Common, earned = true).earned!!
        val zone = ZoneId.of("Asia/Novosibirsk")
        assertEquals("04.11.2026, 14:30", achievementEarnedMoment(award, zone))
        val service = award.copy(ruleId = "APP08", scope = "global", sessionId = null, endId = null, sourceDate = null)
        assertEquals("04.11.2026, 14:30", achievementEarnedMoment(service, zone))
        val afterMidnight = award.copy(earnedAtMs = Instant.parse("2026-11-03T18:30:00Z").toEpochMilli())
        assertEquals("04.11.2026, 01:30", achievementEarnedMoment(afterMidnight, zone))
        assertEquals("04.11.2026", achievementReceivedDateLabel(afterMidnight, zone))
        assertEquals("2026-11-03", afterMidnight.sourceDate)
    }
}

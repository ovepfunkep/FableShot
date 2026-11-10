package app.fableshot.android.domain

import org.junit.Assert.*
import org.junit.Test

class AchievementGroupingTest {
    private fun award(id: String, rarity: AchievementRarity, priority: Int,
        family: String = "group", scope: String = "barebow") = EarnedAchievement(
        "$id:$scope", id, scope, id, "Реплика", "Условие", family, rarity, priority,
        "session", "end", "2026-11-03", 0, "batch", null, true,
    )

    @Test fun sixRelatedAwardsBecomeBestPlusFiveWithoutDeletingAnyAward() {
        val awards = AchievementRarity.entries.mapIndexed { index, rarity -> award("GROUP$index", rarity, index) }
        val group = groupAchievements(awards).single()
        assertEquals(AchievementRarity.Mythic, group.main.rarity)
        assertEquals(5, group.others.size)
        assertEquals(awards.map { it.key }.toSet(), (listOf(group.main) + group.others).map { it.key }.toSet())
    }

    @Test fun familiesAndBowsStaySeparateAndInvalidOrDuplicateReceiptsAreNotCounted() {
        val first = award("GROUP01", AchievementRarity.Rare, 1)
        val groups = groupAchievements(listOf(first, first, first.copy(key = "GROUP02:barebow", valid = false),
            award("GROUP01", AchievementRarity.Rare, 1, scope = "compound"),
            award("RANK09", AchievementRarity.Mythic, 9, family = "norms")))
        assertEquals(3, groups.size)
        assertEquals("RANK09", groups.first().main.ruleId)
        assertTrue(groups.all { it.others.isEmpty() })
    }

    @Test fun equalRarityUsesHigherExplicitTierRegardlessOfInsertOrder() {
        val low = award("GROUP01", AchievementRarity.Epic, 1)
        val high = award("GROUP08", AchievementRarity.Epic, 8)
        assertEquals(high, groupAchievements(listOf(high, low)).single().main)
        assertEquals(high, groupAchievements(listOf(low, high)).single().main)
    }

    @Test fun compoundTripleSuppressesTheStarterTenEvenWhenBothRaritiesAreCommon() {
        val starter = AchievementCatalog.byId.getValue("START02")
        val triple = AchievementCatalog.byId.getValue("HIT01")
        val first = award(starter.id, starter.rarityFor("compound"), starter.priority, starter.family, "compound")
        val perfect = award(triple.id, triple.rarityFor("compound"), triple.priority, triple.family, "compound")
        assertEquals(first.rarity, perfect.rarity)
        val group = groupAchievements(listOf(first, perfect)).single()
        assertEquals("HIT01", group.main.ruleId)
        assertEquals(listOf(first), group.others)
        assertEquals(2, first.priority)
        assertEquals(1, perfect.priority)
    }

    @Test fun categoryVariantsDoNotClaimEqualDifficultyOrChangeOfficialNormativeRarity() {
        val perfect = AchievementCatalog.byId.getValue("HIT01")
        assertTrue(perfect.rarityFor("compound").ordinal < perfect.rarityFor("traditional").ordinal)
        val rank = AchievementCatalog.byId.getValue("RANK09")
        assertEquals(rank.rarityFor("compound"), rank.rarityFor("barebow"))
        assertEquals(62, AchievementCatalog.rules.size)
        assertEquals(62, AchievementCatalog.byId.size)
    }
}

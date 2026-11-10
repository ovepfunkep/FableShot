package app.fableshot.android.domain

enum class AchievementRarity(val label: String) {
    Common("Обычное"), Uncommon("Необычное"), Rare("Редкое"), Epic("Эпическое"),
    Legendary("Легендарное"), Mythic("Мифическое"),
}

val achievementBowLabels = linkedMapOf(
    "recurve" to "Классический", "compound" to "Блочный", "barebow" to "Баребоу",
    "traditional" to "Традиционный", "longbow" to "Лонгбоу",
)

data class AchievementDefinition(
    val id: String,
    val title: String,
    val flavor: String,
    val description: String,
    val family: String,
    val rarity: AchievementRarity,
    val target: Long = 1,
    val categorySpecific: Boolean = false,
    val performanceFormat: Boolean = false,
    val priority: Int = 0,
) {
    fun rarityFor(scope: String): AchievementRarity {
        if (!performanceFormat) return rarity
        // Editorial starting matrix, separate from CG3 and official sporting standards.
        val row = when (scope) {
            "compound" -> listOf(0, 0, 1, 2, 3, 4)
            "recurve" -> listOf(0, 1, 2, 3, 4, 5)
            "barebow", "traditional", "longbow" -> listOf(0, 2, 3, 4, 5, 5)
            else -> return rarity
        }
        return AchievementRarity.entries[row[rarity.ordinal]]
    }
}

data class EarnedAchievement(
    val key: String,
    val ruleId: String,
    val scope: String,
    val title: String,
    val flavor: String,
    val description: String,
    val family: String,
    val rarity: AchievementRarity,
    val priority: Int,
    val sessionId: String?,
    val endId: String?,
    val sourceDate: String?,
    val earnedAtMs: Long,
    val batchId: String,
    val notifiedAtMs: Long?,
    val valid: Boolean,
)

data class AchievementStatus(
    val definition: AchievementDefinition,
    val scope: String,
    val value: Long = 0,
    val earned: EarnedAchievement? = null,
) {
    val key: String get() = "${definition.id}:$scope"
}

data class AchievementBoard(
    val statuses: List<AchievementStatus> = emptyList(),
    val awards: List<EarnedAchievement> = emptyList(),
    val scopes: Set<String> = emptySet(),
    val failed: Boolean = false,
)

data class AchievementGroup(val main: EarnedAchievement, val others: List<EarnedAchievement>) {
    val key: String get() = "${main.family}:${main.scope}"
}

/** The starter ten precedes perfect-series tiers, regardless of its historical metadata priority. */
internal fun achievementTierOrder(ruleId: String, priority: Int): Int =
    if (ruleId == "START02") 0 else priority

/** Only new awards in the supplied context are folded; none are deleted or silently counted twice. */
fun groupAchievements(awards: List<EarnedAchievement>): List<AchievementGroup> = awards
    .filter { it.valid }.distinctBy { it.key }.groupBy { it.family to it.scope }.values.map { group ->
        val ordered = group.sortedWith(compareByDescending<EarnedAchievement> { it.rarity.ordinal }
            .thenByDescending { achievementTierOrder(it.ruleId, it.priority) }.thenBy { it.ruleId })
        AchievementGroup(ordered.first(), ordered.drop(1))
    }.sortedWith(compareByDescending<AchievementGroup> { it.main.rarity.ordinal }
        .thenByDescending { achievementTierOrder(it.main.ruleId, it.main.priority) }.thenBy { it.key })

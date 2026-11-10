package app.fableshot.android.domain

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

enum class AchievementGalleryState {
    Earned, InProgress, Next, Locked,
}

data class AchievementGalleryFamily(
    val key: String,
    val statuses: List<AchievementStatus>,
    val earned: List<AchievementStatus>,
    val next: AchievementStatus?,
    val locked: List<AchievementStatus>,
) {
    val main: AchievementStatus get() = earned.firstOrNull() ?: requireNotNull(next)
    val rarity: AchievementRarity get() = main.galleryRarity()

    fun stateOf(status: AchievementStatus): AchievementGalleryState = when {
        status.earned?.valid == true -> AchievementGalleryState.Earned
        status.key == next?.key && status.value > 0 -> AchievementGalleryState.InProgress
        status.key == next?.key -> AchievementGalleryState.Next
        else -> AchievementGalleryState.Locked
    }

    val details: List<AchievementStatus> get() = statuses.sortedWith(
        compareBy<AchievementStatus> { stateOf(it).ordinal }.then(galleryRarityOrder),
    )
}

private fun AchievementStatus.galleryRarity() = earned?.rarity ?: definition.rarityFor(scope)

private val galleryRarityOrder = compareByDescending<AchievementStatus> { it.galleryRarity().ordinal }
    .thenByDescending { achievementTierOrder(it.definition.id, it.earned?.priority ?: it.definition.priority) }
    .thenBy { it.definition.id }

/** Presentation only: tier order chooses the next step; rarity orders the visible collection. */
fun achievementGalleryFamilies(statuses: List<AchievementStatus>): List<AchievementGalleryFamily> = statuses
    .distinctBy { it.key }
    .map { status -> status.copy(earned = status.earned?.takeIf { it.valid }) }
    .groupBy { (it.earned?.family ?: it.definition.family) to it.scope }
    .map { (key, family) ->
        val earned = family.filter { it.earned != null }.sortedWith(galleryRarityOrder)
        val next = family.filter { it.earned == null }
            .minWithOrNull(compareBy<AchievementStatus> { achievementTierOrder(it.definition.id, it.definition.priority) }
                .thenBy { it.definition.id })
        AchievementGalleryFamily("${key.first}:${key.second}", family, earned, next,
            family.filter { it.earned == null && it.key != next?.key }.sortedWith(galleryRarityOrder))
    }
    .sortedWith(compareByDescending<AchievementGalleryFamily> { it.rarity.ordinal }
        .thenBy { it.stateOf(it.main).ordinal }.thenBy { it.key })

/** Old receipts keep their original data; repeated eligibility notices are hidden only at display time. */
fun achievementDescriptionForDisplay(description: String): String {
    val notices = listOf(
        "Считаются новые тренировки FableShot, импорт не участвует.",
        "Только новые допустимые факты; импортированные попадания не засчитываются.",
    )
    return notices.fold(description) { text, notice -> text.replace(notice, "") }
        .lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n")
}

fun achievementReceivedDateLabel(award: EarnedAchievement, zone: ZoneId = ZoneId.systemDefault()): String =
    Instant.ofEpochMilli(award.earnedAtMs).atZone(zone).format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))

fun achievementEarnedMoment(award: EarnedAchievement, zone: ZoneId = ZoneId.systemDefault()): String {
    return Instant.ofEpochMilli(award.earnedAtMs).atZone(zone).format(DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm"))
}

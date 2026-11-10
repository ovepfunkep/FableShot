package app.fableshot.android.domain

import java.time.LocalDate

data class AchievementFact(
    val sessionId: String,
    val completed: Boolean,
    val arrows: Int,
    val localDate: String?,
)

data class AchievementRule(
    val id: String,
    val title: String,
    val target: Long,
    val unit: String,
    val description: String,
    val version: Int = 1,
)

data class AchievementProgress(
    val rule: AchievementRule,
    val value: Long,
    val earnedOn: String?,
    val evidenceSessionIds: List<String>,
) {
    val earned: Boolean get() = value >= rule.target
    val key: String get() = "${rule.id}:v${rule.version}"
    val evidenceSessionId: String? get() = if (earned) evidenceSessionIds.lastOrNull() else null
}

private val firstPractice = AchievementRule("first-practice", "Первый шаг", 1, "Завершено занятий",
    "Первая завершённая непустая тренировка. Импортированная история тоже учитывается. Пустые, активные и приостановленные занятия не подходят.")
private val hundredArrows = AchievementRule("hundred-arrows", "Сотня стрел", 100, "Внесено стрел",
    "100 внесённых выстрелов за всё время. Учитываются оценённые стрелы, разминка и ручной подсчёт объёма, в том числе в текущей или приостановленной тренировке. Это дневник ввода, а не автоматическое обнаружение выстрела.")
private val fivePractices = AchievementRule("five-practices", "Пять занятий", 5, "Завершено занятий",
    "Пять завершённых непустых тренировок за всё время, без требования заниматься каждый день. Импорт учитывается, повторная загрузка той же тренировки не добавляет новое занятие.")

/** Derived from current facts. Import/reopening cannot replay an award or create a second one. */
fun initialAchievements(facts: List<AchievementFact>): List<AchievementProgress> {
    val unique = facts.distinctBy {it.sessionId}.filter {it.arrows > 0}
    val ordered = unique.map { fact ->
        val date = fact.localDate?.let {runCatching {LocalDate.parse(it).toString()}.getOrNull()}
        fact.copy(localDate = date)
    }.sortedWith(compareBy<AchievementFact> {it.localDate == null}.thenBy {it.localDate}.thenBy {it.sessionId})

    fun evaluate(rule: AchievementRule, completedOnly: Boolean, arrows: Boolean): AchievementProgress {
        val eligible = if (completedOnly) ordered.filter {it.completed} else ordered
        var total = 0L
        var crossingDate: String? = null
        val evidence = mutableListOf<String>()
        for (fact in eligible) {
            if (total < rule.target) {
                evidence += fact.sessionId
                if (total + (if (arrows) fact.arrows.toLong() else 1) >= rule.target) crossingDate = fact.localDate
            }
            total += if (arrows) fact.arrows.toLong() else 1
        }
        return AchievementProgress(rule, total, crossingDate, evidence)
    }
    return listOf(evaluate(firstPractice, true, false), evaluate(hundredArrows, false, true), evaluate(fivePractices, true, false))
}

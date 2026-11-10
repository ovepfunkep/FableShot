package app.fableshot.android.data

import app.fableshot.android.domain.AchievementFact
import app.fableshot.android.domain.initialAchievements

fun personalAchievements(sessions: List<SessionSummary>) = initialAchievements(sessions.map {
    AchievementFact(it.id, it.state == "completed", it.shotCount, it.journalMeta?.takeIf {meta -> meta.dateKnown}?.localDate)
})

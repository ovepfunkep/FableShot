package app.fableshot.android.data.journal

/** The lifecycle subset of the journal's already archived mutation receipts. */
data class TrainingTimeEvent(
    val sessionId: String,
    val kind: String,
    val resultRevision: Long,
    val appliedAtMs: Long,
    val sessionState: String,
    val trashed: Boolean,
)

data class TrackedTrainingTime(
    val closedMs: Long?,
    val activeSinceMs: Long?,
    val partial: Boolean,
) {
    fun elapsedMs(nowMs: Long): Long? {
        val activeMs = activeSinceMs?.let { start -> nowMs.takeIf { it >= start }?.minus(start) }
        return when {
            activeMs == null -> closedMs
            closedMs == null -> activeMs
            else -> addDurations(closedMs, activeMs)
        }
    }
}

data class TrainingTimeSummary(
    val bySession: Map<String, TrackedTrainingTime> = emptyMap(),
    val recordedMs: Long? = null,
)

private fun addDurations(first: Long, second: Long): Long = first + second.coerceAtMost(Long.MAX_VALUE - first)

internal fun trainingTimeSummary(events: List<TrainingTimeEvent>): TrainingTimeSummary {
    val sessions = mutableMapOf<String, TrackedTrainingTime>()
    var recordedMs = 0L
    events.groupBy { it.sessionId }.forEach { (id, sessionEvents) ->
        val ordered = sessionEvents.sortedBy { it.resultRevision }
        val current = ordered.last()
        var partial = ordered.first().kind != "start"
        var activeSince: Long? = null
        var closedMs: Long? = null
        for (event in ordered) {
            val instant = event.appliedAtMs
            when (event.kind) {
                "start", "resume" -> {
                    // Without a matching stop there is no evidence for the intervening duration.
                    if (activeSince != null || instant < 0) partial = true
                    activeSince = instant.takeIf { it >= 0 }
                }
                "pause", "complete", "next", "trash" -> {
                    activeSince?.let { start ->
                        if (instant < start) partial = true
                        else closedMs = addDurations(closedMs ?: 0L, instant - start)
                    }
                    activeSince = null
                }
            }
        }
        if (current.sessionState != "active" || current.trashed) {
            if (activeSince != null) partial = true
            activeSince = null
        }
        if (closedMs != null || activeSince != null) sessions[id] = TrackedTrainingTime(closedMs, activeSince, partial)
        if (!current.trashed) recordedMs = addDurations(recordedMs, closedMs ?: 0L)
    }
    return TrainingTimeSummary(sessions, recordedMs)
}

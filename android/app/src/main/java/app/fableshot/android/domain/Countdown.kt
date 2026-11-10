package app.fableshot.android.domain

enum class CountdownStatus { Idle, Running, Paused, Finished }

data class Countdown(
    val durationSeconds: Int,
    val remainingMillis: Long = durationSeconds * 1000L,
    val status: CountdownStatus = CountdownStatus.Idle,
    val deadlineMillis: Long? = null,
    val backgroundPause: Boolean = false,
) {
    init { require(durationSeconds in 1..3600) }

    val displaySeconds: Int get() = ((remainingMillis + 999) / 1000).toInt()

    fun start(now: Long): Countdown = when (status) {
        CountdownStatus.Idle, CountdownStatus.Paused -> copy(
            status = CountdownStatus.Running,
            deadlineMillis = now + remainingMillis,
            backgroundPause = false,
        )
        else -> this
    }

    fun tick(now: Long): Countdown {
        if (status != CountdownStatus.Running) return this
        val remaining = (requireNotNull(deadlineMillis) - now).coerceIn(0, durationSeconds * 1000L)
        return copy(
            remainingMillis = remaining,
            status = if (remaining == 0L) CountdownStatus.Finished else status,
            deadlineMillis = if (remaining == 0L) null else deadlineMillis,
        )
    }

    fun pause(now: Long, background: Boolean = false): Countdown {
        val current = tick(now)
        if (current.status != CountdownStatus.Running) return current
        return current.copy(status = CountdownStatus.Paused, deadlineMillis = null, backgroundPause = background)
    }

    fun reset(seconds: Int = durationSeconds) = Countdown(seconds)
}

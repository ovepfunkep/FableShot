package app.fableshot.android

import android.os.SystemClock
import app.fableshot.android.domain.Countdown
import app.fableshot.android.domain.CountdownStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class TimerPhase(val title: String) { Series("Серия"), Rest("Отдых") }

data class PracticeTimerState(
    val phase: TimerPhase = TimerPhase.Series,
    val countdown: Countdown = Countdown(120),
)

/** Owned by the practice ViewModel; commands and clock updates run on its main scope. */
class PracticeTimer(
    private val scope: CoroutineScope,
    private val now: () -> Long = SystemClock::elapsedRealtime,
) {
    private val _state = MutableStateFlow(PracticeTimerState())
    val state = _state.asStateFlow()
    private val _completions = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val completions = _completions.asSharedFlow()
    private var ticker: Job? = null
    private var sessionId: String? = null
    private var seriesSeconds = 120
    private var restSeconds = 60

    fun bindSession(id: String?) {
        if (id == sessionId) return
        sessionId = id
        reset()
    }

    fun configure(series: Int, rest: Int) {
        require(series in 1..3600 && rest in 1..3600)
        seriesSeconds = series
        restSeconds = rest
        if (_state.value.countdown.status == CountdownStatus.Idle) reset()
    }

    fun select(phase: TimerPhase) {
        ticker?.cancel()
        _state.value = PracticeTimerState(phase, Countdown(duration(phase)))
    }

    fun start() {
        if (sessionId == null || _state.value.countdown.status == CountdownStatus.Running) return
        if (_state.value.countdown.status == CountdownStatus.Finished) reset()
        _state.value = _state.value.copy(countdown = _state.value.countdown.start(now()))
        ticker?.cancel()
        ticker = scope.launch {
            while (isActive && _state.value.countdown.status == CountdownStatus.Running) {
                delay(100)
                val updated = _state.value.countdown.tick(now())
                _state.value = _state.value.copy(countdown = updated)
                if (updated.status == CountdownStatus.Finished) _completions.emit(Unit)
            }
        }
    }

    fun pause(background: Boolean = false) {
        ticker?.cancel()
        _state.value = _state.value.copy(countdown = _state.value.countdown.pause(now(), background))
    }

    fun reset() {
        ticker?.cancel()
        _state.value = _state.value.copy(countdown = Countdown(duration(_state.value.phase)))
    }

    private fun duration(phase: TimerPhase) = if (phase == TimerPhase.Series) seriesSeconds else restSeconds
}

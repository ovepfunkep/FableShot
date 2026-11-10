package app.fableshot.android

import app.fableshot.android.domain.CountdownStatus
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Test

class PracticeTimerTest {
    @Test fun delayedTickCompletesOnceAndChangingSessionResetsWithoutStarting() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        var clock = 1000L
        val timer = PracticeTimer(scope) {clock}
        var signals = 0
        val collector = scope.launch {timer.completions.collect {signals++}}
        try {
            withContext(Dispatchers.Main) {
                timer.configure(2, 3)
                timer.start()
                assertEquals(CountdownStatus.Idle, timer.state.value.countdown.status)
                timer.bindSession("first")
                timer.start()
                timer.start()
                clock = 4000
            }
            withTimeout(3000) {timer.state.first {it.countdown.status == CountdownStatus.Finished}}
            withContext(Dispatchers.Main) {
                assertEquals(1, signals)
                timer.pause()
                timer.bindSession("second")
                assertEquals(CountdownStatus.Idle, timer.state.value.countdown.status)
                assertEquals(2, timer.state.value.countdown.displaySeconds)
                timer.select(TimerPhase.Rest)
                timer.start()
                clock += 500
                timer.pause(background = true)
                assertEquals(2500L, timer.state.value.countdown.remainingMillis)
                assertTrue(timer.state.value.countdown.backgroundPause)
                clock += 100000
                assertEquals(2500L, timer.state.value.countdown.remainingMillis)
                timer.start()
                assertFalse(timer.state.value.countdown.backgroundPause)
                timer.bindSession(null)
                assertEquals(CountdownStatus.Idle, timer.state.value.countdown.status)
                assertEquals(1, signals)
            }
        } finally {collector.cancel();scope.coroutineContext[Job]!!.cancelAndJoin()}
    }
}

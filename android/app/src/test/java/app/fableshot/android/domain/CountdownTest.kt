package app.fableshot.android.domain

import org.junit.Assert.*
import org.junit.Test

class CountdownTest {
    @Test fun deadlineHandlesDelayedUpdatesWithoutAccumulatingDrift() {
        val initial = Countdown(120).start(5000)
        assertEquals(125000L, initial.deadlineMillis)
        val delayed = initial.tick(92345)
        assertEquals(32655L, delayed.remainingMillis)
        assertEquals(33, delayed.displaySeconds)
        assertEquals(125000L, delayed.deadlineMillis)
        assertEquals(CountdownStatus.Finished, delayed.tick(126000).status)
        assertEquals(0, delayed.tick(126000).displaySeconds)
        assertNull(delayed.tick(126000).deadlineMillis)
    }

    @Test fun backgroundPausePreservesRemainderUntilExplicitResume() {
        val paused = Countdown(60).start(1000).pause(22345, background = true)
        assertEquals(38655L, paused.remainingMillis)
        assertEquals(CountdownStatus.Paused, paused.tick(999999).status)
        assertTrue(paused.backgroundPause)
        assertEquals(paused, paused.tick(999999))
        val resumed = paused.start(1000000)
        assertFalse(resumed.backgroundPause)
        assertEquals(1038655L, resumed.deadlineMillis)
        assertEquals(CountdownStatus.Finished, resumed.tick(1038655).status)
    }

    @Test fun resetAndRepeatedCommandsDoNotRestartAnExistingCountdown() {
        val running = Countdown(1).start(0)
        assertEquals(running, running.start(900))
        assertEquals(1, running.tick(999).displaySeconds)
        val finished = running.tick(1000)
        assertEquals(finished, finished.start(5000))
        assertEquals(CountdownStatus.Finished, running.pause(1000).status)
        assertEquals(Countdown(30), running.reset(30))
        assertEquals(CountdownStatus.Idle, finished.reset().status)
    }

    @Test fun durationsAreBounded() {
        for (seconds in listOf(0, -1, 3601, Int.MAX_VALUE)) {
            assertThrows(IllegalArgumentException::class.java) { Countdown(seconds) }
        }
    }
}

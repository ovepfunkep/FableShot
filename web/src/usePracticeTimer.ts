import { useCallback, useEffect, useRef, useState } from 'react';
import { performTrainingHaptic } from './native-training-window.ts';
import { DEFAULT_TIMER_SETTINGS, displaySeconds, initialTimer, loadTimerSettings, resetTimer,
  saveTimerSettings, selectTimerPhase, tickTimer, toggleTimer } from './timer.ts';
import type { TimerPhase, TimerSettings, TimerState } from './timer.ts';

function readSettings(): TimerSettings | null {
  try { return loadTimerSettings(); }
  catch { return null; }
}

export function usePracticeTimer(active: boolean, haptics = false) {
  const [settings, setSettings] = useState(readSettings);
  const settingsRef = useRef(settings);
  const [state, setState] = useState(() => initialTimer(settings ?? DEFAULT_TIMER_SETTINGS));
  const live = useRef(state);

  const publish = useCallback((next: TimerState) => {
    live.current = next;
    // Keep exact milliseconds for pause while publishing only visible changes.
    setState(previous => previous.phase === next.phase && previous.status === next.status &&
      previous.durationSeconds === next.durationSeconds && displaySeconds(previous) === displaySeconds(next)
      ? previous : next);
  }, []);

  useEffect(() => {
    if (!active) {
      publish(resetTimer(live.current, settingsRef.current ?? DEFAULT_TIMER_SETTINGS));
      return;
    }
    function tick() {
      const before = live.current;
      // Wall time includes phone sleep on browsers whose performance clock stops during sleep.
      const now = Date.now();
      const next = tickTimer(before, now);
      if (haptics && before.status === 'Running' && next.status === 'Finished' && document.visibilityState === 'visible' &&
        before.deadlineMillis !== null && now - before.deadlineMillis < 1000) performTrainingHaptic();
      publish(next);
    }
    const interval = window.setInterval(tick, 100);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [active, haptics, publish]);

  function prepare(): boolean {
    try {
      const loaded = loadTimerSettings();
      if (!settingsRef.current) {
        settingsRef.current = loaded;
        setSettings(loaded);
        publish(initialTimer(loaded));
      }
      return true;
    } catch { return false; }
  }

  function save(next: TimerSettings): boolean {
    if (live.current.status === 'Running' || live.current.status === 'Paused') return false;
    try {
      saveTimerSettings(next);
      settingsRef.current = next;
      setSettings(next);
      publish(resetTimer(live.current, next));
      return true;
    } catch { return false; }
  }

  function toggle() {
    if (active && settingsRef.current) publish(toggleTimer(live.current, Date.now()));
  }

  function reset() {
    if (settingsRef.current) publish(resetTimer(live.current, settingsRef.current));
  }

  function select(phase: TimerPhase) {
    if (settingsRef.current) publish(selectTimerPhase(live.current, phase, settingsRef.current));
  }

  return { state, settings, prepare, save, toggle, reset, select };
}

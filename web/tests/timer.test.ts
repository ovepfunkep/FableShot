import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  DEFAULT_TIMER_SETTINGS, displaySeconds, initialTimer, loadTimerSettings, resetTimer,
  saveTimerSettings, selectTimerPhase, tickTimer, timerClock, toggleTimer,
} from '../src/timer.ts';

const key = 'app.fableshot.timer-settings.v1';

function storage(t: TestContext, initial: string | null = null, failWrite = false) {
  const entries = new Map<string, string>();
  if (initial !== null) entries.set(key, initial);
  const value = {
    getItem(name: string) { return entries.get(name) ?? null; },
    setItem(name: string, raw: string) {
      if (failWrite) throw new DOMException('Storage full', 'QuotaExceededError');
      entries.set(name, raw);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'));
  return value;
}

test('starts with the Android durations and rounds partial seconds upward', () => {
  const idle = initialTimer();
  assert.equal(idle.phase, 'Series');
  assert.equal(idle.status, 'Idle');
  assert.equal(displaySeconds(idle), 120);
  assert.equal(timerClock(displaySeconds(idle)), '02:00');
  const running = toggleTimer(idle, 100);
  assert.equal(timerClock(displaySeconds(tickTimer(running, 1100))), '01:59');
  assert.equal(timerClock(displaySeconds(tickTimer(running, 1100.1))), '01:59');
  assert.equal(timerClock(displaySeconds(tickTimer(running, 1099.9))), '02:00');
  assert.equal(timerClock(0), '00:00');
  assert.equal(timerClock(3600), '60:00');
});

test('a delayed tick catches up after background time and completes exactly once', () => {
  const running = toggleTimer(initialTimer(), 5000);
  const caughtUp = tickTimer(running, 85_000);
  assert.equal(caughtUp.remainingMillis, 40_000);
  assert.equal(caughtUp.deadlineMillis, 125_000);
  assert.equal(caughtUp.status, 'Running');
  const finished = tickTimer(caughtUp, 130_000);
  assert.equal(finished.status, 'Finished');
  assert.equal(finished.deadlineMillis, null);
  assert.equal(displaySeconds(finished), 0);
  assert.strictEqual(tickTimer(finished, 200_000), finished);
});

test('pause keeps the precise remaining time, resume sets a new deadline', () => {
  const started = toggleTimer(initialTimer(), 1000);
  const paused = toggleTimer(started, 2456.7);
  assert.equal(paused.status, 'Paused');
  assert.equal(paused.remainingMillis, 118543.3);
  assert.equal(paused.deadlineMillis, null);
  assert.strictEqual(tickTimer(paused, 100_000), paused);
  const resumed = toggleTimer(paused, 200_000);
  assert.equal(resumed.deadlineMillis, 318543.3);
  assert.ok(Math.abs(tickTimer(resumed, 201_000).remainingMillis - 117543.3) < .0001);
});

test('pause after the deadline finishes, repeat restarts, and reset keeps the phase', () => {
  const settings = { seriesSeconds: 5, restSeconds: 12 };
  const running = toggleTimer(initialTimer(settings), 0);
  const ended = toggleTimer(running, 7000);
  assert.equal(ended.status, 'Finished');
  const repeat = toggleTimer(ended, 8000);
  assert.equal(repeat.status, 'Running');
  assert.equal(repeat.remainingMillis, 5000);
  assert.equal(repeat.deadlineMillis, 13000);
  const rest = selectTimerPhase(repeat, 'Rest', settings);
  assert.deepEqual(rest, initialTimer(settings, 'Rest'));
  const reset = resetTimer(toggleTimer(rest, 10_000), { ...settings, restSeconds: 60 });
  assert.equal(reset.phase, 'Rest');
  assert.equal(reset.status, 'Idle');
  assert.equal(reset.remainingMillis, 60_000);
});

test('fresh process state restores settings and begins idle', t => {
  const value = storage(t);
  assert.deepEqual(loadTimerSettings(), DEFAULT_TIMER_SETTINGS);
  saveTimerSettings({ seriesSeconds: 180, restSeconds: 90 });
  assert.deepEqual(JSON.parse(value.getItem(key)!), { version: 1, settings: { seriesSeconds: 180, restSeconds: 90 } });
  assert.equal(initialTimer(loadTimerSettings()).status, 'Idle');
  assert.equal(initialTimer(loadTimerSettings()).remainingMillis, 180_000);
});

test('durations are integers from one to 3600 seconds', t => {
  storage(t);
  for (const seriesSeconds of [0, -1, 1.5, 3601, NaN, Infinity]) {
    const settings = { seriesSeconds, restSeconds: 60 };
    assert.throws(() => initialTimer(settings));
    assert.throws(() => saveTimerSettings(settings));
  }
  assert.equal(initialTimer({ seriesSeconds: 1, restSeconds: 3600 }, 'Rest').durationSeconds, 3600);
  assert.throws(() => timerClock(-1));
  assert.throws(() => timerClock(1.5));
});

test('corrupted or unsupported settings remain untouched on a save attempt', t => {
  const value = storage(t, '{bad');
  assert.throws(() => loadTimerSettings());
  assert.throws(() => saveTimerSettings({ seriesSeconds: 30, restSeconds: 40 }));
  assert.equal(value.getItem(key), '{bad');
  for (const raw of ['null', '{"version":2,"settings":{"seriesSeconds":120,"restSeconds":60}}',
    '{"version":1,"settings":{"seriesSeconds":120,"restSeconds":0}}']) {
    value.setItem(key, raw);
    assert.throws(() => loadTimerSettings());
    assert.throws(() => saveTimerSettings({ seriesSeconds: 120, restSeconds: 60 }));
    assert.equal(value.getItem(key), raw);
  }
});

test('storage failure is surfaced and the prior settings remain unchanged', t => {
  const raw = JSON.stringify({ version: 1, settings: DEFAULT_TIMER_SETTINGS });
  const value = storage(t, raw, true);
  assert.throws(() => saveTimerSettings({ seriesSeconds: 90, restSeconds: 30 }), /Storage full/);
  assert.equal(value.getItem(key), raw);
});

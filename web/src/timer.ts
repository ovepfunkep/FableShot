import { appStorage } from './app-storage.ts';
export type TimerPhase = 'Preparation' | 'Series' | 'Rest';
export type TimerStatus = 'Idle' | 'Running' | 'Paused' | 'Finished';
export type TimerSettings = { seriesSeconds: number; restSeconds: number; preparationSeconds?: number };
export type TimerState = {
  phase: TimerPhase;
  durationSeconds: number;
  remainingMillis: number;
  status: TimerStatus;
  deadlineMillis: number | null;
};

export const DEFAULT_TIMER_SETTINGS: Readonly<TimerSettings> = { seriesSeconds: 120, restSeconds: 60 };
export const DEFAULT_PREPARATION_SECONDS = 10;
const settingsKey = 'app.fableshot.timer-settings.v1';

export function isSettings(value: unknown): value is TimerSettings {
  if (value === null || typeof value !== 'object') return false;
  const { seriesSeconds, restSeconds, preparationSeconds } = value as Partial<TimerSettings>;
  return (preparationSeconds === undefined || Number.isInteger(preparationSeconds) && preparationSeconds >= 1 && preparationSeconds <= 120) &&
    [seriesSeconds, restSeconds].every(seconds =>
    typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600);
}

export function initialTimer(settings: TimerSettings = DEFAULT_TIMER_SETTINGS, phase: TimerPhase = 'Series'): TimerState {
  if (!isSettings(settings)) throw new RangeError('Длительность должна быть от 1 до 3600 секунд.');
  const durationSeconds = phase === 'Preparation' ? settings.preparationSeconds ?? DEFAULT_PREPARATION_SECONDS
    : phase === 'Series' ? settings.seriesSeconds : settings.restSeconds;
  return { phase, durationSeconds, remainingMillis: durationSeconds * 1000, status: 'Idle', deadlineMillis: null };
}

export function displaySeconds(state: TimerState): number {
  return Math.ceil(state.remainingMillis / 1000);
}

export function timerClock(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) throw new RangeError('Invalid timer display value');
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Supply the same elapsed-time clock for every command and visibility catch-up. */
export function tickTimer(state: TimerState, now: number): TimerState {
  if (state.status !== 'Running') return state;
  if (!Number.isFinite(now) || state.deadlineMillis === null) throw new RangeError('Invalid timer clock');
  const remainingMillis = Math.min(state.durationSeconds * 1000, Math.max(0, state.deadlineMillis - now));
  if (remainingMillis === state.remainingMillis) return state;
  return {
    ...state,
    remainingMillis,
    status: remainingMillis === 0 ? 'Finished' : 'Running',
    deadlineMillis: remainingMillis === 0 ? null : state.deadlineMillis,
  };
}

export function toggleTimer(state: TimerState, now: number): TimerState {
  if (!Number.isFinite(now)) throw new RangeError('Invalid timer clock');
  if (state.status === 'Running') {
    const current = tickTimer(state, now);
    return current.status === 'Finished' ? current : { ...current, status: 'Paused', deadlineMillis: null };
  }
  const remainingMillis = state.status === 'Finished' ? state.durationSeconds * 1000 : state.remainingMillis;
  return { ...state, remainingMillis, status: 'Running', deadlineMillis: now + remainingMillis };
}

const nextPhase: Record<TimerPhase, TimerPhase> = { Preparation: 'Series', Series: 'Rest', Rest: 'Preparation' };
const signalCount: Record<TimerPhase, number> = { Preparation: 2, Series: 1, Rest: 3 };

export function advanceTimer(state: TimerState, settings: TimerSettings, now: number): TimerState {
  return toggleTimer(initialTimer(settings, nextPhase[state.phase]), now);
}

export function tickTimerSequence(state: TimerState, settings: TimerSettings, now: number): TimerState {
  while (state.status === 'Running' && state.phase !== 'Rest' && state.deadlineMillis !== null && now >= state.deadlineMillis) {
    state = advanceTimer(state, settings, state.deadlineMillis);
  }
  return tickTimer(state, now);
}

export function timerSignals(state: TimerState, settings: TimerSettings, now: number, playEntry: boolean) {
  const signals = playEntry ? [{ at: now, count: signalCount[state.phase] }] : [];
  while (state.phase !== 'Rest' && state.deadlineMillis !== null) {
    const at = state.deadlineMillis;
    state = advanceTimer(state, settings, at);
    signals.push({ at, count: signalCount[state.phase] });
  }
  return signals;
}

export function selectTimerPhase(_state: TimerState, phase: TimerPhase, settings: TimerSettings): TimerState {
  return initialTimer(settings, phase);
}

export function resetTimer(state: TimerState, settings: TimerSettings): TimerState {
  return initialTimer(settings, state.phase);
}

export function loadTimerSettings(): TimerSettings {
  const raw = appStorage.getItem(settingsKey);
  if (raw === null) return { ...DEFAULT_TIMER_SETTINGS };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new Error('Не удалось прочитать длительности таймера. Исходная запись сохранена.', { cause });
  }
  if (value === null || typeof value !== 'object') throw new Error('Неверный формат длительностей таймера.');
  const { version, settings } = value as { version?: unknown; settings?: unknown };
  if (version !== 1 || !isSettings(settings)) throw new Error('Неверный формат длительностей таймера. Исходная запись сохранена.');
  return { seriesSeconds: settings.seriesSeconds, restSeconds: settings.restSeconds,
    ...(settings.preparationSeconds !== undefined ? { preparationSeconds: settings.preparationSeconds } : {}) };
}

export function saveTimerSettings(settings: TimerSettings): void | Promise<void> {
  if (!isSettings(settings)) throw new RangeError('Длительность должна быть от 1 до 3600 секунд.');
  loadTimerSettings();
  return appStorage.setItem(settingsKey, JSON.stringify({ version: 1, settings }));
}

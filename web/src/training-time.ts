export type TrainingTime = { closedMs: number | null; activeSinceMs: number | null; partial: boolean };

const validMs = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function isTrainingTime(value: unknown, active: boolean): value is TrainingTime {
  if (!value || typeof value !== 'object') return false;
  const time = value as Partial<TrainingTime>;
  return (time.closedMs === null || validMs(time.closedMs)) &&
    (time.activeSinceMs === null || active && validMs(time.activeSinceMs)) && typeof time.partial === 'boolean';
}

export function startTrainingTime(now: number, previous?: TrainingTime, partial = false): TrainingTime {
  return { closedMs: previous?.closedMs ?? null, activeSinceMs: now, partial: previous?.partial ?? partial };
}

export function stopTrainingTime(time: TrainingTime, now: number): TrainingTime {
  if (time.activeSinceMs === null) return time;
  if (now < time.activeSinceMs) return { ...time, activeSinceMs: null, partial: true };
  return { ...time, closedMs: Math.min(Number.MAX_SAFE_INTEGER, (time.closedMs ?? 0) + now - time.activeSinceMs), activeSinceMs: null };
}

export function elapsedTrainingTime(time: TrainingTime, now: number): number | null {
  return stopTrainingTime(time, now).closedMs;
}

export function formatTrainingTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`;
}

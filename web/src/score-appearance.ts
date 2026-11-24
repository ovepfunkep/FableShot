import { zoneColor } from './target.ts';
import type { Shot } from './target.ts';

export const scoreColor = (score: number) => score === 10 ? 'var(--score-ten, #ffe15d)' : zoneColor(score);

export function scoreOutline(shots: readonly Shot[], enabled: boolean): string | undefined {
  if (!enabled || !shots.length) return undefined;
  const counts = Array<number>(11).fill(0);
  for (const shot of shots) {
    if (Number.isInteger(shot.points) && shot.points >= 0 && shot.points <= 10) counts[shot.points]++;
  }
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (!total) return undefined;
  let position = 0;
  const stops = counts.flatMap((count, score) => {
    if (!count) return [];
    const start = position;
    position += count;
    const color = score === 9 ? 'var(--score-outline-nine)' : score === 10 ? 'var(--score-outline-ten)' : scoreColor(score);
    return [`${color} ${start / total * 100}% ${position / total * 100}%`];
  });
  return `conic-gradient(${stops.join(', ')})`;
}

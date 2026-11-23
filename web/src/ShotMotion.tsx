import type { CSSProperties, ReactNode } from 'react';
import type { ShotMotionStyle } from './preferences.ts';
import './shot-motion.css';

export type ShotMotionEvent = { id: number; index: number; points: number };
export const SHOT_FEEDBACK_MS = 930;
export const CLEAN_SERIES_MS = 1550;

export const SHOT_MOTION_STYLES = [
  { id: 'cards', label: 'Карточки' },
  { id: 'pulse', label: 'Импульс' },
] as const;

const sparks = [
  [-73, -10, -68], [-64, 19, 44], [-47, -25, -42], [-28, 31, 26], [-14, -34, -15],
  [13, 32, 12], [28, -33, 27], [47, 26, -35], [63, -23, 56], [73, 10, 74],
];

export function ShotFace({ points, style, background, color, children }: {
  points?: number; style: ShotMotionStyle; background?: string; color?: string; children: ReactNode;
}) {
  return <>
    <span className="shot-face" data-shot-motion={points === undefined ? undefined : style}
      data-shot-tier={points === undefined ? undefined : points === 10 ? 'ten' : points === 9 ? 'gold' : points >= 7 ? 'red' : 'base'}
      style={{ background, color }}>{children}</span>
    {points === 10 && style === 'cards' && <span className="shot-sparks" aria-hidden="true">
      <span className="shot-ten-wave" />
      {sparks.map(([x, y, angle], index) => <i key={index} style={{
        '--spark-x': `${x}px`, '--spark-y': `${y}px`, '--spark-angle': `${angle}deg`,
      } as CSSProperties} />)}
    </span>}
  </>;
}

export function CleanSeriesEffect({ arrows }: { arrows: number }) {
  return <div className="clean-series-effect" role="status" data-testid="clean-series-effect"
    style={{ animationDuration: `${CLEAN_SERIES_MS}ms` }}>
    <span>Чистая серия</span><strong>{arrows * 10}/{arrows * 10}</strong>
    <div className="clean-series-light" aria-hidden="true"><i /><i /><i /></div>
  </div>;
}

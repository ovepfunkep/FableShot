import type { CSSProperties, ReactNode } from 'react';
import type { ShotMotionStyle } from './preferences.ts';
import './shot-motion.css';

export type ShotMotionEvent = { id: number; index: number; points: number };

export const SHOT_MOTION_STYLES = [
  { id: 'cards', label: 'Карточки' },
  { id: 'pulse', label: 'Импульс' },
] as const;

const sparks = [
  [-25, -11, -68], [-22, 11, 44], [-14, -16, -20],
  [0, 16, 4], [18, -16, 28], [22, 13, -52], [29, -7, 74],
];

export function ShotFace({ points, style, background, color, children }: {
  points?: number; style: ShotMotionStyle; background?: string; color?: string; children: ReactNode;
}) {
  return <>
    <span className="shot-face" data-shot-motion={points === undefined ? undefined : style}
      data-shot-tier={points === undefined ? undefined : points === 10 ? 'ten' : points === 9 ? 'gold' : points >= 7 ? 'red' : 'base'}
      style={{ background, color }}>{children}</span>
    {points === 10 && style === 'cards' && <span className="shot-sparks" aria-hidden="true">
      {sparks.map(([x, y, angle], index) => <i key={index} style={{
        '--spark-x': `${x}px`, '--spark-y': `${y}px`, '--spark-angle': `${angle}deg`,
      } as CSSProperties} />)}
    </span>}
  </>;
}

export function CleanSeriesEffect({ arrows }: { arrows: number }) {
  return <div className="clean-series-effect" role="status" data-testid="clean-series-effect">
    <span>Чистая серия</span><strong>{arrows * 10}/{arrows * 10}</strong>
  </div>;
}

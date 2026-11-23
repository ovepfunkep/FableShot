import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ShotMotionStyle } from './preferences.ts';
import { zoneColor } from './target.ts';
import './shot-motion.css';

export type CleanSeriesMotion = 'jump' | 'glint';
export type ShotMotionEvent = { id: number; index: number; points: number; cleanSeries?: CleanSeriesMotion; firstTen?: boolean };
export const SHOT_FEEDBACK_MS = 930;

export const SHOT_MOTION_STYLES = [
  { id: 'cards', label: 'Карточки' },
  { id: 'pulse', label: 'Импульс' },
] as const;

const sparks = [
  [-73, -10, -68], [-64, 19, 44], [-47, -25, -42], [-28, 31, 26], [-14, -34, -15],
  [13, 32, 12], [28, -33, 27], [47, 26, -35], [63, -23, 56], [73, 10, 74],
];

function SparkParticles() {
  return sparks.map(([x, y, angle], index) => <i key={index} style={{
    '--spark-x': `${x}px`, '--spark-y': `${y}px`, '--spark-angle': `${angle}deg`,
  } as CSSProperties} />);
}

export function ShotFace({ points, style, background, color, children }: {
  points?: number; style: ShotMotionStyle; background?: string; color?: string; children: ReactNode;
}) {
  return <>
    <span className="shot-face" data-shot-motion={points === undefined ? undefined : style}
      data-shot-tier={points === undefined ? undefined : points === 10 ? 'ten' : points === 9 ? 'gold' : points >= 7 ? 'red' : 'base'}
      style={{ background, color }}>{children}</span>
    {points === 10 && style === 'cards' && <span className="shot-sparks" aria-hidden="true">
      <span className="shot-ten-wave" />
      <SparkParticles />
    </span>}
  </>;
}

export function CleanSeriesEffects({ as: Element = 'span', landing }: { as?: 'li' | 'span'; landing: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const layer = ref.current;
    const row = layer?.closest('[data-clean-series]');
    if (!layer || !row) return;

    const updateClip = () => {
      const bounds = layer.getBoundingClientRect();
      const { offsetWidth, offsetHeight } = layer;
      if (!bounds.width || !bounds.height || !offsetWidth || !offsetHeight) return;
      const scaleX = bounds.width / offsetWidth;
      const scaleY = bounds.height / offsetHeight;
      const paths = Array.from(row.querySelectorAll<HTMLElement>('.arrow-slot.arrow-entered'), cell => {
        const rect = cell.getBoundingClientRect();
        const x = (rect.x - bounds.x) / scaleX + cell.clientLeft;
        const y = (rect.y - bounds.y) / scaleY + cell.clientTop;
        const right = x + rect.width / scaleX - cell.clientLeft * 2;
        const bottom = y + rect.height / scaleY - cell.clientTop * 2;
        const radius = Math.min(right - x, bottom - y) / 2;
        const arc = `A ${radius} ${radius} 0 0 1`;
        return `M ${x + radius} ${y} H ${right - radius} ${arc} ${right} ${y + radius}`
          + ` V ${bottom - radius} ${arc} ${right - radius} ${bottom} H ${x + radius}`
          + ` ${arc} ${x} ${bottom - radius} V ${y + radius} ${arc} ${x + radius} ${y} Z`;
      });
      if (paths.length) layer.style.clipPath = `path("${paths.join(' ')}")`;
    };

    updateClip();
    const observer = new ResizeObserver(updateClip);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return <Element className="clean-series-effects" aria-hidden="true">
    <span ref={ref} className="clean-series-glint" />
    {landing && <span className="clean-series-sparks"><SparkParticles /></span>}
  </Element>;
}

export function CleanSeriesPreview() {
  return <div className="clean-series-preview" data-testid="clean-series-preview" data-clean-series="jump">
    {[0, 1, 2].map(index => <span key={index} className="arrow-slot arrow-entered">
      <ShotFace style="cards" background={zoneColor(10)} color="#111811">10</ShotFace>
    </span>)}
    <CleanSeriesEffects landing />
  </div>;
}

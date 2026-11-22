import { useState } from 'react';
import type { CSSProperties } from 'react';
import { formatAverage } from './preferences.ts';
import { zoneColor } from './target.ts';
import './shot-distribution.css';

type Zone = { score: number; count: number; label: string };
export type DistributionView = 'mosaic' | 'pie';
const mosaicLimit = 120;
const center = 110;
const outer = 104;
const inner = 58;
const point = (angle: number, radius: number) =>
  `${center + Math.cos(angle) * radius} ${center + Math.sin(angle) * radius}`;
const distributionColor = (score: number) => score % 2 === 0 ? zoneColor(score)
  : `color-mix(in srgb, ${zoneColor(score)} 74%, #78634f)`;

function ringSector(start: number, end: number) {
  const large = Number(end - start > Math.PI);
  return `M ${point(start, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(end, outer)}
    L ${point(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(start, inner)} Z`;
}

function Mosaic({ zones, total, selected, onSelect }: {
  zones: readonly Zone[]; total: number; selected: number | null; onSelect: (score: number) => void;
}) {
  // All scores remain represented when a long training is compressed to 120 tiles.
  // Quantile boundaries keep the total stable without allocating one DOM node per arrow.
  const exact = total <= mosaicLimit;
  const extra = mosaicLimit - zones.length;
  let seen = 0;
  return <div className="shot-mosaic" data-testid="shot-mosaic" aria-hidden="true" onClick={event => {
    if (event.target instanceof HTMLElement && event.target.dataset.zone !== undefined) onSelect(Number(event.target.dataset.zone));
  }}>
    {zones.flatMap(zone => {
      const before = seen;
      seen += zone.count;
      const count = exact ? zone.count : 1 + Math.round(extra * seen / total) - Math.round(extra * before / total);
      return Array.from({ length: count }, (_, index) => <span key={`${zone.score}:${index}`} data-zone={zone.score}
        data-muted={selected !== null && selected !== zone.score} style={{ background: distributionColor(zone.score) }} />);
    })}
  </div>;
}

export function ShotDistribution({ counts, total, view }: { counts: readonly number[]; total: number; view: DistributionView }) {
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  if (!total) return null;
  const zones = counts.map((count, score) => ({ count, score, label: score === 0 ? 'M' : String(score) }))
    .reverse().filter(zone => zone.count > 0);
  const selected = zones.find(zone => zone.score === selectedScore);
  function select(score: number) { setSelectedScore(previous => previous === score ? null : score); }
  const reading = <div className="shot-distribution-reading" aria-live="polite" data-testid="shot-distribution-reading">
    <span>{selected ? selected.score === 0 ? 'Промах' : `Оценка ${selected.label}` : 'Всего стрел'}</span>
    <strong>{selected ? `${selected.count} из ${total}` : total}</strong>
    {selected && <small>{formatAverage(100 * selected.count / total, false)}%</small>}
  </div>;
  let counted = 0;
  return <>
    {view === 'mosaic' ? <>
      {reading}
      <Mosaic zones={zones} total={total} selected={selected?.score ?? null} onSelect={select} />
      {total > mosaicLimit && <small className="shot-distribution-caption">Плитки показывают пропорции</small>}
    </> : <div className="shot-donut">
      <svg viewBox="0 0 220 220" aria-hidden="true" data-testid="shot-distribution-pie">
        {zones.map(zone => {
          const start = 2 * Math.PI * counted / total - Math.PI / 2;
          counted += zone.count;
          const end = 2 * Math.PI * counted / total - Math.PI / 2;
          const fill = distributionColor(zone.score);
          const label = `${zone.label} · ${zone.count}`;
          const middle = (start + end) / 2;
          return <g key={zone.score} data-muted={!!selected && selected.score !== zone.score} onClick={() => select(zone.score)}>
            {zones.length === 1 ? <circle cx={center} cy={center} r={(outer + inner) / 2} fill="none" stroke={fill} strokeWidth={outer - inner} />
              : <path d={ringSector(start, end)} fill={fill} stroke="var(--surface)" strokeWidth="1.4" />}
            {zone.count / total >= .14 && label.length <= 16 && <text transform={`translate(${point(middle, (outer + inner) / 2)})`}
              textAnchor="middle" dominantBaseline="central"
              fill={zone.score <= 0 || zone.score === 3 || zone.score === 4 ? '#fff' : '#111811'}>{label}</text>}
          </g>;
        })}
      </svg>
      {reading}
    </div>}
    <div className="shot-zone-keys" role="group" aria-label="Оценки попаданий">
      {zones.map(zone => <button type="button" key={zone.score} data-testid={`report-zone-${zone.label}`}
        style={{ '--zone-color': distributionColor(zone.score) } as CSSProperties}
        aria-label={`${zone.score === 0 ? 'Промах' : `Оценка ${zone.label}`}, стрел: ${zone.count}`}
        aria-pressed={selected?.score === zone.score} onClick={() => select(zone.score)}>{zone.label}</button>)}
    </div>
  </>;
}

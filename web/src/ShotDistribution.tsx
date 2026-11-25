import { useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import { formatAverage } from './preferences.ts';
import { zoneColor } from './target.ts';
import './shot-distribution.css';
import { useReportView } from './report-view.ts';
import { packMosaicGroups } from './mosaic-layout.ts';

type Zone = { score: number; count: number; label: string };
export type DistributionView = 'mosaic' | 'pie';
const mosaicLimit = 120;
const center = 110;
const outer = 104;
const inner = 58;
const point = (angle: number, radius: number) =>
  `${center + Math.cos(angle) * radius} ${center + Math.sin(angle) * radius}`;
const distributionColor = (score: number) => score === 10 ? 'var(--score-ten)' : score % 2 === 0 ? zoneColor(score)
  : `color-mix(in srgb, ${zoneColor(score)} 74%, #78634f)`;

function ringSector(start: number, end: number) {
  const large = Number(end - start > Math.PI);
  return `M ${point(start, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(end, outer)}
    L ${point(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(start, inner)} Z`;
}

function ringLabels(zones: readonly Zone[], total: number) {
  let angle = -Math.PI / 2;
  const sectors = zones.map(zone => {
    const start = angle;
    angle += 2 * Math.PI * zone.count / total;
    const middle = (start + angle) / 2;
    const left = Math.cos(middle) < 0;
    const fontSize = Math.min(14, Math.floor((outer + inner) * (angle - start) / (2 * zone.label.length * .8)));
    return { ...zone, start, end: angle, middle, left, fontSize, y: center + Math.sin(middle) * (outer + 15) };
  });
  for (const left of [true, false]) {
    const side = sectors.filter(sector => sector.left === left).sort((a, b) => a.y - b.y);
    let limit = -8;
    for (const sector of side) {
      sector.y = Math.max(sector.y, limit);
      limit = sector.y + 16;
    }
    limit = 228;
    for (const sector of [...side].reverse()) {
      sector.y = Math.min(sector.y, limit);
      limit = sector.y - 16;
    }
  }
  return sectors;
}

function Mosaic({ zones, total, selected, onSelect }: {
  zones: readonly Zone[]; total: number; selected: number | null; onSelect: (score: number) => void;
}) {
  const layout = useMemo(() => {
    const exact = total <= mosaicLimit;
    const extra = mosaicLimit - zones.length;
    let seen = 0;
    const weighted = zones.map(({ score, count }) => {
      const before = seen;
      seen += count;
      return { score, tiles: exact ? count : 1 + Math.round(extra * seen / total) - Math.round(extra * before / total) };
    });
    return packMosaicGroups(weighted);
  }, [zones, total]);
  const cellSize = 16;
  return <svg className="shot-mosaic" style={{ maxWidth: layout.columns * 27 }} data-testid="shot-mosaic" role="group" aria-label="Мозаика попаданий"
    viewBox={`0 0 ${layout.columns * cellSize} ${layout.rows * cellSize}`}>
    {zones.map(zone => {
      const fill = distributionColor(zone.score);
      const cells = layout.cellsByScore.get(zone.score) ?? [];
      const first = cells[0];
      return <g key={zone.score} role="button" tabIndex={0} aria-label={zoneName(zone)} aria-pressed={selected === zone.score}
        data-testid={`report-zone-${zone.label}`} data-muted={selected !== null && selected !== zone.score}
        onClick={() => onSelect(zone.score)} onKeyDown={event => activateZone(event, () => onSelect(zone.score))}>
        {cells.map(({ column, row }) => <rect key={`${column}:${row}`} aria-hidden="true"
          data-zone={zone.score} x={column * cellSize + 1} y={row * cellSize + 1} width={cellSize - 2} height={cellSize - 2}
          rx={2} fill={fill} />)}
        {first && <text aria-hidden="true" className="shot-mosaic-label" x={(first.column + .5) * cellSize} y={(first.row + .5) * cellSize}
          textAnchor="middle" dominantBaseline="central" fill={zone.score === 0 || zone.score === 3 || zone.score === 4 ? '#fff' : '#111811'}>{zone.label}</text>}
      </g>;
    })}
  </svg>;
}

const zoneName = (zone: Zone) => `${zone.score ? `Оценка ${zone.label}` : 'Промах'}, стрел: ${zone.count}`;

function activateZone(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

export function ShotDistribution({ counts, total, view, reportId, scope }: { counts: readonly number[]; total: number; view: DistributionView; reportId?: string; scope?: number | null }) {
  const [selectedScore, setSelectedScore] = useReportView<number | null>(reportId, `zone:${scope ?? 'all'}`, null);
  const zones = useMemo(() => counts.map((count, score) => ({ count, score, label: score === 0 ? 'M' : String(score) }))
    .reverse().filter(zone => zone.count > 0), [counts]);
  if (!total) return null;
  const selected = zones.find(zone => zone.score === selectedScore);
  function select(score: number) { setSelectedScore(selectedScore === score ? null : score); }
  const reading = <div className="shot-distribution-reading" aria-live="polite" data-testid="shot-distribution-reading">
    <span>{selected ? selected.score === 0 ? 'Промах' : `Оценка ${selected.label}` : 'Всего стрел'}</span>
    <strong>{selected ? `${selected.count} из ${total}` : total}</strong>
    {selected && <small>{formatAverage(100 * selected.count / total, false)}%</small>}
  </div>;
  return <>
    {view === 'mosaic' ? <>
      {reading}
      <Mosaic zones={zones} total={total} selected={selected?.score ?? null} onSelect={select} />
      {total > mosaicLimit && <small className="shot-distribution-caption">Плитки показывают пропорции</small>}
    </> : <div className="shot-donut">
      <svg viewBox="-63 -25 346 270" data-testid="shot-distribution-pie" aria-label="Распределение попаданий">
        {ringLabels(zones, total).map(zone => {
          const { start, end, middle, left, y, fontSize } = zone;
          const fill = distributionColor(zone.score);
          const x = left ? -16 : 236;
          const active = selected?.score === zone.score;
          return <g key={zone.score} role="button" tabIndex={0} aria-pressed={active}
            data-testid={`report-zone-${zone.label}`} data-muted={!!selected && !active}
            aria-label={zoneName(zone)}
            onClick={() => select(zone.score)} onKeyDown={event => activateZone(event, () => select(zone.score))}>
            {zones.length === 1 ? <circle className="shot-sector" cx={center} cy={center} r={(outer + inner) / 2} fill="none" stroke={fill} strokeWidth={outer - inner} />
              : <><path className="shot-sector" d={ringSector(start, end)} fill={fill} stroke={active ? 'var(--ink)' : 'var(--surface)'} strokeWidth={active ? 2 : 1} />
                <path d={`M ${point(start, inner)} L ${point(start, outer + 10)}`} stroke="var(--muted)" strokeWidth=".85" /></>}
            <path d={`M ${point(middle, outer + 2)} L ${point(middle, outer + 9)} L ${x} ${y}`} fill="none" stroke="var(--muted)" strokeWidth=".8" />
            <rect x={left ? x - 46 : x} y={y - 8} width="46" height="16" fill="transparent" />
            <text x={x + (left ? -3 : 3)} y={y} textAnchor={left ? 'end' : 'start'}
              dominantBaseline="central" fill="var(--ink)">{fontSize < 9 ? `${zone.label} · ${zone.count}` : zone.count}</text>
            {fontSize >= 9 && <text transform={`translate(${point(middle, (outer + inner) / 2)})`}
              textAnchor="middle" dominantBaseline="central" style={{ fontSize }}
              fill={zone.score <= 0 || zone.score === 3 || zone.score === 4 ? '#fff' : '#111811'}>{zone.label}</text>}
          </g>;
        })}
      </svg>
      {reading}
    </div>}
  </>;
}

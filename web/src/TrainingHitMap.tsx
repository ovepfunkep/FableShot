import { useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import type { Conditions } from './conditions.ts';
import { HIT_MAP_GRID_SIZE, hitCentroid, hitDensity, hitGeometry, hitMapLimit, knownHitPoints, knownMissPoints } from './hit-map.ts';
import { zoneColor } from './TargetBoard.tsx';
import { getTargetProfile, MISS_RING_WIDTH, spotOffsets, summarize, targetMapMinimum } from './target.ts';
import type { Point, Shot, TargetProfile } from './target.ts';
import { Icon } from './TrainingChrome.tsx';
import './training-hit-map.css';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';
import { clampTargetZoom, TargetZoom } from './TargetZoom.tsx';

type MapSeries = { id: number; round: number; number: number; shots: readonly Shot[] };
type MapMode = 'density' | 'points';

const densityColors = ['#d0e8d2', '#8dba97', '#417b55', '#123e28'];
const densityOpacity = .65;
const side = 260;
const center = side / 2;
const gridRadius = side * .46;
const cellSize = 2 * gridRadius / HIT_MAP_GRID_SIZE;
const millimeters = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const initialView = { zoom: 1, x: center, y: center };

function HitMapPlot({ points, misses, profile, limit, mode, density, showOffset, arrowScale }: {
  points: readonly Point[];
  misses: readonly Point[];
  profile: TargetProfile;
  limit: number;
  mode: MapMode;
  density: ReturnType<typeof hitDensity>;
  showOffset: boolean;
  arrowScale?: number;
}) {
  const radius = gridRadius / limit;
  const at = (coordinate: number) => center + coordinate * radius;
  const centroid = hitCentroid(points);
  const [view, setView] = useState(initialView);
  const currentView = useRef(initialView);
  const pointers = useRef(new Map<number, Point>());
  const span = side / view.zoom;

  function changeView(zoom: number, x: number, y: number) {
    const half = center / zoom;
    const clamp = (value: number) => Math.max(half, Math.min(side - half, value));
    const next = { zoom, x: clamp(x), y: clamp(y) };
    currentView.current = next;
    setView(next);
  }

  function trackPointer(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || pointers.current.size >= 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function movePointer(event: PointerEvent<SVGSVGElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, next);
    const current = currentView.current;
    const rect = event.currentTarget.getBoundingClientRect();
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      const zoom = clampTargetZoom(current.zoom * after / Math.max(1, before));
      const moveAxis = (origin: number, a: number, b: number, fixed: number, start: number, pixels: number) =>
        origin + ((a + fixed) / 2 - start - pixels / 2) * side / (pixels * current.zoom)
          - ((b + fixed) / 2 - start - pixels / 2) * side / (pixels * zoom);
      changeView(zoom, moveAxis(current.x, previous.x, next.x, other.x, rect.left, rect.width),
        moveAxis(current.y, previous.y, next.y, other.y, rect.top, rect.height));
    } else if (current.zoom > 1) {
      changeView(current.zoom, current.x - (next.x - previous.x) * side / (rect.width * current.zoom),
        current.y - (next.y - previous.y) * side / (rect.height * current.zoom));
    }
  }

  function forgetPointer(event: PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
  }

  return <div className="hit-map-viewport">
    <TargetZoom className="zoom hit-map-zoom" zoom={view.zoom}
      onStep={factor => changeView(clampTargetZoom(view.zoom * factor), view.x, view.y)}
      onReset={() => changeView(1, center, center)} />
    <svg viewBox={`${view.x - span / 2} ${view.y - span / 2} ${span} ${span}`} className="hit-map-plot" role="img"
    data-zoomed={view.zoom > 1}
    onPointerDown={trackPointer} onPointerMove={movePointer} onPointerUp={forgetPointer}
    onPointerCancel={forgetPointer} onLostPointerCapture={forgetPointer}
    aria-label={mode === 'density' ? 'Плотность попаданий на мишени' : 'Точки попаданий на мишени'}
    data-testid="hit-map-plot">
    {spotOffsets(profile).map(offset => <g key={offset} transform={`translate(0 ${offset * radius})`}>
    {!!misses.length && <circle cx={center} cy={center} r={radius * (profile.zones.at(-1)!.outerRadius + MISS_RING_WIDTH)}
      fill="#536052" stroke="#758175" strokeWidth={.75} />}
    {[...profile.zones].reverse().map(zone => <circle key={zone.code} cx={center} cy={center} r={radius * zone.outerRadius}
      fill={zoneColor(zone.points)} stroke="#30352c" strokeWidth={.75} />)}
    </g>)}
    {mode === 'density' ? density.cells.map(({ column, row, count }) => <rect key={`${column},${row}`}
      x={center - gridRadius + column * cellSize} y={center - gridRadius + row * cellSize} width={cellSize} height={cellSize}
      fill={densityColors[Math.ceil(count / density.peak * densityColors.length) - 1]} fillOpacity={densityOpacity} />)
      : points.map(({ x, y }, index) => <circle key={index} cx={at(x)} cy={at(y)} r={arrowScale ? radius * arrowScale : 3}
        fill="#111811" stroke="white" strokeWidth={arrowScale ? Math.min(1, radius * arrowScale / 2) : 1} />)}
    {misses.map(({ x, y }, index) => <g key={index} transform={`translate(${at(x)} ${at(y)})`} data-testid="hit-map-miss">
      <circle r={4} fill="#536052" stroke="white" strokeWidth={.8} />
      <path d="M-2-2 2 2 M2-2-2 2" fill="none" stroke="white" strokeWidth={1.1} />
    </g>)}
    {showOffset && centroid && <g fill="none">
      <circle cx={at(centroid.x)} cy={at(centroid.y)} r={7} stroke="#111811" strokeWidth={3} />
      <circle cx={at(centroid.x)} cy={at(centroid.y)} r={7} stroke="white" strokeWidth={1} />
    </g>}
    </svg>
  </div>;
}

export function TrainingHitMap({ series, conditions }: { series: readonly MapSeries[]; conditions: Conditions }) {
  const { preferences } = useTrainingPreferences();
  const visible = (feature: Parameters<typeof statisticVisible>[1]) => statisticVisible(preferences, feature);
  const titleId = useId();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<MapMode>('density');
  const [help, setHelp] = useState(false);
  const allShots = useMemo(() => series.flatMap(entry => entry.shots), [series]);
  const allPoints = useMemo(() => knownHitPoints(allShots, true), [allShots]);
  const allMisses = useMemo(() => knownMissPoints(allShots, true), [allShots]);
  const profile = getTargetProfile(conditions.targetProfileId);
  if (!series.length || !profile) return null;

  const index = series.findIndex(entry => entry.id === selectedId);
  const selected = series[index];
  const shots = selected?.shots ?? allShots;
  const points = selected ? knownHitPoints(shots, true) : allPoints;
  const misses = selected ? knownMissPoints(shots, true) : allMisses;
  const limit = hitMapLimit([...allPoints, ...allMisses], targetMapMinimum(profile));
  const density = hitDensity(points, limit);
  const geometry = hitGeometry(shots, conditions.targetDiameterMm);
  const arrowDiameter = preferences.realArrowDiameter && conditions.equipment?.arrows.diameterMm;

  return <section className="training-hit-map" aria-labelledby={titleId} data-testid="training-hit-map">
    <header>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" />
      </svg>
      <h3 id={titleId}>Карта попаданий</h3>
      <button type="button" className="hit-map-help" aria-label="О карте попаданий" onClick={() => setHelp(true)}>?</button>
    </header>
    {(visible('result') || visible('volume')) && <div className="hit-map-reading" aria-live="polite">
      {visible('result') && <span data-testid="hit-map-score">Очки <strong>{summarize(shots).points}</strong></span>}
      {visible('volume') && <span data-testid="hit-map-coverage">Координаты <strong>{points.length + misses.length} из {shots.length}</strong></span>}
    </div>}
    {allPoints.length > 0 && <div className="hit-map-modes" role="group" aria-label="Вид карты">
      <button type="button" aria-pressed={mode === 'density'} onClick={() => setMode('density')}
        data-testid="hit-map-mode-density">Плотность</button>
      <button type="button" aria-pressed={mode === 'points'} onClick={() => setMode('points')}
        data-testid="hit-map-mode-points">Попадания</button>
    </div>}
    {points.length + misses.length > 0 ? <HitMapPlot points={points} misses={misses} profile={profile} limit={limit} mode={mode} density={density}
      showOffset={!profile.vertical && visible('offset')} arrowScale={arrowDiameter ? arrowDiameter / conditions.targetDiameterMm : undefined} />
      : <p className={`hit-map-empty${allPoints.length ? ' hit-map-empty--plot' : ''}`}
        data-testid="hit-map-empty">Нет подтверждённых координат.</p>}
    <div className="hit-map-series-controls">
      <button type="button" className="icon-button" aria-label="Предыдущая серия на карте" data-testid="hit-map-previous"
        disabled={index < 0} onClick={() => setSelectedId(series[index - 1]?.id ?? null)}><Icon name="left" /></button>
      <select aria-label="Серия на карте" data-testid="hit-map-series" value={selected?.id ?? ''}
        onChange={event => setSelectedId(event.target.value === '' ? null : Number(event.target.value))}>
        <option value="">Все серии</option>
        {series.map(entry => <option key={entry.id} value={entry.id}>Раунд {entry.round} · Серия {entry.number}</option>)}
      </select>
      <button type="button" className="icon-button" aria-label="Следующая серия на карте" data-testid="hit-map-next"
        disabled={index >= series.length - 1} onClick={() => setSelectedId(series[index + 1].id)}><Icon name="right" /></button>
    </div>
    {mode === 'density' && density.peak > 0 && <div className="hit-map-legend">
      <div className="hit-map-density-bands" aria-hidden="true">
        {densityColors.map((color, index) => <span key={color}>
          <i style={{ backgroundColor: color, opacity: densityOpacity }} />
          {index * 25}–{(index + 1) * 25}%
        </span>)}
      </div>
      <span>Темнее — чаще.{visible('volume') && ` Максимум в ячейке ${density.peak}.`}</span>
    </div>}
    {geometry && (visible('offset') || (selected && visible('grouping') && geometry.rmsMm !== null)) && <div className="hit-map-reading" aria-live="polite">
      {visible('grouping') && selected && geometry.rmsMm !== null && <span data-testid="hit-map-rms">Разброс RMS <strong>{millimeters.format(geometry.rmsMm)} мм</strong></span>}
      {visible('offset') && <span data-testid="hit-map-shift">Смещение <strong>{millimeters.format(geometry.shiftMm)} мм</strong></span>}
    </div>}
    {help && <BottomSheet title="Карта попаданий" onClose={() => setHelp(false)}>
      <p>Крестики показывают промахи, отмеченные в кольце вокруг мишени. Они не входят в плотность, кучность и смещение.</p>
      <p>Измерения используют зачётные попадания с известными координатами.
        {profile.vertical ? ' Для светофора разброс и смещение считаются относительно центра каждого круга.' : ' Белое кольцо отмечает среднюю точку. Смещение — расстояние от центра мишени до средней точки.'}
        RMS измеряет разброс вокруг средней точки и рассчитывается при наличии трёх или более координат.</p>
      <p>Плотность показывает количество отмеченных попаданий в ячейках сетки {HIT_MAP_GRID_SIZE} × {HIT_MAP_GRID_SIZE}.
        Цвет ячейки зависит от её доли от максимума для выбранных серий.</p>
    </BottomSheet>}
  </section>;
}

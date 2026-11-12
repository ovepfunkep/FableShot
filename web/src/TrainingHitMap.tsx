import { useId, useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import type { Conditions } from './conditions.ts';
import { HIT_MAP_GRID_SIZE, hitCentroid, hitDensity, hitGeometry, hitMapLimit, knownHitPoints, knownMissPoints } from './hit-map.ts';
import { zoneColor } from './TargetBoard.tsx';
import { getTargetProfile, MISS_RING_WIDTH, summarize } from './target.ts';
import type { Point, Shot, TargetProfile } from './target.ts';
import { Icon } from './TrainingChrome.tsx';
import './training-hit-map.css';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';

type MapSeries = { id: number; round: number; number: number; shots: readonly Shot[] };
type MapMode = 'density' | 'points';

const densityColors = ['#d0e8d2', '#8dba97', '#417b55', '#123e28'];
const densityOpacity = .65;
const side = 260;
const center = side / 2;
const gridRadius = side * .46;
const cellSize = 2 * gridRadius / HIT_MAP_GRID_SIZE;
const millimeters = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function HitMapPlot({ points, misses, profile, limit, mode, density, showOffset }: {
  points: readonly Point[];
  misses: readonly Point[];
  profile: TargetProfile;
  limit: number;
  mode: MapMode;
  density: ReturnType<typeof hitDensity>;
  showOffset: boolean;
}) {
  const radius = gridRadius / limit;
  const at = (coordinate: number) => center + coordinate * radius;
  const centroid = hitCentroid(points);

  return <svg viewBox={`0 0 ${side} ${side}`} className="hit-map-plot" role="img"
    aria-label={mode === 'density' ? 'Плотность попаданий на мишени' : 'Точки попаданий на мишени'}
    data-testid="hit-map-plot">
    {!!misses.length && <circle cx={center} cy={center} r={radius * (profile.zones.at(-1)!.outerRadius + MISS_RING_WIDTH)}
      fill="#536052" stroke="#758175" strokeWidth={.75} />}
    {[...profile.zones].reverse().map(zone => <circle key={zone.code} cx={center} cy={center} r={radius * zone.outerRadius}
      fill={zoneColor(zone.points)} stroke="#30352c" strokeWidth={.75} />)}
    {mode === 'density' ? density.cells.map(({ column, row, count }) => <rect key={`${column},${row}`}
      x={center - gridRadius + column * cellSize} y={center - gridRadius + row * cellSize} width={cellSize} height={cellSize}
      fill={densityColors[Math.ceil(count / density.peak * densityColors.length) - 1]} fillOpacity={densityOpacity} />)
      : points.map(({ x, y }, index) => <circle key={index} cx={at(x)} cy={at(y)} r={3}
        fill="#111811" stroke="white" strokeWidth={1} />)}
    {misses.map(({ x, y }, index) => <g key={index} transform={`translate(${at(x)} ${at(y)})`} data-testid="hit-map-miss">
      <circle r={4} fill="#536052" stroke="white" strokeWidth={.8} />
      <path d="M-2-2 2 2 M2-2-2 2" fill="none" stroke="white" strokeWidth={1.1} />
    </g>)}
    {showOffset && centroid && <g fill="none">
      <circle cx={at(centroid.x)} cy={at(centroid.y)} r={7} stroke="#111811" strokeWidth={3} />
      <circle cx={at(centroid.x)} cy={at(centroid.y)} r={7} stroke="white" strokeWidth={1} />
    </g>}
  </svg>;
}

export function TrainingHitMap({ series, conditions }: { series: readonly MapSeries[]; conditions: Conditions }) {
  const { preferences } = useTrainingPreferences();
  const visible = (feature: Parameters<typeof statisticVisible>[1]) => statisticVisible(preferences, feature);
  const titleId = useId();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<MapMode>('density');
  const [help, setHelp] = useState(false);
  const allShots = useMemo(() => series.flatMap(entry => entry.shots), [series]);
  const allPoints = useMemo(() => knownHitPoints(allShots), [allShots]);
  const allMisses = useMemo(() => knownMissPoints(allShots), [allShots]);
  const profile = getTargetProfile(conditions.targetProfileId);
  if (!series.length || !profile) return null;

  const index = series.findIndex(entry => entry.id === selectedId);
  const selected = series[index];
  const shots = selected?.shots ?? allShots;
  const points = selected ? knownHitPoints(shots) : allPoints;
  const misses = selected ? knownMissPoints(shots) : allMisses;
  const limit = hitMapLimit([...allPoints, ...allMisses]);
  const density = hitDensity(points, limit);
  const geometry = hitGeometry(shots, conditions.targetDiameterMm);

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
    {points.length + misses.length > 0 ? <HitMapPlot points={points} misses={misses} profile={profile} limit={limit} mode={mode} density={density} showOffset={visible('offset')} />
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
        Белое кольцо отмечает среднюю точку. Смещение — расстояние от центра мишени до средней точки.
        RMS измеряет разброс вокруг средней точки и рассчитывается при наличии трёх или более координат.</p>
      <p>Плотность показывает количество отмеченных попаданий в ячейках сетки {HIT_MAP_GRID_SIZE} × {HIT_MAP_GRID_SIZE}.
        Цвет ячейки зависит от её доли от максимума для выбранных серий.</p>
    </BottomSheet>}
  </section>;
}

import { useId, useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { buildNumberedArrowAnalysis, numberedArrowMapExtent } from './numbered-arrow-analysis.ts';
import type { NumberedArrowGroup, NumberedArrowSeries } from './numbered-arrow-analysis.ts';
import { formatAverage } from './preferences.ts';
import { statisticVisible } from './statistics-visibility.ts';
import { getTargetProfile } from './target.ts';
import { zoneColor } from './TargetBoard.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './numbered-arrow-analysis.css';

const colors = ['#005a9c', '#c34700', '#007c6d', '#8c3d99', '#9a6600', '#b02d50', '#445569', '#476c00'];
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const side = 260;
const center = side / 2;

function ArrowComparison({ group }: { group: NumberedArrowGroup }) {
  const { preferences } = useTrainingPreferences();
  const [number, setNumber] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const showGrouping = statisticVisible(preferences, 'grouping');
  const showOffset = statisticVisible(preferences, 'offset');
  const showAverage = statisticVisible(preferences, 'average');
  const showVolume = statisticVisible(preferences, 'volume');
  const radiusMm = group.conditions.targetDiameterMm / 2;
  const scale = (center - 10) / numberedArrowMapExtent(group, showGrouping);
  const at = (coordinate: number) => center + scale * coordinate;
  const profile = getTargetProfile(group.conditions.targetProfileId)!;
  const arrows = group.arrows.map((arrow, index) => ({ ...arrow, color: colors[index % colors.length] }));
  const selected = arrows.find(arrow => arrow.number === number);
  const shown = selected ? [selected] : arrows;
  const details = showAverage || showVolume || shown.some(arrow =>
    (showGrouping && arrow.rmsMm !== null) || (showOffset && arrow.shiftMm !== null));

  return <>
    <div className="numbered-arrow-filters" role="group" aria-label="Номер стрелы">
      <button type="button" aria-pressed={!selected} data-testid="numbered-arrow-all" onClick={() => setNumber(null)}>Все</button>
      {arrows.map(arrow => <button key={arrow.number} type="button" aria-pressed={selected?.number === arrow.number}
        aria-label={`Стрела №${arrow.number}`} data-testid={`numbered-arrow-${arrow.number}`} onClick={() => setNumber(arrow.number)}>
        <i aria-hidden="true" style={{ backgroundColor: arrow.color }} />№{arrow.number}
      </button>)}
    </div>
    {shown.some(arrow => arrow.points.length) ? <svg viewBox={`0 0 ${side} ${side}`} className="numbered-arrow-plot" role="img"
      aria-label={selected ? `Попадания стрелы №${selected.number}` : 'Попадания всех номерных стрел'} data-testid="numbered-arrow-plot">
      {[...profile.zones].reverse().map(zone => <circle key={zone.code} cx={center} cy={center} r={scale * zone.outerRadius}
        fill={zoneColor(zone.points)} stroke="#30352c" strokeWidth=".75" />)}
      {showGrouping && shown.map(arrow => arrow.centroid && arrow.rmsMm !== null && <circle key={arrow.number}
        cx={at(arrow.centroid.x)} cy={at(arrow.centroid.y)} r={scale * arrow.rmsMm / radiusMm}
        fill={arrow.color} fillOpacity=".18" stroke={arrow.color} strokeOpacity=".7" strokeWidth="1.25" data-testid="numbered-arrow-rms-circle" />)}
      {shown.flatMap(arrow => arrow.points.map((point, index) => <circle key={`${arrow.number}:${index}`}
        cx={at(point.x)} cy={at(point.y)} r="3.4" fill={arrow.color} stroke="white" strokeWidth="1.35" data-testid="numbered-arrow-point" />))}
    </svg> : <p className="numbered-arrow-empty" data-testid="numbered-arrow-empty">Нет попаданий с известными координатами.</p>}
    {details && <button className="numbered-arrow-details-toggle" type="button" aria-expanded={expanded} aria-controls={detailsId}
      data-testid="numbered-arrow-details" onClick={() => setExpanded(!expanded)}>{expanded ? 'Скрыть подробности' : 'Подробнее'}</button>}
    {details && <ul className="numbered-arrow-details" id={detailsId} hidden={!expanded}>
      {shown.map(arrow => <li key={arrow.number}>
        <strong>Стрела №{arrow.number}</strong>
        <dl>
          {showVolume && <div><dt>Выстрелы</dt><dd>{arrow.shotCount}</dd></div>}
          {showAverage && <div><dt>Средний балл</dt><dd>{formatAverage(arrow.average, preferences.averageHundredths)}</dd></div>}
          {showGrouping && arrow.rmsMm !== null && <div><dt>Кучность RMS</dt><dd>{decimal.format(arrow.rmsMm)} мм</dd></div>}
          {showOffset && arrow.shiftMm !== null && <div><dt>Смещение</dt><dd>{decimal.format(arrow.shiftMm)} мм</dd></div>}
        </dl>
      </li>)}
    </ul>}
  </>;
}

export function NumberedArrowAnalysis({ series }: { series: readonly NumberedArrowSeries[] }) {
  const { preferences } = useTrainingPreferences();
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const titleId = useId();
  const enabled = statisticVisible(preferences, 'numbered_arrows');
  const groups = useMemo(() => enabled ? buildNumberedArrowAnalysis(series) : [], [series, enabled]);
  const selected = groups.find(group => group.key === requestedKey) ?? groups[0];
  if (!selected) return null;

  return <section className="numbered-arrow-analysis" aria-labelledby={titleId} data-testid="numbered-arrow-analysis">
    <header>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 19 19 5m-7 0h7v7M5 19v-6m0 6h6" />
      </svg>
      <h3 id={titleId}>По номерам стрел</h3>
      <button type="button" className="numbered-arrow-help" aria-label="Об анализе по номерам стрел" onClick={() => setHelp(true)}>?</button>
    </header>
    {groups.length > 1 && <select value={selected.key} aria-label="Условия для сравнения стрел" data-testid="numbered-arrow-conditions"
      onChange={event => setRequestedKey(event.target.value)}>
      {groups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
    </select>}
    <ArrowComparison key={selected.key} group={selected} />
    {help && <BottomSheet title="По номерам стрел" onClose={() => setHelp(false)}>
      <p>Сравнение учитывает выстрелы из одного сохранённого набора при одинаковых условиях. Цвет обозначает номер стрелы. Точки показывают известные координаты, а круг RMS — разброс вокруг средней точки.</p>
      <p>Для расчёта разброса и смещения нужны минимум три координаты одной стрелы.</p>
    </BottomSheet>}
  </section>;
}

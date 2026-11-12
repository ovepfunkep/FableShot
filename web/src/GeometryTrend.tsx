import { useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import type { TimelineGroup } from './progress-timeline.ts';
import { statisticVisible } from './statistics-visibility.ts';
import { Icon } from './TrainingChrome.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './geometry-trend.css';

const measures = [
  { key: 'rms', field: 'rmsMm', feature: 'grouping', chip: 'Разброс', title: 'Разброс RMS' },
  { key: 'offset', field: 'shiftMm', feature: 'offset', chip: 'Смещение', title: 'Смещение от центра' },
] as const;
const dateLabel = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: 'UTC' });
const date = (value: string) => dateLabel.format(new Date(`${value}T00:00:00Z`));
const number = (value: number, digits = 1) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const WINDOW = 12;
const NOISE = 1e-9;

export function GeometryTrend({ group }: { group: TimelineGroup }) {
  const { preferences } = useTrainingPreferences();
  const [requested, setRequested] = useState<'rms' | 'offset'>('rms');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const available = measures.filter(measure => statisticVisible(preferences, measure.feature));
  if (!statisticVisible(preferences, 'geometry_trend') || !available.length) return null;

  const measure = available.find(item => item.key === requested) ?? available[0];
  const showVolume = statisticVisible(preferences, 'volume');
  const eligible = group.points.flatMap(point => point.geometry ? [{ ...point, known: point.geometry.known, mm: point.geometry[measure.field] }] : []);
  const shown = eligible.slice(-WINDOW);
  const ceiling = Math.max(1, Math.ceil(Math.max(0, ...shown.map(point => point.mm)) - NOISE));
  const selected = shown.find(point => point.id === selectedId) ?? shown.at(-1);
  const index = selected ? shown.indexOf(selected) : -1;
  const first = eligible[0], latest = eligible.at(-1);
  const difference = latest && first ? latest.mm - first.mm : 0;
  const signedDifference = Math.abs(difference) < NOISE ? 0 : difference;
  const percent = first && first.mm > NOISE ? 100 * signedDifference / first.mm : null;
  const x = (position: number) => shown.length === 1 ? 50 : 5 + 90 * position / (shown.length - 1);
  const y = (value: number) => 94 - 88 * Math.min(1, value / ceiling);

  return <section className="progress-timeline geometry-trend journal-tab-panel"
    aria-label="Кучность и точность по занятиям" data-testid="geometry-trend">
    <header>
      <Icon name="stats" />
      <h2>Кучность и точность по занятиям</h2>
      <button type="button" className="progress-timeline-help" aria-label="О кучности и точности" onClick={() => setHelp(true)}>?</button>
    </header>
    <p className="progress-timeline-condition-label">{group.label}</p>
    <div className="progress-timeline-metrics" role="group" aria-label="Показатель кучности">
      {available.map(item => <button type="button" key={item.key} aria-pressed={measure.key === item.key}
        data-testid={`geometry-trend-${item.key}`} onClick={() => setRequested(item.key)}>{item.chip}</button>)}
    </div>
    {showVolume && <p className="geometry-trend-caption" data-testid="geometry-trend-coverage">Учтено занятий: {eligible.length} из {group.points.length}</p>}
    {selected ? <>
      <div className="geometry-trend-chart-heading">
        <strong>{measure.title}</strong><span data-testid="geometry-trend-scale">0–{number(ceiling)} мм</span>
      </div>
      <div className="geometry-trend-plot">
        <div className="geometry-trend-scale" aria-hidden="true">
          {[ceiling, ceiling / 2, 0].map(tick => <span key={tick}>{number(tick)}</span>)}
        </div>
        <div className="geometry-trend-points" role="group" aria-label={`${measure.title}, от 0 до ${number(ceiling)} мм`} data-testid="geometry-trend-chart">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {[6, 50, 94].map(level => <line key={level} x1="5" x2="95" y1={level} y2={level} className="progress-timeline-grid" />)}
            {shown.length > 1 && <polyline className="progress-timeline-line"
              points={shown.map((point, position) => `${x(position)},${y(point.mm)}`).join(' ')} />}
            <line x1={x(index)} x2={x(index)} y1="6" y2="94" className="geometry-trend-guide" />
          </svg>
          {shown.map((point, position) => <button type="button" key={point.id} aria-pressed={point.id === selected.id}
            aria-label={`${date(point.date)} · ${point.title} · ${number(point.mm, 2)} мм`}
            style={{ left: `${x(position)}%`, top: `${y(point.mm)}%` }}
            onClick={() => setSelectedId(point.id)} data-testid="geometry-trend-point" />)}
        </div>
      </div>
      {shown.length > 1 && <p className="geometry-trend-caption">{date(shown[0].date)} — {date(shown.at(-1)!.date)}
        {showVolume && eligible.length > shown.length && ` · ${shown.length} из ${eligible.length}`}</p>}
      <div className="geometry-trend-reading" data-testid="geometry-trend-selection" aria-live="polite">
        <button type="button" aria-label="Предыдущее занятие" disabled={index <= 0} data-testid="geometry-trend-prev"
          onClick={() => setSelectedId(shown[index - 1].id)}><Icon name="back" /></button>
        <div>
          <strong data-testid="geometry-trend-selected-value">{number(selected.mm, 2)} мм</strong>
          <span data-testid="geometry-trend-selected-session">{date(selected.date)} · {selected.title}</span>
          {showVolume && <small>Координаты {selected.known} из {selected.arrows}</small>}
        </div>
        <button type="button" aria-label="Следующее занятие" disabled={index >= shown.length - 1} data-testid="geometry-trend-next"
          onClick={() => setSelectedId(shown[index + 1].id)}><Icon name="right" /></button>
      </div>
      {eligible.length >= 2 && <div className="geometry-trend-comparison">
        <span>Последнее <strong data-testid="geometry-trend-latest">{number(latest!.mm)} мм</strong></span>
        <span>От первого к последнему <strong data-testid="geometry-trend-change">{signedDifference === 0 ? 'без изменений' :
          `${signedDifference > 0 ? '+' : '−'}${number(Math.abs(signedDifference))} мм`}
          {percent !== null && signedDifference !== 0 && ` · ${percent > 0 ? '+' : ''}${number(percent)}%`}</strong></span>
      </div>}
    </> : <p className="geometry-trend-caption" data-testid="geometry-trend-empty">Для динамики пока недостаточно подтверждённых координат.</p>}
    {help && <BottomSheet title="Кучность и точность по занятиям" tag="geometry-trend-help" onClose={() => setHelp(false)}>
      <p>Разброс RMS показывает, насколько плотно лежат попадания, а смещение — насколько центр группы далёк от центра мишени. Меньшее значение лучше. Для каждого занятия нужны хотя бы три подтверждённые координаты.</p>
      <p>График показывает до 12 последних занятий при выбранных условиях. Расстояние между точками обозначает порядок занятий. Сравнение первого и последнего учитывает весь выбранный период. Если координаты есть только у части стрел, показатели рассчитаны по этой части.</p>
    </BottomSheet>}
  </section>;
}

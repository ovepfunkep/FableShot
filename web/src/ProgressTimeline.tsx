import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DiaryEntry } from './persistence.ts';
import { formatAverage } from './preferences.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { BottomSheet } from './ConditionsScreen.tsx';
import { availableTimelineMetrics, buildProgressTimeline, DEFAULT_PROGRESS_FILTERS, filterProgressEntries, progressPeriodRange, TIMELINE_METRICS, TIMELINE_VISIBLE_DAYS, timelineCeiling, timelineDate, timelineViewport } from './progress-timeline.ts';
import type { ProgressFilters, ProgressPeriod, TimelineGroup, TimelineMetric } from './progress-timeline.ts';
import './progress-timeline.css';

const DAY = 86_400_000;
const dateLabel = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const label = (day: number, full = false) => (full ? fullDate : dateLabel).format(new Date(Math.floor(day) * DAY));
function Arrow({ previous }: { previous?: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={previous ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'} /></svg>;
}

function TimelinePlot({ group, metric }: { group: TimelineGroup; metric: TimelineMetric }) {
  const { preferences } = useTrainingPreferences();
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320), [scrollLeft, setScrollLeft] = useState(0), [selectedId, setSelectedId] = useState<string | null>(null);
  const points = group.points.filter(point => point.values[metric] !== null);
  const bounds = timelineViewport(points), ceiling = timelineCeiling(points, metric);
  const trackWidth = Math.max(width, (bounds.latestEnd - bounds.firstDay) / TIMELINE_VISIBLE_DAYS * width);
  const start = bounds.firstDay + scrollLeft / width * TIMELINE_VISIBLE_DAYS, end = start + TIMELINE_VISIBLE_DAYS;
  const visible = points.filter(point => point.x >= start && point.x <= end);
  const selected = visible.find(point => point.id === selectedId) ?? visible.at(-1);
  const definition = TIMELINE_METRICS.find(item => item.key === metric)!;
  const x = (day: number) => (day - bounds.firstDay) / TIMELINE_VISIBLE_DAYS * width;
  const y = (value: number) => 148 - value / ceiling * 128;
  function format(value: number) {
    return metric === 'average' ? formatAverage(value, preferences.averageHundredths) :
      value.toLocaleString('ru-RU', { maximumFractionDigits: metric === 'cg3' ? 2 : 1 });
  }
  useLayoutEffect(() => {
    const node = scroller.current; if (!node) return;
    const measure = () => setWidth(Math.max(1, node.clientWidth));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = scroller.current; if (!node) return;
    node.scrollLeft = Math.max(0, trackWidth - width); setScrollLeft(node.scrollLeft);
  }, [width, trackWidth]);
  function pan(direction: number) {
    const node = scroller.current; if (!node) return;
    node.scrollLeft = Math.min(trackWidth - width, Math.max(0, node.scrollLeft + direction * width));
    setScrollLeft(node.scrollLeft);
  }
  return <>
    <div className="progress-timeline-range" data-testid="progress-trend-range">{label(start, true)} — {label(end - 1, true)}</div>
    <div className="progress-timeline-plot">
      <div className="progress-timeline-scale" aria-hidden="true">{[ceiling, ceiling / 2, 0].map(value => <span key={value}>{value.toLocaleString('ru-RU')}</span>)}</div>
      <div className="progress-timeline-scroll" ref={scroller} tabIndex={0} role="region" aria-label={`График: ${definition.label}. Стрелки влево и вправо перемещают на 30 дней.`}
        data-testid="progress-trend-chart" onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); pan(event.key === 'ArrowLeft' ? -1 : 1); } }}>
        <svg className="progress-timeline-svg" width={trackWidth} height="184" viewBox={`0 0 ${trackWidth} 184`} role="group" aria-label={definition.label}>
          {[0, ceiling / 2, ceiling].map(value => <line key={value} x1="0" x2={trackWidth} y1={y(value)} y2={y(value)} className="progress-timeline-grid" />)}
          {group.comparable && visible.length > 1 && <polyline className="progress-timeline-line" points={visible.map(point => `${x(point.x)},${y(point.values[metric]!)}`).join(' ')} />}
          {visible.map(point => <g key={point.id} role="button" tabIndex={0} aria-label={`${label(point.day, true)} · ${point.title}: ${format(point.values[metric]!)} ${definition.unit}`}
            aria-pressed={selected?.id === point.id} onClick={() => setSelectedId(point.id)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(point.id); } }}>
            <circle cx={x(point.x)} cy={y(point.values[metric]!)} r="14" className="progress-timeline-hit" />
            <circle cx={x(point.x)} cy={y(point.values[metric]!)} r={selected?.id === point.id ? 5 : 3.5} className={selected?.id === point.id ? 'progress-timeline-dot selected' : 'progress-timeline-dot'} />
          </g>)}
          {[start, start + 15, end - 1].map((day, index) => <text key={index} x={x(day) + (index === 0 ? 3 : index === 2 ? -3 : 0)} y="175" textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}>{label(day)}</text>)}
        </svg>
      </div>
      <button type="button" className="progress-timeline-pan previous" aria-label="Раньше на 30 дней" disabled={scrollLeft <= 1} onClick={() => pan(-1)}><Arrow previous /></button>
      <button type="button" className="progress-timeline-pan next" aria-label="Позже на 30 дней" disabled={scrollLeft >= trackWidth - width - 1} onClick={() => pan(1)}><Arrow /></button>
    </div>
    <div className="progress-timeline-selected" aria-live="polite" data-testid="progress-trend-value">
      {selected ? <><span><time dateTime={selected.date}>{label(selected.day, true)}</time><small>{selected.title}</small></span>
        <strong>{format(selected.values[metric]!)} <small>{definition.unit}</small></strong></> : <span>В этом отрезке нет результатов. Пролистай график к тренировкам.</span>}
    </div>
  </>;
}

export function ProgressTimeline({ groups }: { groups: readonly TimelineGroup[] }) {
  const { preferences } = useTrainingPreferences();
  const [requestedMetric, setMetric] = useState<TimelineMetric>('average');
  const [help, setHelp] = useState(false);
  const supported = groups.filter(group => availableTimelineMetrics(group, preferences).length > 0);
  const group = supported[0];
  if (!group) return null;
  const metrics = availableTimelineMetrics(group, preferences), metric = metrics.includes(requestedMetric) ? requestedMetric : metrics[0];
  return <section className="progress-timeline journal-tab-panel" aria-label="Динамика прогресса" data-testid="progress-trend">
    <header><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 4v16h16M7 15l4-5 4 2 5-7" /></svg><h2>Динамика прогресса</h2>
      <button type="button" className="progress-timeline-help" aria-label="О динамике прогресса" onClick={() => setHelp(true)}>?</button>
    </header>
    <p className="progress-timeline-condition-label">{group.label}</p>
    <div className="progress-timeline-metrics" role="group" aria-label="Показатель графика">
      {TIMELINE_METRICS.filter(item => metrics.includes(item.key)).map(item => <button type="button" key={item.key} aria-pressed={metric === item.key}
        data-testid={`progress-trend-${item.key}`} onClick={() => setMetric(item.key)}>{item.label}</button>)}
    </div>
    <TimelinePlot key={`${group.key}:${metric}`} group={group} metric={metric} />
    {help && <BottomSheet title="Динамика прогресса" onClose={() => setHelp(false)} tag="progress-trend-help">
      <p className="round-help">Каждая точка — сохранённая тренировка при выбранных условиях. На экране 30 дней; листай график вбок, чтобы увидеть всю историю. Нажми на точку для точного значения. RMS — разброс отмеченных попаданий в миллиметрах; меньше — плотнее. Для RMS нужны три отметки. Десятки включают X. CG3 доступен для полных серий с достаточными координатами. При неизвестном классе лука тренировки показаны отдельно.</p>
    </BottomSheet>}
  </section>;
}

export function ProgressFiltersSheet({ entries, value, onApply, onClose }: {
  entries: readonly DiaryEntry[]; value: ProgressFilters; onApply: (next: ProgressFilters) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [choosing, setChoosing] = useState(false);
  const [visible, setVisible] = useState(40);
  const range = progressPeriodRange(draft);
  const dated = useMemo(() => filterProgressEntries(entries, { ...DEFAULT_PROGRESS_FILTERS, period: draft.period, from: draft.from, to: draft.to })
    .sort((a, b) => (timelineDate(b) ?? '').localeCompare(timelineDate(a) ?? '') || a.id.localeCompare(b.id)),
  [entries, draft.period, draft.from, draft.to]);
  const selected = new Set(draft.sessionIds ?? dated.map(entry => entry.id));
  const conditionEntries = useMemo(() => filterProgressEntries(entries, { ...draft, conditionKey: null }),
    [entries, draft.period, draft.from, draft.to, draft.sessionIds]);
  const groups = useMemo(() => buildProgressTimeline(conditionEntries), [conditionEntries]);
  const count = filterProgressEntries(entries, draft).length;
  const periods: readonly [ProgressPeriod, string][] = [[0, 'Всё время'], [7, '7 дней'], [30, '30 дней'], [90, '90 дней'], [-1, 'Свои даты']];

  return <BottomSheet title="Критерии прогресса" tag="progress-filter-sheet" onClose={onClose}>
    <form className="progress-filter-form" onSubmit={event => { event.preventDefault(); if (range.valid) onApply(draft); }}>
      <div className="progress-timeline-metrics" role="group" aria-label="Период">
        {periods.map(([period, title]) => <button type="button" key={period} aria-pressed={draft.period === period}
          data-testid={`analytics-period-${period}`} onClick={() => setDraft(current => ({ ...current, period }))}>{title}</button>)}
      </div>
      {draft.period === -1 && <>
        <div className="progress-filter-dates">
          <label>С даты<input type="date" value={draft.from} data-testid="analytics-from" aria-invalid={!range.valid}
            onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></label>
          <label>По дату<input type="date" value={draft.to} data-testid="analytics-to" aria-invalid={!range.valid}
            onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} /></label>
        </div>
        {!range.valid && <p className="progress-filter-error" role="alert">Укажи обе даты. Начало должно быть не позже окончания.</p>}
      </>}
      <label>Сопоставимые условия
        <select className="progress-timeline-conditions" aria-label="Сопоставимые условия" value={draft.conditionKey ?? ''}
          data-testid="analytics-conditions" onChange={event => setDraft(current => ({ ...current, conditionKey: event.target.value || null }))}>
          <option value="">Все условия</option>
          {draft.conditionKey && !groups.some(group => group.key === draft.conditionKey) &&
            <option value={draft.conditionKey}>Выбранные условия · нет результатов</option>}
          {groups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
        </select>
      </label>
      <div className="progress-filter-actions">
        <button type="button" data-testid="analytics-choose" aria-expanded={choosing}
          onClick={() => setChoosing(current => !current)}>{draft.sessionIds === null ? 'Выбрать тренировки' : `Выбрано ${count}`}</button>
        {draft.sessionIds !== null && <button type="button" data-testid="analytics-reset" onClick={() => setDraft(current => ({ ...current, sessionIds: null }))}>Все в периоде</button>}
      </div>
      {choosing && <fieldset className="progress-filter-sessions">
        <legend>Тренировки в периоде</legend>
        <div className="progress-filter-actions">
          <button type="button" onClick={() => setDraft(current => ({ ...current, sessionIds: dated.map(entry => entry.id) }))}>Все</button>
          <button type="button" onClick={() => setDraft(current => ({ ...current, sessionIds: [] }))}>Снять выбор</button>
        </div>
        {dated.length === 0 && <p>В этом периоде нет завершённых тренировок.</p>}
        {dated.slice(0, visible).map(entry => <label className="progress-filter-session" key={entry.id}>
          <input type="checkbox" checked={selected.has(entry.id)} data-testid={`analytics-session-${entry.id}`}
            onChange={event => {
              const ids = new Set(draft.sessionIds ?? dated.map(item => item.id));
              if (event.target.checked) ids.add(entry.id); else ids.delete(entry.id);
              setDraft(current => ({ ...current, sessionIds: [...ids] }));
            }} />
          <span>{entry.title || 'Тренировка'}<small>{timelineDate(entry) ?? 'Дата неизвестна'}</small></span>
        </label>)}
        {dated.length > visible && <button type="button" className="text-action" onClick={() => setVisible(current => current + 40)}>Показать ещё</button>}
      </fieldset>}
      <p className="progress-filter-count" data-testid="analytics-count">Завершённых занятий {count}</p>
      <details className="progress-filter-help"><summary>Как выбрать данные</summary>
        <p>Период включает обе даты. Занятия с неизвестной датой доступны за всё время. Ручной выбор сохраняется при смене периода. График показывает 30 дней и листается вбок. При выборе условий в расчёты входят соответствующие серии.</p>
      </details>
      <button type="button" className="text-action" onClick={() => { setDraft(DEFAULT_PROGRESS_FILTERS); setChoosing(false); }}>Сбросить фильтры</button>
      <div className="progress-filter-actions">
        <button type="button" onClick={onClose}>Отмена</button>
        <button type="submit" className="primary" data-testid="analytics-apply" disabled={!range.valid}>Показать результаты</button>
      </div>
    </form>
  </BottomSheet>;
}

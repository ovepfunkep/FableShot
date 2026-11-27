import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DiaryEntry } from './persistence.ts';
import { formatAverage } from './preferences.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { BottomSheet } from './ConditionsScreen.tsx';
import { availableTimelineMetrics, buildProgressTimeline, DEFAULT_PROGRESS_FILTERS, filterProgressEntries, progressPeriodRange, TIMELINE_METRICS, TIMELINE_VISIBLE_DAYS, timelineComparison, timelineDate, timelineViewport } from './progress-timeline.ts';
import { chartLabel, chartScale, rankAverageScale } from './chart-metrics.ts';
import { progressTone } from './progress-scoring.ts';
import type { ProgressFilters, ProgressPeriod, TimelineGroup, TimelineMetric } from './progress-timeline.ts';
import { ChoicePicker } from './ChoicePicker.tsx';
import { StatisticRules } from './StatisticRules.tsx';
import { useChartScrub } from './useChartScrub.ts';
import './progress-timeline.css';

const DAY = 86_400_000;
const dateLabel = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const label = (day: number, full = false) => (full ? fullDate : dateLabel).format(new Date(Math.floor(day) * DAY));
function TimelinePlot({ group, metric, onOpen, selectedId, onSelect, focusId }: {
  group: TimelineGroup; metric: TimelineMetric; onOpen: (id: string) => void;
  selectedId: string | null; onSelect: (id: string) => void; focusId: string | null;
}) {
  const { preferences } = useTrainingPreferences();
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320), [scrollLeft, setScrollLeft] = useState(0);
  const points = group.points.filter(point => point.values[metric] !== null);
  const bounds = timelineViewport(group.points);
  const trackWidth = Math.max(width, (bounds.latestEnd - bounds.firstDay) / TIMELINE_VISIBLE_DAYS * width);
  const start = bounds.firstDay + scrollLeft / width * TIMELINE_VISIBLE_DAYS, end = start + TIMELINE_VISIBLE_DAYS;
  const visible = points.filter(point => point.x >= start && point.x <= end);
  const compatible = (point: TimelineGroup['points'][number], prior: TimelineGroup['points'][number]) =>
    (group.comparable || !!point.comparisonKey && point.comparisonKey === prior.comparisonKey) &&
    (metric !== 'rank' || point.rank?.exercise.id === prior.rank?.exercise.id);
  let sum = 0, count = 0;
  const cumulative = group.points.map((point, index) => {
    const value = point.values[metric], prior = group.points[index - 1];
    const joins = !!(prior && prior.values[metric] !== null && compatible(point, prior));
    if (!joins) { sum = 0; count = 0; }
    if (value === null) return null;
    const weight = metric === 'rank' ? point.rank!.entered : metric === 'average' || metric.endsWith('Share') ? point.arrows : 1;
    sum += value * weight; count += weight;
    return count ? { value: sum / count, joins } : null;
  });
  const chartValues = [
    ...visible.map(point => point.values[metric]!),
    ...cumulative.flatMap((point, i) => point && group.points[i].x >= start && group.points[i].x <= end ? [point.value] : []),
  ];
  const exercises = new Map(visible.flatMap(point => point.rank ? [[point.rank.exercise.id, point.rank.exercise] as const] : []));
  const rankAxis = metric === 'rank' ? rankAverageScale(chartValues, exercises.size === 1 ? exercises.values().next().value : undefined) : null;
  const { lower, upper, ticks } = rankAxis ?? chartScale(chartValues, metric);
  const axisTicks = ticks.length > 5
    ? ticks.filter((_, index) => index === 0 || index === ticks.length - 1 || index % Math.ceil(ticks.length / 4) === 0) : ticks;
  const selected = points.find(point => point.id === selectedId) ?? visible.at(-1);
  const definition = TIMELINE_METRICS.find(item => item.key === metric)!;
  const x = (day: number) => (day - bounds.firstDay) / TIMELINE_VISIBLE_DAYS * width;
  const y = (value: number) => 148 - (value - lower) / (upper - lower) * 128;
  const path = group.points.map((point, i) => {
    const value = point.values[metric];
    if (value === null || point.x < start || point.x > end) return '';
    const previous = group.points[i - 1];
    const joins = previous && previous.x >= start && previous.values[metric] !== null && compatible(point, previous);
    return `${joins ? 'L' : 'M'} ${x(point.x)} ${y(value)}`;
  }).join(' ');
  const guide = cumulative.map((point, i) => {
    if (!point) return '';
    const current = group.points[i];
    if (current.x < start || current.x > end) return '';
    const previous = group.points[i - 1];
    const before = cumulative[i - 1];
    if (!point.joins || !before || previous.x < start) return `M ${x(current.x)} ${y(point.value)}`;
    const middle = (x(previous.x) + x(current.x)) / 2;
    return `C ${middle} ${y(before.value)} ${middle} ${y(point.value)} ${x(current.x)} ${y(point.value)}`;
  }).join(' ');
  function format(value: number) {
    return metric === 'rank' || metric === 'average' ? formatAverage(value, preferences.averageHundredths) :
      value.toLocaleString('ru-RU', { maximumFractionDigits: metric === 'cg3' ? 2 : 1 });
  }
  const pointLabel = (point: TimelineGroup['points'][number]) => metric === 'rank'
    ? point.rank?.pace?.label ?? '—' : format(point.values[metric]!);
  const axisLabel = (value: number) => rankAxis?.thresholds.find(threshold => threshold.average === value)?.label ?? format(value);
  useLayoutEffect(() => {
    const node = scroller.current; if (!node) return;
    const measure = () => setWidth(Math.max(1, node.clientWidth));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const restoredPoint = useRef(selectedId);
  useLayoutEffect(() => {
    const node = scroller.current; if (!node) return;
    const restored = points.find(point => point.id === restoredPoint.current);
    node.scrollLeft = restored ? Math.max(0, x(restored.x) - width / 2) : Math.max(0, trackWidth - width);
    setScrollLeft(node.scrollLeft);
  }, [width, trackWidth, metric]);
  useLayoutEffect(() => {
    const node = scroller.current;
    const point = points.find(point => point.id === focusId);
    if (node && point) node.scrollLeft = x(point.x) - width / 2;
  }, [focusId]);
  function scroll(direction: number) {
    const node = scroller.current; if (!node) return;
    node.scrollLeft += direction * 8;
    setScrollLeft(node.scrollLeft);
  }
  const scrub = useChartScrub<HTMLDivElement>(clientX => {
    const node = scroller.current;
    if (!node || !points.length) return;
    const position = clientX - node.getBoundingClientRect().left + node.scrollLeft;
    const nearest = points.reduce((best, point) => Math.abs(x(point.x) - position) < Math.abs(x(best.x) - position) ? point : best);
    onSelect(nearest.id);
  }, scroll);
  return <>
    <div className="progress-timeline-range" data-testid="progress-trend-range">{label(start, true)} — {label(end - 1, true)}</div>
    <div className="progress-timeline-plot">
      <div className="progress-timeline-scale" aria-hidden="true">{axisTicks.map(value => <span key={value}
        style={{ top: y(value) }}>{axisLabel(value)}</span>)}</div>
      <div className="progress-timeline-scroll" ref={scroller} tabIndex={0} role="region" aria-label={`График: ${definition.label}. Стрелки влево и вправо выбирают тренировку.`}
        {...scrub}
        data-testid="progress-trend-chart" onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const index = selected ? points.indexOf(selected) : points.length;
          const next = points[index + (event.key === 'ArrowLeft' ? -1 : 1)];
          if (next) {
            onSelect(next.id);
            event.currentTarget.scrollLeft = x(next.x) - width / 2;
          }
        }}>
        <svg className="progress-timeline-svg" width={trackWidth} height="184" viewBox={`0 0 ${trackWidth} 184`} role="group" aria-label={definition.label}>
          {axisTicks.map(value => <line key={value} x1="0" x2={trackWidth} y1={y(value)} y2={y(value)} className="progress-timeline-grid" />)}
          {guide.includes('C ') && <path className="progress-cumulative-line" d={guide} />}
          {visible.length > 1 && path && <path className="progress-timeline-line" d={path} />}
          {visible.map(point => <g key={point.id} role="button" tabIndex={0} aria-label={`${label(point.day, true)} · ${point.title}: ${pointLabel(point)} ${definition.unit}`}
            aria-pressed={selected?.id === point.id}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(point.id); } }}>
            <circle cx={x(point.x)} cy={y(point.values[metric]!)} r="14" className="progress-timeline-hit" />
            <circle cx={x(point.x)} cy={y(point.values[metric]!)} r={selected?.id === point.id ? 5 : 3.5} className={selected?.id === point.id ? 'progress-timeline-dot selected' : 'progress-timeline-dot'} />
          </g>)}
          {[start, start + 15, end - 1].map((day, index) => <text key={index} x={x(day) + (index === 0 ? 3 : index === 2 ? -3 : 0)} y="175" textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}>{label(day)}</text>)}
        </svg>
      </div>
    </div>
    <div className="progress-timeline-selected" aria-live="polite" data-testid="progress-trend-value">
      {selected ? <><span><time dateTime={selected.date}>{label(selected.day, true)}</time><small>{selected.title}</small></span>
        <strong data-progress-tone={metric === 'progress' ? progressTone(selected.values.progress!) : undefined}>
          {metric === 'progress' && selected.values.progress! > 0 ? '+' : ''}{pointLabel(selected)} <small>{definition.unit}</small>
        </strong><button type="button" className="text-action progress-open-training" onClick={() => onOpen(selected.sessionId)}>Открыть тренировку</button>
      </> : <span>В этом отрезке нет результатов. Пролистай график к тренировкам.</span>}
    </div>
    {guide.includes('C ') && <p className="progress-cumulative-legend">{metric === 'average' || metric === 'rank' || metric.endsWith('Share') ? 'Накопительное среднее' : 'Среднее по тренировкам'}</p>}
  </>;
}

export function ProgressTimeline({ groups, history, comparisonKey, onCompare, onOpen, selectedId, onSelect }: {
  groups: readonly TimelineGroup[]; history: TimelineGroup; comparisonKey: string | null; onCompare: (key: string) => void; onOpen: (id: string) => void;
  selectedId: string | null; onSelect: (id: string) => void;
}) {
  const { preferences, update } = useTrainingPreferences();
  const requestedMetric = TIMELINE_METRICS.find(item => item.key === preferences.statisticsView?.progressMetric)?.key ?? 'average';
  const [help, setHelp] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const view = preferences.statisticsView?.progressView === 'compare' ? 'compare' : 'history';
  const setView = (progressView: 'history' | 'compare') => { void update({ ...preferences, statisticsView: { ...preferences.statisticsView, progressView } }); };
  const supported = groups.filter(group => availableTimelineMetrics(group, preferences).length > 0);
  const historyMetrics = availableTimelineMetrics(history, preferences);
  if (!historyMetrics.length && !supported.length) return null;
  const comparing = view === 'compare' || !historyMetrics.length;
  const group = comparing ? supported.find(item => item.key === comparisonKey) ?? supported[0] : history;
  const metrics = group ? availableTimelineMetrics(group, preferences) : [];
  const metric = metrics.includes(requestedMetric) ? requestedMetric : metrics[0];
  const plotted = group?.points.filter(point => metric && point.values[metric] !== null);
  const highlighted = plotted?.find(point => point.id === selectedId)?.id ?? plotted?.at(-1)?.id;
  const comparisons = (['average', 'rms'] as const).flatMap(key => {
    if (!group || !metrics.includes(key)) return [];
    const result = timelineComparison(group, key);
    return result ? [{ key, ...result }] : [];
  });
  return <><section className="progress-timeline journal-tab-panel" aria-label="По тренировкам" data-testid="progress-trend">
    <header><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 4v16h16M7 15l4-5 4 2 5-7" /></svg><h2>По тренировкам</h2>
      <button type="button" className="progress-timeline-help" aria-label="О динамике прогресса" onClick={() => setHelp(true)}>?</button>
    </header>
    {historyMetrics.length > 0 && <div className="progress-timeline-metrics" role="group" aria-label="Выбор тренировок для графика">
      <button type="button" aria-pressed={!comparing} onClick={() => setView('history')} data-testid="progress-view-history">Все тренировки</button>
      <button type="button" aria-pressed={comparing} onClick={() => setView('compare')} data-testid="progress-view-compare">По условиям</button>
    </div>}
    {comparing && (supported.length > 1 ? <ChoicePicker label="Условия сравнения" value={group?.key ?? ''}
      options={supported.map(item => ({ value: item.key, label: item.label }))} onChange={onCompare} /> : <p className="progress-timeline-condition-label">
      {group?.label ?? 'Для сравнения нужны тренировки с указанным классом лука и одинаковыми условиями.'}
    </p>)}
    {group && metric && <><ChoicePicker label="Показатель графика" variant="ghost" value={metric}
      options={TIMELINE_METRICS.filter(item => metrics.includes(item.key)).map(item => ({ value: item.key, label: item.label }))}
      onChange={progressMetric => { void update({ ...preferences, statisticsView: { ...preferences.statisticsView, progressMetric } }); }} />
    <TimelinePlot key={group.key} group={group} metric={metric} onOpen={onOpen} selectedId={selectedId}
      onSelect={id => { setFocusId(null); if (id !== selectedId) onSelect(id); }} focusId={focusId} /></>}
    {comparisons.length > 0 && <div className="progress-insights" data-testid="progress-insights">
      <h3>Последняя тренировка · {label(comparisons[0].latest.day, true)}</h3>
      <div className="progress-insights-grid">
        {comparisons.map(({ key, current, baseline, delta, earlier }) => {
          const average = key === 'average';
          const digits = average && preferences.averageHundredths ? 2 : 1;
          const display = (value: number) => value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
          const rounded = Number(delta.toFixed(digits));
          const better = average ? rounded > 0 : rounded < 0;
          const unit = average ? 'балла' : 'мм';
          return <section key={key} className="progress-insight" data-testid={`progress-insight-${key}`}>
            <h4>{average ? 'Средний балл' : 'Кучность RMS'}</h4>
            <strong data-better={better}>{rounded === 0 ? 'Без изменений' : `${rounded > 0 ? '+' : '−'}${display(Math.abs(rounded))} ${unit}`}</strong>
            <small>{display(current)} сейчас · {display(baseline)} в базе</small>
            <details><summary>База · {earlier.length} трен.</summary>
              <ul>{earlier.map(point => <li key={point.id}>{label(point.day, true)} · {display(point.values[key]!)}</li>)}</ul>
            </details>
          </section>;
        })}
      </div>
    </div>}
    {help && <BottomSheet title="Динамика прогресса" onClose={() => setHelp(false)} tag="progress-trend-help">
      <p className="round-help">Каждая точка показывает результат тренировки. Нажми на точку, чтобы увидеть значение и открыть тренировку.</p>
      <StatisticRules>
        <p>Для сравнения совпадают класс лука, дистанция и мишень. В накопительной линии средний балл и доли взвешены по количеству стрел.</p>
        <p>Сводка сравнивает последнее занятие со средним за 3–5 предыдущих занятий на более ранних датах.</p>
      </StatisticRules>
    </BottomSheet>}
  </section>
    {group && <section className="journal-tab-panel progress-training-list">
      <h2>Тренировки</h2>
      {[...group.points].reverse().map(point => <div key={point.id} className="progress-training-row" data-selected={highlighted === point.id}>
        <button type="button" onClick={() => { setFocusId(point.id); onSelect(point.id); }} aria-pressed={highlighted === point.id}
          disabled={!metric || point.values[metric] === null}>
          <time dateTime={point.date}>{label(point.day, true)}</time><span>{point.title}</span>
          {metric && <strong>{metric === 'rank' ? point.rank?.pace?.label ?? '—'
            : point.values[metric] === null ? '—' : chartLabel(metric, point.values[metric], preferences.averageHundredths)}</strong>}
        </button>
        <button type="button" className="text-action" aria-label={`Открыть тренировку ${point.title}`} onClick={() => onOpen(point.sessionId)}>›</button>
      </div>)}
    </section>}
  </>;
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
  const equipment = new Map<string, string>();
  for (const entry of conditionEntries) for (const round of entry.practice.rounds) for (const series of round.series) {
    const kit = series.conditions.equipment;
    if (series.shots.length && kit && !equipment.has(kit.id)) equipment.set(kit.id, kit.name);
  }
  const groups = useMemo(() => buildProgressTimeline(filterProgressEntries(conditionEntries, { ...DEFAULT_PROGRESS_FILTERS, equipmentId: draft.equipmentId })),
    [conditionEntries, draft.equipmentId]);
  const count = filterProgressEntries(entries, draft).length;
  const periods: readonly [ProgressPeriod, string][] = [[0, 'Всё время'], [7, '7 дней'], [30, '30 дней'], [90, '90 дней'], [-1, 'Свои даты']];

  return <BottomSheet title="Критерии прогресса" tag="progress-filter-sheet" onClose={onClose}>
    <form className="progress-filter-form" onSubmit={event => { event.preventDefault(); if (range.valid) onApply(draft); }}>
      <div className="progress-timeline-metrics" role="group" aria-label="Период">
        {periods.map(([period, title]) => <button type="button" key={period} aria-pressed={draft.period === period}
          data-testid={`analytics-period-${period}`} onClick={() => setDraft(current => ({ ...current, period }))}>{title}</button>)}
      </div>
      <div className="progress-filter-actions">
        <button type="button" onClick={() => {
          const year = new Date().getFullYear();
          setDraft(current => ({ ...current, period: -1, from: `${year}-01-01`, to: `${year}-12-31` }));
        }}>Текущий сезон</button>
        <button type="button" onClick={() => {
          const year = new Date().getFullYear() - 1;
          setDraft(current => ({ ...current, period: -1, from: `${year}-01-01`, to: `${year}-12-31` }));
        }}>Прошлый сезон</button>
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
      {(equipment.size > 0 || draft.equipmentId) && <ChoicePicker label="Комплект" value={draft.equipmentId ?? ''}
        onChange={value => setDraft(current => ({ ...current, equipmentId: value || null }))}
        options={[{ value: '', label: 'Все комплекты' },
          ...(draft.equipmentId && !equipment.has(draft.equipmentId) ? [{ value: draft.equipmentId, label: 'Выбранный комплект · нет результатов' }] : []),
          ...[...equipment].map(([value, label]) => ({ value, label }))]} />}
      <ChoicePicker label="Сопоставимые условия" value={draft.conditionKey ?? ''} testId="analytics-conditions"
        onChange={value => setDraft(current => ({ ...current, conditionKey: value || null }))}
        options={[{ value: '', label: 'Все условия' },
          ...(draft.conditionKey && !groups.some(group => group.key === draft.conditionKey) ? [{ value: draft.conditionKey, label: 'Выбранные условия · нет результатов' }] : []),
          ...groups.map(group => ({ value: group.key, label: group.label }))]} />
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

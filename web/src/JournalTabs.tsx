import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { scoreOutline } from './score-appearance.ts';
import { roundShots } from './practice.ts';
import type { DiaryEntry } from './persistence.ts';
import { exerciseRank, exerciseRankDisplay } from './exercise-rank.ts';
import { ProgressFiltersSheet, ProgressTimeline } from './ProgressTimeline.tsx';
import { GeometryTrend } from './GeometryTrend.tsx';
import { ProgressExport } from './ProgressExport.tsx';
import { buildProgressTimeline, buildTrainingHistoryTimeline, DEFAULT_PROGRESS_FILTERS, filterProgressEntries } from './progress-timeline.ts';
import type { ProgressFilters } from './progress-timeline.ts';
import { BOW_CATEGORIES } from './equipment.ts';
import { BottomSheet } from './ConditionsScreen.tsx';
import { DEFAULT_HISTORY_FILTERS, filterDiary } from './diary-history.ts';
import type { HistoryFilters } from './diary-history.ts';
import { compactProgress } from './progress-scoring.ts';
import { formatAverage } from './preferences.ts';
import { summarize } from './target.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';
import './journal-tabs.css';
import { Icon } from './TrainingChrome.tsx';
import { tournamentLinks, tournamentTitle } from './tournaments.ts';
import { ChoicePicker } from './ChoicePicker.tsx';
import type { Tournament } from './tournaments.ts';

type JournalEntry = DiaryEntry;
type IconName = 'target' | 'distance' | 'bow' | 'arrow' | 'progress' | 'kit' | 'next' | 'history';

const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long' });
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function TabIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    target: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0Zm-4 0a5 5 0 1 0-10 0 5 5 0 0 0 10 0Zm-4 0a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z',
    distance: 'M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4',
    bow: 'M7 3q13 9 0 18L7 3m-4 9h18m-4-4 4 4-4 4',
    arrow: 'm4 20 16-16m-7 0h7v7M4 14l6 6',
    progress: 'm3 17 6-6 4 3 7-8m-5 0h5v5',
    kit: 'M3 8h18v12H3zm5 0V4h8v4M3 13h18m-11 0v2h4v-2',
    next: 'm9 6 6 6-6 6',
    history: 'M3 12a9 9 0 1 1 2.6 6.4M3 12V6m0 6h6m3-5v5l3 2',
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>;
}

function EmptyState({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <div className="journal-tab-empty">
    <TabIcon name={icon} />
    <div><strong>{title}</strong><p>{children}</p></div>
  </div>;
}

function HistoryCard({ entry, hundredths, onOpen, tournament }: {
  entry: JournalEntry; hundredths: boolean; onOpen: () => void;
  tournament?: { tournament: Tournament; start: Tournament['starts'][number] };
}) {
  const { preferences } = useTrainingPreferences();
  const showResult = statisticVisible(preferences, 'result');
  const showAverage = statisticVisible(preferences, 'average');
  const showVolume = statisticVisible(preferences, 'volume');
  const { practice } = entry;
  const shots = practice.rounds.flatMap(roundShots);
  const { points, maximum, average } = summarize(shots);
  const series = practice.rounds.flatMap(round => round.series);
  const conditions = series.filter(item => item.shots.length > 0).map(item => item.conditions);
  const first = conditions[0] ?? series.at(-1)?.conditions;
  const mixed = new Set(conditions.map(value => JSON.stringify(value))).size > 1;
  const kitName = first?.equipment?.name;
  const draft = practice.savedAt === null;
  const rank = statisticVisible(preferences, 'norms') ? exerciseRank(practice, preferences.rankCategory ?? null) : null;
  const rankDisplay = rank && exerciseRankDisplay(rank);
  const progress = statisticVisible(preferences, 'progress_score') ? compactProgress(practice) : null;
  const outline = scoreOutline(shots, preferences.colorTrainingBorders !== false && !preferences.hideScores && showResult && !draft);

  return <button type="button" className={`journal-tab-history-card${entry.deletedAt ? ' is-deleted' : ''}${tournament ? ' is-tournament' : ''}`} onClick={onOpen} data-testid={`session-${entry.id}`}
    data-score-outline={outline !== undefined || undefined}
    style={outline ? { '--score-outline': outline } as CSSProperties : undefined}>
    <span className="journal-tab-card-title">
      <strong>{entry.title || (entry.paused ? 'Приостановленная тренировка' : draft ? 'Черновик тренировки' : 'Тренировка')}</strong>
      {entry.groupRoomName && <span title={entry.groupRoomName} aria-label={`Групповая тренировка · ${entry.groupRoomName}`}><Icon name="group" /></span>}
      {tournament && <span title={tournamentTitle(tournament.tournament)}
        aria-label={`Турнир · ${tournamentTitle(tournament.tournament)}${tournament.start.place === null ? '' : ` · ${tournament.start.place} место`}`}>
        <Icon name="trophy" /></span>}
      <TabIcon name="next" />
    </span>
    {maximum > 0 && (showResult || showAverage || progress || rankDisplay?.label) && <span className="journal-tab-card-result">
      {showResult && <span aria-label={`${points} из ${maximum} очков`}><strong>{number.format(points)}</strong><span> / {number.format(maximum)}</span></span>}
      {showAverage && <span className="journal-tab-icon-value" aria-label={`Средний балл ${formatAverage(average, hundredths)}`}>
        <TabIcon name="progress" /><strong>{formatAverage(average, hundredths)}</strong>
      </span>}
      {progress && <span className="history-progress" data-progress-tone={progress.tone} aria-label={`Прогресс относительно похожих тренировок ${progress.text}`}>{progress.text}</span>}
      {rankDisplay?.label && <span className="history-rank" data-testid={`history-rank-${entry.id}`}
        aria-label={`${rankDisplay.forecast ? 'Темп' : 'Разряд'} ${rankDisplay.label}`} title={rankDisplay.actual ?? rank?.classLabel ?? undefined}>
        {rankDisplay.label}
      </span>}
    </span>}
    <span className="journal-tab-conditions">
      {mixed ? <span className="journal-tab-icon-value"><TabIcon name="target" />Разные условия</span> : first && <>
        <span className="journal-tab-icon-value" aria-label={`Мишень ${number.format(first.targetDiameterMm / 10)} сантиметров`}>
          <TabIcon name="target" />{number.format(first.targetDiameterMm / 10)} см
        </span>
        <span className="journal-tab-icon-value" aria-label={`Дистанция ${number.format(first.distanceMeters)} метров`}>
          <TabIcon name="distance" />{number.format(first.distanceMeters)} м
        </span>
        {kitName && <span className="journal-tab-icon-value"><TabIcon name="bow" /><span>{kitName}</span></span>}
      </>}
      {showVolume && <span className="journal-tab-icon-value"><TabIcon name="arrow" />{number.format(shots.length)} стр.</span>}
    </span>
  </button>;
}

export function JournalHistory({ entries, filters, onFilters, onOpen, tournaments, onTournaments }: {
  entries: readonly JournalEntry[]; filters: HistoryFilters; onFilters: (filters: HistoryFilters) => void; onOpen: (id: string) => void;
  tournaments: readonly Tournament[]; onTournaments: () => void;
}) {
  const { preferences } = useTrainingPreferences();
  const [filterOpen, setFilterOpen] = useState(false);
  const links = useMemo(() => tournamentLinks(tournaments), [tournaments]);
  const filtered = filterDiary(entries, filters).filter(entry => !filters.tournament || (filters.tournament === 'linked') === links.has(entry.id));
  const distances = [...new Set(entries.flatMap(entry => entry.practice.rounds.flatMap(round => round.series.map(series => series.conditions.distanceMeters))))].sort((a, b) => a - b);
  const groups = new Map<string, { title: string; entries: { entry: JournalEntry; date: Date }[] }>();
  for (const entry of filtered) {
    const date = new Date(entry.startedAt);
    const known = Number.isFinite(date.getTime());
    const key = known ? `${date.getFullYear()}-${date.getMonth()}` : 'unknown';
    const group = groups.get(key);
    if (group) group.entries.push({ entry, date });
    else groups.set(key, { title: known ? `${monthLabel.format(date)} ${date.getFullYear()}` : 'Без даты', entries: [{ entry, date }] });
  }

  return <section className="journal-tab-content" aria-label="История тренировок" data-testid="history-screen">
    <div className="history-tools">
      <input type="search" aria-label="Найти тренировку" placeholder="Поиск" value={filters.query}
        onChange={event => onFilters({ ...filters, query: event.target.value })} />
      <button type="button" className="icon-button" aria-label="Фильтры истории" data-testid="history-filters"
        data-has-filters={!!(filters.tournament || filters.from || filters.to || filters.bow || filters.distance || filters.deleted) || undefined}
        onClick={() => setFilterOpen(true)}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M3 6h18M6 12h12m-8 6h4" /></svg>
      </button>
      {filters.deleted && <span className="history-trash-label">Корзина</span>}
    </div>
    {groups.size === 0 && <EmptyState icon="history" title={filters.deleted ? 'Корзина пуста' : entries.length ? 'Тренировки не найдены' : 'История пока пуста'}>
      {filters.deleted ? 'Здесь появятся удалённые тренировки.' : entries.length ? 'Попробуй изменить фильтры.' : 'Начни тренировку на главной — она появится здесь.'}
    </EmptyState>}
    {[...groups].map(([key, group]) => <section key={key} className="journal-tab-month">
      <h2>{group.title}</h2>
      <ol className="journal-tab-timeline">
        {group.entries.map(({ entry, date }) => <li key={entry.id}>
          {Number.isFinite(date.getTime())
            ? <time className="journal-tab-day" dateTime={entry.startedAt} aria-label={shortDate.format(date)}>{date.getDate()}</time>
            : <span className="journal-tab-day" aria-label="Без даты">—</span>}
          <HistoryCard entry={entry} hundredths={preferences.averageHundredths} tournament={links.get(entry.id)} onOpen={() => onOpen(entry.id)} />
        </li>)}
      </ol>
    </section>)}
    {filterOpen && <BottomSheet title="Фильтры истории" tag="history-filter-sheet" onClose={() => setFilterOpen(false)}>
      <div className="history-filter-fields">
        <div className="history-record-filter"><ChoicePicker label="Тип записи" value={filters.tournament ?? 'all'}
          options={[{ value: 'all', label: 'Все записи' }, { value: 'ordinary', label: 'Только тренировки' }, { value: 'linked', label: 'Только турниры' }]}
          onChange={selected => onFilters({ ...filters, tournament: selected === 'linked' || selected === 'ordinary' ? selected : undefined })} />
          <button className="text-action" type="button" onClick={() => { setFilterOpen(false); onTournaments(); }}><Icon name="trophy" />Турниры</button>
        </div>
        <label>С даты<input type="date" value={filters.from} onChange={event => onFilters({ ...filters, from: event.target.value })} /></label>
        <label>По дату<input type="date" value={filters.to} onChange={event => onFilters({ ...filters, to: event.target.value })} /></label>
        <ChoicePicker label="Дистанция" value={filters.distance} options={[{ value: '', label: 'Любая' }, ...distances.map(distance => ({ value: String(distance), label: `${distance} м` }))]}
          onChange={distance => onFilters({ ...filters, distance })} />
        <ChoicePicker label="Класс лука" value={filters.bow} options={[{ value: '', label: 'Любой' }, ...BOW_CATEGORIES, { value: 'unknown', label: 'Не указан' }]}
          onChange={bow => onFilters({ ...filters, bow })} />
        <label className="history-trash-toggle"><input type="checkbox" checked={filters.deleted} onChange={event => onFilters({ ...filters, deleted: event.target.checked })} /> Корзина</label>
        <button className="text-action" type="button" onClick={() => onFilters(DEFAULT_HISTORY_FILTERS)}>Сбросить фильтры</button>
      </div>
    </BottomSheet>}
  </section>;
}

export type ProgressViewState = { filters: ProgressFilters; comparisonKey: string | null; selectedId: string | null };
export const defaultProgressView: ProgressViewState = { filters: DEFAULT_PROGRESS_FILTERS, comparisonKey: null, selectedId: null };

export function JournalProgress({ entries, onOpen, onPractice, view, onView }: {
  entries: readonly JournalEntry[]; onOpen: (id: string) => void; onPractice: () => void;
  view: ProgressViewState; onView: (view: ProgressViewState) => void;
}) {
  const { preferences } = useTrainingPreferences();
  const { filters, comparisonKey, selectedId } = view;
  const setFilters = (filters: ProgressFilters) => onView({ ...view, filters, selectedId: null });
  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const showAverage = statisticVisible(preferences, 'average');
  const showVolume = statisticVisible(preferences, 'volume');
  const filtered = useMemo(() => filterProgressEntries(entries, filters), [entries, filters]);
  const groups = useMemo(() => buildProgressTimeline(filtered, preferences).filter(group => group.comparable), [filtered, preferences]);
  const history = useMemo(() => buildTrainingHistoryTimeline(filtered, preferences), [filtered, preferences]);
  const comparison = groups.find(group => group.key === comparisonKey) ?? groups[0];
  const sessions = filtered.map(entry => {
    const shots = entry.practice.rounds.flatMap(roundShots);
    return { date: new Date(entry.startedAt), arrows: shots.length, ...summarize(shots) };
  }).filter(session => session.arrows > 0);
  const totals = sessions.reduce((total, session) => ({
    arrows: total.arrows + session.arrows, points: total.points + session.points,
  }), { arrows: 0, points: 0 });
  const hasResults = entries.some(entry => !entry.deletedAt && entry.practice.savedAt !== null && entry.practice.rounds.some(round => round.series.some(series => series.shots.length)));
  const activeFilters = filters.period !== 0 || filters.sessionIds !== null || filters.conditionKey !== null || filters.equipmentId !== null;
  const period = filters.period === 0 ? 'Всё время' : filters.period === -1 ? `${filters.from} — ${filters.to}` : `${filters.period} дней`;

  return <section className="journal-tab-content" aria-label="Прогресс тренировок" data-testid="progress-screen">
    {hasResults && <div className="progress-actions">
      <button type="button" className="progress-filters-open" data-testid="analytics-filters" aria-label="Критерии прогресса"
        onClick={() => setFilterOpen(true)}><span>{period}</span><span>{activeFilters ? 'Фильтры включены' : 'Критерии'}</span></button>
      {sessions.length > 0 && <button type="button" className="icon-button" aria-label="Экспорт отчёта по выборке"
        onClick={() => setExportOpen(true)}><Icon name="download" /></button>}
    </div>}
    {sessions.length === 0 ? <EmptyState icon="progress" title={activeFilters && hasResults ? 'По этим критериям результатов нет' : 'Пока нет результатов'}>
      {activeFilters && hasResults ? <button className="text-action" type="button" onClick={() => setFilters(DEFAULT_PROGRESS_FILTERS)}>Сбросить фильтры</button>
        : <button className="text-action" type="button" onClick={onPractice}>Перейти к тренировке</button>}
    </EmptyState> : <>
      {(showAverage || showVolume) && <section className="report-metrics-card report-metrics-result progress-period-result" aria-labelledby="progress-period-title">
        <div className="report-result-label"><h3 id="progress-period-title">Итог периода</h3><span>{period}</span></div>
        {showAverage && <div className="report-result-score-row">
          <div className="report-metrics-score"><strong>{formatAverage(totals.points / totals.arrows, preferences.averageHundredths)}</strong><span>/ 10</span></div>
          <span className="report-metrics-muted">Средний балл</span>
        </div>}
        {showVolume && <dl className="report-metric-grid report-result-metrics">
          <div><dt>Тренировки</dt><dd>{number.format(sessions.length)}</dd></div>
          <div><dt>Стрелы</dt><dd>{number.format(totals.arrows)}</dd></div>
        </dl>}
      </section>}
      <ProgressTimeline groups={groups} history={history} comparisonKey={comparisonKey} onCompare={comparisonKey => onView({ ...view, comparisonKey, selectedId: null })}
        onOpen={onOpen} selectedId={selectedId} onSelect={selectedId => onView({ ...view, selectedId })} />
      {comparison && <GeometryTrend group={comparison} />}
    </>}
    {filterOpen && <ProgressFiltersSheet entries={entries} value={filters} onClose={() => setFilterOpen(false)}
      onApply={next => { setFilters(next); setFilterOpen(false); }} />}
    {exportOpen && <ProgressExport entries={filtered}
      period={period} onClose={() => setExportOpen(false)} />}
  </section>;
}

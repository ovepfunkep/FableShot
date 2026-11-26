import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { BOW_CATEGORIES } from './equipment.ts';
import { readRoomHistory, roomComparison, roomConditionChoices, roomShotLabel, roomShotPoints } from './group-leaderboard.ts';
import type { GroupScoring, RoomHistory, RoomScope } from './group-leaderboard.ts';
import { loadRoomMembership, readRoomName, roomSnapshot } from './group-room-membership.ts';
import { displayCompositeScore } from './composite-scoring.ts';
import { scoreColor } from './score-appearance.ts';
import { Icon } from './TrainingChrome.tsx';
import { RoomHelp, RoomHelpButton } from './RoomHelp.tsx';
import { shareReport } from './share-report.ts';
import { roomResultCard } from './room-result-card.ts';
import { RoomTargetViewer } from './RoomTargetViewer.tsx';
import { ChoicePicker } from './ChoicePicker.tsx';
import './room-leaderboard.css';

const scoring = [
  { id: 'classic', label: 'Очки', icon: 'target' },
  { id: 'cg3', label: 'Общие', icon: 'trophy' },
  { id: 'pg1', label: 'Прогресс', icon: 'stats' },
] as const;
const emptySeries: RoomHistory['series'] = [];
const emptyParticipants: RoomHistory['participants'] = [];
type RoomRow = ReturnType<typeof roomComparison>[number];
const bowName = (bow: string | null) => BOW_CATEGORIES.find(item => item.value === bow)?.label ?? 'Без категории';
const decimal = (value: number) => displayCompositeScore(value).replace('.', ',');
function scoreLabel(row: RoomRow, mode: GroupScoring) {
  const { value } = row.metrics[mode];
  if (value === null) return '—';
  if (mode === 'classic') return value + '/' + row.arrows * 10;
  if (mode === 'cg3') return decimal(value);
  return (Number(displayCompositeScore(value)) > 0 ? '+' : '') + decimal(value) + '%';
}

function SeriesShots({ scores }: { scores: string }) {
  const visible = scores.slice(0, 6);
  return <div className="room-series-shots" aria-label="Оценки выстрелов">
    {Array.from(visible, (code, index) => {
      const points = roomShotPoints(code);
      return <span key={index} data-dark={points >= 3 && points <= 4 || points === 0}
        title={'Стрела ' + (index + 1)} style={{ backgroundColor: scoreColor(points) }}>{roomShotLabel(code)}</span>;
    })}
    {visible.length < scores.length && <small>+{scores.length - visible.length}</small>}
  </div>;
}

export function GroupLeaderboard({ entryId, mySeries, myOpenSeries, onClose, saved, title, archived, onRefresh, onFinalSnapshot }: {
  entryId?: string; mySeries: number; myOpenSeries?: number; onClose: () => void; saved?: RoomHistory; title?: string; archived?: boolean;
  onRefresh?: () => Promise<RoomHistory>;
  onFinalSnapshot?: (history: RoomHistory, name?: string) => void;
}) {
  const [live, setLive] = useState<RoomHistory>();
  const [selected, setSelected] = useState<number | null>(null);
  const [scope, setScope] = useState<RoomScope>('through');
  const [category, setCategory] = useState('all');
  const [mode, setMode] = useState<GroupScoring>('classic');
  const [condition, setCondition] = useState('');
  const [sameConditions, setSameConditions] = useState(false);
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState(title);
  const [refreshing, setRefreshing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [openMember, setOpenMember] = useState<string>();
  const [viewer, setViewer] = useState<{ initialId: string; ids: string[] }>();
  const [shareStatus, setShareStatus] = useState('');
  const [sharing, setSharing] = useState(false);
  const persistFinalSnapshot = useEffectEvent((history: RoomHistory, name?: string) => onFinalSnapshot?.(history, name));

  useEffect(() => {
    if (archived || saved?.finalizedAt || live?.finalizedAt || !entryId) return;
    const id = entryId;
    let cancelled = false;
    let loading = false;
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const membership = loadRoomMembership(id);
        if (!membership) throw new Error('Приглашение в комнату недоступно.');
        const snapshot = await roomSnapshot(membership.invitation);
        const results = readRoomHistory(snapshot);
        if (!cancelled) {
          const name = readRoomName(snapshot) ?? membership.roomName ?? title;
          if (results.finalizedAt) persistFinalSnapshot(results, name);
          setLive(results); setRoomName(name); setError('');
        }
      } catch {
        if (!cancelled) setError('Связь с комнатой потеряна.');
      } finally { loading = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [archived, entryId, title, saved?.finalizedAt, live?.finalizedAt]);

  const history = saved?.finalizedAt ? saved : live ?? saved;
  const finalizedAt = history?.finalizedAt;
  const series = history?.series ?? emptySeries;
  const participants = history?.participants ?? emptyParticipants;
  const latest = useMemo(() => series.reduce((max, end) => end.result ? Math.max(max, end.ordinal) : max, 0), [series]);
  const ownSnapshotSeries = useMemo(() => series.reduce((max, end) =>
    end.entryId === entryId && end.result ? Math.max(max, end.ordinal) : max, 0), [series, entryId]);
  const automatic = entryId ? Math.max(mySeries, ownSnapshotSeries) : archived ? latest : mySeries;
  const ordinal = selected ?? automatic;
  const choices = useMemo(() =>
    [...new Set([automatic, selected ?? 0, ...series.map(end => end.ordinal)])].filter(value => value > 0).sort((a, b) => a - b),
  [automatic, selected, series]);
  const conditions = useMemo(() => roomConditionChoices(series), [series]);
  const conditionFilter = conditions.has(condition) ? condition : undefined;
  const rows = useMemo(() => roomComparison(series, participants, { ordinal, scope, sort: mode, sameConditions, ownId: entryId,
    bow: category === 'all' ? undefined : category === 'unknown' ? null : category, conditions: conditionFilter }),
  [series, participants, ordinal, scope, mode, sameConditions, entryId, category, conditionFilter]);
  const filtersActive = category !== 'all' || !!conditionFilter;
  const name = (row: RoomRow) => row.name || (row.id === entryId ? 'Вы' : 'Стрелок ' + row.id.slice(0, 5).toUpperCase());
  const count = new Set([...series, ...participants].map(end => end.entryId)).size;
  const index = choices.indexOf(ordinal);
  const before = index > 0 ? choices[index - 1] : undefined;
  const after = choices[index + 1];
  const canShare = finalizedAt && scope === 'through' && rows.some(row => row.arrows);
  return <BottomSheet title={roomName || 'Таблица комнаты'} onClose={onClose} tag="room-leaderboard" startAtTop
    className={'room-leaderboard-sheet' + (expanded ? ' is-expanded' : '')}
    headerAction={<div className="room-header-actions">
      <button type="button" className="icon-button" aria-label={expanded ? 'Свернуть таблицу' : 'Развернуть таблицу'}
        onClick={() => setExpanded(!expanded)}><Icon name={expanded ? 'down' : 'up'} /></button>
      <RoomHelpButton onClick={() => setHelpOpen(true)} />
    </div>}>
    <section className="room-leaderboard" aria-label="Результаты участников">
      <div className="room-toolbar">
        <div className="room-status" role="status" data-offline={!!error}>
          <Icon name="group" /><span>{history ? count + ' · ' : ''}{finalizedAt ? 'Итоги' : error ? 'Нет связи' : archived ? 'Сохранённая таблица'
            : history ? 'В комнате' : 'Подключаемся…'}</span>
        </div>
        {canShare && <button type="button" className="room-pill" disabled={sharing} onClick={async () => {
          setSharing(true);
          setShareStatus('');
          try {
            const label = { classic: 'Классика', cg3: 'Общие очки', pg1: 'Прогресс' }[mode];
            const selection = [conditionFilter && conditions.get(conditionFilter), category !== 'all' && bowName(category),
              sameConditions && 'Одинаковые условия'].filter(Boolean).join(' · ');
            const file = roomResultCard(roomName || 'Групповая тренировка', finalizedAt, label, ordinal, selection,
              rows.filter(row => row.arrows).map(row => ({ name: name(row), bow: bowName(row.bow), place: row.metrics[mode].place, score: scoreLabel(row, mode) })));
            const result = await shareReport([file], 'FableShot — итоги комнаты');
            if (result === 'downloaded') setShareStatus('Карточка скачана.');
          } catch { setShareStatus('Не удалось подготовить карточку. Попробуйте ещё раз.'); }
          finally { setSharing(false); }
        }}>{sharing ? 'Готовим…' : 'Поделиться итогами'}</button>}
        {onRefresh && !finalizedAt && <button type="button" className="icon-button room-filter-button" disabled={refreshing}
          aria-label="Обновить таблицу" onClick={async () => {
            setRefreshing(true); setError('');
            try { setLive(await onRefresh()); }
            catch { setError('Не удалось обновить таблицу комнаты.'); }
            finally { setRefreshing(false); }
          }}><Icon name="undo" /></button>}
      </div>
      {(archived || error || shareStatus) && <small role={error || shareStatus ? 'status' : undefined} className="room-caption">
        {[error || shareStatus, history?.receivedAt ? 'Получено ' + new Date(history.receivedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '']
          .filter(Boolean).join(' · ')}
      </small>}
      <div className="room-toolbar room-scope-toolbar">
        <div className="room-scope" role="group" aria-label="Режим сравнения">
          <button type="button" aria-pressed={scope === 'through'} onClick={() => setScope('through')}>До серии</button>
          <button type="button" aria-pressed={scope === 'single'} onClick={() => setScope('single')}>Только серия</button>
        </div>
        <div className="room-ordinal">
          <button type="button" className="icon-button" aria-label="Предыдущая серия" disabled={before === undefined}
            onClick={() => setSelected(before!)}><Icon name="left" /></button>
          <ChoicePicker label="Серия" value={selected === null ? '' : String(selected)}
            options={[{ value: '', label: `${automatic || '—'} · авто` }, ...choices.map(value => ({ value: String(value), label: String(value) }))]}
            onChange={value => setSelected(value ? Number(value) : null)} />
          <button type="button" className="icon-button" aria-label="Следующая серия" disabled={after === undefined}
            onClick={() => setSelected(after)}><Icon name="right" /></button>
        </div>
      </div>
      <div className="room-toolbar">
        <button type="button" className="room-conditions-toggle" role="switch" aria-checked={sameConditions} onClick={() => setSameConditions(!sameConditions)}>
          <span>Одинаковые условия</span><span className="preference-switch" aria-hidden="true"><span /></span>
        </button>
        <button type="button" className="icon-button room-filter-button" data-active={filtersActive} aria-haspopup="dialog"
          aria-label="Фильтры таблицы" onClick={() => setFiltersOpen(true)}><Icon name="filter" /></button>
      </div>
      {filtersOpen && <BottomSheet title="Фильтры таблицы" onClose={() => setFiltersOpen(false)}>
        <div className="room-leaderboard-filters">
          <ChoicePicker label="Лук" value={category} onChange={setCategory}
            options={[{ value: 'all', label: 'Все луки' }, { value: 'unknown', label: 'Без категории' }, ...BOW_CATEGORIES]} />
          {conditions.size > 0 && <ChoicePicker label="Условия" value={conditionFilter ?? ''} onChange={setCondition}
            options={[{ value: '', label: 'Все условия' }, ...[...conditions].map(([value, label]) => ({ value, label }))]} />}
          {filtersActive && <button type="button" className="room-pill" onClick={() => { setCategory('all'); setCondition(''); }}>Сбросить</button>}
          <button type="button" className="primary" onClick={() => setFiltersOpen(false)}>Готово</button>
        </div>
      </BottomSheet>}
      {helpOpen && <RoomHelp onClose={() => setHelpOpen(false)} />}
      <div className="room-score-head" role="group" aria-label="Сортировка">
        {scoring.map(({ id, label, icon }) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>
          <Icon name={icon} />{label}
        </button>)}
      </div>
      <div className="room-table-scroll">
        {!ordinal && !!choices.length && <small className="room-caption">Выбери принятую серию.</small>}
        {history && !rows.length && <p>{filtersActive ? 'На этом срезе нет результатов по выбранным фильтрам.' : 'Здесь появятся участники комнаты.'}</p>}
        <ul className="room-standing-cards">
          {rows.map(row => {
            const opened = openMember === row.id;
            const own = row.id === entryId;
            const missing = !row.current && ordinal > 0;
            const state = missing && own && ordinal === myOpenSeries ? 'Серия открыта'
              : missing && scope === 'single' ? 'Серия не получена'
              : ordinal > 0 && scope === 'through' && !row.full ? row.seriesCount + ' из ' + ordinal + ' серий' : undefined;
            return <li key={row.id} data-own={own} data-room-member={row.id}>
              <button type="button" className="room-standing-person" aria-expanded={scope === 'through' ? opened : undefined}
                aria-haspopup={scope === 'single' ? 'dialog' : undefined} onClick={() => {
                  if (scope === 'single' && ordinal > 0) {
                    setViewer({ initialId: row.id, ids: [...new Set([...rows.map(person => person.id),
                      ...participants.map(person => person.entryId), ...series.map(end => end.entryId)])] });
                  } else setOpenMember(opened ? undefined : row.id);
                }}>
                <span><strong>{name(row)}</strong>{own && row.name && <small>Вы</small>}<small className="room-bow-class">{bowName(row.bow)}</small></span>
                <span>{state}<Icon name={scope === 'single' ? 'target' : opened ? 'up' : 'down'} /></span>
              </button>
              {scope === 'single' && row.current?.scores && <SeriesShots scores={row.current.scores} />}
              <div className="room-metric-row">
                {scoring.map(({ id, label }) => {
                  const measurement = row.metrics[id];
                  return <div key={id} data-testid={'room-score-' + id} aria-label={label} data-current={mode === id || undefined} data-preliminary={measurement.preliminary || undefined}>
                    <span className="room-reading"><strong>{scoreLabel(row, id)}</strong>
                      {measurement.place !== null && <span className="room-place" data-place={Math.min(4, measurement.place)} aria-label={'Место ' + measurement.place}>
                        {measurement.place <= 3 && <Icon name="trophy" />}{measurement.place}</span>}
                    </span>
                    {measurement.hint && <small>{measurement.preliminary ? 'Предварительно' : measurement.hint}</small>}
                  </div>;
                })}
              </div>
              {opened && scope === 'through' && <div className="room-standing-details">
                {row.composite.total !== undefined && <small>Попадания +{decimal(row.composite.base ?? 0)} · кучность +{decimal(row.composite.groupBonus ?? 0)}
                  {row.composite.stabilityBonus !== undefined && ' · стабильность +' + decimal(row.composite.stabilityBonus)}</small>}
                {row.progress?.baselineAverage != null && <small>Обычный средний {decimal(row.progress.baselineAverage)} · текущий {decimal(row.progress.currentAverage ?? 0)}</small>}
                {row.metrics.pg1.preliminary && row.metrics.pg1.hint && <small>{row.metrics.pg1.hint}</small>}
                {row.current?.conditions && <small>{bowName(row.bow)} · {row.current.conditions.distanceMeters} м · {row.current.conditions.targetDiameterMm / 10} см</small>}
              </div>}
            </li>;
          })}
        </ul>
      </div>
      {viewer && history && <RoomTargetViewer history={history} ids={viewer.ids} initialId={viewer.initialId} ownId={entryId}
        ordinal={ordinal} choices={choices} onSeries={setSelected} onClose={() => setViewer(undefined)} />}
    </section>
  </BottomSheet>;
}

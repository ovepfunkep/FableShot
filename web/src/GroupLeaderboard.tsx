import { useEffect, useEffectEvent, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { BOW_CATEGORIES } from './equipment.ts';
import { groupStandings, readRoomHistory, roomConditionChoices } from './group-leaderboard.ts';
import type { GroupScoring, RoomHistory } from './group-leaderboard.ts';
import { MIN_SCORED_ARROWS } from './progress-scoring.ts';
import type { ProgressResult } from './progress-scoring.ts';
import { loadRoomMembership, readRoomName, roomSnapshot } from './group-room-membership.ts';
import { displayCompositeScore } from './composite-scoring.ts';
import type { CompositeScore } from './composite-scoring.ts';
import { Icon } from './TrainingChrome.tsx';
import { RoomHelp, RoomHelpButton } from './RoomHelp.tsx';
import { shareReport } from './share-report.ts';
import { roomResultCard } from './room-result-card.ts';

function CompositeBreakdown({ score }: { score: CompositeScore }) {
  if (score.total === undefined) return <small>{{
    'incomplete-slice': 'В срезе не хватает серий.',
    'incomplete-end': 'Есть неполная серия.',
    'insufficient-end-shots': 'Для кучности нужно от трёх стрел в серии.',
    'missing-coordinates': 'В срезе не хватает данных о кучности.',
    'unverified-geometry': 'Для зачёта нужны серии с одним типом лука и одинаковыми условиями.',
    'available': 'Расчёт пока недоступен.',
    'no-data': 'Нет закрытых серий.',
    'insufficient-ends': 'Пока недостаточно серий.',
    'unknown-maximum': 'Максимум мишени неизвестен.',
    'invalid-data': 'Некорректные данные серии.',
  }[score.availability]}</small>;
  return <details><summary>Разбор очков</summary>
    <small>Попадания +{displayCompositeScore(score.base ?? 0)} · кучность +{displayCompositeScore(score.groupBonus ?? 0)}
      {score.stabilityBonus !== undefined && ` · стабильность +${displayCompositeScore(score.stabilityBonus)}`}</small>
    {score.phase === 'early' && <small>Предварительно · стабильность учитывается с третьей полной серии</small>}
  </details>;
}

export function GroupLeaderboard({ entryId, mySeries, onClose, saved, title, archived, onRefresh, onFinalSnapshot }: {
  entryId?: string; mySeries: number; onClose: () => void; saved?: RoomHistory; title?: string; archived?: boolean;
  onRefresh?: () => Promise<RoomHistory>;
  onFinalSnapshot?: (history: RoomHistory, name?: string) => void;
}) {
  const [live, setLive] = useState<RoomHistory>();
  const [selected, setSelected] = useState<number | null>(null);
  const [category, setCategory] = useState('all');
  const [mode, setMode] = useState<GroupScoring>('classic');
  const [condition, setCondition] = useState('');
  const [layout, setLayout] = useState('auto');
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState(title);
  const [refreshing, setRefreshing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const { series = [], participants = [] } = history ?? {};
  const received = !!history;
  const latest = archived || finalizedAt ? series.reduce((max, end) => Math.max(max, end.result ? end.ordinal : 0), 1) : mySeries;
  const ordinal = selected ?? latest;
  const choices = [...new Set([latest, ...(selected === null ? [] : [selected]), ...series.map(end => end.ordinal)])].sort((a, b) => a - b);
  const conditions = roomConditionChoices(series);
  const conditionFilter = conditions.has(condition) ? condition : undefined;
  const rows = groupStandings(series, ordinal, category === 'all' ? undefined : category === 'unknown' ? null : category, participants, conditionFilter, mode);
  const cards = layout === 'cards' || layout === 'auto' && new Set([...series, ...participants].map(end => end.entryId)).size <= 8;
  const name = (row: typeof rows[number]) => row.displayName || (row.id === entryId ? 'Вы' : `Стрелок ${row.id.slice(0, 5).toUpperCase()}`);
  const bow = (row: typeof rows[number]) => BOW_CATEGORIES.find(item => item.value === row.bow)?.label ?? 'Без категории';
  const format = (value: number | undefined) => value === undefined ? '—' : displayCompositeScore(value);
  const progressLabel = (value?: ProgressResult) => {
    if (value?.percentagePoints == null) return '—';
    const rounded = displayCompositeScore(value.percentagePoints);
    return `${Number(rounded) > 0 ? '+' : ''}${rounded.replace('.', ',')}%`;
  };
  const score = (row: typeof rows[number]) => !row.current ? 'Ещё нет' : mode === 'cg3' ? format(row.compositeSeries?.total)
    : mode === 'pg1' ? progressLabel(row.progressSeries) : `${row.current.points}/${row.current.arrows * 10}`;
  const total = (row: typeof rows[number]) => mode === 'cg3' ? format(row.composite?.total)
    : mode === 'pg1' ? progressLabel(row.progress) : row.arrows ? `${row.points}/${row.arrows * 10}` : '—';
  const progressDetails = (row: typeof rows[number]) => {
    if (mode !== 'pg1' || !row.arrows) return null;
    const { progress, base } = row;
    if (!row.current) return <small>В срезе не хватает серий.</small>;
    if (!base) return <small>Нет базы для этих условий.</small>;
    if (!progress) return <small>Для итога нужна одна база и одинаковые условия.</small>;
    return <details><summary>{progress.fullRankAvailable ? 'Разбор прогресса' : 'Предварительный результат'}</summary>
      <small>{base.sessions < 3 ? 'Для места нужны три похожие тренировки.' : progress.scoredCount < MIN_SCORED_ARROWS
        ? `Для места нужно от ${MIN_SCORED_ARROWS} стрел.` : !progress.fullRankAvailable ? 'Для места нужны все полные серии среза.' : null}</small>
      {progress.baselineAverage !== null && <small>Обычный средний {format(progress.baselineAverage)} · текущий {format(progress.currentAverage ?? undefined)}.
        Процент показывает, на сколько изменилась доля от максимума: 8 вместо 7 из 10 — это +10%.</small>}
    </details>;
  };
  const filtersActive = category !== 'all' || !!conditionFilter || layout !== 'auto';
  const count = new Set([...series, ...participants].map(end => end.entryId)).size;
  return <BottomSheet title={roomName || 'Таблица комнаты'} onClose={onClose} tag="room-leaderboard"
    headerAction={<RoomHelpButton onClick={() => setHelpOpen(true)} />}>
    <div className="room-leaderboard">
      <div className="room-toolbar">
        <div className="room-status" role="status" data-offline={!!error}>
          <Icon name="group" /><span>{finalizedAt ? 'Итоги зафиксированы' : error ? archived ? 'Обновление недоступно' : 'Нет связи' : archived ? 'Сохранённая таблица'
            : received ? `Участники · ${count}` : 'Подключаемся…'}</span>
        </div>
        {finalizedAt && ordinal === latest && rows.some(row => row.arrows) && <button type="button" className="room-pill" disabled={sharing} onClick={async () => {
          setSharing(true);
          setShareStatus('');
          try {
            const label = { classic: 'Классика', cg3: 'Общие очки', pg1: 'Прогресс' }[mode];
            const scope = [conditionFilter && conditions.get(conditionFilter), category !== 'all' &&
              (BOW_CATEGORIES.find(item => item.value === category)?.label ?? 'Без категории')].filter(Boolean).join(' · ');
            const file = roomResultCard(roomName || 'Групповая тренировка', finalizedAt, label, ordinal, scope,
              rows.filter(row => row.arrows).map(row => ({ name: name(row), bow: bow(row), place: row.place, score: total(row) })));
            const result = await shareReport([file], 'FableShot — итоги комнаты');
            if (result === 'downloaded') setShareStatus('Карточка скачана.');
          } catch { setShareStatus('Не удалось подготовить карточку. Попробуйте ещё раз.'); }
          finally { setSharing(false); }
        }}>{sharing ? 'Готовим…' : 'Поделиться итогами'}</button>}
      </div>
      {shareStatus && <small role="status">{shareStatus}</small>}
      {history && (archived || error) && <small>Получено {new Date(history.receivedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</small>}
      {onRefresh && !finalizedAt && <button type="button" className="room-pill" disabled={refreshing} onClick={async () => {
        setRefreshing(true);
        setError('');
        try { setLive(await onRefresh()); }
        catch { setError('Не удалось обновить таблицу комнаты.'); }
        finally { setRefreshing(false); }
      }}>{refreshing ? 'Обновляем…' : 'Обновить таблицу'}</button>}
      <div className="room-modes" role="group" aria-label="Зачёт">
        {([['classic', 'Классика'], ['cg3', 'Общие'], ['pg1', 'Прогресс']] as const).map(([id, label]) =>
          <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}
      </div>
      <div className="room-toolbar">
        <select className="room-pill" aria-label="Серия" value={selected ?? ''} onChange={event => setSelected(event.target.value ? Number(event.target.value) : null)}>
          <option value="">{finalizedAt ? 'Итоги' : archived ? 'Последняя' : 'Моя серия'} · {latest}</option>
          {choices.map(value => <option value={value} key={value}>Серия {value}</option>)}
        </select>
        <button type="button" className="icon-button room-filter-button" data-active={filtersActive} aria-haspopup="dialog"
          aria-label="Фильтры таблицы" onClick={() => setFiltersOpen(true)}><Icon name="filter" /></button>
      </div>
      {filtersActive && <small>Фильтры активны</small>}
      {filtersOpen && <BottomSheet title="Фильтры таблицы" onClose={() => setFiltersOpen(false)}>
      <div className="room-leaderboard-filters">
        <label>Лук<select aria-label="Лук" value={category} onChange={event => setCategory(event.target.value)}>
          <option value="all">Все луки</option><option value="unknown">Без категории</option>
          {BOW_CATEGORIES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}
        </select></label>
      {conditions.size > 0 && <label>Условия<select aria-label="Условия"
        value={conditionFilter ?? ''} onChange={event => setCondition(event.target.value)}>
        <option value="">Все условия</option>
        {[...conditions].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>}
      <label>Вид<select aria-label="Вид" value={layout} onChange={event => setLayout(event.target.value)}>
        <option value="auto">Авто</option><option value="cards">Карточки</option><option value="rows">Список</option>
      </select></label>
      <button type="button" className="primary" onClick={() => setFiltersOpen(false)}>Готово</button>
      </div></BottomSheet>}
      {helpOpen && <RoomHelp onClose={() => setHelpOpen(false)} />}
      {mode === 'classic' && (!conditionFilter || category === 'all') && rows.length > 1 && <small>Товарищеский зачёт</small>}
      {error && <small>{error}{received && ' Показана сохранённая таблица.'}</small>}
      {received && !rows.length && <p>{conditionFilter || category !== 'all' ? 'На этом срезе нет результатов по выбранным фильтрам.' : 'Здесь появятся опубликованные серии.'}</p>}
      {rows.length > 0 && (cards ? <ul className="room-standing-cards">
        {rows.map(row => <li key={row.id} data-own={row.id === entryId}>
          <div className="room-standing-person"><span className="room-place" aria-label={row.place ? `Место ${row.place}` : 'Без места'}>{row.place ?? '—'}</span>
            <span><strong>{name(row)}</strong><small>{bow(row)}</small></span></div>
          <dl><div><dt>За серию</dt><dd>{score(row)}</dd></div><div><dt>{row.arrows && !row.complete ? 'Частичный итог' : 'Итог'}</dt><dd>{total(row)}</dd></div></dl>
          {row.composite && <CompositeBreakdown score={row.composite} />}
          {progressDetails(row)}
        </li>)}
      </ul> : <table><thead><tr><th>Стрелок</th><th>За серию</th><th>Итог</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.id} data-own={row.id === entryId}>
          <th scope="row">{row.place ? `${row.place}. ` : ''}{name(row)}<small>{bow(row)}</small></th>
          <td>{score(row)}</td>
          <td>{total(row)}{mode === 'classic' && row.arrows > 0 && !row.complete && <small>Частичный</small>}
            {row.composite && <CompositeBreakdown score={row.composite} />}{progressDetails(row)}</td>
        </tr>)}
      </tbody></table>)}
    </div>
  </BottomSheet>;
}

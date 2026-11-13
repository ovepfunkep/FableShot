import { useEffect, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { BOW_CATEGORIES } from './equipment.ts';
import { groupStandings, readRoomParticipants, readRoomSeries, roomConditionChoices } from './group-leaderboard.ts';
import type { GroupScoring, RoomHistory } from './group-leaderboard.ts';
import { MIN_SCORED_ARROWS } from './progress-scoring.ts';
import type { ProgressResult } from './progress-scoring.ts';
import { loadRoomMembership, readRoomName, roomSnapshot } from './group-room-membership.ts';
import { displayCompositeScore } from './composite-scoring.ts';
import type { CompositeScore } from './composite-scoring.ts';

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

export function GroupLeaderboard({ entryId, mySeries, onClose, saved, title, archived, onRefresh }: {
  entryId?: string; mySeries: number; onClose: () => void; saved?: RoomHistory; title?: string; archived?: boolean;
  onRefresh?: () => Promise<RoomHistory>;
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

  useEffect(() => {
    if (archived || !entryId) return;
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
        const results = { receivedAt: Date.now(), series: readRoomSeries(snapshot), participants: readRoomParticipants(snapshot) };
        if (!cancelled) { setLive(results); setRoomName(readRoomName(snapshot) ?? membership.roomName ?? title); setError(''); }
      } catch {
        if (!cancelled) setError('Связь с комнатой потеряна.');
      } finally { loading = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [archived, entryId, title]);

  const history = live ?? saved;
  const { series = [], participants = [] } = history ?? {};
  const received = !!history;
  const latest = archived ? series.reduce((max, end) => Math.max(max, end.ordinal), 1) : mySeries;
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
  return <BottomSheet title="Таблица комнаты" onClose={onClose}>
    <div className="room-leaderboard">
      {roomName && <strong>{roomName}</strong>}
      <label className="room-leaderboard-layout">Зачёт<select aria-label="Зачёт" value={mode} onChange={event => setMode(event.target.value as GroupScoring)}>
        <option value="classic">Классические очки</option><option value="cg3">Общие очки</option><option value="pg1">Прогресс</option>
      </select></label>
      {history && (archived || error) && <small>Получено {new Date(history.receivedAt).toLocaleString('ru-RU')}</small>}
      {onRefresh && <button type="button" className="secondary" disabled={refreshing} onClick={async () => {
        setRefreshing(true);
        setError('');
        try { setLive(await onRefresh()); }
        catch { setError('Не удалось обновить таблицу комнаты.'); }
        finally { setRefreshing(false); }
      }}>{refreshing ? 'Обновляем…' : 'Обновить таблицу'}</button>}
      <div className="room-leaderboard-filters">
        <label>Серия<select aria-label="Серия" value={selected ?? ''} onChange={event => setSelected(event.target.value ? Number(event.target.value) : null)}>
          <option value="">{archived ? 'Последняя' : 'Моя'} · {latest}</option>
          {choices.map(value => <option value={value} key={value}>Серия {value}</option>)}
        </select></label>
        <label>Лук<select aria-label="Лук" value={category} onChange={event => setCategory(event.target.value)}>
          <option value="all">Все луки</option><option value="unknown">Без категории</option>
          {BOW_CATEGORIES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}
        </select></label>
      </div>
      {conditions.size > 0 && <label className="room-leaderboard-layout">Условия<select aria-label="Условия"
        value={conditionFilter ?? ''} onChange={event => setCondition(event.target.value)}>
        <option value="">Все условия</option>
        {[...conditions].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>}
      {rows.length > 0 && <label className="room-leaderboard-layout">Вид<select value={layout} onChange={event => setLayout(event.target.value)}>
        <option value="auto">Авто</option><option value="cards">Карточки</option><option value="rows">Список</option>
      </select></label>}
      {(!conditionFilter || category === 'all') && rows.length > 1 && <small>Товарищеский зачёт · условия могут различаться</small>}
      {error && <p role="status">{error}{received && ' Показаны последние полученные результаты.'}</p>}
      {!received && !error && <p role="status">Получаем результаты…</p>}
      {received && !rows.length && <p>{conditionFilter || category !== 'all' ? 'На этом срезе нет результатов по выбранным фильтрам.' : 'Здесь появятся опубликованные серии.'}</p>}
      {rows.length > 0 && (cards ? <ul className="room-standing-cards">
        {rows.map(row => <li key={row.id} data-own={row.id === entryId}>
          <header><strong>{row.place ? `${row.place}. ` : ''}{name(row)}</strong><small>{bow(row)}</small></header>
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

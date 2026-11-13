import { useEffect, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { BOW_CATEGORIES } from './equipment.ts';
import { groupStandings, readRoomSeries } from './group-leaderboard.ts';
import type { RoomSeries } from './group-leaderboard.ts';
import { loadRoomMembership, roomSnapshot } from './group-room-membership.ts';

export function GroupLeaderboard({ entryId, mySeries, onClose }: { entryId: string; mySeries: number; onClose: () => void }) {
  const [series, setSeries] = useState<RoomSeries[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [category, setCategory] = useState('all');
  const [error, setError] = useState('');
  const [received, setReceived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const membership = loadRoomMembership(entryId);
        if (!membership) throw new Error('Приглашение в комнату недоступно.');
        const snapshot = readRoomSeries(await roomSnapshot(membership.invitation));
        if (!cancelled) { setSeries(snapshot); setReceived(true); setError(''); }
      } catch {
        if (!cancelled) setError('Связь с комнатой потеряна.');
      } finally { loading = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [entryId]);

  const ordinal = selected ?? mySeries;
  const choices = [...new Set([mySeries, ...(selected === null ? [] : [selected]), ...series.map(end => end.ordinal)])].sort((a, b) => a - b);
  const rows = groupStandings(series, ordinal, category === 'all' ? undefined : category === 'unknown' ? null : category);
  return <BottomSheet title="Классический зачёт" onClose={onClose}>
    <div className="room-leaderboard">
      <div className="room-leaderboard-filters">
        <label>Серия<select aria-label="Серия" value={selected ?? ''} onChange={event => setSelected(event.target.value ? Number(event.target.value) : null)}>
          <option value="">Моя · {mySeries}</option>
          {choices.map(value => <option value={value} key={value}>Серия {value}</option>)}
        </select></label>
        <label>Лук<select aria-label="Лук" value={category} onChange={event => setCategory(event.target.value)}>
          <option value="all">Все луки</option><option value="unknown">Без категории</option>
          {BOW_CATEGORIES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}
        </select></label>
      </div>
      {category === 'all' && rows.length > 1 && <small>Товарищеский зачёт · условия могут различаться</small>}
      {error && <p role="status">{error}{received && ' Показаны последние полученные результаты.'}</p>}
      {!received && !error && <p role="status">Получаем результаты…</p>}
      {received && !rows.length && <p>Здесь появятся опубликованные серии.</p>}
      {rows.length > 0 && <table><thead><tr><th>Стрелок</th><th>За серию</th><th>Итог</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.id} data-own={row.id === entryId}>
          <th scope="row">{row.place ? `${row.place}. ` : ''}{row.id === entryId ? 'Вы' : `Стрелок ${row.id.slice(0, 5).toUpperCase()}`}
            <small>{BOW_CATEGORIES.find(item => item.value === row.bow)?.label ?? 'Без категории'}</small></th>
          <td>{row.current ? `${row.current.points}/${row.current.arrows * 10}` : 'Ещё нет'}</td>
          <td>{row.arrows ? `${row.points}/${row.arrows * 10}` : '—'}{row.arrows > 0 && !row.complete && <small>Частичный</small>}</td>
        </tr>)}
      </tbody></table>}
    </div>
  </BottomSheet>;
}

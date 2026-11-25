import { useRef, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { roomShotLabel, roomShotPoints } from './group-leaderboard.ts';
import type { RoomHistory } from './group-leaderboard.ts';
import { BOW_CATEGORIES } from './equipment.ts';
import { scoreColor } from './score-appearance.ts';
import { getTargetProfile, MISS_RING_WIDTH, spotOffsets, spotPoint, zoneColor } from './target.ts';
import { Icon } from './TrainingChrome.tsx';

export function RoomTargetViewer({ history, ids, initialId, ownId, ordinal, choices, onSeries, onClose }: {
  history: RoomHistory; ids: readonly string[]; initialId: string; ownId?: string; ordinal: number;
  choices: readonly number[]; onSeries: (ordinal: number) => void; onClose: () => void;
}) {
  const [person, setPerson] = useState(() => Math.max(0, ids.indexOf(initialId)));
  const [selection, setSelection] = useState<{ ordinal: number; person: number; shot: number }>();
  const start = useRef<{ x: number; y: number } | null>(null);
  const id = ids[person];
  const historyEntry = history.series.find(entry => entry.entryId === id && entry.ordinal === ordinal);
  const member = history.participants.find(entry => entry.entryId === id);
  const latest = history.series.find(entry => entry.entryId === id);
  const name = member?.displayName || historyEntry?.displayName || latest?.displayName || (id === ownId ? 'Вы' : 'Стрелок ' + id.slice(0, 5).toUpperCase());
  const result = historyEntry?.result;
  const scores = result?.scores;
  const conditions = result?.conditions;
  const bow = BOW_CATEGORIES.find(item => item.value === (result?.bowCategory ?? member?.bowCategory))?.label;
  const profile = conditions && getTargetProfile(conditions.targetProfileId);
  const selected = selection?.ordinal === ordinal && selection.person === person ? selection.shot : undefined;
  const positions = result?.shotPositions;
  const spotRadius = (profile?.zones.at(-1)?.outerRadius ?? 1) + MISS_RING_WIDTH;
  const fieldHeight = profile?.vertical ? spotRadius * 2 + 2.4 : spotRadius * 2;
  const span = fieldHeight + .24;
  const mapped = positions?.some(Boolean);
  const seriesIndex = choices.indexOf(ordinal);
  const changePerson = (next: number) => {
    setSelection(undefined);
    setPerson(Math.max(0, Math.min(ids.length - 1, next)));
  };
  const previousSeries = choices[seriesIndex - 1];
  const nextSeries = choices[seriesIndex + 1];
  const details = [bow, conditions && conditions.distanceMeters + ' м', profile && profile.title,
    conditions && conditions.targetDiameterMm / 10 + ' см'].filter(Boolean).join(' · ');

  return <BottomSheet title="Мишени участников" onClose={onClose} tag="room-target-viewer" className="room-viewer-sheet"
    headerLeading={<button type="button" className="room-viewer-back" onClick={onClose}><Icon name="back" />Таблица</button>}
    headerAction={<div className="room-ordinal">
      <button type="button" className="icon-button" aria-label="Предыдущая серия на мишени" disabled={previousSeries === undefined}
        onClick={() => onSeries(previousSeries)}><Icon name="left" /></button>
      <select value={ordinal} aria-label="Серия на мишени" onChange={event => onSeries(Number(event.currentTarget.value))}>
        {choices.map(number => <option key={number} value={number}>Серия {number}</option>)}
      </select>
      <button type="button" className="icon-button" aria-label="Следующая серия на мишени" disabled={nextSeries === undefined}
        onClick={() => onSeries(nextSeries)}><Icon name="right" /></button>
    </div>}>
    <div className="room-viewer" onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        changePerson(person + (event.key === 'ArrowLeft' ? -1 : 1));
      }
    }}>
      <div className="room-viewer-person" aria-live="polite">
        <div><h3>{name}</h3>{details && <small>{details}</small>}</div>
        <strong>{result ? <>{result.points}<small>/{result.arrows * 10}</small></> : '—'}</strong>
      </div>
      <div className="room-viewer-map" onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        start.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerUp={event => {
        const origin = start.current;
        start.current = null;
        if (!origin) return;
        const x = event.clientX - origin.x;
        if (Math.abs(x) > 36 && Math.abs(x) > Math.abs(event.clientY - origin.y) * 1.35) changePerson(person + (x < 0 ? 1 : -1));
      }} onPointerCancel={() => { start.current = null; }}>
        {result && profile && mapped ? <svg viewBox={[-span / 2, -span / 2, span, span].join(' ')}
          role="img" aria-label={'Мишень · ' + name} data-testid="room-viewer-target">
          {spotOffsets(profile).map((y, index) => <g key={index}>
            <circle cy={y} r={spotRadius} fill="#536052" />
            {[...profile.zones].reverse().map(zone => <circle key={zone.code} cy={y} r={zone.outerRadius}
              fill={zoneColor(zone.points)} stroke="#30352c" strokeWidth={.008} />)}
            {profile.vertical && <text x={spotRadius + .12} y={y + .035} fill="currentColor" fontSize={.13}>{index + 1}</text>}
          </g>)}
          {positions?.map((point, index) => ({ point, index })).sort((a, b) => Number(a.index === selected) - Number(b.index === selected))
            .map(({ point, index }) => {
              if (!point) return null;
              const { x, y } = spotPoint({ x: point[0], y: point[1] }, point[2]);
              const active = selected === index;
              return <g key={index} data-testid="room-viewer-marker" data-selected={active} transform={`translate(${x},${y})`}>
                {active && <circle r={.079} fill="none" stroke="#fff2a4" strokeWidth={.018} />}
                <circle r={.039} fill={scores?.[index] === '0' ? '#657263' : '#162019'} stroke="#fff" strokeWidth={.012} />
              </g>;
            })}
        </svg> : <p>{result ? 'Координаты не переданы' : 'Серия не получена'}</p>}
      </div>
      {scores && <div className="room-series-shots room-viewer-shots" aria-label="Выстрелы">
        {Array.from(scores, (code, index) => {
          const points = roomShotPoints(code);
          return <button key={index} type="button" aria-label={`Стрела ${index + 1} · ${roomShotLabel(code)}`}
            data-dark={points >= 3 && points <= 4 || points === 0} aria-pressed={selected === index}
            onClick={() => setSelection(index === selected ? undefined : { person, ordinal, shot: index })}
            style={{ backgroundColor: scoreColor(points) }}>{roomShotLabel(code)}</button>;
        })}
      </div>}
      {selected !== undefined && !positions?.[selected] && <small className="room-caption">У этой стрелы есть только оценка.</small>}
      <nav className="room-viewer-pager" aria-label="Участники">
        <button type="button" className="icon-button" aria-label="Предыдущий участник" disabled={person === 0} onClick={() => changePerson(person - 1)}><Icon name="left" /></button>
        <div className="room-viewer-dots" role="img" aria-label={`Участник ${person + 1} из ${ids.length}`}>
          {ids.length <= 20 ? ids.map((id, index) => <span key={id} aria-hidden="true" data-active={index === person} />) : <small>{person + 1} / {ids.length}</small>}
        </div>
        <button type="button" className="icon-button" aria-label="Следующий участник" disabled={person === ids.length - 1} onClick={() => changePerson(person + 1)}><Icon name="right" /></button>
      </nav>
    </div>
  </BottomSheet>;
}

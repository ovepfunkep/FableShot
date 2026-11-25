import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './TrainingChrome.tsx';
import { encodeTechniqueStepLines, techniqueStepLines } from './technique.ts';
import type { TechniqueStep } from './technique.ts';

type Row = { id: string; text: string };

function newRow(text = ''): Row {
  return { id: crypto.randomUUID(), text };
}

export function TechniqueSubpointEditor({ step, number, onChange }: {
  step: TechniqueStep; number: string; onChange: (fields: Pick<TechniqueStep, 'detail' | 'children'>) => void;
}) {
  const [rows, setRows] = useState(() => techniqueStepLines(step).map(newRow));
  const [removed, setRemoved] = useState<{ row: Row; index: number }>();
  const [focusId, setFocusId] = useState<string>();
  const [menuId, setMenuId] = useState<string>();
  const [dropId, setDropId] = useState<string>();
  const [limitReached, setLimitReached] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: string; to: string | undefined; y: number; moved: boolean } | undefined>(undefined);

  useLayoutEffect(() => {
    if (focusId) {
      list.current?.querySelector<HTMLTextAreaElement>(`[data-subpoint="${focusId}"] textarea`)?.focus();
      setFocusId(undefined);
    }
  }, [focusId]);

  function save(next: Row[]) {
    const fields = encodeTechniqueStepLines(next.map(row => row.text));
    setLimitReached(!fields);
    if (!fields) return false;
    setRows(next);
    if (fields.detail !== step.detail || fields.children !== step.children) onChange(fields);
    return true;
  }

  function move(from: number, to: number) {
    if (from < 0 || to < 0 || from === to || to >= rows.length) return;
    const next = [...rows];
    next.splice(to, 0, ...next.splice(from, 1));
    save(next);
  }

  return <div className="technique-subpoints" ref={list}>
    {rows.map((row, index) => {
      const label = `${number}.${index + 1}`;
      return <div className="technique-subpoint" key={row.id} data-subpoint={row.id} data-drop={dropId === row.id || undefined}>
        <label htmlFor={`subpoint-${row.id}`}>{label}</label>
        <textarea id={`subpoint-${row.id}`} aria-label={`Подпункт ${label}`} rows={1} maxLength={4000} value={row.text} onChange={event => {
          const [first, ...rest] = event.target.value.split(/\r\n?|\n/);
          const inserted = rest.map(newRow);
          if (save([...rows.slice(0, index), { ...row, text: first }, ...inserted, ...rows.slice(index + 1)]) && inserted.length) {
            setFocusId(inserted.at(-1)?.id);
          }
        }} />
        <button type="button" className="icon-button technique-grip" aria-label={`Порядок подпункта ${label}`} aria-expanded={menuId === row.id}
          onClick={() => { if (!drag.current?.moved) setMenuId(current => current === row.id ? undefined : row.id); drag.current = undefined; }}
          onPointerDown={event => { if (event.button === 0) { drag.current = { from: row.id, to: undefined, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); } }}
          onPointerMove={event => {
            const gesture = drag.current;
            if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId) || (!gesture.moved && Math.abs(gesture.y - event.clientY) < 8)) return;
            const destination = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-subpoint]');
            gesture.moved = true;
            gesture.to = destination && list.current?.contains(destination) ? destination.dataset.subpoint : undefined;
            setDropId(gesture.to);
          }}
          onPointerUp={() => {
            if (drag.current?.moved) {
              const { from, to } = drag.current;
              move(rows.findIndex(item => item.id === from), rows.findIndex(item => item.id === to));
              setDropId(undefined);
            }
          }}
          onPointerCancel={() => { drag.current = undefined; setDropId(undefined); }}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M8 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M8 16a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3" /></svg>
        </button>
        <button type="button" className="icon-button" aria-label={`Удалить подпункт ${label}`} onClick={() => {
          if (save(rows.filter(item => item.id !== row.id))) setRemoved({ row, index });
        }}><Icon name="delete" /></button>
        {menuId === row.id && <div className="technique-subpoint-menu">
          <button type="button" className="technique-text-button" disabled={index === 0} onClick={() => move(index, index - 1)}>Выше</button>
          <button type="button" className="technique-text-button" disabled={index === rows.length - 1} onClick={() => move(index, index + 1)}>Ниже</button>
        </div>}
      </div>;
    })}
    <div className="technique-row">
      <button type="button" className="technique-text-button" onClick={() => {
        const row = newRow(); setRows([...rows, row]); setFocusId(row.id);
      }}>＋ Добавить подпункт</button>
      {removed && <button type="button" className="technique-text-button" onClick={() => {
        const next = [...rows]; next.splice(removed.index, 0, removed.row);
        if (save(next)) { setRemoved(undefined); setFocusId(removed.row.id); }
      }}>Вернуть</button>}
    </div>
    {limitReached && <span className="technique-error" role="alert">Текст не помещается в памятку. Сократи подпункт или разбей его на строки.</span>}
  </div>;
}

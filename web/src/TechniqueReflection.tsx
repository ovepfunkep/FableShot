import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Practice } from './practice.ts';
import type { TechniqueSelection } from './technique.ts';
import {
  emptyTechniqueReflection, MAX_REFLECTION_TEXT, relevantTechniqueUseIndexes, techniqueUsePlace, updateTechniqueReflection,
} from './technique-reflection.ts';
import type { TechniqueReflectionEntry } from './technique-reflection.ts';
import { useTechniqueSettings } from './TechniqueSettings.tsx';
import './technique-reflection.css';

const ratings = [
  { value: 'yes', title: 'Получалось' },
  { value: 'unstable', title: 'Нестабильно' },
  { value: 'untracked', title: 'Не отслеживал' },
] as const;
type ReflectionDraft = { entry: TechniqueReflectionEntry; original: string; use: string };

function ReflectionEditor({ entry, error, onChange, onSave, onClose }: {
  entry: TechniqueReflectionEntry;
  error: string;
  onChange: (entry: TechniqueReflectionEntry) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="reflection-dialog" aria-labelledby={headingId} data-testid="technique-reflection-dialog"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="reflection-form" onSubmit={event => { event.preventDefault(); onSave(); }}>
      <h2 id={headingId}>После тренировки</h2>
      <label className="reflection-field"><span>Что получилось?</span>
        <textarea value={entry.worked} maxLength={MAX_REFLECTION_TEXT} rows={3} data-testid="reflection-worked"
          onChange={event => onChange({ ...entry, worked: event.target.value })} />
      </label>
      <label className="reflection-field"><span>Что хочу разобрать?</span>
        <textarea value={entry.question} maxLength={MAX_REFLECTION_TEXT} rows={3} data-testid="reflection-question"
          onChange={event => onChange({ ...entry, question: event.target.value })} />
      </label>
      <div className="reflection-ratings" role="group" aria-label="Как получалось">
        {ratings.map(rating => <button key={rating.value} type="button" aria-pressed={entry.rating === rating.value}
          data-testid={`reflection-rating-${rating.value}`} onClick={() => onChange({ ...entry, rating: entry.rating === rating.value ? null : rating.value })}>
          {rating.title}
        </button>)}
      </div>
      {error && <p className="reflection-error" role="alert">{error}</p>}
      <div className="reflection-actions">
        <button type="button" onClick={onClose}>Пропустить</button>
        <button type="submit" data-testid="reflection-save">Сохранить</button>
      </div>
    </form>
  </dialog>;
}

export function TechniqueReflection({ practice, onChange, onOpenMemo }: {
  practice: Practice;
  onChange: (next: Practice) => boolean;
  onOpenMemo: (selection: TechniqueSelection) => void;
}) {
  const { settings } = useTechniqueSettings();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReflectionDraft>>({});
  const [failure, setFailure] = useState<{ useIndex: number; message: string } | null>(null);
  const latest = useRef(practice);
  latest.current = practice;
  const listId = useId();
  const relevant = relevantTechniqueUseIndexes(practice);
  const draft = editing === null ? null : drafts[String(editing)];

  function edit(useIndex: number) {
    const key = String(useIndex);
    if (!drafts[key]) {
      const entry = practice.techniqueReflections?.[key] ?? emptyTechniqueReflection();
      setDrafts(previous => ({ ...previous, [key]: { entry: { ...entry }, original: JSON.stringify(entry),
        use: JSON.stringify(practice.techniqueUses?.[useIndex]) } }));
    }
    setEditing(useIndex);
  }
  function save() {
    if (editing === null || !draft) return;
    const key = String(editing);
    try {
      const current = latest.current;
      if (JSON.stringify(current.techniqueUses?.[editing]) !== draft.use ||
        JSON.stringify(current.techniqueReflections?.[key] ?? emptyTechniqueReflection()) !== draft.original) {
        throw new Error('Рефлексия изменена в другом окне. Твой текст остаётся в форме.');
      }
      if (!onChange(updateTechniqueReflection(current, editing, draft.entry))) {
        throw new Error('Не удалось сохранить рефлексию. Текст остаётся в форме; повтори действие.');
      }
      setDrafts(previous => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      if (failure?.useIndex === editing) setFailure(null);
      setEditing(null);
    } catch (cause) {
      setFailure({ useIndex: editing, message: cause instanceof Error ? cause.message : 'Не удалось сохранить рефлексию.' });
    }
  }

  if (practice.savedAt === null || !relevant.length) return null;
  return <section className="technique-reflection" aria-label="Техника и рефлексия">
    <button type="button" className="reflection-expand" aria-expanded={expanded} aria-controls={listId}
      data-testid="report-technique" onClick={() => setExpanded(value => !value)}>
      Техника и рефлексия · {relevant.length}<span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
    </button>
    {expanded && <div className="reflection-uses" id={listId}>
      {relevant.map(index => {
        const selection = practice.techniqueUses![index].selection;
        const entry = practice.techniqueReflections?.[String(index)];
        const focus = [selection.focus1, selection.focus2].filter(value => value.trim()).join(' · ');
        const place = techniqueUsePlace(practice, index);
        return <article className="reflection-use" key={index} data-testid={`report-technique-use-${index}`}>
          <div className="reflection-use-heading">
            <div><p className="reflection-place">{place}</p>
              {focus && <p className="reflection-focus">{focus}</p>}
            </div>
            {settings.techniqueReflection && <button type="button" className="reflection-edit" onClick={() => edit(index)}
              aria-label={`Рефлексия · ${place}`} data-testid={`reflection-edit-${index}`}>Рефлексия</button>}
          </div>
          {selection.versionId && <button type="button" className="reflection-memo" onClick={() => onOpenMemo(selection)}>
            {selection.title} · версия {selection.versionNumber}
          </button>}
          {entry?.worked.trim() && <p className="reflection-content">Получилось: {entry.worked}</p>}
          {entry?.question.trim() && <p className="reflection-content">Обсудить: {entry.question}</p>}
          {entry?.rating && <span className="reflection-rating">{ratings.find(rating => rating.value === entry.rating)?.title}</span>}
        </article>;
      })}
    </div>}
    {failure && (editing === null || !settings.techniqueReflection) && <p className="reflection-error" role="alert">{failure.message}</p>}
    {draft && editing !== null && settings.techniqueReflection && <ReflectionEditor entry={draft.entry}
      error={failure?.useIndex === editing ? failure.message : ''} onSave={save} onClose={() => setEditing(null)}
      onChange={entry => setDrafts(previous => ({ ...previous, [String(editing)]: { ...previous[String(editing)], entry } }))} />}
  </section>;
}

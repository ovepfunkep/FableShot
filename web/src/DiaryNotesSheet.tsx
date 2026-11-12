import { useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { NOTE_FIELD_LIMITS, encodeNoteTags, isDiaryNote, legacyNoteConditions, notesInScope } from './diary-notes.ts';
import type { DiaryNote, DiaryNoteScope } from './diary-notes.ts';
import { isLocalDate } from './import-source.ts';
import './diary-notes.css';

type Draft = { initial: DiaryNote; note: DiaryNote; tags: string; isNew: boolean; detailsOpen: boolean };
type Confirmation = 'delete' | 'discard-list' | 'discard-close';
const detailLabels = { place: 'Место', feeling: 'Самочувствие', conditions: 'Условия' } as const;
const detailFields = ['place', 'feeling', 'conditions'] as const;
const editableFields = ['localDate', 'body', ...detailFields] as const;

function readTags(text: string): { tags: string[]; error: string } {
  try { return { tags: encodeNoteTags(text), error: '' }; }
  catch (error) { return { tags: [], error: (error as Error).message }; }
}

function noteDraft(note: DiaryNote, isNew = false): Draft {
  return { initial: note, note, tags: note.tags.join(', '), isNew, detailsOpen: detailFields.some(field => !!note[field]) };
}

function emptyNote(scope: DiaryNoteScope): DiaryNote {
  const now = new Date();
  return { ...scope, id: crypto.randomUUID(), localDate: new Intl.DateTimeFormat('sv-SE').format(now), body: '', tags: [],
    place: '', feeling: '', conditions: '', createdAtMs: now.getTime(), updatedAtMs: now.getTime() };
}

export function DiaryNotesSheet({ notes, scope, readOnly = false, onSave, onClose, initialNoteId, initialNew = false, standalone = false, includeConditionNotes = false }: {
  notes: readonly DiaryNote[];
  scope: DiaryNoteScope;
  readOnly?: boolean;
  onSave: (nextNotes: DiaryNote[]) => boolean;
  onClose: () => void;
  initialNoteId?: string;
  initialNew?: boolean;
  standalone?: boolean;
  includeConditionNotes?: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(() => {
    const existing = initialNoteId ? notes.find(note => note.id === initialNoteId) : null;
    return existing ? noteDraft(existing) : initialNew ? noteDraft(emptyNote(scope), true) : null;
  });
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState('');
  const { tags, error: tagError } = readTags(draft?.tags ?? '');
  const note = draft && { ...draft.note, tags };
  const changed = !!draft && !!note && (!!tagError || tags.length !== draft.initial.tags.length ||
    tags.some((tag, index) => tag !== draft.initial.tags[index]) || editableFields.some(field => note[field] !== draft.initial[field]));
  const archived = draft?.note.deletedAtMs != null;
  const canSave = !readOnly && !archived && changed && !tagError && isDiaryNote(note);
  const direct = initialNoteId !== undefined || initialNew;

  function open(note: DiaryNote, isNew = false) {
    setError('');
    setDraft(noteDraft(note, isNew));
  }

  function add() {
    open(emptyNote(scope), true);
  }

  function change(field: typeof editableFields[number], value: string) {
    setDraft(current => current && { ...current, note: { ...current.note, [field]: value } });
  }

  function backToList() {
    setDraft(null);
    setConfirmation(null);
    setError('');
    if (direct) onClose();
  }

  function back(discard: 'discard-list' | 'discard-close') {
    setError('');
    if (confirmation) setConfirmation(null);
    else if (changed && !readOnly) setConfirmation(discard);
    else if (discard === 'discard-list') backToList();
    else onClose();
  }

  function save(replacement: DiaryNote | null) {
    if (!draft || readOnly) return;
    const current = notes.find(item => item.id === draft.initial.id);
    if (current !== (draft.isNew ? undefined : draft.initial)) {
      setError('Заметка изменилась. Открой её снова.');
      return;
    }
    const now = Date.now();
    const next = !replacement ? notes.map(item => item.id === current?.id ? { ...item, deletedAtMs: now, updatedAtMs: now } : item)
      : current ? notes.map(item => item.id === current.id ? replacement : item) : [...notes, replacement];
    if (onSave(next)) backToList();
    else setError(replacement ? 'Не удалось сохранить заметку. Повтори действие.' : 'Не удалось удалить заметку. Повтори действие.');
  }

  const scoped = draft ? [] : notesInScope(notes, scope, includeConditionNotes);
  const listTitle = scope.seriesId !== undefined ? 'Заметки к серии' : scope.conditionKey !== undefined ? 'Заметки к условиям' : standalone ? 'Отдельные записи' : 'Заметки к тренировке';
  const title = confirmation === 'delete' ? 'Удалить заметку?' : confirmation ? 'Не сохранять изменения?'
    : draft ? draft.isNew ? 'Новая заметка' : archived ? 'Заметка в архиве' : 'Заметка' : listTitle;

  return <BottomSheet title={title} tag="diary-notes-sheet" onClose={() => back('discard-close')}>
    {confirmation ? <div className="diary-notes-grid">
      <div className="diary-notes-actions">
        <button type="button" autoFocus onClick={() => back('discard-close')}>{confirmation === 'delete' ? 'Отмена' : 'Продолжить запись'}</button>
        {confirmation === 'delete'
          ? <button type="button" className="diary-notes-danger" data-testid="note-delete-confirm" onClick={() => save(null)}>В архив</button>
          : <button type="button" onClick={confirmation === 'discard-list' ? backToList : onClose}>Не сохранять</button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </div> : draft ? <form className="diary-notes-grid" data-testid="note-editor" onSubmit={event => {
      event.preventDefault();
      if (canSave) save({ ...note, place: note.place.trim(), feeling: note.feeling.trim(), conditions: note.conditions.trim(), updatedAtMs: Date.now() });
    }}>
      {draft.note.conditionKey && <small className="diary-note-scope">{legacyNoteConditions(draft.note.conditionKey)}</small>}
      <label>Дата
        <input type="text" inputMode="text" placeholder="ГГГГ-ММ-ДД" maxLength={10} value={draft.note.localDate}
          data-testid="note-date" aria-invalid={!isLocalDate(draft.note.localDate)} readOnly={readOnly || archived} onChange={event => change('localDate', event.target.value)} />
      </label>
      {!isLocalDate(draft.note.localDate) && <small role="alert">Введи дату в формате ГГГГ-ММ-ДД.</small>}
      <label>Мои наблюдения
        <textarea rows={4} maxLength={NOTE_FIELD_LIMITS.body} value={draft.note.body} data-testid="note-body"
          readOnly={readOnly || archived} onChange={event => change('body', event.target.value)} />
      </label>
      <label>Теги через запятую
        <input maxLength={500} value={draft.tags} data-testid="note-tags" aria-invalid={!!tagError} readOnly={readOnly || archived}
          onChange={event => setDraft(current => current && { ...current, tags: event.target.value })} />
      </label>
      {tagError && <small role="alert">{tagError}</small>}
      {(!readOnly || detailFields.some(field => !!draft.note[field])) && <button type="button" className="text-action" aria-expanded={draft.detailsOpen} data-testid="note-context"
        onClick={() => setDraft(current => current && { ...current, detailsOpen: !current.detailsOpen })}>Место, самочувствие и условия</button>}
      {draft.detailsOpen && <div className="diary-notes-details">
        {detailFields.map(field => {
          const props = { maxLength: NOTE_FIELD_LIMITS[field], value: draft.note[field], 'data-testid': `note-${field}`, readOnly: readOnly || archived };
          return <label key={field}>{detailLabels[field]}
            {field === 'conditions' ? <textarea {...props} rows={2} onChange={event => change(field, event.target.value)} />
              : <input {...props} onChange={event => change(field, event.target.value)} />}
          </label>;
        })}
      </div>}
      {error && <p role="alert">{error}</p>}
      <div className="diary-notes-actions">
        <button type="button" onClick={() => back('discard-list')}>{direct ? 'Закрыть' : 'К списку'}</button>
        {!readOnly && !archived && <button type="submit" className="primary" data-testid="note-save" disabled={!canSave}>Сохранить</button>}
      </div>
      {!readOnly && !archived && !draft.isNew && <button type="button" className="text-action diary-notes-danger" data-testid="note-delete" onClick={() => {
        setError('');
        setConfirmation('delete');
      }}>Удалить заметку</button>}
    </form> : <div className="diary-notes-grid">
      {scoped.length ? <ul className="diary-notes-list">{scoped.map(item => {
        const preview = [item.body, item.place, item.feeling, item.conditions].find(text => text.trim());
        return <li key={item.id}>
          <button type="button" className="diary-note-item" data-testid="note-item" onClick={() => open(item)}>
            <time dateTime={item.localDate}>{item.localDate}</time>
            {item.conditionKey && <small className="diary-note-scope">{legacyNoteConditions(item.conditionKey)}</small>}
            {preview && <span className="diary-note-preview">{preview}</span>}
            {item.tags.length > 0 && <span className="diary-note-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}
          </button>
        </li>;
      })}</ul> : <p className="diary-notes-empty">Заметок пока нет.</p>}
      <div className="diary-notes-actions">
        <button type="button" onClick={onClose}>Закрыть</button>
        {!readOnly && <button type="button" className="primary" data-testid="note-add" onClick={add}>Добавить заметку</button>}
      </div>
    </div>}
  </BottomSheet>;
}

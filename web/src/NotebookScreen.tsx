import { useState } from 'react';
import { DiaryNotesSheet } from './DiaryNotesSheet.tsx';
import type { DiaryNote, DiaryNoteScope } from './diary-notes.ts';
import type { DiaryEntry } from './persistence.ts';
import { Icon } from './TrainingChrome.tsx';
import './notebook-screen.css';

type LocatedNote = { note: DiaryNote; entry?: DiaryEntry };
type Editor = { entry?: DiaryEntry; note?: DiaryNote; create?: boolean };
const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'UTC' });
const displayDate = (localDate: string) => date.format(new Date(`${localDate}T00:00:00Z`));

function scopeTitle(note: DiaryNote) {
  return note.seriesId !== undefined ? 'Заметки серии' : note.conditionKey !== undefined ? 'Заметки условий' : 'Заметки тренировки';
}

export function NotebookScreen({ entries, notes, onSaveStandalone, onSaveSession, onOpenSession, onBack }: {
  entries: readonly DiaryEntry[];
  notes: readonly DiaryNote[];
  onSaveStandalone: (next: DiaryNote[]) => boolean;
  onSaveSession: (id: string, next: DiaryNote[]) => boolean;
  onOpenSession: (id: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const needle = query.trim().replace(/^#/, '').toLocaleLowerCase('ru-RU');
  const all: LocatedNote[] = [
    ...notes.map(note => ({ note })),
    ...entries.flatMap(entry => (entry.notes ?? []).map(note => ({ note, entry }))),
  ];
  const shown = all.filter(({ note }) => note.deletedAtMs == null &&
    (!needle || [note.body, note.localDate, note.place, note.feeling, note.conditions, ...note.tags]
      .some(value => value.toLocaleLowerCase('ru-RU').includes(needle))))
    .sort((a, b) => b.note.localDate.localeCompare(a.note.localDate) || b.note.createdAtMs - a.note.createdAtMs || a.note.id.localeCompare(b.note.id));
  const currentEntry = editor?.entry ? entries.find(entry => entry.id === editor.entry!.id) : undefined;
  const editorNotes = editor?.entry ? currentEntry?.notes ?? [] : notes;
  const scope: DiaryNoteScope = editor?.note
    ? { ...(editor.note.seriesId !== undefined ? { seriesId: editor.note.seriesId } : {}),
      ...(editor.note.conditionKey !== undefined ? { conditionKey: editor.note.conditionKey } : {}) } : {};
  return <main className="conditions-page" data-testid="notebook-screen">
    <header className="topbar"><button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button><h1>Заметки</h1></header>
    <div className="conditions-content notebook-content">
      <div className="notebook-search">
        <label><span className="sr-only">Поиск по заметкам</span><input type="search" placeholder="Поиск по заметкам"
          maxLength={120} value={query} data-testid="notebook-search" onChange={event => setQuery(event.target.value)} /></label>
        <button type="button" className="icon-button" aria-label="Написать заметку" data-testid="notebook-add"
          onClick={() => setEditor({ create: true })}><span aria-hidden="true">＋</span></button>
      </div>
      {!shown.length ? <p className="notebook-empty" role="status">{needle ? 'Ничего не найдено' : 'Пока нет заметок. Можно написать отдельную запись без тренировки.'}</p>
        : <ul className="notebook-list">{shown.map(({ note, entry }) => <li key={`${entry?.id ?? 'standalone'}:${note.id}`}
          data-testid="notebook-item">
          <button type="button" className="notebook-note" onClick={() => setEditor({ entry, note })}>
            <span className="notebook-note-meta"><Icon name="notes" /><time dateTime={note.localDate}>{displayDate(note.localDate)}</time>
              {!entry && <span>Отдельная запись</span>}</span>
            {note.body.trim() && <span className="notebook-body">{note.body}</span>}
            {[note.place, note.feeling, note.conditions].some(value => value.trim()) && <span className="notebook-context">
              {[note.place, note.feeling, note.conditions].filter(value => value.trim()).join(' · ')}</span>}
            {!!note.tags.length && <span className="diary-note-tags">{note.tags.map(tag => <span key={tag}>#{tag}</span>)}</span>}
          </button>
          {entry && (!entry.deletedAt ? <button type="button" className="notebook-source" data-testid="notebook-source"
            onClick={() => onOpenSession(entry.id)}><span>{scopeTitle(note)} · {entry.title || 'Тренировка'}</span><Icon name="right" /></button>
            : <p className="notebook-unavailable">{scopeTitle(note)} · тренировка в корзине</p>)}
        </li>)}</ul>}
    </div>
    {editor && <DiaryNotesSheet key={`${editor.entry?.id ?? 'standalone'}:${editor.note?.id ?? 'new'}`}
      notes={editorNotes} scope={scope} standalone={!editor.entry} initialNoteId={editor.note?.id} initialNew={editor.create}
      onSave={next => editor.entry ? onSaveSession(editor.entry.id, next) : onSaveStandalone(next)}
      onClose={() => setEditor(null)} />}
  </main>;
}

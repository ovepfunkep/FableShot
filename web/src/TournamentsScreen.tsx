import { useMemo, useRef, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import { BOW_CATEGORIES, bowCategoryName } from './equipment.ts';
import type { DiaryEntry } from './persistence.ts';
import { compareDiaryDate } from './diary-history.ts';
import { roundShots } from './practice.ts';
import { summarize } from './target.ts';
import { emptyTournamentStart, isTournament, MAX_PROTOCOL_FILE, readTournamentAttachment, tournamentLinks, tournamentStatuses, tournamentTitle } from './tournaments.ts';
import type { Tournament, TournamentAttachment, TournamentStart } from './tournaments.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { exportDocument } from './document-export.ts';
import './tournaments.css';

const localDate = new Intl.DateTimeFormat('sv-SE');
const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' });
const sessionLabel = (entry: DiaryEntry) => `${entry.startedAt ? date.format(new Date(entry.startedAt)) : 'Без даты'} · ${entry.title || 'Тренировка'}`;

function StartEditor({ start, index, entries, occupied, onChange, onRemove }: {
  start: TournamentStart; index: number; entries: readonly DiaryEntry[]; occupied: ReadonlySet<string>;
  onChange: (value: TournamentStart) => void; onRemove?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const search = query.trim().toLocaleLowerCase('ru-RU');
  const linked = new Set(start.sessionIds);
  const candidates = entries.filter(entry => linked.has(entry.id) ||
    (!entry.deletedAt && !occupied.has(entry.id) && sessionLabel(entry).toLocaleLowerCase('ru-RU').includes(search)));
  return <fieldset className="tournament-start">
    <legend>Старт {index + 1}</legend>
    <div className="tournament-fields">
      <label>Категория<input value={start.category} maxLength={120} placeholder="Например, мужчины 18 м"
        onChange={e => onChange({ ...start, category: e.target.value })} /></label>
      <label>Тип лука<select value={start.bow ?? ''} onChange={e => onChange({ ...start,
        bow: BOW_CATEGORIES.find(category => category.value === e.target.value)?.value ?? null })}>
        <option value="">Не указан</option>{BOW_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
      </select></label>
      <label>Статус<select value={start.status} onChange={e => {
        const status = e.target.value as TournamentStart['status'];
        onChange(status === 'participated' ? { ...start, status } : { ...start, status, result: '', place: null });
      }}>
        {Object.entries(tournamentStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {start.status === 'participated' && <>
        <label className="tournament-wide">Итог по протоколу<input value={start.result} maxLength={240} placeholder="Очки, счёт матча, DNF или DSQ"
          onChange={e => onChange({ ...start, result: e.target.value })} /></label>
        <label>Место<input type="number" inputMode="numeric" min={1} step={1} value={start.place ?? ''}
          onChange={e => onChange({ ...start, place: e.target.value ? e.target.valueAsNumber : null })} /></label>
        <label>Участников в категории<input type="number" inputMode="numeric" min={1} step={1} value={start.participants ?? ''}
          onChange={e => onChange({ ...start, participants: e.target.value ? e.target.valueAsNumber : null })} /></label>
      </>}
    </div>
    <details className="tournament-link-picker">
      <summary>Связанные тренировки{linked.size ? ` · ${linked.size}` : ''}</summary>
      <label>Поиск тренировки<input type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(20); }} /></label>
      {!candidates.length && <p>Подходящих тренировок пока нет.</p>}
      <div className="tournament-link-list">
        {candidates.filter((entry, index) => index < limit || linked.has(entry.id)).map(entry => <label key={entry.id}>
          <input type="checkbox" checked={linked.has(entry.id)} onChange={e => onChange({ ...start, sessionIds: e.target.checked
            ? [...start.sessionIds, entry.id] : start.sessionIds.filter(id => id !== entry.id) })} />
          <span>{sessionLabel(entry)}{entry.deletedAt ? ' · в корзине' : ''}</span>
        </label>)}
      </div>
      {candidates.length > limit && <button type="button" className="text-action" onClick={() => setLimit(limit + 20)}>Показать ещё</button>}
    </details>
    {onRemove && <button type="button" className="text-action tournament-danger" onClick={onRemove}>Убрать старт {index + 1}</button>}
  </fieldset>;
}

export function TournamentsScreen({ tournaments, entries, onBack, onSave, onRemove, onFinish, onOpenSession }: {
  tournaments: readonly Tournament[]; entries: readonly DiaryEntry[]; onBack: () => void;
  onSave: (value: Tournament) => boolean; onRemove: (id: string) => boolean; onOpenSession: (id: string) => void;
  onFinish: (id: string) => boolean;
}) {
  const { preferences } = useTrainingPreferences();
  const [draft, setDraft] = useState<Tournament | null>(null);
  const [removing, setRemoving] = useState<Tournament | null>(null);
  const [finishing, setFinishing] = useState<Tournament | null>(null);
  const [celebration, setCelebration] = useState<{ id: string; prize: boolean } | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [attachmentError, setAttachmentError] = useState<{ id: string; message: string } | null>(null);
  const [exportingFile, setExportingFile] = useState(false);
  const editGeneration = useRef(0);
  const [error, setError] = useState('');
  const ordered = useMemo(() => [...entries].sort(compareDiaryDate), [entries]);
  const links = useMemo(() => tournamentLinks(tournaments), [tournaments]);
  const byId = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);
  const sorted = [...tournaments].sort((a, b) => b.from.localeCompare(a.from));
  const edit = (value: Tournament) => { editGeneration.current++; setReadingFile(false); setError(''); setDraft(value); };
  const closeEditor = () => { editGeneration.current++; setReadingFile(false); setDraft(null); };

  async function addAttachment(file: File) {
    if (!draft || readingFile || (draft.attachments?.length ?? 0) >= 3) return;
    const generation = editGeneration.current;
    setReadingFile(true); setError('');
    try {
      const value = await readTournamentAttachment(file);
      if (generation === editGeneration.current) {
        setDraft(current => current ? { ...current, attachments: [...(current.attachments ?? []), value] } : null);
      }
    } catch (cause) {
      if (generation === editGeneration.current) setError(cause instanceof Error ? cause.message : 'Не удалось прочитать файл.');
    } finally {
      if (generation === editGeneration.current) setReadingFile(false);
    }
  }

  async function openPdf(id: string, file: TournamentAttachment) {
    if (exportingFile) return;
    setExportingFile(true); setAttachmentError(null);
    try {
      await exportDocument({ name: `FableShot-протокол-${file.id.slice(0, 8)}.pdf`, mimeType: 'application/pdf',
        bytes: Uint8Array.from(atob(file.data), char => char.charCodeAt(0)) });
    } catch (cause) {
      setAttachmentError({ id, message: cause instanceof Error ? cause.message : 'Не удалось открыть протокол.' });
    } finally { setExportingFile(false); }
  }
  return <main className="conditions-page" data-testid="tournaments-screen">
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button>
      <h1>Турниры</h1>
    </header>
    <div className="conditions-content tournament-list">
      <button type="button" className="primary" onClick={() => edit({ id: crypto.randomUUID(), title: '', from: localDate.format(new Date()),
        to: null, venue: '', protocol: '', note: '', starts: [emptyTournamentStart()] })}>Добавить турнир</button>
      {!sorted.length && <p className="tournament-empty">Здесь появятся твои турниры, категории и места.</p>}
      {sorted.map(item => <article key={item.id} className="tournament-card" data-testid="tournament-card"
        data-finish-effect={preferences.animations && celebration?.id === item.id ? celebration.prize ? 'prize' : 'normal' : undefined}
        onAnimationEnd={event => { if (event.target === event.currentTarget && celebration?.id === item.id) setCelebration(null); }}>
        <header><Icon name="trophy" /><h2>{tournamentTitle(item)}</h2>
          <button type="button" className="icon-button" aria-label={`Редактировать ${tournamentTitle(item)}`} onClick={() => edit(structuredClone(item))}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 16 12-12 4 4L8 20H4zm9-9 4 4" /></svg>
          </button>
        </header>
        <p>{date.format(new Date(`${item.from}T12:00:00`))}{item.to ? ` — ${date.format(new Date(`${item.to}T12:00:00`))}` : ''}{item.venue ? ` · ${item.venue}` : ''}{item.completed ? ' · Завершён' : ''}</p>
        {item.starts.map((start, index) => {
          const sessions = start.sessionIds.flatMap(id => { const entry = byId.get(id); return entry && !entry.deletedAt ? [entry] : []; });
          const shots = sessions.flatMap(entry => entry.practice.rounds.flatMap(roundShots));
          const score = summarize(shots);
          return <section className="tournament-result" key={start.id}>
            <div className="tournament-result-header"><h3>{start.category || `Старт ${index + 1}`}</h3><span>{tournamentStatuses[start.status]}</span></div>
            {start.bow && <p>{bowCategoryName(start.bow)}</p>}
            <div className="tournament-score-row">
              {start.result && <div><span>По протоколу</span><strong>{start.result}</strong></div>}
              {start.place !== null && <div><span>Место</span><strong>{start.place}{start.participants ? ` из ${start.participants}` : ''}</strong></div>}
              {!!shots.length && <div><span>По стрелам</span><strong>{score.points}/{score.maximum}</strong></div>}
            </div>
            {!!sessions.length && <details><summary>Тренировки · {sessions.length}</summary>
              {sessions.map(entry => <button type="button" key={entry.id} className="text-action" onClick={() => onOpenSession(entry.id)}>{sessionLabel(entry)}</button>)}
            </details>}
          </section>;
        })}
        {item.note && <p className="tournament-note">{item.note}</p>}
        {!!item.attachments?.length && <details className="tournament-attachments"><summary>Вложения · {item.attachments.length}</summary>
          {item.attachments.map(file => file.type === 'application/pdf'
            ? <button type="button" key={file.id} className="text-action" disabled={exportingFile} onClick={() => void openPdf(item.id, file)}>{file.name}</button>
            : <figure key={file.id}><img loading="lazy" src={`data:${file.type};base64,${file.data}`} alt={file.name} /><figcaption>{file.name}</figcaption></figure>)}
          {attachmentError?.id === item.id && <p role="alert">{attachmentError.message}</p>}
        </details>}
        <footer>
          {item.protocol && <a href={item.protocol} target="_blank" rel="noreferrer">Протокол</a>}
          {!item.completed && item.starts.some(start => start.status === 'participated') && <button type="button" className="text-action"
            onClick={() => { setError(''); setFinishing(item); }}>Завершить турнир</button>}
          <button type="button" className="icon-button tournament-danger" aria-label={`Удалить ${tournamentTitle(item)}`}
            onClick={() => { setError(''); setRemoving(item); }}><Icon name="delete" /></button>
        </footer>
      </article>)}
    </div>
    {draft && <BottomSheet title={tournaments.some(item => item.id === draft.id) ? 'Редактировать турнир' : 'Участие в турнире'} tag="tournament-editor" onClose={closeEditor}>
      <form className="tournament-form" onSubmit={event => {
        event.preventDefault();
        if (readingFile) return;
        const value = { ...draft, title: draft.title.trim(), venue: draft.venue.trim(), note: draft.note.trim(), protocol: draft.protocol.trim(),
          starts: draft.starts.map(start => ({ ...start, category: start.category.trim(), result: start.result.trim() })) };
        if (!isTournament(value)) { setError('Проверь даты, ссылку и место. Место не может превышать число участников.'); return; }
        if (onSave(value)) closeEditor();
        else setError('Не удалось сохранить турнир. Проверь связанные тренировки и общий размер вложений.');
      }}>
        <div className="tournament-fields">
          <label className="tournament-wide">Название<input value={draft.title} maxLength={160} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Начало<input type="date" required value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
          <label>Конец<input type="date" min={draft.from} value={draft.to ?? ''} onChange={e => setDraft({ ...draft, to: e.target.value || null })} /></label>
          <label className="tournament-wide">Место проведения<input value={draft.venue} maxLength={160} onChange={e => setDraft({ ...draft, venue: e.target.value })} /></label>
        </div>
        {draft.starts.map((start, index) => {
          const occupied = new Set([...links].filter(([, link]) => link.tournament.id !== draft.id).map(([id]) => id));
          draft.starts.forEach(other => { if (other.id !== start.id) other.sessionIds.forEach(id => occupied.add(id)); });
          return <StartEditor key={start.id} start={start} index={index} entries={ordered} occupied={occupied}
            onChange={value => setDraft({ ...draft, starts: draft.starts.map(item => item.id === value.id ? value : item) })}
            onRemove={draft.starts.length > 1 ? () => setDraft({ ...draft, starts: draft.starts.filter(item => item.id !== start.id) }) : undefined} />;
        })}
        <button type="button" className="text-action" disabled={draft.starts.length >= 40}
          onClick={() => setDraft({ ...draft, starts: [...draft.starts, emptyTournamentStart()] })}>Добавить старт</button>
        <details className="tournament-extras"><summary>Протокол и заметка</summary>
          <label>Ссылка на протокол<input type="url" value={draft.protocol} maxLength={2000} onChange={e => setDraft({ ...draft, protocol: e.target.value })} /></label>
          <label>Заметка<textarea value={draft.note} maxLength={4000} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
          {(draft.attachments ?? []).map(file => <div className="tournament-file" key={file.id}>
            <span>{file.name}</span>
            <button type="button" className="icon-button" aria-label={`Убрать ${file.name}`} onClick={() =>
              setDraft({ ...draft, attachments: draft.attachments?.filter(item => item.id !== file.id) })}><Icon name="delete" /></button>
          </div>)}
          <label>Прикрепить протокол<input type="file" accept="application/pdf,image/jpeg,image/png" disabled={readingFile || (draft.attachments?.length ?? 0) >= 3}
            onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void addAttachment(file); }} /></label>
          <small>PDF до {MAX_PROTOCOL_FILE / 1024} КБ. Большие фото уменьшаются при добавлении.</small>
        </details>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={readingFile}>Сохранить турнир</button>
      </form>
    </BottomSheet>}
    {finishing && <BottomSheet title="Завершить турнир?" onClose={() => setFinishing(null)}>
      <p>Завершённый турнир можно редактировать из паспорта.</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="primary" onClick={() => {
        if (!onFinish(finishing.id)) { setError('Не удалось завершить турнир.'); return; }
        if (preferences.animations && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          setCelebration({ id: finishing.id, prize: finishing.starts.some(start => start.status === 'participated' && start.place !== null && start.place <= 3) });
        }
        setFinishing(null);
      }}>Завершить</button>
    </BottomSheet>}
    {removing && <BottomSheet title="Удалить турнир?" onClose={() => setRemoving(null)}>
      <p>Паспорт и отметки турнира будут удалены. Связанные тренировки останутся в дневнике.</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="primary" onClick={() => {
        if (onRemove(removing.id)) setRemoving(null); else setError('Не удалось удалить турнир.');
      }}>Удалить турнир</button>
    </BottomSheet>}
  </main>;
}

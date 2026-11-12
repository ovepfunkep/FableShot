import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  archiveTechnique, createTechnique, decodeTechnique, latestTechnique, loadTechniques, MAX_TECHNIQUE_BYTES,
  MAX_TECHNIQUE_TEXT, newTechniqueStep, primaryTechnique, publishTechnique, saveTechniques,
  techniqueFromText, techniquePlainText, techniqueSubpoints, updateTechniqueDraft,
} from './technique.ts';
import type { TechniqueDocument, TechniqueLibrary, TechniquePhase, TechniqueSelection, TechniqueStep, TechniqueText, TechniqueVersion } from './technique.ts';
import { exportDocument } from './document-export.ts';
import { TechniqueDisplayControls, useTechniqueSettings } from './TechniqueSettings.tsx';
import './technique.css';

type Reading = { documentId: string | null; version: TechniqueVersion };
export type TechniquePublication = { documentId: string; content: string };

function publicationContent(text: TechniqueText): string | null {
  const normalized = (value: string) => value.trim().replace(/\s+/g, ' ');
  const phases = text.phases.flatMap(phase => {
    const steps = phase.steps.map(step => ({ id: '', short: normalized(step.short), detail: normalized(step.detail),
      children: normalized(step.children), question: normalized(step.question), visible: true }))
      .filter(step => step.short || step.detail || step.children || step.question);
    return steps.length ? [{ id: '', title: normalized(phase.title), steps }] : [];
  });
  const description = normalized(text.description);
  if (!description && !phases.length) return null;
  return JSON.stringify({ schema: 1, title: normalized(text.title), context: normalized(text.context), description,
    phases, discussed: null, change: '' });
}
type Overlay = { kind: 'phase'; phaseId: string } | { kind: 'step'; phaseId: string; stepId: string } |
  { kind: 'paste'; append: boolean } | { kind: 'export'; text: TechniqueText } | { kind: 'help' } |
  { kind: 'versions'; documentId: string } | { kind: 'delete'; phaseId: string; stepId?: string } | { kind: 'reload' };

function BackIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PencilIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 4 5 5M4 15 16 3l5 5L9 20l-6 1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}
function NotesIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
function Field({ label, value, onChange, maxLength, multiline = false, testId, readOnly = false }: {
  label: string; value: string; onChange: (value: string) => void; maxLength: number; multiline?: boolean; testId?: string; readOnly?: boolean;
}) {
  return <label className="technique-field"><span>{label}</span>{multiline
    ? <textarea value={value} onChange={event => onChange(event.target.value)} readOnly={readOnly} maxLength={maxLength} rows={3} data-testid={testId} />
    : <input value={value} onChange={event => onChange(event.target.value)} readOnly={readOnly} maxLength={maxLength} data-testid={testId} />}</label>;
}
function Sheet({ children, onBack, label }: { children: ReactNode; onBack: () => void; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="technique-sheet" aria-label={label}
    onCancel={event => { event.preventDefault(); onBack(); }} onClick={event => { if (event.target === event.currentTarget) onBack(); }}>
    <div className="technique-sheet-content"><span className="technique-handle" />{children}</div>
  </dialog>;
}
function readLibrary(): { library: TechniqueLibrary | null; error: string } {
  try { return { library: loadTechniques(), error: '' }; }
  catch (error) { return { library: null, error: error instanceof Error ? error.message : 'Не удалось открыть памятки.' }; }
}
function initialReading(library: TechniqueLibrary | null, initial: TechniqueSelection | null): Reading | null {
  if (!initial?.versionId) return null;
  for (const document of library?.documents ?? []) {
    const version = document.versions.find(item => item.id === initial.versionId);
    if (version) return { documentId: document.id, version };
  }
  return initial.payload && initial.versionNumber ? { documentId: null,
    version: { id: initial.versionId, number: initial.versionNumber, createdAtMs: 0, payload: initial.payload } } : null;
}
async function download(text: TechniqueText, format: 'pdf' | 'json' | 'txt', versionLabel?: string) {
  let bytes: Uint8Array;
  if (format === 'pdf') {
    async function readFont(weight: 'regular' | 'bold') {
      const response = await fetch(new URL(`fonts/manrope-pdf-${weight}.ttf`, document.baseURI));
      if (!response.ok) throw new Error('Не удалось открыть шрифт PDF. Повтори экспорт.');
      return new Uint8Array(await response.arrayBuffer());
    }
    const [{ createTechniquePdf }, regular, bold] = await Promise.all([
      import('./technique-pdf.ts'), readFont('regular'), readFont('bold'),
    ]);
    bytes = await createTechniquePdf(text, { regular, bold }, versionLabel);
  } else bytes = new TextEncoder().encode(format === 'json' ? JSON.stringify(text, null, 2) : techniquePlainText(text));
  return exportDocument({ bytes, mimeType: format === 'pdf' ? 'application/pdf' : format === 'json' ? 'application/json' : 'text/plain',
    name: `${text.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Памятка'}.${format}` });
}

export function TechniqueWindow({ onClose, onSelect, initial, readOnly = false, onPublication }: {
  onClose: () => void; onSelect?: (selection: TechniqueSelection) => boolean; initial: TechniqueSelection | null; readOnly?: boolean;
  onPublication?: (publication: TechniquePublication) => void;
}) {
  const { settings } = useTechniqueSettings();
  const [state, setState] = useState(readLibrary);
  const libraryRef = useRef(state.library);
  const expectedDraft = useRef<{ documentId: string; raw: string } | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TechniqueText | null>(null);
  const [reading, setReading] = useState<Reading | null>(() => initialReading(state.library, initial));
  const [ownFocus, setOwnFocus] = useState(() => !!initial && !initial.versionId);
  const [focus1, setFocus1] = useState(initial?.focus1 ?? '');
  const [focus2, setFocus2] = useState(initial?.focus2 ?? '');
  const [archives, setArchives] = useState(false);
  const [metadata, setMetadata] = useState(false);
  const [compact, setCompact] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [status, setStatus] = useState('Черновик сохраняется автоматически');
  const [applyingError, setApplyingError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const modal = useRef<HTMLDialogElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const backRef = useRef<() => void>(() => {});
  const headingId = useId();
  const library = state.library;
  const text = reading?.version.payload ?? null;

  useLayoutEffect(() => { modal.current?.showModal(); }, []);

  function commit(next: TechniqueLibrary): boolean {
    const expected = libraryRef.current;
    if (!expected) return false;
    try {
      saveTechniques(next, expected);
      libraryRef.current = next;
      setState({ library: next, error: '' });
      return true;
    } catch (error) {
      setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Не удалось сохранить памятки.' }));
      return false;
    }
  }
  function saveDraft(value = draft): boolean {
    if (!value || !editorId || !libraryRef.current) return true;
    const previous = libraryRef.current.documents.find(item => item.id === editorId)?.draft;
    if (JSON.stringify(previous) === JSON.stringify(value)) {
      expectedDraft.current = { documentId: editorId, raw: JSON.stringify(value) };
      return true;
    }
    try {
      checkDraftConflict(editorId);
      if (commit(updateTechniqueDraft(libraryRef.current, editorId, value))) {
        expectedDraft.current = { documentId: editorId, raw: JSON.stringify(value) };
        setStatus('Черновик сохранён'); return true;
      }
    } catch (error) { setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Не удалось сохранить черновик.' })); }
    setStatus('Черновик не сохранён. Текст остаётся в редакторе.');
    return false;
  }
  function checkDraftConflict(documentId: string) {
    const previous = libraryRef.current?.documents.find(item => item.id === documentId)?.draft;
    if (expectedDraft.current?.documentId !== documentId || JSON.stringify(previous) !== expectedDraft.current.raw) {
      throw new Error('Черновик изменён в другом окне. Экспортируй свой текст и переоткрой памятку.');
    }
  }
  function back() {
    if (exportBusy) return;
    if (overlay) { setOverlay(null); return; }
    if (editorId) { if (saveDraft()) { setEditorId(null); setDraft(null); } return; }
    if (reading || ownFocus) { setReading(null); setOwnFocus(false); setApplyingError(''); return; }
    onClose();
  }
  useLayoutEffect(() => { backRef.current = back; });
  useEffect(() => {
    const key = 'fableshotTechniqueWindow';
    function markOpen() {
      if (window.history.state?.[key] === headingId) return;
      const next = { ...window.history.state, [key]: headingId };
      if (window.history.state?.[key]) window.history.replaceState(next, '');
      else window.history.pushState(next, '');
    }
    function pop() {
      if (window.history.state?.[key] === headingId) return;
      backRef.current();
      queueMicrotask(() => { if (modal.current?.isConnected) markOpen(); });
    }
    markOpen(); window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      queueMicrotask(() => { if (!modal.current?.isConnected && window.history.state?.[key] === headingId) window.history.back(); });
    };
  }, [headingId]);
  useEffect(() => {
    if (!editorId || !draft) return;
    const previous = libraryRef.current?.documents.find(item => item.id === editorId)?.draft;
    if (JSON.stringify(previous) === JSON.stringify(draft)) return;
    setStatus('Сохраняем черновик…');
    const timeout = setTimeout(() => saveDraft(draft), 500);
    return () => clearTimeout(timeout);
  }, [draft, editorId]);
  useEffect(() => {
    if (!editorId || !draft) return;
    const save = () => { if (document.visibilityState === 'hidden') saveDraft(draft); };
    const pageHide = () => saveDraft(draft);
    document.addEventListener('visibilitychange', save); window.addEventListener('pagehide', pageHide);
    return () => { document.removeEventListener('visibilitychange', save); window.removeEventListener('pagehide', pageHide); };
  }, [draft, editorId]);

  function retry() {
    const next = readLibrary(); libraryRef.current = next.library; setState(next);
    if (next.library && editorId) setStatus('Библиотека прочитана. Повтори сохранение черновика.');
  }
  function openEditor(document: TechniqueDocument) {
    expectedDraft.current = { documentId: document.id, raw: JSON.stringify(document.draft) };
    setEditorId(document.id); setDraft(structuredClone(document.draft)); setMetadata(false); setStatus('Черновик сохраняется автоматически');
  }
  function create(text?: TechniqueText): boolean {
    if (!libraryRef.current) return false;
    try {
      const result = createTechnique(libraryRef.current, text);
      if (commit(result.library)) { openEditor(result.library.documents.find(item => item.id === result.documentId)!); return true; }
    } catch (error) { setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Не удалось создать памятку.' })); }
    return false;
  }
  function mutate(action: (value: TechniqueLibrary) => TechniqueLibrary) {
    if (!libraryRef.current) return;
    try { commit(action(libraryRef.current)); }
    catch (error) { setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Не удалось сохранить памятку.' })); }
  }
  function read(documentId: string | null, version: TechniqueVersion) {
    setReading({ documentId, version }); setOwnFocus(false); setCompact(false); setPhaseIndex(0); setApplyingError('');
    setFocus1(initial?.versionId === version.id ? initial.focus1 : ''); setFocus2(initial?.versionId === version.id ? initial.focus2 : ''); setOverlay(null);
  }
  function publish() {
    if (!draft || !editorId || !libraryRef.current) return;
    try {
      checkDraftConflict(editorId);
      const document = libraryRef.current.documents.find(document => document.id === editorId);
      const previous = document ? latestTechnique(document) : null;
      const result = publishTechnique(libraryRef.current, editorId, draft);
      if (commit(result.library)) {
        setEditorId(null); setDraft(null);
        const content = publicationContent(result.version.payload);
        if (content && (!previous || content !== publicationContent(previous.payload))) {
          try { onPublication?.({ documentId: editorId, content }); }
          catch (cause) { setState(current => ({ ...current, error: `Версия опубликована. ${cause instanceof Error ? cause.message : 'Не удалось сохранить достижение.'}` })); }
        }
      }
    } catch (error) { setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Не удалось сохранить версию.' })); }
  }
  async function exportMemo(format: 'pdf' | 'json' | 'txt') {
    if (overlay?.kind !== 'export' || exportBusy) return;
    setExportBusy(true); setExportError(''); setExportNotice('');
    try {
      const result = await download(overlay.text, format, draft ? 'Черновик' : reading ? `Версия ${reading.version.number}` : undefined);
      if (result.saved) {
        setExportNotice(Capacitor.isNativePlatform() ? result.opened ? 'Файл сохранён и открыт.' : 'Файл сохранён.' : 'Скачивание начато.');
        setOverlay(null);
      }
    } catch (cause) { setExportError(cause instanceof Error ? cause.message : 'Не удалось сохранить файл. Повтори экспорт.'); }
    finally { setExportBusy(false); }
  }
  function apply() {
    if (readOnly || !onSelect) return;
    const selection: TechniqueSelection = { versionId: reading?.version.id ?? null, title: text?.title ?? 'Мой фокус',
      versionNumber: reading?.version.number ?? null, focus1, focus2, payload: text ? structuredClone(text) : null };
    if (!onSelect(selection)) setApplyingError('Не удалось сохранить фокус тренировки. Повтори действие.');
  }
  function chooseFocus(value: string) {
    if (focus1 === value) setFocus1(''); else if (focus2 === value) setFocus2(''); else if (!focus1.trim()) setFocus1(value); else setFocus2(value);
  }
  function updatePhase(phase: TechniquePhase) {
    setDraft(previous => previous ? { ...previous, phases: previous.phases.map(item => item.id === phase.id ? phase : item) } : previous);
  }
  function updateStep(phaseId: string, step: TechniqueStep) {
    setDraft(previous => previous ? { ...previous, phases: previous.phases.map(phase => phase.id === phaseId
      ? { ...phase, steps: phase.steps.map(item => item.id === step.id ? step : item) } : phase) } : previous);
  }
  function move(items: TechniquePhase[] | TechniqueStep[], index: number, delta: number) {
    const next = [...items]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next;
  }
  function openPaste(append: boolean) { setPaste(''); setPasteError(''); setOverlay({ kind: 'paste', append }); }
  function importPaste(append: boolean) {
    try {
      const imported = append ? techniqueFromText(paste) : decodeTechnique(paste);
      if (append && draft) {
        const next = { ...draft, phases: [...draft.phases.filter(phase => phase.steps.length), ...imported.phases] };
        if (next.phases.length > 30) throw new Error('В памятке может быть не больше 30 фаз.');
        setDraft(next);
      } else if (!create(imported)) { setPasteError('Не удалось сохранить импорт. Текст остаётся здесь; проверь хранилище и повтори.'); return; }
      setOverlay(null);
    } catch (error) { setPasteError(error instanceof Error ? error.message : 'Не удалось добавить текст.'); }
  }
  async function importFile(file: File) {
    try {
      if (file.size > MAX_TECHNIQUE_BYTES) throw new Error('Файл памятки слишком большой.');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      create(decodeTechnique(raw));
    } catch (error) { setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Не удалось прочитать файл UTF-8.' })); }
  }
  const editingPhase = overlay && 'phaseId' in overlay ? draft?.phases.find(phase => phase.id === overlay.phaseId) : null;
  const editingStep = overlay?.kind === 'step' ? editingPhase?.steps.find(step => step.id === overlay.stepId) : null;
  const editorPhaseIndex = editingPhase && draft ? draft.phases.indexOf(editingPhase) : -1;
  const editorStepIndex = editingStep && editingPhase ? editingPhase.steps.indexOf(editingStep) : -1;

  return <>
    <dialog ref={modal} className="technique-window" aria-labelledby={headingId} data-testid="technique-window"
      onCancel={event => { event.preventDefault(); back(); }} onClick={event => { if (event.target === event.currentTarget) back(); }}>
      <div className="technique-screen">
        <header className="technique-header">
          <button type="button" className="icon-button" aria-label={editorId ? 'Сохранить черновик и выйти' : reading || ownFocus ? 'Назад к памяткам' : 'Закрыть памятки'}
            data-testid="technique-back" onClick={back}><BackIcon /></button>
          <h2 id={headingId}>{editorId ? 'Моя памятка' : 'Моя техника'}</h2>
          {(draft || text) && <button type="button" className="technique-text-button" onClick={() => setOverlay({ kind: 'export', text: draft ?? text! })} aria-label="Экспорт памятки">Экспорт</button>}
          {!editorId && !reading && !ownFocus && <button type="button" className="icon-button" aria-label="О памятках" onClick={() => setOverlay({ kind: 'help' })}>ⓘ</button>}
        </header>
        {state.error && <div className="technique-error" role="alert">{state.error}<div className="technique-row"><button type="button" onClick={retry}>Повторить чтение</button>
          {editorId && <button type="button" onClick={() => setOverlay({ kind: 'reload' })}>Переоткрыть памятку</button>}</div></div>}

        {exportNotice && <p className="technique-muted technique-export-notice" role="status">{exportNotice}</p>}
        {editorId && draft ? <>
          <div className="technique-scroll technique-editor" data-testid="technique-editor">
            <Field label="Название" value={draft.title} onChange={title => setDraft({ ...draft, title })} maxLength={100} testId="technique-title" />
            <div className="technique-row"><button type="button" className="technique-text-button" onClick={() => setMetadata(!metadata)}>{metadata ? 'Скрыть описание' : 'Добавить описание'}</button>
              <button type="button" className="icon-button" aria-label="Вставить алгоритм текстом" data-testid="technique-paste" onClick={() => openPaste(true)}><NotesIcon /></button></div>
            {metadata && <div className="technique-fields">
              <Field label="Лук или контекст" value={draft.context} onChange={context => setDraft({ ...draft, context })} maxLength={200} />
              <Field label="Описание памятки" value={draft.description} onChange={description => setDraft({ ...draft, description })} maxLength={4000} multiline />
              <label className="technique-check"><input type="checkbox" checked={draft.discussed !== null} onChange={event => {
                const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                setDraft({ ...draft, discussed: event.target.checked ? date : null });
              }} />Обсуждал с тренером сегодня</label>
              <Field label="Изменения версии" value={draft.change} onChange={change => setDraft({ ...draft, change })} maxLength={1000} multiline />
            </div>}
            {draft.phases.map((phase, i) => <section key={phase.id} className="technique-card">
              <div className="technique-row"><h3>{i + 1}. {phase.title || 'Фаза'}</h3><button type="button" className="icon-button" aria-label={`Изменить фазу ${i + 1}`} onClick={() => setOverlay({ kind: 'phase', phaseId: phase.id })}><PencilIcon /></button></div>
              {phase.steps.map((step, j) => <button type="button" key={step.id} className="technique-outline-step" data-testid={`technique-step-${i}-${j}`}
                onClick={() => { setExpanded(false); setOverlay({ kind: 'step', phaseId: phase.id, stepId: step.id }); }}>
                <span className="technique-outline-number">{j + 1}</span><span><strong>{step.short || step.detail.split('\n')[0] || 'Новый пункт'}</strong>{step.question.trim() && <small>Уточнить с тренером</small>}</span><PencilIcon />
              </button>)}
              <button type="button" className="technique-text-button" disabled={phase.steps.length >= 50} data-testid={`technique-add-step-${i}`} onClick={() => {
                const step = newTechniqueStep(); updatePhase({ ...phase, steps: [...phase.steps, step] }); setExpanded(false); setOverlay({ kind: 'step', phaseId: phase.id, stepId: step.id });
              }}>＋ Добавить пункт</button>
            </section>)}
            <button type="button" className="technique-outline-button" disabled={draft.phases.length >= 30} onClick={() => {
              const phase = { id: crypto.randomUUID(), title: 'Новая фаза', steps: [] }; setDraft({ ...draft, phases: [...draft.phases, phase] }); setOverlay({ kind: 'phase', phaseId: phase.id });
            }}>Добавить фазу</button>
          </div>
          <footer className="technique-footer"><span className="technique-muted" role="status" data-testid="technique-save-status">{status}</span>
            <button type="button" className="primary" disabled={!draft.title.trim()} data-testid="technique-publish" onClick={publish}>Сохранить версию</button></footer>
        </> : reading || ownFocus ? <div className="technique-scroll technique-reader" data-testid="technique-reader">
          <div className="technique-reader-heading"><h1>{text?.title ?? 'Мой фокус'}</h1>{reading && <button type="button" className="technique-version-chip" disabled={!reading.documentId}
            onClick={() => reading.documentId && setOverlay({ kind: 'versions', documentId: reading.documentId })}>Версия {reading.version.number}{reading.documentId ? ' ▾' : ''}</button>}</div>
          {text?.context.trim() && <p className="technique-muted">{text.context}</p>}
          {text?.discussed && <p className="technique-muted">Обсуждал с тренером: {text.discussed} · личная отметка</p>}
          {text?.change.trim() && <p>{text.change}</p>}
          {text?.description.trim() && <p className="technique-preserve">{text.description}</p>}
          {text && <>
            <button type="button" className="technique-chip" aria-pressed={compact} onClick={() => setCompact(!compact)}>На тренировке · кратко</button>
            {text.phases.map((phase, i) => (!compact || i === phaseIndex) && <section key={phase.id} className="technique-reading-phase">
              <h3>{i + 1}. {phase.title.trim()}</h3>
              {phase.steps.map((step, j) => (!compact || step.visible) && <div className={`technique-reading-step${compact ? ' is-compact' : ''}`} key={step.id}>
                {(step.short.trim() || !compact) && <h4>{i + 1}.{j + 1} {step.short.trim() || `Пункт ${j + 1}`}</h4>}
                {!compact && <>{techniqueSubpoints(step, i + 1, j + 1).map((line, index) => <p key={index}>{line}</p>)}{step.question.trim() && <p className="technique-muted">Обсудить: {step.question}</p>}</>}
                {!readOnly && onSelect && settings.techniqueFocus && step.short.trim() && <button type="button" className="technique-text-button" aria-pressed={focus1 === step.short || focus2 === step.short} onClick={() => chooseFocus(step.short)}>Фокус: {focus1 === step.short || focus2 === step.short ? 'выбран' : 'выбрать'}</button>}
              </div>)}
            </section>)}
            {compact && <div className="technique-row"><button type="button" className="technique-text-button" disabled={phaseIndex <= 0} onClick={() => setPhaseIndex(phaseIndex - 1)}>Назад по фазам</button>
              <button type="button" className="technique-text-button" disabled={phaseIndex >= text.phases.length - 1} onClick={() => setPhaseIndex(phaseIndex + 1)}>Следующая фаза</button></div>}
          </>}
          {settings.techniqueFocus && (onSelect || readOnly) && (!readOnly || focus1.trim() || focus2.trim()) && <div className="technique-fields technique-focus-fields">
            {(!readOnly || focus1.trim()) && <Field label={readOnly ? 'Фокус занятия' : 'Фокус занятия · необязательно'} value={focus1} onChange={setFocus1} readOnly={readOnly} maxLength={200} testId="technique-focus-1" />}
            {(!readOnly || focus2.trim()) && <Field label={readOnly ? 'Второй фокус' : 'Второй фокус · необязательно'} value={focus2} onChange={setFocus2} readOnly={readOnly} maxLength={200} testId="technique-focus-2" />}
            {applyingError && <p className="technique-error" role="alert">{applyingError}</p>}
          </div>}
          {applyingError && !settings.techniqueFocus && <p className="technique-error" role="alert">{applyingError}</p>}
          {!readOnly && onSelect && <button type="button" className="primary" data-testid="technique-apply" onClick={apply}>Использовать на тренировке</button>}
          {reading?.documentId && !library?.documents.find(item => item.id === reading.documentId)?.archived && <button type="button" className="technique-text-button" onClick={() => {
            if (!libraryRef.current || !text) return;
            try {
              const result = publishTechnique(libraryRef.current, reading.documentId!, { ...text, discussed: null, change: `Возврат к версии ${reading.version.number}` });
              if (commit(result.library)) setReading(null);
            } catch (error) { setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Не удалось восстановить версию.' })); }
          }}>Создать новую версию из этой</button>}
        </div> : <div className="technique-scroll technique-library" data-testid="technique-library">
          <div className="technique-library-actions"><button type="button" className="primary" disabled={!library} data-testid="technique-create" onClick={() => create()}>＋ Создать</button>
            <details className="technique-import"><summary>Импорт</summary><div className="technique-menu"><button type="button" disabled={!library} onClick={() => importInput.current?.click()}>Из JSON / TXT</button><button type="button" disabled={!library} onClick={() => openPaste(false)}>Вставить текст</button></div></details></div>
          {!readOnly && settings.techniqueFocus && <button type="button" className="technique-text-button" onClick={() => { setOwnFocus(true); setFocus1(initial?.versionId === null ? initial.focus1 : ''); setFocus2(initial?.versionId === null ? initial.focus2 : ''); }}>Свой фокус без памятки</button>}
          <button type="button" className="technique-chip" aria-pressed={archives} onClick={() => setArchives(!archives)}>Архив памяток</button>
          {library && library.documents.filter(document => document.archived === archives).length === 0 && <p className="technique-empty">{archives ? 'В архиве пока нет памяток' : 'Создай памятку или импортируй свой алгоритм'}</p>}
          {library?.documents.filter(document => document.archived === archives).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.updatedAtMs - a.updatedAtMs).map(document => {
            const version = latestTechnique(document), payload = version?.payload ?? document.draft;
            return <article className="technique-card technique-library-card" key={document.id}>
              <button type="button" className="technique-open-document" data-testid={version ? `technique-read-${document.id}` : `technique-draft-${document.id}`} onClick={() => {
                if (version) read(document.id, version); else if (!document.archived) openEditor(document);
              }} disabled={document.archived && !version}>
                <NotesIcon /><span><strong>{payload.title || 'Без названия'}</strong><small>{document.isPrimary ? 'Основная · ' : ''}{version ? `v${version.number}` : 'Черновик'} · {payload.phases.length} фаз · {payload.phases.reduce((count, phase) => count + phase.steps.length, 0)} пунктов</small>{payload.context.trim() && <small>{payload.context}</small>}</span>
              </button>
              <details className="technique-document-menu"><summary aria-label={`Действия памятки ${payload.title}`}>⋮</summary><div className="technique-menu">
                {!archives && <><button type="button" data-testid={`technique-edit-${document.id}`} onClick={() => openEditor(document)}>Редактировать</button>
                  <button type="button" onClick={() => create({ ...payload, title: `${payload.title} — копия`.slice(0, 100) })}>Дублировать</button>
                  {version && <button type="button" onClick={() => mutate(value => primaryTechnique(value, document.id))}>Сделать основной</button>}</>}
                <button type="button" onClick={() => mutate(value => archiveTechnique(value, document.id, !archives))}>{archives ? 'Восстановить' : 'Архивировать'}</button>
                {document.versions.length > 0 && <button type="button" onClick={() => setOverlay({ kind: 'versions', documentId: document.id })}>История версий</button>}
                <button type="button" onClick={() => setOverlay({ kind: 'export', text: payload })}>Экспорт</button>
              </div></details>
            </article>;
          })}
        </div>}
        {!editorId && !reading && !ownFocus && <TechniqueDisplayControls />}
        <input ref={importInput} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} />
      </div>
    </dialog>

    {overlay && <Sheet label={overlay.kind === 'step' ? 'Редактирование пункта' : overlay.kind === 'phase' ? 'Редактирование фазы' : 'Памятка'} onBack={() => { if (!exportBusy) setOverlay(null); }}>
      {overlay.kind === 'help' && <><h2>Моя техника</h2><p>Личные памятки для работы с тренером. Черновик сохраняется автоматически, а сохранённые версии остаются в истории тренировок.</p></>}
      {overlay.kind === 'reload' && <><h2>Переоткрыть памятку?</h2><p>Несохранённые изменения в редакторе будут заменены последним черновиком из библиотеки. При необходимости сначала экспортируй свой текст.</p>
        <div className="technique-confirm-actions"><button type="button" className="technique-text-button" onClick={() => setOverlay(null)}>Отмена</button>
          <button type="button" className="technique-text-button" onClick={() => {
            const next = readLibrary(); libraryRef.current = next.library; setState(next);
            const document = next.library?.documents.find(item => item.id === editorId);
            if (document && !document.archived) { openEditor(document); setOverlay(null); }
            else if (next.library) { setEditorId(null); setDraft(null); setOverlay(null); }
          }}>Переоткрыть</button></div></>}
      {overlay.kind === 'export' && <><h2>Экспорт памятки</h2>
        <button type="button" className="technique-selector" data-testid="technique-export-pdf" disabled={exportBusy} onClick={() => exportMemo('pdf')}>PDF · полная расшифровка</button>
        <button type="button" className="technique-selector" data-testid="technique-export-json" disabled={exportBusy} onClick={() => exportMemo('json')}>JSON · все поля</button>
        <button type="button" className="technique-selector" data-testid="technique-export-txt" disabled={exportBusy} onClick={() => exportMemo('txt')}>TXT · нумерованный алгоритм</button>
        {exportBusy && <p role="status" className="technique-muted">Готовим файл…</p>}
        {exportError && <p role="alert" className="technique-error">{exportError}</p>}
      </>}
      {overlay.kind === 'versions' && <><h2>История версий</h2>{library?.documents.find(document => document.id === overlay.documentId)?.versions.slice().sort((a, b) => b.number - a.number).map(version =>
        <button type="button" className="technique-selector" key={version.id} onClick={() => read(overlay.documentId, version)}>Версия {version.number}<small>{new Date(version.createdAtMs).toLocaleDateString('ru-RU')}</small></button>)}</>}
      {overlay.kind === 'paste' && <><h2>{overlay.append ? 'Вставить алгоритм' : 'Импорт памятки'}</h2><p className="technique-muted">{overlay.append ? 'Пункты разделяй пустой строкой или нумерацией. Для фаз напиши ## Название. Добавим к памятке, сохранив прежние пункты.' : 'Вставь JSON памятки или текст алгоритма. Для фаз напиши ## Название.'}</p>
        <Field label="Текст алгоритма" value={paste} onChange={setPaste} maxLength={MAX_TECHNIQUE_TEXT} multiline testId="technique-paste-text" />
        {pasteError && <p className="technique-error" role="alert">{pasteError}</p>}<button type="button" className="primary" disabled={!paste.trim()} data-testid="technique-paste-apply" onClick={() => importPaste(overlay.append)}>{overlay.append ? 'Добавить пункты' : 'Импортировать'}</button></>}
      {overlay.kind === 'phase' && editingPhase && draft && <>
        <Field label="Название фазы" value={editingPhase.title} onChange={title => updatePhase({ ...editingPhase, title })} maxLength={100} />
        <div className="technique-row"><button type="button" className="icon-button" aria-label="Фазу выше" disabled={editorPhaseIndex <= 0} onClick={() => setDraft({ ...draft, phases: move(draft.phases, editorPhaseIndex, -1) as TechniquePhase[] })}>↑</button>
          <button type="button" className="icon-button" aria-label="Фазу ниже" disabled={editorPhaseIndex >= draft.phases.length - 1} onClick={() => setDraft({ ...draft, phases: move(draft.phases, editorPhaseIndex, 1) as TechniquePhase[] })}>↓</button>
          <button type="button" className="technique-danger" onClick={() => setOverlay({ kind: 'delete', phaseId: editingPhase.id })}>Удалить фазу</button></div>
        <button type="button" className="primary" onClick={() => setOverlay(null)}>Готово</button>
      </>}
      {overlay.kind === 'step' && editingStep && editingPhase && <>
        <h2>Пункт {editorStepIndex + 1}</h2>
        <Field label="Короткая подсказка" value={editingStep.short} onChange={short => updateStep(editingPhase.id, { ...editingStep, short })} maxLength={200} testId="technique-step-short" />
        <Field label="Полное пояснение" value={editingStep.detail} onChange={detail => updateStep(editingPhase.id, { ...editingStep, detail })} maxLength={4000} multiline testId="technique-step-detail" />
        <button type="button" className="technique-text-button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Скрыть подробности' : 'Подпункты и тренер'}</button>
        {expanded && <><Field label="Подпункты · каждый с новой строки" value={editingStep.children} onChange={children => updateStep(editingPhase.id, { ...editingStep, children })} maxLength={4000} multiline testId="technique-step-children" />
          <Field label="Уточнить с тренером" value={editingStep.question} onChange={question => updateStep(editingPhase.id, { ...editingStep, question })} maxLength={1000} multiline testId="technique-step-question" />
          <label className="technique-check"><input type="checkbox" checked={editingStep.visible} onChange={event => updateStep(editingPhase.id, { ...editingStep, visible: event.target.checked })} />Показывать в кратком режиме</label></>}
        <div className="technique-row"><button type="button" className="icon-button" aria-label="Пункт выше" disabled={editorStepIndex <= 0} onClick={() => updatePhase({ ...editingPhase, steps: move(editingPhase.steps, editorStepIndex, -1) as TechniqueStep[] })}>↑</button>
          <button type="button" className="icon-button" aria-label="Пункт ниже" disabled={editorStepIndex >= editingPhase.steps.length - 1} onClick={() => updatePhase({ ...editingPhase, steps: move(editingPhase.steps, editorStepIndex, 1) as TechniqueStep[] })}>↓</button>
          <button type="button" className="technique-danger" onClick={() => setOverlay({ kind: 'delete', phaseId: editingPhase.id, stepId: editingStep.id })}>Удалить пункт</button></div>
        <button type="button" className="primary" data-testid="technique-step-done" onClick={() => setOverlay(null)}>Готово</button>
      </>}
      {overlay.kind === 'delete' && draft && <><h2>{overlay.stepId ? 'Удалить пункт?' : 'Удалить фазу и её пункты?'}</h2><div className="technique-confirm-actions">
        <button type="button" className="technique-text-button" onClick={() => setOverlay(overlay.stepId ? { kind: 'step', phaseId: overlay.phaseId, stepId: overlay.stepId } : { kind: 'phase', phaseId: overlay.phaseId })}>Отмена</button>
        <button type="button" className="technique-danger" onClick={() => { setDraft({ ...draft, phases: overlay.stepId ? draft.phases.map(phase => phase.id === overlay.phaseId ? { ...phase, steps: phase.steps.filter(step => step.id !== overlay.stepId) } : phase) : draft.phases.filter(phase => phase.id !== overlay.phaseId) }); setOverlay(null); }}>Удалить</button></div></>}
    </Sheet>}
  </>;
}

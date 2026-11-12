import { appStorage } from './app-storage.ts';
export type TechniqueStep = { id: string; short: string; detail: string; children: string; visible: boolean; question: string };
export type TechniquePhase = { id: string; title: string; steps: TechniqueStep[] };
/** The portable payload is the same schema used by Android TechniqueText.json(). */
export type TechniqueText = {
  schema: 1; title: string; context: string; description: string; phases: TechniquePhase[];
  discussed: string | null; change: string;
};
export type TechniqueVersion = { id: string; number: number; createdAtMs: number; payload: TechniqueText };
export type TechniqueDocument = {
  id: string; draft: TechniqueText; updatedAtMs: number; archived: boolean; isPrimary: boolean; versions: TechniqueVersion[];
};
export type TechniqueLibrary = { version: 1; documents: TechniqueDocument[] };
export type TechniqueSelection = {
  versionId: string | null; title: string; versionNumber: number | null; focus1: string; focus2: string; payload: TechniqueText | null;
};

export const TECHNIQUE_STORAGE_KEY = 'app.fableshot.techniques.v1';
export const MAX_TECHNIQUE_TEXT = 262_144;
export const MAX_TECHNIQUE_BYTES = 1_048_576;
const id = () => crypto.randomUUID();
const copy = <T>(value: T): T => structuredClone(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const validId = (value: unknown): value is string => str(value, 128) && value.trim().length > 0;
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => timestamp(value) && value > 0;
const unique = (values: string[]) => new Set(values).size === values.length;

function validDate(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isTechniqueText(value: unknown, allowDraft = false): value is TechniqueText {
  if (!record(value) || value.schema !== 1 || !str(value.title, 100) || (!allowDraft && !value.title.trim()) ||
    !str(value.context, 200) || !str(value.description, 4000) || !str(value.change, 1000) || !validDate(value.discussed) ||
    !Array.isArray(value.phases) || value.phases.length > 30) return false;
  const phaseIds: string[] = [];
  for (const phase of value.phases) {
    if (!record(phase) || !validId(phase.id) || !str(phase.title, 100) || !Array.isArray(phase.steps) || phase.steps.length > 50) return false;
    phaseIds.push(phase.id);
    const stepIds: string[] = [];
    for (const step of phase.steps) {
      if (!record(step) || !validId(step.id) || !str(step.short, 200) || !str(step.detail, 4000) ||
        !str(step.children, 4000) || typeof step.visible !== 'boolean' || !str(step.question, 1000)) return false;
      stepIds.push(step.id);
    }
    if (!unique(stepIds)) return false;
  }
  return unique(phaseIds) && JSON.stringify(value).length <= MAX_TECHNIQUE_TEXT;
}

export function parseTechniqueText(raw: string, allowDraft = false): TechniqueText {
  if (raw.length > MAX_TECHNIQUE_TEXT) throw new Error('Памятка слишком большая.');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (cause) { throw new Error('Не удалось прочитать JSON памятки.', { cause }); }
  if (!isTechniqueText(value, allowDraft)) throw new Error('Проверь формат памятки, длину полей и название.');
  return value;
}

export function newTechniqueStep(): TechniqueStep {
  return { id: id(), short: '', detail: '', children: '', visible: true, question: '' };
}

export function newTechniqueText(): TechniqueText {
  return { schema: 1, title: 'Новая памятка', context: '', description: '', discussed: null, change: '',
    phases: ['Подготовка', 'Выполнение', 'Завершение', 'Наблюдения'].map(title => ({ id: id(), title, steps: [] })) };
}

export function isTechniqueSelection(value: unknown): value is TechniqueSelection {
  if (!record(value) || !str(value.title, 100) || !value.title.trim() || !str(value.focus1, 200) || !str(value.focus2, 200)) return false;
  if (value.versionId === null) return value.versionNumber === null && value.payload === null;
  return validId(value.versionId) && positive(value.versionNumber) && isTechniqueText(value.payload) && value.title === value.payload.title;
}

export function isTechniqueLibrary(value: unknown): value is TechniqueLibrary {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.documents) || value.documents.length > 1000) return false;
  const ids: string[] = [];
  let primary = 0;
  for (const document of value.documents) {
    if (!record(document) || !validId(document.id) || !isTechniqueText(document.draft, true) || !timestamp(document.updatedAtMs) ||
      typeof document.archived !== 'boolean' || typeof document.isPrimary !== 'boolean' || !Array.isArray(document.versions)) return false;
    ids.push(document.id);
    const numbers: number[] = [];
    for (const version of document.versions) {
      if (!record(version) || !validId(version.id) || !positive(version.number) || !timestamp(version.createdAtMs) || !isTechniqueText(version.payload)) return false;
      ids.push(version.id);
      numbers.push(version.number);
    }
    if (new Set(numbers).size !== numbers.length) return false;
    if (document.isPrimary && (document.archived || !document.versions.length || ++primary > 1)) return false;
  }
  return unique(ids);
}

export function loadTechniques(): TechniqueLibrary {
  let raw: string | null;
  try { raw = appStorage.getItem(TECHNIQUE_STORAGE_KEY); }
  catch (cause) { throw new Error('Не удалось открыть хранилище памяток. Повтори чтение.', { cause }); }
  if (raw === null) return { version: 1, documents: [] };
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (cause) { throw new Error('Не удалось прочитать памятки. Исходная запись сохранена.', { cause }); }
  if (!isTechniqueLibrary(value)) throw new Error('Неверный формат библиотеки памяток. Исходная запись сохранена.');
  return value;
}

/** A changed or unreadable stored library is never silently overwritten. */
export function saveTechniques(value: TechniqueLibrary, expected: TechniqueLibrary): void {
  if (!isTechniqueLibrary(value)) throw new Error('Проверь данные памятки.');
  const current = loadTechniques();
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Памятки изменены в другом окне. Повтори чтение перед сохранением.');
  try { appStorage.setItem(TECHNIQUE_STORAGE_KEY, JSON.stringify(value)); }
  catch (cause) { throw new Error('Не удалось сохранить памятку. Возможно, хранилище заполнено. Текст остаётся в редакторе.', { cause }); }
}

export function createTechnique(library: TechniqueLibrary, text = newTechniqueText()): { library: TechniqueLibrary; documentId: string } {
  if (!isTechniqueText(text, true)) throw new Error('Неверный формат памятки.');
  const documentId = id();
  const next = copy(library);
  next.documents.push({ id: documentId, draft: { ...copy(text), discussed: null }, updatedAtMs: Date.now(), archived: false, isPrimary: false, versions: [] });
  return { library: next, documentId };
}

function writableDocument(library: TechniqueLibrary, documentId: string): TechniqueDocument {
  const document = library.documents.find(item => item.id === documentId);
  if (!document || document.archived) throw new Error('Памятка недоступна для редактирования.');
  return document;
}

export function updateTechniqueDraft(library: TechniqueLibrary, documentId: string, text: TechniqueText): TechniqueLibrary {
  if (!isTechniqueText(text, true)) throw new Error('Проверь длину полей памятки.');
  const next = copy(library);
  const document = writableDocument(next, documentId);
  document.draft = copy(text);
  document.updatedAtMs = Date.now();
  return next;
}

export function publishTechnique(library: TechniqueLibrary, documentId: string, text: TechniqueText): { library: TechniqueLibrary; version: TechniqueVersion } {
  if (!isTechniqueText(text)) throw new Error('Укажи название памятки и проверь длину полей.');
  const next = copy(library);
  const document = writableDocument(next, documentId);
  const version = { id: id(), number: Math.max(0, ...document.versions.map(item => item.number)) + 1, createdAtMs: Date.now(), payload: copy(text) };
  document.versions.push(version);
  document.draft = { ...copy(text), discussed: null, change: '' };
  document.updatedAtMs = version.createdAtMs;
  return { library: next, version: copy(version) };
}

export function archiveTechnique(library: TechniqueLibrary, documentId: string, archived: boolean): TechniqueLibrary {
  const next = copy(library);
  const document = next.documents.find(item => item.id === documentId);
  if (!document) throw new Error('Памятка не найдена.');
  document.archived = archived;
  if (archived) document.isPrimary = false;
  return next;
}

export function primaryTechnique(library: TechniqueLibrary, documentId: string): TechniqueLibrary {
  const next = copy(library);
  const document = writableDocument(next, documentId);
  if (!document.versions.length) throw new Error('Сначала сохрани версию памятки.');
  next.documents.forEach(item => { item.isPrimary = item.id === documentId; });
  return next;
}

export function latestTechnique(document: TechniqueDocument): TechniqueVersion | null {
  return document.versions.reduce<TechniqueVersion | null>((latest, version) => !latest || version.number > latest.number ? version : latest, null);
}

export function techniqueSubpoints(step: TechniqueStep, phase: number, number: number): string[] {
  return `${step.detail}\n${step.children}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map((line, index) => `${phase}.${number}.${index + 1} ${line}`);
}

export function techniquePlainText(text: TechniqueText): string {
  const lines = [`# ${text.title}`];
  if (text.context.trim()) lines.push(`Контекст: ${text.context}`);
  if (text.description.trim()) lines.push(text.description);
  text.phases.forEach((phase, i) => {
    lines.push('', `## ${i + 1}. ${phase.title.trim()}`);
    phase.steps.forEach((step, j) => {
      lines.push(`${i + 1}.${j + 1}. ${step.short.trim() || `Пункт ${j + 1}`}`);
      lines.push(...techniqueSubpoints(step, i + 1, j + 1).map(line => line.replace(' ', '. ')));
      if (step.question.trim()) lines.push(`Уточнить с тренером: ${step.question}`);
      if (!step.visible) lines.push('Не показывать в кратком режиме');
      lines.push('');
    });
  });
  if (text.discussed) lines.push(`Обсуждал с тренером: ${text.discussed}`);
  if (text.change.trim()) lines.push(`Изменения версии: ${text.change}`);
  return `${lines.join('\n')}\n`;
}

export function techniqueFromText(raw: string, fallbackTitle = 'Импортированная памятка'): TechniqueText {
  if (!raw.trim() || raw.length > MAX_TECHNIQUE_TEXT) throw new Error('Введи текст памятки допустимого размера.');
  const text = { ...newTechniqueText(), title: fallbackTitle, phases: [] as TechniquePhase[] };
  const source = raw.replace(/\r\n?/g, '\n').split('\n');
  const hasPhases = source.some(line => line.startsWith('## '));
  let phaseTitle = 'Алгоритм', explicitPhase = false, steps: TechniqueStep[] = [], lines: string[] = [], questions: string[] = [];
  let readingQuestion = false, readingChange = false, visible = true;
  const description: string[] = [], change: string[] = [];
  function flushStep() {
    const body = lines.join('\n').trim();
    lines = [];
    if (!body) return;
    const first = body.split('\n')[0];
    const short = first.length <= 200 ? first : '';
    const explanation = short ? body.slice(first.length).trim() : body;
    const split = explanation.length > 4000 ? explanation.lastIndexOf('\n', 4000) : -1;
    const detail = split >= 0 ? explanation.slice(0, split) : explanation;
    const children = split >= 0 ? explanation.slice(split + 1) : '';
    if (detail.length > 4000 || children.length > 4000) throw new Error('Пояснение и подпункты превышают допустимый объём.');
    steps.push({ ...newTechniqueStep(), short, detail, children, question: questions.join('\n').trim(), visible });
    questions = []; readingQuestion = false; visible = true;
    if (steps.length > 50) throw new Error('В фазе может быть не больше 50 пунктов.');
  }
  function flushPhase() {
    flushStep();
    if (phaseTitle.length > 100) throw new Error('Название фазы длиннее 100 знаков.');
    if (steps.length || explicitPhase) text.phases.push({ id: id(), title: phaseTitle, steps });
    if (text.phases.length > 30) throw new Error('В памятке может быть не больше 30 фаз.');
    steps = []; explicitPhase = false;
  }
  for (const line of source) {
    if (line.startsWith('## ')) {
      flushPhase(); phaseTitle = line.slice(3).trim().replace(/^\d+[.)]\s+/, ''); explicitPhase = true; readingChange = false;
    } else if (line.startsWith('# ') && !text.phases.length && !steps.length && !lines.length) text.title = line.slice(2).trim();
    else if (line.startsWith('Контекст: ') && !text.phases.length && !explicitPhase && !steps.length && !lines.length) text.context = line.slice(10).trim();
    else if (line.startsWith('Обсуждал с тренером: ')) { flushPhase(); text.discussed = line.slice('Обсуждал с тренером: '.length).trim(); }
    else if (line.startsWith('Изменения версии: ')) { flushPhase(); change.push(line.slice('Изменения версии: '.length)); readingChange = true; }
    else if (readingChange) change.push(line);
    else if (hasPhases && !text.phases.length && !explicitPhase && !steps.length && !lines.length) description.push(line);
    else if (/^\s*\d+\.\d+\.\d+\.\s+(.+)$/.test(line) && lines.length) { lines.push(line.replace(/^\s*\d+\.\d+\.\d+\.\s+/, '')); readingQuestion = false; }
    else if (/^\s*(?:\d+\.\d+\.|\d+[.)]|[-•])\s+/.test(line)) { flushStep(); lines.push(line.replace(/^\s*(?:\d+\.\d+\.|\d+[.)]|[-•])\s+/, '')); }
    else if (line.startsWith('Уточнить с тренером: ') && lines.length) { questions.push(line.slice('Уточнить с тренером: '.length)); readingQuestion = true; }
    else if (line === 'Не показывать в кратком режиме' && lines.length) { visible = false; readingQuestion = false; }
    else if (readingQuestion) questions.push(line.trim());
    else if (!line.trim()) flushStep();
    else lines.push(line.trim());
  }
  flushPhase();
  text.description = description.join('\n').trim(); text.change = change.join('\n').trim();
  if (!text.phases.length) throw new Error('В памятке нет пунктов.');
  if (!isTechniqueText(text, true)) throw new Error('Проверь длину полей и дату обсуждения памятки.');
  return text;
}

export function decodeTechnique(raw: string): TechniqueText {
  const text = raw.replace(/^\uFEFF/, '');
  if (!text.trim() || text.length > MAX_TECHNIQUE_TEXT) throw new Error('Памятка пуста или слишком большая.');
  return text.trimStart().startsWith('{') ? parseTechniqueText(text.trim(), true) : techniqueFromText(text);
}

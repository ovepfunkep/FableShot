import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  archiveTechnique, createTechnique, decodeTechnique, isTechniqueSelection, isTechniqueText, latestTechnique,
  loadTechniques, MAX_TECHNIQUE_TEXT, newTechniqueStep, newTechniqueText, parseTechniqueText, primaryTechnique,
  publishTechnique, saveTechniques, TECHNIQUE_STORAGE_KEY, techniqueFromText, techniquePlainText, techniqueSubpoints, updateTechniqueDraft,
} from '../src/technique.ts';
import type { TechniqueLibrary, TechniqueSelection } from '../src/technique.ts';

function storage(t: TestContext, initial: string | null = null, failWrite = false) {
  const entries = new Map<string, string>();
  if (initial !== null) entries.set(TECHNIQUE_STORAGE_KEY, initial);
  const value = {
    getItem(key: string) { return entries.get(key) ?? null; },
    setItem(key: string, raw: string) { if (failWrite) throw new DOMException('Full', 'QuotaExceededError'); entries.set(key, raw); },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'));
  return value;
}
function authored() {
  const text = newTechniqueText();
  text.title = 'Моя памятка'; text.context = 'Классический лук'; text.description = 'Мои пояснения';
  text.phases[0].steps = [{ ...newTechniqueStep(), short: 'Проверить положение', detail: '2.5 см от края\nБез напряжения', children: 'Спокойный вдох', question: 'Уточнить высоту\nИ угол', visible: false }];
  text.discussed = '2026-11-11'; text.change = 'Проверены пояснения';
  return text;
}

test('neutral Android scaffold has four empty phases and portable schema 1', () => {
  const text = newTechniqueText();
  assert.deepEqual(text.phases.map(phase => phase.title), ['Подготовка', 'Выполнение', 'Завершение', 'Наблюдения']);
  assert.ok(text.phases.every(phase => phase.steps.length === 0));
  assert.deepEqual(parseTechniqueText(JSON.stringify(text)), text);
  const noTitle = { ...text, title: '' };
  assert.equal(isTechniqueText(noTitle), false);
  assert.equal(isTechniqueText(noTitle, true), true);
});

test('Android payload preserves all fields; rejects bad sizes, duplicate ids and invalid dates', () => {
  const text = authored();
  assert.deepEqual(decodeTechnique(`\uFEFF${JSON.stringify(text)}`), text);
  for (const invalid of [
    { ...text, schema: 2 }, { ...text, title: 'x'.repeat(101) }, { ...text, discussed: '2026-02-30' },
    { ...text, phases: [...text.phases, text.phases[0]] },
    { ...text, phases: [{ ...text.phases[0], steps: [text.phases[0].steps[0], text.phases[0].steps[0]] }] },
    { ...text, phases: [{ ...text.phases[0], steps: [{ ...text.phases[0].steps[0], detail: 'x'.repeat(4001) }] }] },
  ]) assert.equal(isTechniqueText(invalid, true), false);
  assert.throws(() => parseTechniqueText('broken'));
  assert.throws(() => decodeTechnique('x'.repeat(MAX_TECHNIQUE_TEXT + 1)));
});

test('publication freezes the payload and clears version-only metadata in the next draft', () => {
  const original = authored();
  const created = createTechnique({ version: 1, documents: [] }, original);
  assert.equal(created.library.documents[0].draft.discussed, null);
  const published = publishTechnique(created.library, created.documentId, original);
  assert.equal(published.version.number, 1);
  assert.equal(published.library.documents[0].draft.discussed, null);
  assert.equal(published.library.documents[0].draft.change, '');
  original.phases[0].steps[0].short = 'Другой фокус';
  published.version.payload.title = 'Изменённая копия результата';
  assert.equal(published.library.documents[0].versions[0].payload.title, 'Моя памятка');
  assert.equal(published.library.documents[0].versions[0].payload.phases[0].steps[0].short, 'Проверить положение');
  const updated = updateTechniqueDraft(published.library, created.documentId, original);
  const second = publishTechnique(updated, created.documentId, original);
  assert.equal(second.version.number, 2);
  assert.equal(latestTechnique(second.library.documents[0])?.number, 2);
  assert.equal(second.library.documents[0].versions[0].payload.phases[0].steps[0].short, 'Проверить положение');
  assert.equal(created.library.documents[0].versions.length, 0);
});

test('primary is unique, archival removes primary and keeps every saved version', () => {
  const first = createTechnique({ version: 1, documents: [] });
  assert.throws(() => primaryTechnique(first.library, first.documentId));
  const a = publishTechnique(first.library, first.documentId, authored());
  const second = createTechnique(a.library);
  const b = publishTechnique(second.library, second.documentId, newTechniqueText());
  const primary = primaryTechnique(primaryTechnique(b.library, first.documentId), second.documentId);
  assert.equal(primary.documents.filter(document => document.isPrimary).length, 1);
  const archived = archiveTechnique(primary, second.documentId, true);
  assert.equal(archived.documents[1].isPrimary, false);
  assert.equal(archived.documents[1].versions.length, 1);
  assert.throws(() => updateTechniqueDraft(archived, second.documentId, newTechniqueText()));
  assert.throws(() => publishTechnique(archived, second.documentId, newTechniqueText()));
  const restored = archiveTechnique(archived, second.documentId, false);
  assert.equal(restored.documents[1].archived, false);
  assert.equal(restored.documents[1].isPrimary, false);
});

test('TXT hierarchical round trips never multiply numbering and preserve measurements and coach notes', () => {
  const first = authored();
  assert.deepEqual(techniqueSubpoints(first.phases[0].steps[0], 1, 1), ['1.1.1 2.5 см от края', '1.1.2 Без напряжения', '1.1.3 Спокойный вдох']);
  const raw = techniquePlainText(first);
  assert.ok(raw.includes('1.1.1. 2.5 см от края'));
  const imported = techniqueFromText(raw);
  const roundtrip = techniquePlainText(imported);
  assert.equal(roundtrip, raw);
  assert.equal(techniquePlainText(techniqueFromText(roundtrip)), raw);
  const step = imported.phases[0].steps[0];
  assert.equal(step.visible, false);
  assert.equal(step.question, first.phases[0].steps[0].question);
  assert.equal(imported.context, first.context);
  assert.equal(imported.description, first.description);
  assert.equal(imported.discussed, first.discussed);
  assert.equal(imported.change, first.change);
});

test('text authoring supports headings, simple lists, empty phases and enforces phase/step limits', () => {
  const text = techniqueFromText('# Алгоритм\n## 1. Начало\n1) Первый пункт\nПояснение\n\n2) Второй пункт\n\n## 2. Завершение\n');
  assert.equal(text.title, 'Алгоритм');
  assert.deepEqual(text.phases.map(phase => phase.title), ['Начало', 'Завершение']);
  assert.equal(text.phases[0].steps[0].detail, 'Пояснение');
  assert.equal(text.phases[0].steps[1].short, 'Второй пункт');
  assert.equal(text.phases[1].steps.length, 0);
  assert.throws(() => techniqueFromText(''));
  assert.throws(() => techniqueFromText(Array.from({ length: 31 }, (_, i) => `## Фаза ${i}`).join('\n')));
  assert.throws(() => techniqueFromText(Array.from({ length: 51 }, (_, i) => `${i + 1}) Пункт`).join('\n')));
});

test('selection validates own focuses and a self-contained immutable version snapshot', () => {
  const own: TechniqueSelection = { versionId: null, title: 'Мой фокус', versionNumber: null, focus1: 'Дыхание', focus2: '', payload: null };
  assert.equal(isTechniqueSelection(own), true);
  const full: TechniqueSelection = { ...own, versionId: 'version-id', title: 'Моя памятка', versionNumber: 1, payload: authored() };
  assert.equal(isTechniqueSelection(full), true);
  assert.equal(isTechniqueSelection({ ...full, title: 'Другое название' }), false);
  assert.equal(isTechniqueSelection({ ...full, payload: null }), false);
  assert.equal(isTechniqueSelection({ ...full, versionNumber: 0 }), false);
  assert.equal(isTechniqueSelection({ ...own, focus1: 'x'.repeat(201) }), false);
  assert.equal(isTechniqueSelection({ ...own, payload: authored() }), false);
});

test('separate library persists draft and published versions without touching the practice store', t => {
  const fake = storage(t);
  fake.setItem('app.fableshot.practice.v3', 'personal diary');
  const empty = loadTechniques();
  const created = createTechnique(empty, authored());
  const published = publishTechnique(created.library, created.documentId, authored());
  saveTechniques(published.library, empty);
  assert.deepEqual(loadTechniques(), published.library);
  assert.equal(fake.getItem('app.fableshot.practice.v3'), 'personal diary');
});

test('corrupt and inaccessible storage are explicit failures and never overwritten', t => {
  const fake = storage(t, '{bad json');
  assert.throws(() => loadTechniques(), /Исходная запись сохранена/);
  assert.throws(() => saveTechniques({ version: 1, documents: [] }, { version: 1, documents: [] }), /Исходная запись сохранена/);
  assert.equal(fake.getItem(TECHNIQUE_STORAGE_KEY), '{bad json');
  fake.setItem(TECHNIQUE_STORAGE_KEY, JSON.stringify({ version: 2, documents: [] }));
  assert.throws(() => loadTechniques(), /Неверный формат/);
  fake.getItem = () => { throw new DOMException('Denied', 'SecurityError'); };
  assert.throws(() => loadTechniques(), /Не удалось открыть хранилище/);
});

test('quota failures keep the old library; concurrent changes are never silently replaced', t => {
  const fake = storage(t);
  const old = loadTechniques();
  const first = createTechnique(old);
  saveTechniques(first.library, old);
  const second = createTechnique(old);
  assert.throws(() => saveTechniques(second.library, old), /другом окне/);
  assert.deepEqual(loadTechniques(), first.library);
  const raw = fake.getItem(TECHNIQUE_STORAGE_KEY);
  fake.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  const draft = updateTechniqueDraft(first.library, first.documentId, authored());
  assert.throws(() => saveTechniques(draft, first.library), /Текст остаётся в редакторе/);
  assert.equal(fake.getItem(TECHNIQUE_STORAGE_KEY), raw);
});

test('library rejects orphan metadata and duplicate immutable version ids on read', t => {
  const fake = storage(t);
  const created = createTechnique({ version: 1, documents: [] });
  const next = publishTechnique(created.library, created.documentId, authored()).library;
  const invalid: TechniqueLibrary = structuredClone(next);
  invalid.documents[0].versions.push(structuredClone(invalid.documents[0].versions[0]));
  fake.setItem(TECHNIQUE_STORAGE_KEY, JSON.stringify(invalid));
  assert.throws(() => loadTechniques(), /Неверный формат/);
  invalid.documents[0].versions = [];
  invalid.documents[0].isPrimary = true;
  fake.setItem(TECHNIQUE_STORAGE_KEY, JSON.stringify(invalid));
  assert.throws(() => loadTechniques(), /Неверный формат/);
});

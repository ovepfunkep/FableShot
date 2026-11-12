import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DIARY_KEY, isDiary, loadDiary, loadPractice, saveDiary, savePractice } from '../src/persistence.ts';
import { advanceSeries, appendShot, applyConditions, bindTechnique, completePractice, currentSeries, emptyPractice, startRound } from '../src/practice.ts';
import { DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE } from '../src/conditions.ts';

const legacyKey = 'app.fableshot.practice-pilot.v1';
const previousKey = 'app.fableshot.practice-pilot.v2';
const key = 'app.fableshot.practice-pilot.v3';
const hit = { point: { x: 0.13, y: 0.07 }, points: 9, code: '9' };
const miss = { point: null, points: 0, code: 'M' };
const savedAt = '2026-11-11T10:00:00.000Z';

test('imported numeric scores may have explicitly unknown positions and dates without inventing coordinates', () => {
  const practice = appendShot(emptyPractice(), { points: 9, code: '9', point: null, imported: true });
  const entry = { id: 'imported', startedAt: '', localDate: null, practice: { ...practice, savedAt }, source: {
    kind: 'mytargets', fileHash: 'a'.repeat(64), parserVersion: '1', sessionId: '1',
    sourceRecords: [1], seriesFingerprints: ['series'], overlapFingerprints: [],
  } };
  assert.equal(isDiary({ version: 1, entries: [entry] }), true);
  assert.equal(isDiary({ version: 1, entries: [{ ...entry, source: undefined }] }), false);
  const damaged = structuredClone(entry);
  delete damaged.practice.rounds[0].series[0].shots[0].imported;
  assert.equal(isDiary({ version: 1, entries: [damaged] }), false);
});

test('multi-session diary retains the pilot record and rejects a stale writer', t => {
  const pilot = completePractice(appendShot(emptyPractice(), hit), savedAt);
  const raw = JSON.stringify(pilot);
  const storage = useMemoryStorage(t, { [key]: raw });
  const previous = loadDiary();
  assert.deepEqual(previous.entries, [{ id: 'pilot', startedAt: savedAt, practice: pilot }]);
  assert.equal(storage.getItem(DIARY_KEY), null);
  const next = { ...previous, entries: [...previous.entries, { id: 'new', startedAt: savedAt, practice: emptyPractice() }] };
  saveDiary(next, previous);
  assert.deepEqual(loadDiary(), next);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => saveDiary(previous, previous), /другом окне/);
  assert.deepEqual(loadDiary(), next);
});

test('diary does not accept multiple active entries or replace damaged stored sessions', t => {
  const storage = useMemoryStorage(t, { [DIARY_KEY]: '{broken' });
  const practice = emptyPractice();
  const previous = { version: 1 as const, entries: [] };
  assert.throws(() => saveDiary({ ...previous, entries: [
    { id: 'a', startedAt: savedAt, practice }, { id: 'b', startedAt: savedAt, practice },
  ] }, previous), /недопустимые/);
  assert.throws(() => saveDiary(previous, previous), /прочитать/);
  assert.equal(storage.getItem(DIARY_KEY), '{broken');
});

test('old v3 diaries accept optional technique history and retain an immutable focus after reload', t => {
  const original = appendShot(emptyPractice(), hit);
  const entries = useMemoryStorage(t, { [key]: JSON.stringify(original) });
  assert.deepEqual(loadPractice(), original);
  const bound = bindTechnique(original, { versionId: null, versionNumber: null, payload: null, title: 'Мой фокус', focus1: 'Стойка', focus2: '' });
  savePractice(bound);
  assert.deepEqual(loadPractice(), bound);
  const stored = entries.getItem(key);
  assert.throws(() => savePractice({ ...bound, techniqueUses: [{ ...bound.techniqueUses![0], selection: { ...bound.techniqueUses![0].selection, focus1: null } }] } as never));
  assert.equal(entries.getItem(key), stored);
});

function useMemoryStorage(t: TestContext, initial: Record<string, string> = {}, failWrite = false) {
  const entries = new Map(Object.entries(initial));
  const storage = {
    getItem(name: string) { return entries.get(name) ?? null; },
    setItem(name: string, value: string) {
      if (failWrite) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      entries.set(name, value);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  return storage;
}

test('starts empty and restores rounds and a partially entered series including misses', t => {
  useMemoryStorage(t);
  assert.deepEqual(loadPractice(), emptyPractice());
  const first = appendShot(emptyPractice(), hit);
  const second = appendShot(advanceSeries(first), miss);
  const draft = appendShot(startRound(second), hit);
  savePractice(draft);
  assert.deepEqual(loadPractice(), draft);
  const saved = completePractice(draft, savedAt);
  savePractice(saved);
  assert.deepEqual(loadPractice(), saved);
});

test('imports saved pilot data without overwriting v1 and prefers v3 after a write', t => {
  const raw = JSON.stringify({ shots: [hit, miss], savedAt });
  const storage = useMemoryStorage(t, { [legacyKey]: raw });
  const restored = loadPractice();
  assert.deepEqual(currentSeries(restored)?.series.shots, [hit, miss]);
  assert.equal(restored.savedAt, savedAt);
  assert.equal(storage.getItem(key), null);
  savePractice(emptyPractice());
  assert.equal(storage.getItem(legacyKey), raw);
  assert.deepEqual(loadPractice(), emptyPractice());
});

test('imports a pilot draft as a current series with no completion date', t => {
  useMemoryStorage(t, { [legacyKey]: JSON.stringify({ shots: [miss], savedAt: null }) });
  const restored = loadPractice();
  assert.equal(restored.savedAt, null);
  assert.deepEqual(currentSeries(restored)?.series.shots, [miss]);
});

test('does not replace a damaged v3 record or fall back to stale pilot data', t => {
  const raw = '{broken';
  const storage = useMemoryStorage(t, { [key]: raw, [legacyKey]: JSON.stringify({ shots: [hit], savedAt }) });
  assert.throws(loadPractice, /Исходная запись сохранена/);
  assert.throws(() => savePractice(emptyPractice()), /Исходная запись сохранена/);
  assert.equal(storage.getItem(key), raw);
});

test('migrates the v2 diary with original conditions and format while preserving both old records', t => {
  const old = { savedAt, nextId: 3, rounds: [{ id: 1, series: [{ id: 2, shots: [hit, miss] }] }] };
  const raw = JSON.stringify(old);
  const firstPilot = JSON.stringify({ shots: [hit], savedAt });
  const storage = useMemoryStorage(t, { [previousKey]: raw, [legacyKey]: firstPilot });
  const restored = loadPractice();
  assert.deepEqual(currentSeries(restored)?.series.conditions, DEFAULT_CONDITIONS);
  assert.deepEqual(restored.roundRule, DEFAULT_ROUND_RULE);
  assert.deepEqual(currentSeries(restored)?.series.shots, [hit, miss]);
  assert.equal(storage.getItem(key), null);
  savePractice(restored);
  assert.equal(storage.getItem(previousKey), raw);
  assert.equal(storage.getItem(legacyKey), firstPilot);
});

test('refuses a damaged v2 diary even if v1 is readable', t => {
  const raw = '{broken';
  const storage = useMemoryStorage(t, { [previousKey]: raw, [legacyKey]: JSON.stringify({ shots: [hit], savedAt }) });
  assert.throws(loadPractice, /Исходная запись сохранена/);
  assert.throws(() => savePractice(emptyPractice()), /Исходная запись сохранена/);
  assert.equal(storage.getItem(previousKey), raw);
  assert.equal(storage.getItem(key), null);
});

test('stores an unlimited round above thirty arrows and independent equipment conditions', t => {
  useMemoryStorage(t);
  let practice = applyConditions(emptyPractice(), { ...DEFAULT_CONDITIONS, distanceMeters: 30 }, { unit: 'unlimited', limit: null });
  for (let i = 0; i < 32; i++) practice = appendShot(practice, hit);
  savePractice(practice);
  assert.deepEqual(loadPractice(), practice);
});

test('rejects missing series conditions, unreachable coordinates and an exhausted id counter', t => {
  useMemoryStorage(t);
  const saved = appendShot(emptyPractice(), hit);
  savePractice(saved);
  const malformed = structuredClone(saved);
  Reflect.deleteProperty(malformed.rounds[0].series[0], 'conditions');
  assert.throws(() => savePractice(malformed), /недопустимые данные/);
  const huge = structuredClone(saved);
  huge.rounds[0].series[0].shots[0].point = { x: Number.MAX_VALUE, y: 0 };
  assert.throws(() => savePractice(huge), /недопустимые данные/);
  assert.throws(() => savePractice({ ...saved, nextId: Number.MAX_SAFE_INTEGER }), /недопустимые данные/);
  assert.deepEqual(loadPractice(), saved);
});

test('does not overwrite a damaged pilot record while migrating', t => {
  const raw = '{broken';
  const storage = useMemoryStorage(t, { [legacyKey]: raw });
  assert.throws(loadPractice, /Исходная запись сохранена/);
  assert.throws(() => savePractice(emptyPractice()), /Исходная запись сохранена/);
  assert.equal(storage.getItem(legacyKey), raw);
  assert.equal(storage.getItem(key), null);
});

test('rejects an oversized round or invalid score without changing saved data', t => {
  const saved = appendShot(appendShot(emptyPractice(), hit), miss);
  useMemoryStorage(t, { [key]: JSON.stringify(saved) });
  const invalid = emptyPractice();
  invalid.rounds[0].series[0].shots = Array.from({ length: 31 }, () => hit);
  assert.throws(() => savePractice(invalid), /недопустимые данные/);
  invalid.rounds[0].series[0].shots = [{ ...hit, code: 'X' }];
  assert.throws(() => savePractice(invalid), /недопустимые данные/);
  assert.deepEqual(loadPractice(), saved);
});

test('surfaces a storage failure without reporting the attempted save', t => {
  useMemoryStorage(t, {}, true);
  assert.throws(() => savePractice(appendShot(emptyPractice(), hit)), { name: 'QuotaExceededError' });
  assert.deepEqual(loadPractice(), emptyPractice());
});

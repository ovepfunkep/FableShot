import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  DEFAULT_TECHNIQUE_SETTINGS, isTechniqueDisplaySettings, loadTechniqueSettings, saveTechniqueSettings, TECHNIQUE_SETTINGS_STORAGE_KEY,
} from '../src/technique-settings.ts';

function storage(t: TestContext, raw?: string, fail?: 'read' | 'write') {
  const entries = new Map<string, string>();
  if (raw !== undefined) entries.set(TECHNIQUE_SETTINGS_STORAGE_KEY, raw);
  entries.set('app.fableshot.practice.v3', 'personal diary');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => { if (fail === 'read') throw new DOMException('Denied', 'SecurityError'); return entries.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (fail === 'write') throw new DOMException('Full', 'QuotaExceededError'); entries.set(key, value); },
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'));
  return entries;
}

test('technique visibility defaults match Android and explicit choices persist separately', t => {
  const entries = storage(t);
  assert.deepEqual(loadTechniqueSettings(), { techniqueFocus: true, techniqueReflection: true });
  const next = { techniqueFocus: false, techniqueReflection: false };
  saveTechniqueSettings(next, DEFAULT_TECHNIQUE_SETTINGS);
  assert.deepEqual(loadTechniqueSettings(), next);
  assert.equal(entries.get('app.fableshot.practice.v3'), 'personal diary');
  assert.equal(entries.size, 2);
  const loaded = loadTechniqueSettings();
  loaded.techniqueFocus = true;
  assert.deepEqual(loadTechniqueSettings(), next);
});

test('malformed, unknown-version, and incomplete settings are never silently replaced', t => {
  const entries = storage(t);
  const malformed = [
    '{broken', 'null', '[]', JSON.stringify({ version: 2, settings: DEFAULT_TECHNIQUE_SETTINGS }),
    JSON.stringify({ version: 1, settings: { techniqueFocus: true } }),
    JSON.stringify({ version: 1, settings: { ...DEFAULT_TECHNIQUE_SETTINGS, techniqueReflection: 'yes' } }),
    JSON.stringify({ version: 1, settings: { ...DEFAULT_TECHNIQUE_SETTINGS, futureFlag: true } }),
  ];
  for (const raw of malformed) {
    entries.set(TECHNIQUE_SETTINGS_STORAGE_KEY, raw);
    assert.throws(loadTechniqueSettings, /Исходная запись сохранена/);
    assert.throws(() => saveTechniqueSettings(DEFAULT_TECHNIQUE_SETTINGS, DEFAULT_TECHNIQUE_SETTINGS));
    assert.equal(entries.get(TECHNIQUE_SETTINGS_STORAGE_KEY), raw);
  }
  assert.equal(isTechniqueDisplaySettings(null), false);
  assert.equal(isTechniqueDisplaySettings([]), false);
});

test('a stale settings snapshot cannot overwrite another window', t => {
  const entries = storage(t);
  const expected = loadTechniqueSettings();
  const changed = { ...expected, techniqueFocus: false };
  saveTechniqueSettings(changed, expected);
  const raw = entries.get(TECHNIQUE_SETTINGS_STORAGE_KEY);
  assert.throws(() => saveTechniqueSettings({ ...expected, techniqueReflection: false }, expected), /другом окне/);
  assert.equal(entries.get(TECHNIQUE_SETTINGS_STORAGE_KEY), raw);
});

test('quota failure reports the error and retains the last saved settings', t => {
  const raw = JSON.stringify({ version: 1, settings: DEFAULT_TECHNIQUE_SETTINGS });
  const entries = storage(t, raw, 'write');
  assert.throws(() => saveTechniqueSettings({ ...DEFAULT_TECHNIQUE_SETTINGS, techniqueFocus: false }, DEFAULT_TECHNIQUE_SETTINGS), /хранилище заполнено/);
  assert.equal(entries.get(TECHNIQUE_SETTINGS_STORAGE_KEY), raw);
});

test('unavailable storage blocks both reading and writing with useful diagnostics', t => {
  storage(t, undefined, 'read');
  assert.throws(loadTechniqueSettings, /открыть настройки/);
  assert.throws(() => saveTechniqueSettings(DEFAULT_TECHNIQUE_SETTINGS, DEFAULT_TECHNIQUE_SETTINGS), /открыть настройки/);
});

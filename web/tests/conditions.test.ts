import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE, isConditions, isRoundRule, loadPresets, removePreset, savePreset,
} from '../src/conditions.ts';

function useStorage(t: TestContext, raw: string | null = null, failWrite = false) {
  let stored = raw;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key: string) { return key === 'app.fableshot.training-presets.v1' ? stored : null; },
    setItem(_key: string, value: string) {
      if (failWrite) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      stored = value;
    },
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'));
  return () => stored;
}

test('conditions require a known profile and compatible diameter, with finite distance and valid limits', () => {
  assert(isConditions(DEFAULT_CONDITIONS));
  assert(!isConditions({ ...DEFAULT_CONDITIONS, distanceMeters: Infinity }));
  assert(!isConditions({ ...DEFAULT_CONDITIONS, targetProfileId: 'unknown' }));
  assert(!isConditions({ ...DEFAULT_CONDITIONS, targetDiameterMm: 800 }));
  assert(isConditions({ ...DEFAULT_CONDITIONS, targetProfileId: 'practice-full-10-v1', targetDiameterMm: 123 }));
  assert(isRoundRule({ unit: 'arrows', limit: 1_000_000 }));
  assert(!isRoundRule({ unit: 'arrows', limit: 1_000_001 }));
  assert(!isRoundRule({ unit: 'series', limit: 201 }));
  assert(!isRoundRule({ unit: 'unlimited', limit: 30 }));
  assert(isRoundRule({ unit: 'unlimited', limit: null }));
});

test('preset save, read and remove keep independent snapshots and reject case-insensitive duplicate names', t => {
  useStorage(t);
  const conditions = { ...DEFAULT_CONDITIONS };
  const saved = savePreset('  Клуб  ', conditions, DEFAULT_ROUND_RULE);
  conditions.distanceMeters = 50;
  assert.equal(saved[0].name, 'Клуб');
  assert.equal(saved[0].conditions.distanceMeters, 18);
  assert.deepEqual(loadPresets(), saved);
  assert.throws(() => savePreset('кЛуБ', DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE), /уже существуют/);
  assert.throws(() => savePreset(' ', DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE), /Имя/);
  assert.deepEqual(removePreset(saved[0].id), []);
  assert.deepEqual(loadPresets(), []);
});

test('damaged and unsupported preset data survive read and write attempts', t => {
  const original = '{broken';
  const raw = useStorage(t, original);
  assert.throws(loadPresets, /Исходная запись сохранена/);
  assert.throws(() => savePreset('Клуб', DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE), /Исходная запись сохранена/);
  assert.throws(() => removePreset('missing'), /Исходная запись сохранена/);
  assert.equal(raw(), original);
});

test('the sixty-four preset limit and failed storage writes leave earlier presets intact', t => {
  const presets = Array.from({ length: 64 }, (_, i) => ({
    id: `preset-${i}`, name: `Клуб ${i}`, conditions: DEFAULT_CONDITIONS, rule: DEFAULT_ROUND_RULE,
  }));
  const original = JSON.stringify({ version: 1, presets });
  const raw = useStorage(t, original);
  assert.throws(() => savePreset('Ещё', DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE), /64/);
  assert.equal(raw(), original);
});

test('a preset storage failure does not report success', t => {
  const raw = useStorage(t, null, true);
  assert.throws(() => savePreset('Клуб', DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE), { name: 'QuotaExceededError' });
  assert.equal(raw(), null);
});

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DEFAULT_PREFERENCES, formatAverage, loadPreferences, savePreferences } from '../src/preferences.ts';
import { statisticVisible } from '../src/statistics-visibility.ts';

const key = 'app.fableshot.training-preferences.v1';

test('lock-screen setting is optional for existing diaries and validates explicit overrides', t => {
  storage(t);
  for (const trainingOnLockScreen of [true, false]) {
    savePreferences({ ...DEFAULT_PREFERENCES, trainingOnLockScreen });
    assert.equal(loadPreferences().trainingOnLockScreen, trainingOnLockScreen);
  }
  assert.throws(() => savePreferences({ ...DEFAULT_PREFERENCES, trainingOnLockScreen: 'yes' } as never));
});
function storage(t: TestContext, raw: string | null = null, fail = false) {
  const entries = new Map<string, string>();
  if (raw !== null) entries.set(key, raw);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (name: string) => entries.get(name) ?? null,
    setItem: (name: string, value: string) => { if (fail) throw new DOMException('Full', 'QuotaExceededError'); entries.set(name, value); },
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'));
  return entries;
}

test('uses Android defaults and persists explicit display choices separately from the diary', t => {
  const entries = storage(t);
  assert.deepEqual(loadPreferences(), { hideScores: false, averageHundredths: false, animations: true, haptics: false, keepAwake: true });
  const next = { ...DEFAULT_PREFERENCES, hideScores: true, averageHundredths: true, animations: false };
  savePreferences(next);
  assert.deepEqual(loadPreferences(), next);
  assert.equal(entries.size, 1);
});

test('corrupt preferences cannot be silently overwritten', t => {
  const entries = storage(t, '{broken');
  assert.throws(loadPreferences, /прочитать/);
  assert.throws(() => savePreferences(DEFAULT_PREFERENCES));
  assert.equal(entries.get(key), '{broken');
});

test('invalid flags and quota failure retain the previous settings', t => {
  const raw = JSON.stringify({ version: 1, preferences: DEFAULT_PREFERENCES });
  const entries = storage(t, raw, true);
  assert.throws(() => savePreferences({ ...DEFAULT_PREFERENCES, hideScores: 'yes' } as never));
  assert.throws(() => savePreferences({ ...DEFAULT_PREFERENCES, hideScores: true }), /Full/);
  assert.equal(entries.get(key), raw);
});

test('average rounding follows the one/two decimal preference, including empty results', () => {
  assert.equal(formatAverage(25 / 3, false), '8,3');
  assert.equal(formatAverage(25 / 3, true), '8,33');
  assert.equal(formatAverage(10, true), '10,00');
  assert.equal(formatAverage(0, false), '0,0');
  assert.equal(formatAverage(null, true), '—');
});

test('statistics choices persist without affecting other preferences and default to visible', t => {
  storage(t);
  assert.equal(statisticVisible(loadPreferences(), 'norms'), true);
  const next = { ...DEFAULT_PREFERENCES, disabledStatistics: ['norms', 'average', 'records'] as const };
  savePreferences({ ...next, disabledStatistics: [...next.disabledStatistics] });
  assert.equal(statisticVisible(loadPreferences(), 'norms'), false);
  assert.equal(statisticVisible(loadPreferences(), 'result'), true);
  assert.equal(loadPreferences().keepAwake, true);
});

test('unknown or duplicate statistics flags cannot overwrite saved preferences', t => {
  const raw = JSON.stringify({ version: 1, preferences: DEFAULT_PREFERENCES });
  const entries = storage(t, raw);
  for (const disabledStatistics of [['unknown'], ['norms', 'norms'], 'norms']) {
    assert.throws(() => savePreferences({ ...DEFAULT_PREFERENCES, disabledStatistics } as never));
    assert.equal(entries.get(key), raw);
  }
});

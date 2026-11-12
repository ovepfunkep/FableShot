import assert from 'node:assert/strict';
import { test } from 'node:test';
import { achievementValidity } from '../src/achievement-validity.ts';
import type { AchievementGrant } from '../src/achievement-ledger.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import type { Diary, DiaryEntry } from '../src/persistence.ts';

const epoch = 'current-epoch';
const earnedAt = '2026-11-11T10:00:00.000Z';
const setup = { ...DEFAULT_CONDITIONS, equipment: { id: 'kit', name: 'Комплект',
  bow: { name: 'Лук', category: 'recurve' }, arrows: { name: 'Стрелы', diameterMm: 6 } } };

function training(id = 'source', scores = [10, 10, 10]): DiaryEntry {
  return { id, startedAt: '2026-11-11T09:00:00.000Z', achievementEnrollment: { epoch, rankCategory: null },
    practice: { savedAt: earnedAt, nextId: 3, roundRule: { unit: 'unlimited', limit: null }, rounds: [{ id: 1, series: [{
      id: 2, plannedCount: 3, conditions: structuredClone(setup), shots: scores.map(points => ({ points,
        code: points ? String(points) : 'M', point: points ? { x: (10.5 - points) / 10, y: 0 } : null })),
    }] }] } };
}

const grant = (id: string, scope = 'recurve', extra: Partial<AchievementGrant> & { valid?: boolean } = {}): AchievementGrant =>
  ({ id, scope, earnedAt, sessionId: 'source', ...extra });
const diary = (entries: DiaryEntry[], grants: AchievementGrant[]): Diary => ({ version: 1, entries,
  achievementLedger: { epoch, grants } });

test('validity recomputes issued performance receipts after a correction and can recover without new receipts', () => {
  const source = training();
  const original = diary([source], [grant('HIT01'), grant('START03')]);
  const snapshot = structuredClone(original);
  assert.deepEqual([...achievementValidity(original)], [['HIT01:recurve', true], ['START03:recurve', true]]);
  assert.deepEqual(original, snapshot);
  const changed = diary([training('source', [9, 10, 10])], [grant('HIT01'), grant('START03')]);
  assert.equal(achievementValidity(changed).get('HIT01:recurve'), false);
  assert.equal(achievementValidity(changed).get('START03:recurve'), true);
  assert.equal(achievementValidity(diary([source], [grant('HIT01', 'recurve', { valid: false })])).get('HIT01:recurve'), true);
  assert.equal(achievementValidity(diary([source], [])).size, 0);
  assert.equal(achievementValidity({ version: 1, entries: [source] }).size, 0);
});

test('global thresholds use all remaining eligible sources and ignore legacy, reset epochs and imported arrows', () => {
  const entries = Array.from({ length: 5 }, (_, index) => training(`source-${index}`, [0]));
  const grants = [grant('START05', 'global')];
  assert.equal(achievementValidity(diary(entries, grants)).get('START05:global'), true);
  for (const excluded of [
    { ...entries[4], achievementEnrollment: undefined },
    { ...entries[4], achievementEnrollment: { epoch: 'old-epoch', rankCategory: null } },
    { ...entries[4], deletedAt: earnedAt },
  ]) assert.equal(achievementValidity(diary([...entries.slice(0, 4), excluded], grants)).get('START05:global'), false);
  const imported = structuredClone(entries[4]);
  imported.practice.rounds[0].series[0].shots[0].imported = true;
  assert.equal(achievementValidity(diary([...entries.slice(0, 4), imported], grants)).get('START05:global'), false);
  const otherSource = training('replacement');
  assert.equal(achievementValidity(diary([otherSource], [grant('HIT01')])).get('HIT01:recurve'), true);
});

test('independent actions and unknown receipts preserve stored validity through source deletion', () => {
  const grants = ['APP01', 'APP04', 'APP08', 'MIND03', 'MIND04', 'MIND08', 'FUTURE99'].map(id => grant(id, 'global'));
  const result = achievementValidity(diary([], grants));
  assert.equal(result.size, grants.length);
  assert.ok([...result.values()].every(Boolean));
  assert.equal(achievementValidity(diary([], [grant('APP08', 'global', { valid: false })])).get('APP08:global'), false);
  assert.equal(achievementValidity(diary([training()], [grant('HIT01', 'global')])).get('HIT01:global'), false);
});

test('record receipts follow corrected comparable history and recover without issuing a new receipt', () => {
  const source = training('source', [10, 10, 10]);
  const previous = training('previous', [8, 8, 8]);
  previous.startedAt = '2026-09-01T09:00:00Z';
  previous.practice.savedAt = '2026-09-01T10:00:00Z';
  const records = [grant('PROGRESS04'), grant('PROGRESS10'), grant('PROGRESS06')];
  const state = diary([previous, source], records);
  const snapshot = structuredClone(state);
  assert.deepEqual([...achievementValidity(state).values()], [true, true, false]);
  assert.deepEqual(state, snapshot);
  assert.ok([...achievementValidity(diary([previous, training('source', [8, 8, 8])], records)).values()].every(value => !value));
  const correctedHistory = training('previous', [10, 10, 10]);
  correctedHistory.startedAt = previous.startedAt;
  correctedHistory.practice.savedAt = previous.practice.savedAt;
  assert.ok([...achievementValidity(diary([correctedHistory, source], records)).values()].every(value => !value));
  assert.ok([...achievementValidity(diary([source], records)).values()].every(value => !value));
  const reopened = { ...source, practice: { ...source.practice, savedAt: null } };
  assert.ok([...achievementValidity(diary([previous, reopened], records)).values()].every(value => !value));
  assert.equal(achievementValidity(diary([previous, source], [grant('PROGRESS04', 'recurve', { valid: false })])).get('PROGRESS04:recurve'), true);
  assert.equal(achievementValidity(diary([previous, source], [grant('PROGRESS04', 'recurve', { sessionId: undefined })])).get('PROGRESS04:recurve'), false);
  // Migrated Android receipts retain their saved validity; they do not gain invented web evidence.
  assert.equal(achievementValidity(diary([], [grant('PROGRESS04', 'recurve', { nativeSnapshot: true })])).get('PROGRESS04:recurve'), true);
});

test('exercise-record receipts reassess the full exercise rather than a single completed series', () => {
  const source = training('source', [9, 9, 9]);
  const previous = training('previous', [8, 8, 8]);
  previous.startedAt = '2026-09-01T09:00:00Z';
  previous.practice.savedAt = '2026-09-01T10:00:00Z';
  for (const entry of [source, previous]) {
    const series = entry.practice.rounds[0].series[0];
    entry.practice.rounds[0].series = Array.from({ length: 20 }, (_, index) => ({ ...structuredClone(series), id: index + 2 }));
    entry.practice.nextId = 22;
  }
  const records = [grant('PROGRESS06')];
  assert.equal(achievementValidity(diary([previous, source], records)).get('PROGRESS06:recurve'), true);
  source.practice.rounds[0].series[0].shots = [];
  assert.equal(achievementValidity(diary([previous, source], records)).get('PROGRESS06:recurve'), false);
});

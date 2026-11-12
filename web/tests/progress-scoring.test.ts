import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE } from '../src/conditions.ts';
import type { Conditions } from '../src/conditions.ts';
import type { DiaryEntry } from '../src/persistence.ts';
import type { Series } from '../src/practice.ts';
import type { Shot } from '../src/target.ts';
import {
  calculateProgress, freezeProgressBaseline, isProgressBaseline, progressConditionKey, progressSourceChanges,
} from '../src/progress-scoring.ts';

const conditions: Conditions = {
  ...DEFAULT_CONDITIONS,
  equipment: { id: 'kit-a', name: 'Комплект', bow: { name: 'Лук', category: 'recurve' }, arrows: { name: '', diameterMm: 6 } },
};
const at = (day: number, hour = 9) => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

function shot(points: number): Shot {
  return { points, code: points === 0 ? 'M' : String(points), point: points === 0 ? null : { x: (10 - points) / 10, y: 0 } };
}

function ends(count: number, points: number, setup = conditions, firstId = 2): Series[] {
  return Array.from({ length: Math.ceil(count / 3) }, (_, index) => ({
    id: firstId + index, shots: Array.from({ length: Math.min(3, count - index * 3) }, () => shot(points)), conditions: setup,
  }));
}

function entry(id: string, day: number, series = ends(12, 5)): DiaryEntry {
  return { id, startedAt: at(day), practice: { rounds: [{ id: 1, series }], nextId: 100, savedAt: at(day, 10), roundRule: DEFAULT_ROUND_RULE } };
}

function baseline(sources: readonly DiaryEntry[], setup = conditions, startedAt = at(10), frozenAt = at(11)) {
  return freezeProgressBaseline(sources, 'active', startedAt, setup, frozenAt);
}

test('PG1 conditions compare versioned geometry, distance, diameter and bow category across equipment instances', () => {
  const key = progressConditionKey(conditions);
  assert.ok(key);
  const secondKit = { ...conditions.equipment!, id: 'kit-b', name: 'Другой комплект', arrows: { name: 'Тонкие', diameterMm: 4 } };
  assert.equal(progressConditionKey({ ...conditions, equipment: secondKit }), key);
  assert.notEqual(progressConditionKey({ ...conditions, distanceMeters: 30 }), key);
  assert.notEqual(progressConditionKey({ ...conditions, targetDiameterMm: 600 }), key);
  assert.notEqual(progressConditionKey({ ...conditions, targetProfileId: 'wa-indoor-inner-v1' }), key);
  assert.notEqual(progressConditionKey({ ...conditions, equipment: { ...secondKit, bow: { name: 'Другой', category: 'compound' } } }), key);
  assert.equal(progressConditionKey({ ...conditions, targetProfileId: 'wa-indoor-outer-v2' }), null);
  assert.equal(progressConditionKey({ ...conditions, targetDiameterMm: 800 }), null);
  assert.equal(progressConditionKey({ ...conditions, equipment: { ...secondKit, bow: { name: 'Неизвестный', category: null } } }), null);
  assert.equal(progressConditionKey(DEFAULT_CONDITIONS), null);
  const missing = baseline([entry('one', 1)], DEFAULT_CONDITIONS);
  assert.equal(missing.status, 'unknown_conditions');
  assert.equal(calculateProgress(missing, ends(12, 6)), null);
  assert.ok(isProgressBaseline(missing));
});

test('the last five distinct completed sessions are ordered by start and ID within the original cutoff', () => {
  const atCutoff = entry('at-cutoff', 9);
  atCutoff.practice.savedAt = at(10);
  const afterCutoff = entry('after-cutoff', 9);
  afterCutoff.practice.savedAt = at(10, 11);
  const dateOnly = entry('date-only', 9);
  dateOnly.practice.savedAt = '2026-11-09';
  const ongoing = entry('ongoing', 9);
  ongoing.practice.savedAt = null;
  const backwards = entry('backwards', 9);
  backwards.practice.savedAt = at(8);
  const lateEnd = entry('late-end', 2);
  lateEnd.practice.savedAt = at(9, 11);
  const recent = entry('recent', 8);
  const entries = [entry('oldest', 1), recent, atCutoff, entry('active', 9), entry('tied-z', 7),
    entry('sixth', 4), entry('tied-a', 7), lateEnd, entry('short', 9, ends(11, 8)), ongoing,
    entry('mismatch', 9, ends(12, 8, { ...conditions, distanceMeters: 25 })), afterCutoff, recent, dateOnly,
    backwards, entry('fifth', 6), entry('fourth', 6), entry('future', 12)];
  const frozen = baseline(entries);
  assert.deepEqual(frozen.sources.map(source => source.sessionId), ['recent', 'tied-a', 'tied-z', 'fifth', 'fourth']);
  assert.equal(frozen.sessionStartCutoff, at(10));
  assert.equal(frozen.frozenAt, at(11));
  assert.equal(frozen.scoredCount, 60);
  assert.ok(isProgressBaseline(frozen));
  assert.equal(baseline(entries, conditions, '2026-11-10').status, 'unknown_conditions');
});

test('matching series aggregate by session and the baseline weights each scored arrow, including misses', () => {
  const older = entry('older', 1, ends(12, 4));
  const middle = entry('middle', 2, ends(12, 0));
  const newest = entry('newest', 3, [...ends(9, 10), ...ends(12, 10, { ...conditions, targetDiameterMm: 600 }, 40)]);
  newest.practice.rounds.push({ id: 50, series: ends(15, 10, conditions, 51) });
  const two = baseline([older, middle]);
  assert.equal(two.status, 'building');
  assert.equal(calculateProgress(two, ends(12, 6))!.fullRankAvailable, false);
  const frozen = baseline([older, middle, newest]);
  assert.equal(frozen.status, 'ready');
  assert.deepEqual(frozen.sources.map(source => [source.sessionId, source.scoredCount, source.scoreSum]), [
    ['newest', 24, 240], ['middle', 12, 0], ['older', 12, 48],
  ]);
  assert.deepEqual(calculateProgress(frozen, ends(12, 5)), {
    percentagePoints: -10, relativePercent: -100 / 6, rawIncrease: null,
    baselineAverage: 6, currentAverage: 5, scoredCount: 12, fullRankAvailable: true,
  });
});

test('full PG1 needs 12 scored arrows in full closed series from the selected conditions', () => {
  const frozen = baseline([entry('one', 1), entry('two', 2), entry('three', 3)]);
  const complete = ends(12, 6);
  assert.equal(calculateProgress(frozen, complete)!.relativePercent, 20);
  assert.equal(calculateProgress(frozen, complete)!.percentagePoints, 10);
  assert.equal(calculateProgress(frozen, ends(9, 6))!.fullRankAvailable, false);
  assert.equal(calculateProgress(frozen, complete, complete.at(-1)!.id)!.fullRankAvailable, false);
  const partial = { ...complete[0], plannedCount: 4 };
  assert.equal(calculateProgress(frozen, [partial, ...complete.slice(1)])!.fullRankAvailable, false);
  const blank = { ...complete[0], id: 90, shots: [] };
  assert.equal(calculateProgress(frozen, [...complete, blank], blank.id)!.fullRankAvailable, true);
  const mixed = [...ends(9, 6), ...ends(3, 10, { ...conditions, distanceMeters: 30 }, 50)];
  assert.equal(calculateProgress(frozen, mixed)!.scoredCount, 9);
  assert.equal(calculateProgress(frozen, mixed)!.fullRankAvailable, false);
});

test('missing comparisons stay empty and a true zero baseline shows an absolute difference', () => {
  const noSources = baseline([]);
  assert.equal(calculateProgress(noSources, ends(12, 6))!.baselineAverage, null);
  assert.equal(calculateProgress(noSources, ends(12, 6))!.percentagePoints, null);
  const zeros = baseline([1, 2, 3].map(day => entry(String(day), day, ends(12, 0))));
  assert.deepEqual(calculateProgress(zeros, ends(12, 6)), {
    percentagePoints: 60, relativePercent: null, rawIncrease: 6,
    baselineAverage: 0, currentAverage: 6, scoredCount: 12, fullRankAvailable: true,
  });
  assert.equal(calculateProgress(zeros, [])!.rawIncrease, null);
});

test('an equal-total edit, removal and late arrival never change frozen scores after serialization', () => {
  const first = entry('first', 1);
  const second = entry('second', 2);
  const third = entry('third', 3);
  const original = baseline([first, second, third]);
  const stored: unknown = JSON.parse(JSON.stringify(original));
  assert.ok(isProgressBaseline(stored));
  assert.deepEqual(progressSourceChanges(stored, [first, second, third]), []);
  first.practice.rounds[0].series[0].shots[0] = shot(4);
  first.practice.rounds[0].series[0].shots[1] = shot(6);
  const late = entry('late', 8, ends(12, 10));
  assert.deepEqual(progressSourceChanges(stored, [first, third, late]), [
    { sessionId: 'second', status: 'deleted' }, { sessionId: 'first', status: 'changed' },
  ]);
  assert.equal(original.scoreSum, 180);
  assert.equal(calculateProgress(stored, ends(12, 6))!.relativePercent, 20);
  assert.notEqual(baseline([first, third, late]).scoreSum, stored.scoreSum);
});

test('snapshot validation rejects inconsistent totals, state, chronology, condition key and source evidence', () => {
  const frozen = baseline([entry('one', 1), entry('two', 2), entry('three', 3)]);
  const [source, ...rest] = frozen.sources;
  assert.equal(isProgressBaseline({ ...frozen, policyVersion: 'future' }), false);
  assert.equal(isProgressBaseline({ ...frozen, scoredCount: 36.5 }), false);
  assert.equal(isProgressBaseline({ ...frozen, status: 'building' }), false);
  assert.equal(isProgressBaseline({ ...frozen, maximumPerArrow: 9 }), false);
  assert.equal(isProgressBaseline({ ...frozen, sources: [source, source, ...rest] }), false);
  assert.equal(isProgressBaseline({ ...frozen, sources: [{ ...source, completedAt: at(10) }, ...rest] }), false);
  assert.equal(isProgressBaseline({ ...frozen, sources: [{ ...source, completedAt: '2026-11-03' }, ...rest] }), false);
  assert.equal(isProgressBaseline({ ...frozen, sources: [{ ...source, fingerprint: '' }, ...rest] }), false);
  assert.equal(isProgressBaseline({ ...frozen, sources: [{ ...source, scoreSum: 121 }, ...rest], scoreSum: 241 }), false);
});

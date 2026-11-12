import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAchievementRecords } from '../src/achievement-records.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import type { DiaryEntry } from '../src/persistence.ts';

const conditions = { ...DEFAULT_CONDITIONS, equipment: {
  id: 'kit', name: 'Комплект', bow: { name: 'Лук', category: 'recurve' }, arrows: { name: '', diameterMm: 6 },
} };

function entry(id: string, date: string, rows: number[][], enrolled = false): DiaryEntry {
  return { id, localDate: date, startedAt: `${date}T08:00:00Z`,
    ...(enrolled ? { achievementEnrollment: { epoch: 'current', rankCategory: null } } : {}),
    practice: { nextId: rows.length + 2, savedAt: `${date}T09:00:00Z`, roundRule: { unit: 'unlimited', limit: null },
      rounds: [{ id: 1, series: rows.map((points, index) => ({ id: index + 2, conditions: structuredClone(conditions),
        plannedCount: Math.max(3, points.length), shots: points.map(points => ({ points, code: String(points), point: { x: 0, y: 0 } })) })) }] } };
}
const rows = (count: number, arrows: number, points: number) => Array.from({ length: count }, () => Array<number>(arrows).fill(points));
const ids = (candidate: DiaryEntry, history: DiaryEntry[]) => evaluateAchievementRecords(candidate, history).map(item => item.id);

test('series records require a strictly better comparable previous result and a new enrolled candidate', () => {
  const old = entry('old', '2026-01-10', [[8, 8, 8]]);
  const candidate = entry('candidate', '2026-01-11', [[9, 8, 8]], true);
  const baseline = JSON.stringify([old, candidate]);
  assert.deepEqual(evaluateAchievementRecords(candidate, [old]), [{ id: 'PROGRESS04', scope: 'recurve', progress: 1 }]);
  assert.deepEqual(ids(candidate, []), []);
  assert.deepEqual(ids(candidate, [candidate]), []);
  assert.deepEqual(ids({ ...candidate, achievementEnrollment: undefined }, [old]), []);
  assert.deepEqual(ids(candidate, [entry('tie', '2026-01-10', [[9, 8, 8]])]), []);
  assert.deepEqual(ids(candidate, [entry('six', '2026-01-10', [[4, 4, 4, 4, 4, 4]])]), []);
  assert.equal(JSON.stringify([old, candidate]), baseline);
});

test('import and legacy history can establish the record while imported, deleted and active candidates cannot earn', () => {
  const legacy = entry('legacy', '2026-01-10', [[8, 8, 8]]);
  delete legacy.practice.rounds[0].series[0].plannedCount;
  legacy.practice.rounds[0].series[0].shots[0].imported = true;
  legacy.source = { kind: 'mytargets', fileHash: '0'.repeat(64), parserVersion: '1', sessionId: 'original',
    sourceRecords: [], seriesFingerprints: [], overlapFingerprints: [] };
  const candidate = entry('new', '2026-01-11', [[9, 9, 9]], true);
  assert.deepEqual(ids(candidate, [legacy, legacy]), ['PROGRESS04']);
  assert.deepEqual(ids({ ...candidate, source: legacy.source }, [legacy]), []);
  assert.deepEqual(ids({ ...candidate, deletedAt: candidate.startedAt }, [legacy]), []);
  assert.deepEqual(ids({ ...candidate, practice: { ...candidate.practice, savedAt: null } }, [legacy]), []);
  candidate.practice.rounds[0].series[0].shots[0].imported = true;
  assert.deepEqual(ids(candidate, [legacy]), []);
});

test('series comparison excludes incomplete, differently equipped, future and trashed records', () => {
  const candidate = entry('new', '2026-02-10', [[9, 9, 9]], true);
  const incomplete = entry('partial', '2026-01-10', [[8, 8]]);
  const kit = entry('kit', '2026-01-10', [[8, 8, 8]]);
  kit.practice.rounds[0].series[0].conditions.equipment!.id = 'other';
  const farther = entry('farther', '2026-01-10', [[8, 8, 8]]);
  farther.practice.rounds[0].series[0].conditions.distanceMeters = 20;
  const future = entry('future', '2026-03-10', [[8, 8, 8]]);
  const trashed = { ...entry('trash', '2026-01-10', [[8, 8, 8]]), deletedAt: '2026-02-01T00:00:00Z' };
  assert.deepEqual(ids(candidate, [incomplete, kit, farther, future, trashed]), []);
  candidate.practice.rounds[0].series[0].plannedCount = 6;
  assert.deepEqual(ids(candidate, [entry('old', '2026-01-10', [[8, 8, 8]])]), []);
});

test('a month uses calendar boundaries with month-end clamping and the oldest tie at the best score', () => {
  for (const [before, tooEarly, reached] of [
    ['2026-01-31', '2026-02-27', '2026-02-28'],
    ['2028-01-31', '2028-02-28', '2028-02-29'],
    ['2026-12-31', '2027-01-30', '2027-01-31'],
  ]) {
    const old = entry('old', before, [[8, 8, 8]]);
    assert.deepEqual(ids(entry('early', tooEarly, [[9, 9, 9]], true), [old]), ['PROGRESS04']);
    assert.deepEqual(ids(entry('reached', reached, [[9, 9, 9]], true), [old]), ['PROGRESS04', 'PROGRESS10']);
  }
  const candidate = entry('new', '2026-03-01', [[9, 9, 9]], true);
  const old = entry('old', '2026-01-01', [[8, 8, 8]]);
  const tie = entry('tie', '2026-02-28', [[8, 8, 8]]);
  assert.deepEqual(ids(candidate, [tie, old]), ['PROGRESS04', 'PROGRESS10']);
  const improvedRecently = entry('improved', '2026-02-28', [[9, 8, 8]]);
  assert.deepEqual(ids(candidate, [old, improvedRecently]), ['PROGRESS04']);
  assert.deepEqual(ids({ ...candidate, localDate: null }, [old]), ['PROGRESS04']);
  assert.deepEqual(ids(candidate, [{ ...old, localDate: null }]), ['PROGRESS04']);
});

test('backdated history arriving after the candidate cannot rewrite its record comparison', () => {
  const candidate = entry('new', '2026-02-10', [[9, 9, 9]], true);
  const old = entry('old', '2026-01-10', [[8, 8, 8]]);
  const late = entry('late', '2026-01-01', [[10, 10, 10]]);
  late.createdAt = '2026-03-01T10:00:00Z';
  assert.deepEqual(ids(candidate, [old, late]), ['PROGRESS04', 'PROGRESS10']);
  late.createdAt = '2026-02-01T10:00:00Z';
  assert.deepEqual(ids(candidate, [old, late]), []);
});

test('a whole supported exercise compares total points across different full series lengths', () => {
  const old = entry('old', '2026-01-01', rows(10, 6, 8));
  const candidate = entry('new', '2026-02-01', rows(20, 3, 9), true);
  assert.deepEqual(ids(candidate, [old]), ['PROGRESS06', 'PROGRESS10']);
  assert.deepEqual(ids(candidate, [entry('tie', '2026-01-01', rows(10, 6, 9))]), []);
  assert.deepEqual(ids(candidate, [entry('short', '2026-01-01', rows(5, 6, 8))]), []);
  const partial = entry('partial', '2026-01-01', [...rows(9, 6, 8), [8, 8, 8], [8, 8, 8]]);
  partial.practice.rounds[0].series[9].plannedCount = 6;
  assert.ok(!ids(candidate, [partial]).includes('PROGRESS06'));
});

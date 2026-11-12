import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awardPublication, awardServiceAction, awardTrainingChange, eligibleForAchievements } from '../src/achievement-diary.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import { advanceSeries, completePractice, deleteSeries, replaceShot, startRound } from '../src/practice.ts';
import type { Practice } from '../src/practice.ts';
import { achievementValidity } from '../src/achievement-validity.ts';
import { groupAchievementGrants } from '../src/achievement-ledger.ts';
import { isDiary } from '../src/persistence.ts';
import type { Diary, DiaryEntry } from '../src/persistence.ts';
import type { Shot } from '../src/target.ts';

const epoch = 'achievement-epoch-one';
const now = '2026-11-11T10:00:00.000Z';
const later = '2026-11-11T11:00:00.000Z';
const setup = { ...DEFAULT_CONDITIONS, equipment: { id: 'kit', name: 'Комплект', bow: { name: 'Лук', category: 'recurve' },
  arrows: { name: 'Стрелы', diameterMm: 6 } } };

function shot(points: number): Shot {
  return { points, code: points ? String(points) : 'M', point: points ? { x: (10.5 - points) / 10, y: 0 } : null };
}

function training(id: string, rows: number[][], options: { active?: boolean; enrollment?: string } = {}): DiaryEntry {
  return { id, startedAt: '2026-11-11T09:00:00.000Z',
    ...(options.enrollment ? { achievementEnrollment: { epoch: options.enrollment, rankCategory: null } } : {}),
    practice: { savedAt: options.active ? null : now, nextId: rows.length + 2, roundRule: { unit: 'unlimited', limit: null },
      rounds: [{ id: 1, series: rows.map((row, index) => ({ id: index + 2, shots: row.map(shot), conditions: structuredClone(setup),
        plannedCount: Math.max(3, row.length) })) }] } };
}

const diary = (entries: DiaryEntry[], currentEpoch = epoch): Diary => ({ version: 1, entries, achievementLedger: { epoch: currentEpoch, grants: [] } });
const completed = (entry: DiaryEntry): DiaryEntry => ({ ...entry, practice: { ...entry.practice, savedAt: now } });

function stageTraining(rows: number[][], bow = 'barebow', unit: Practice['roundRule']['unit'] = 'arrows', limit: number | null = 30): DiaryEntry {
  const entry = training('stage', rows, { active: true, enrollment: epoch });
  entry.achievementEnrollment!.stageRankVersion = 1;
  entry.practice.roundRule = { unit, limit };
  for (const round of entry.practice.rounds) for (const series of round.series) series.conditions.equipment!.bow.category = bow;
  return entry;
}

function changeStage(before: Diary, change: (practice: Practice) => Practice, category: 'male' | 'female' | null = 'male') {
  const [entry] = before.entries;
  const result = awardTrainingChange(before, { ...before, entries: [{ ...entry, practice: change(entry.practice) }] }, entry.id, category, now);
  assert.ok(isDiary(result.diary));
  return { ...result, stages: result.added.filter(grant => grant.stageRank) };
}

test('rank series wait for closure and cascade once per bow, category and reference format', () => {
  const entry = stageTraining([[10, 10, 10]]);
  const initial = diary([entry]);
  assert.deepEqual(changeStage(initial, practice => practice).stages, []);
  const closed = changeStage(initial, advanceSeries);
  assert.deepEqual(closed.stages.map(grant => grant.id), ['SNR01', 'SNR02', 'SNR03', 'SNR04', 'SNR05', 'SNR06']);
  assert.equal(groupAchievementGrants(closed.stages)[0].additional.length, 5);
  assert.match(closed.stages[0].scope, /barebow-18-60-male/);
  assert.equal(closed.stages.at(-1)?.stageRank?.threshold, 553);
  const second = stageTraining([[10, 10, 10]]);
  const repeated = { ...closed.diary, entries: [{ ...second, id: 'second' }] };
  assert.deepEqual(changeStage(repeated, advanceSeries).stages, []);
  assert.match(changeStage(repeated, advanceSeries, 'female').stages[0].scope, /female/);
  assert.deepEqual(changeStage(diary([stageTraining([[10, 10, 10]], 'recurve')]), advanceSeries).stages.map(grant => grant.id),
    ['SNR01', 'SNR02', 'SNR03']);
});

test('a full round is distinct from its last series and respects each type of round boundary', () => {
  const rows = Array.from({ length: 10 }, () => [10, 10, 10]);
  for (const [unit, limit] of [['arrows', 30], ['series', 10], ['unlimited', null]] as const) {
    const entry = stageTraining(rows, 'barebow', unit, limit);
    const initial = diary([entry]);
    if (unit === 'unlimited') assert.ok(changeStage(initial, advanceSeries).stages.every(grant => grant.id.startsWith('SNR')));
    const result = changeStage(initial, practice => completePractice(practice, now));
    assert.deepEqual(groupAchievementGrants(result.stages).map(group => [group.leading.id, group.additional.length]), [
      ['SNR06', 5], ['RNR06', 5],
    ]);
  }
  const short = stageTraining([...rows.slice(0, 9), [10, 10]]);
  assert.deepEqual(changeStage(diary([short]), startRound).stages, []);
  const mixed = stageTraining(rows);
  mixed.practice.rounds[0].series[0].conditions = DEFAULT_CONDITIONS;
  assert.ok(changeStage(diary([mixed]), startRound).stages.every(grant => grant.id.startsWith('SNR')));
});

test('older and incomplete samples do not earn, while an exact live correction keeps the closure category', () => {
  const incomplete = stageTraining([[10, 10, 10]]);
  incomplete.practice.rounds[0].series[0].plannedCount = 6;
  assert.deepEqual(changeStage(diary([incomplete]), advanceSeries).stages, []);
  const old = stageTraining([[10, 10, 10]]);
  delete old.achievementEnrollment!.stageRankVersion;
  assert.deepEqual(changeStage(diary([old]), advanceSeries).stages, []);
  const imported = stageTraining([[10, 10, 10]]);
  imported.practice.rounds[0].series[0].shots[0].imported = true;
  assert.deepEqual(changeStage(diary([imported]), advanceSeries).stages, []);
  const initial = diary([stageTraining([[10, 10, 0]])]);
  const closed = changeStage(initial, advanceSeries);
  assert.deepEqual(closed.stages.map(grant => grant.id), ['SNR01']);
  const improved = changeStage(closed.diary, practice => replaceShot(practice, 2, 2, shot(7)), 'female');
  assert.deepEqual(improved.stages.map(grant => grant.id), ['SNR02', 'SNR03', 'SNR04', 'SNR05']);
  assert.ok(improved.stages.every(grant => grant.scope.endsWith('-male:wa-indoor-outer-v1')));
  const best = changeStage(improved.diary, practice => replaceShot(practice, 2, 2, shot(8)));
  assert.deepEqual(best.stages.map(grant => grant.id), ['SNR06']);
  const key = `SNR06:${best.stages[0].scope}`;
  assert.equal(achievementValidity(best.diary).get(key), true);
  const removed = changeStage(best.diary, practice => deleteSeries(practice, 2));
  assert.equal(achievementValidity(removed.diary).get(key), false);
  const historical = { ...best.diary, entries: [completed(best.diary.entries[0])] };
  assert.deepEqual(changeStage(historical, practice => replaceShot(practice, 2, 0, shot(9))).stages, []);
});

test('service actions create their own ledger without enrolling historical training', () => {
  const old = training('legacy', [[10, 10, 10]]);
  const initial: Diary = { version: 1, entries: [old] };
  const awarded = awardServiceAction(initial, 'APP08', now);
  assert.ok(isDiary(awarded));
  assert.deepEqual(eligibleForAchievements(awarded), []);
  assert.deepEqual(awarded.entries, initial.entries);
  assert.deepEqual(awarded.achievementLedger!.grants.map(grant => grant.id), ['APP08']);
  assert.equal(awardServiceAction(awarded, 'APP08', later), awarded);
});

test('publication awards count new distinct content of the same document and reset clears receipts', () => {
  const first = awardPublication(diary([]), 'memo', 'a'.repeat(64), now);
  assert.deepEqual(first.achievementLedger!.grants.map(grant => grant.id), ['MIND03']);
  assert.equal(awardPublication(first, 'memo', 'a'.repeat(64), later), first);
  const other = awardPublication(first, 'other', 'b'.repeat(64), later);
  assert.deepEqual(other.achievementLedger!.grants.map(grant => grant.id), ['MIND03']);
  const second = awardPublication(other, 'memo', 'b'.repeat(64), later);
  assert.deepEqual(second.achievementLedger!.grants.map(grant => grant.id), ['MIND03', 'MIND04']);
  assert.ok(isDiary(second));
  const reset = awardPublication(diary([], 'new-epoch'), 'memo', 'b'.repeat(64), later);
  assert.deepEqual(reset.achievementLedger!.grants.map(grant => grant.id), ['MIND03']);
});

test('a live shot crosses accumulated volume without replaying earlier performance', () => {
  const earlier = training('earlier', [Array(97).fill(0)], { enrollment: epoch });
  const before = training('current', [[0, 0]], { active: true, enrollment: epoch });
  const after = training('current', [[0, 0, 0]], { active: true, enrollment: epoch });
  const result = awardTrainingChange(diary([earlier, before]), diary([earlier, after]), before.id, null, now);
  assert.deepEqual(result.added.map(item => item.id), ['START06']);
  const oldPerfect = training('already-perfect', [[10, 10, 10]], { active: true, enrollment: epoch });
  const finish = awardTrainingChange(diary([oldPerfect]), diary([completed(oldPerfect)]), oldPerfect.id, null, now);
  assert.deepEqual(finish.added.map(item => item.id), ['START01']);
});

test('a newly enrolled completed training earns once and captures the completion category', () => {
  const active = training('new-training', [[0]], { active: true, enrollment: epoch });
  const previous = diary([active]);
  const proposed = diary([completed(active)]);
  const original = structuredClone({ previous, proposed });
  const result = awardTrainingChange(previous, proposed, active.id, 'female', now);
  assert.deepEqual(result.added, [{ id: 'START01', scope: 'global', earnedAt: now, sessionId: active.id }]);
  assert.deepEqual(result.diary.entries[0].achievementEnrollment, { epoch, rankCategory: 'female' });
  assert.ok(isDiary(result.diary));
  assert.deepEqual({ previous, proposed }, original);
  const retried = awardTrainingChange(previous, result.diary, active.id, 'female', later);
  assert.deepEqual(retried.added, []);
  assert.deepEqual(retried.diary.achievementLedger, result.diary.achievementLedger);
});

test('first completion does not backfill legacy sessions, historical imports or imported shots', () => {
  const legacy = Array.from({ length: 5 }, (_, index) => training(`legacy-${index}`, Array.from({ length: 10 }, () => [10, 10, 10])));
  const imported: DiaryEntry = { ...training('source-import', [[10, 10, 10]]), source: { kind: 'mytargets', fileHash: 'a'.repeat(64),
    parserVersion: '1', sessionId: 'source', sourceRecords: [1, 2, 3], seriesFingerprints: ['series'], overlapFingerprints: [] } };
  const active = training('live', [[0]], { active: true, enrollment: epoch });
  const previous = diary([...legacy, imported, active]);
  const proposed = diary([...legacy, imported, completed(active)]);
  const result = awardTrainingChange(previous, proposed, active.id, null, now);
  assert.deepEqual(eligibleForAchievements(proposed).map(entry => entry.id), ['live']);
  assert.deepEqual(result.added.map(grant => grant.id), ['START01']);
  assert.deepEqual(result.diary.entries.slice(0, 6), previous.entries.slice(0, 6));
  const importedArrow = training('source-arrow', [[10, 10, 10]], { active: true, enrollment: epoch });
  importedArrow.practice.rounds[0].series[0].shots[0].imported = true;
  assert.deepEqual(awardTrainingChange(diary([importedArrow]), diary([completed(importedArrow)]), importedArrow.id, null, now).added, []);
});

test('legacy, imported and deleted entries cannot earn by completing or editing their records', () => {
  const legacy = training('legacy-active', [[10, 10, 10]], { active: true });
  const deleted = { ...training('deleted', [[10, 10, 10]], { active: true, enrollment: epoch }), deletedAt: now };
  const imported: DiaryEntry = { ...training('imported', [[10, 10, 10]], { active: true }), source: { kind: 'mytargets', fileHash: 'a'.repeat(64),
    parserVersion: '1', sessionId: 'source', sourceRecords: [1, 2, 3], seriesFingerprints: ['series'], overlapFingerprints: [] } };
  for (const entry of [legacy, imported, deleted]) {
    const proposed = diary([completed(entry)]);
    const result = awardTrainingChange(diary([entry]), proposed, entry.id, 'male', now);
    assert.equal(result.diary, proposed);
    assert.deepEqual(result.added, []);
  }
  const historical = training('already-completed', [[0, 0, 0]], { enrollment: epoch });
  const changed = training(historical.id, [[10, 10, 10]], { enrollment: epoch });
  assert.deepEqual(awardTrainingChange(diary([historical]), diary([changed]), changed.id, 'male', now).added, []);
});

test('an active enrolled series can earn performance awards without a completed-session award', () => {
  const before = training('active', [[10, 10]], { active: true, enrollment: epoch });
  const after = training('active', [[10, 10, 10]], { active: true, enrollment: epoch });
  const result = awardTrainingChange(diary([before]), diary([after]), after.id, null, now);
  assert.ok(result.added.some(grant => grant.id === 'HIT01' && grant.scope === 'recurve'));
  assert.ok(result.added.some(grant => grant.id === 'START02'));
  assert.ok(result.added.every(grant => grant.id !== 'START01'));
  assert.equal(result.diary.entries[0].practice.savedAt, null);
  const unchanged = awardTrainingChange(result.diary, result.diary, after.id, null, later);
  assert.deepEqual(unchanged.added, []);
  assert.equal(unchanged.diary, result.diary);
});

test('completion aggregates only enrolled sessions from the current epoch', () => {
  const prior = Array.from({ length: 4 }, (_, index) => training(`current-${index}`, [[0]], { enrollment: epoch }));
  const active = training('fifth', [[0]], { active: true, enrollment: epoch });
  const result = awardTrainingChange(diary([...prior, active]), diary([...prior, completed(active)]), active.id, null, now);
  assert.deepEqual(new Set(result.added.map(grant => grant.id)), new Set(['START05']));
  assert.ok(result.added.every(grant => grant.sessionId === active.id));
  const stale = prior.map(entry => ({ ...entry, achievementEnrollment: { epoch: 'older-epoch', rankCategory: null } }));
  const resetResult = awardTrainingChange(diary([...stale, active]), diary([...stale, completed(active)]), active.id, null, now);
  assert.deepEqual(resetResult.added.map(grant => grant.id), ['START01']);
});

test('reset epoch blocks an already running old enrollment and permits fresh post-reset sessions', () => {
  const oldActive = training('old-active', [[10, 10, 10]], { active: true, enrollment: epoch });
  const resetEpoch = 'achievement-epoch-two';
  const resetBefore = diary([oldActive], resetEpoch);
  const resetAfter = diary([completed(oldActive)], resetEpoch);
  assert.deepEqual(eligibleForAchievements(resetBefore), []);
  const oldResult = awardTrainingChange(resetBefore, resetAfter, oldActive.id, 'male', now);
  assert.equal(oldResult.diary, resetAfter);
  assert.deepEqual(oldResult.added, []);
  const fresh = training('after-reset', [[0]], { active: true, enrollment: resetEpoch });
  const result = awardTrainingChange(diary([oldActive, fresh], resetEpoch), diary([oldActive, completed(fresh)], resetEpoch), fresh.id, null, later);
  assert.equal(result.diary.achievementLedger!.epoch, resetEpoch);
  assert.deepEqual(result.added, [{ id: 'START01', scope: 'global', earnedAt: later, sessionId: fresh.id }]);
});

test('diaries without an achievement ledger remain unchanged and never backfill on completion', () => {
  const active = training('legacy-diary', [[10, 10, 10]], { active: true });
  const before: Diary = { version: 1, entries: [active] };
  const proposed: Diary = { version: 1, entries: [completed(active)] };
  assert.deepEqual(eligibleForAchievements(before), []);
  const result = awardTrainingChange(before, proposed, active.id, 'male', now);
  assert.equal(result.diary, proposed);
  assert.deepEqual(result.added, []);
});

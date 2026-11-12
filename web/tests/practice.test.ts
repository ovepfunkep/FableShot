import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ROUND_LIMIT, advanceSeries, appendShot, completePractice, currentSeries, deleteRound, deleteSeries,
  emptyPractice, findSeries, removeShot, replaceShot, resumePractice, roundShots, startRound, applyConditions, isRoundFull,
} from '../src/practice.ts';
import type { Practice } from '../src/practice.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';

const nine = { point: { x: .17, y: 0 }, points: 9, code: '9' };
const ten = { point: { x: 0, y: 0 }, points: 10, code: '10' };
const miss = { point: null, points: 0, code: 'M' };
const savedAt = '2026-11-11T10:00:00.000Z';

test('physical numbers are unique in one series, reusable in the next and checked against the saved set', () => {
  const conditions = { ...DEFAULT_CONDITIONS, equipment: {
    id: 'kit', name: 'Комплект', bow: { name: 'Лук', category: null },
    arrows: { id: 'shafts', name: 'Стрелы', diameterMm: null, numberedCount: 6 },
  } };
  const practice = applyConditions(emptyPractice(), conditions);
  const seriesId = currentSeries(practice)!.series.id;
  const first = appendShot(practice, { ...ten, physicalArrowNumber: 4 });
  assert.throws(() => appendShot(first, { ...miss, physicalArrowNumber: 4 }), /уже записан/);
  assert.throws(() => replaceShot(first, seriesId, 0, { ...ten, physicalArrowNumber: 7 }), /отсутствует/);
  const off = applyConditions(first, conditions, undefined, false);
  assert.equal(off.numberedArrows, false);
  assert.equal(off.rounds, first.rounds);
  const next = appendShot(advanceSeries(off), { ...miss, physicalArrowNumber: 4 });
  const edited = replaceShot(completePractice(next, savedAt), seriesId, 0, { ...ten, physicalArrowNumber: 5 });
  assert.equal(edited.rounds[0].series[0].shots[0].physicalArrowNumber, 5);
  assert.equal(edited.rounds[0].series[1].shots[0].physicalArrowNumber, 4);
});

function appendMany(practice: Practice, count: number): Practice {
  return Array.from({ length: count }, () => nine).reduce(appendShot, practice);
}

test('series may exceed three arrows and a round advances only after the next action', () => {
  const first = appendMany(emptyPractice(), 4);
  const next = advanceSeries(first);
  assert.equal(next.rounds.length, 1);
  assert.equal(next.rounds[0].series[0].shots.length, 4);
  assert.equal(advanceSeries(next), next);
  const almostFull = appendMany(next, ROUND_LIMIT - 5);
  const full = appendShot(almostFull, miss);
  assert.equal(roundShots(full.rounds[0]).length, ROUND_LIMIT);
  assert.equal(full.rounds.length, 1);
  assert.equal(currentSeries(full)?.series.shots.at(-1), miss);
  assert.equal(appendShot(full, nine), full);

  const advanced = advanceSeries(full);
  assert.equal(advanced.rounds.length, 2);
  assert.equal(advanced.rounds[0], full.rounds[0]);
  assert.deepEqual(currentSeries(advanced)?.series.shots, []);
});

test('manual next round removes the empty tail and cannot create empty rounds repeatedly', () => {
  const withShots = appendShot(emptyPractice(), nine);
  const emptyTail = advanceSeries(withShots);
  const next = startRound(emptyTail);
  assert.equal(next.rounds.length, 2);
  assert.deepEqual(next.rounds[0], withShots.rounds[0]);
  assert.equal(next.rounds[1].series.length, 1);
  assert.notEqual(currentSeries(next)?.series.id, currentSeries(emptyTail)?.series.id);
  assert.equal(startRound(next), next);
  assert.equal(startRound(withShots).rounds[0], withShots.rounds[0]);
});

test('completion drops the empty tail and resumes in the correct series or round', () => {
  const empty = emptyPractice();
  assert.equal(completePractice(empty, savedAt), empty);
  const withShot = appendShot(empty, nine);
  const emptySeries = advanceSeries(withShot);
  const completed = completePractice(emptySeries, savedAt);
  assert.equal(completed.savedAt, savedAt);
  assert.deepEqual(completed.rounds, withShot.rounds);
  assert.equal(appendShot(completed, miss), completed);
  const resumed = resumePractice(completed);
  assert.equal(resumed.savedAt, null);
  assert.equal(resumed.rounds.length, 1);
  assert.equal(resumed.rounds[0].series.length, 2);
  assert.deepEqual(currentSeries(resumed)?.series.shots, []);

  const full = completePractice(appendMany(emptyPractice(), ROUND_LIMIT), savedAt);
  const resumedFull = resumePractice(full);
  assert.equal(resumedFull.rounds.length, 2);
  assert.equal(resumedFull.rounds[0], full.rounds[0]);
  assert.deepEqual(currentSeries(resumedFull)?.series.shots, []);

  const emptyRound = startRound(withShot);
  assert.deepEqual(completePractice(emptyRound, savedAt).rounds, withShot.rounds);
});

test('editing and deleting in a past round preserves the later round boundary', () => {
  const first = appendMany(emptyPractice(), ROUND_LIMIT);
  const firstSeries = currentSeries(first)!.series.id;
  const active = appendShot(advanceSeries(first), ten);
  const edited = replaceShot(active, firstSeries, 1, miss);
  assert.equal(findSeries(edited, firstSeries)?.series.shots[1], miss);
  assert.equal(roundShots(edited.rounds[0]).length, ROUND_LIMIT);
  const removed = removeShot(edited, firstSeries, 1);
  assert.equal(roundShots(removed.rounds[0]).length, ROUND_LIMIT - 1);
  assert.equal(removed.rounds[1], active.rounds[1]);
  assert.equal(replaceShot(removed, firstSeries, -1, ten), removed);
  assert.equal(removeShot(removed, firstSeries, 1_000), removed);
});

test('deleting the active series or round leaves a fresh place for entry', () => {
  const first = appendShot(emptyPractice(), ten);
  const second = appendShot(advanceSeries(first), miss);
  const current = currentSeries(second)!;
  const afterDelete = deleteSeries(second, current.series.id);
  assert.equal(afterDelete.rounds[0].id, current.round.id);
  assert.equal(afterDelete.rounds[0].series[0], first.rounds[0].series[0]);
  assert.equal(findSeries(afterDelete, current.series.id), null);
  assert.deepEqual(currentSeries(afterDelete)?.series.shots, []);

  const newRound = startRound(second);
  const activeRound = currentSeries(newRound)!.round.id;
  const withoutRound = deleteRound(newRound, activeRound);
  assert.equal(withoutRound.rounds[0], second.rounds[0]);
  assert.notEqual(currentSeries(withoutRound)?.round.id, activeRound);
  assert.deepEqual(currentSeries(withoutRound)?.series.shots, []);
});

test('deleting the only saved hit leaves a new unsaved practice', () => {
  const saved = completePractice(appendShot(emptyPractice(), ten), savedAt);
  const seriesId = currentSeries(saved)!.series.id;
  const removed = removeShot(saved, seriesId, 0);
  assert.equal(removed.savedAt, null);
  assert.equal(findSeries(removed, seriesId), null);
  assert.deepEqual(currentSeries(removed)?.series.shots, []);
});

test('a series-limited round remains editable until explicitly advancing from its last series', () => {
  let practice = applyConditions(emptyPractice(), DEFAULT_CONDITIONS, { unit: 'series', limit: 2 });
  practice = appendShot(practice, ten);
  assert.equal(isRoundFull(practice), false);
  practice = advanceSeries(practice);
  assert.equal(isRoundFull(practice), false);
  practice = appendShot(practice, nine);
  assert.equal(isRoundFull(practice), true);
  practice = appendShot(practice, miss);
  assert.equal(currentSeries(practice)?.series.shots.length, 2);
  const next = advanceSeries(practice);
  assert.equal(next.rounds.length, 2);
  assert.equal(isRoundFull(next), false);
});

test('a custom arrow limit blocks extra entries while unlimited rounds remain open', () => {
  let limited = applyConditions(emptyPractice(), DEFAULT_CONDITIONS, { unit: 'arrows', limit: 2 });
  limited = appendShot(appendShot(limited, ten), miss);
  assert.equal(isRoundFull(limited), true);
  assert.equal(appendShot(limited, nine), limited);
  let unlimited = applyConditions(emptyPractice(), DEFAULT_CONDITIONS, { unit: 'unlimited', limit: null });
  unlimited = appendMany(unlimited, 35);
  assert.equal(isRoundFull(unlimited), false);
  assert.equal(roundShots(unlimited.rounds[0]).length, 35);
});

test('changing conditions freezes the earlier series snapshot and inherits new conditions in later rounds', () => {
  const base = appendShot(emptyPractice(), nine);
  const original = currentSeries(base)!.series;
  const changedConditions = { ...DEFAULT_CONDITIONS, distanceMeters: 30 };
  const changed = applyConditions(base, changedConditions);
  assert.equal(changed.rounds.length, 1);
  assert.equal(changed.rounds[0].series.length, 2);
  assert.equal(changed.rounds[0].series[0], original);
  assert.deepEqual(original.conditions, DEFAULT_CONDITIONS);
  changedConditions.distanceMeters = 50;
  assert.equal(currentSeries(changed)!.series.conditions.distanceMeters, 30);
  const laterRound = startRound(appendShot(changed, ten));
  assert.equal(currentSeries(laterRound)!.series.conditions.distanceMeters, 30);
  const forbidden = applyConditions(laterRound, DEFAULT_CONDITIONS, { unit: 'arrows', limit: 60 });
  assert.equal(forbidden, laterRound);
});

test('applying new conditions at the arrow boundary opens a round and changing a blank series retains its id', () => {
  const withLimit = applyConditions(emptyPractice(), DEFAULT_CONDITIONS, { unit: 'arrows', limit: 1 });
  const full = appendShot(withLimit, nine);
  const next = applyConditions(full, { ...DEFAULT_CONDITIONS, distanceMeters: 50 });
  assert.equal(next.rounds.length, 2);
  assert.equal(next.rounds[0], full.rounds[0]);
  const id = currentSeries(next)!.series.id;
  const edited = applyConditions(next, { ...DEFAULT_CONDITIONS, distanceMeters: 10 });
  assert.equal(currentSeries(edited)!.series.id, id);
  assert.equal(edited.rounds.length, 2);
  assert.equal(currentSeries(edited)!.series.conditions.distanceMeters, 10);
});

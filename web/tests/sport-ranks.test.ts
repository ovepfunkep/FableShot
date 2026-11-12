import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Conditions, RoundRule } from '../src/conditions.ts';
import type { Practice, Series } from '../src/practice.ts';
import { evaluateRank, matchingRankExercises, RANK_LABELS, RANK_REFERENCE, roundRank, seriesRank } from '../src/sport-ranks.ts';
import type { Shot } from '../src/target.ts';

const indoor: Conditions = {
  distanceMeters: 18, targetProfileId: 'wa-indoor-outer-v1', targetDiameterMm: 400,
  equipment: { id: 'bow', name: 'Лук', bow: { name: 'Лук', category: 'barebow' }, arrows: { name: '', diameterMm: null } },
};
const hit = (points: number, code = String(points)): Shot => ({ points, code, point: null });
const arrows = (length: number, points: number) => Array.from({ length }, () => hit(points));
const series = (id: number, shots: Shot[], conditions = indoor): Series => ({ id, shots, conditions });
const plan = (limit: number): RoundRule => ({ unit: 'arrows', limit });
const unlimited: RoundRule = { unit: 'unlimited', limit: null };

function training(items: Series[], roundRule = plan(30), savedAt: string | null = null): Practice {
  return { rounds: [{ id: 1, series: items }], nextId: 100, roundRule, savedAt };
}

test('uses exact threshold comparisons even when the averages round to the same number', () => {
  const [, exercise] = matchingRankExercises(indoor, 'male');
  const below = evaluateRank(exercise, 372, 57);
  const exact = evaluateRank(exercise, 392, 60);
  assert.equal(below.average?.toFixed(2), exact.average?.toFixed(2));
  assert.equal(below.pace, null);
  assert.deepEqual(below.next, { label: 'III', score: 392 });
  assert.equal(below.remainingAverage, 20 / 3);
  assert.equal(exact.result?.label, 'III');
  assert.equal(exact.remainingAverage, null);
});

test('includes misses and X and updates the scoped series and round samples independently', () => {
  const practice = training([series(2, [hit(10, 'X'), hit(0, 'M')]), series(3, [hit(10)])]);
  const first = seriesRank(practice, 2, 'male');
  const second = seriesRank(practice, 3, 'male');
  const round = roundRank(practice, 1, 'male');
  assert.equal(first.label, 'ниже порога');
  assert.equal(second.label, 'МСМК');
  assert.equal(first.classLabel, 'КЛб(М)');
  assert.equal(round.evaluation?.entered, 3);
  assert.equal(round.evaluation?.points, 20);
  assert.equal(round.evaluation?.projected, 400);
  assert.equal(round.evaluation?.result, null);
});

test('selects the planned exercise first, actual arrows for a closed free round, and a reference while open', () => {
  const items = [series(2, arrows(30, 9))];
  const savedAt = '2026-11-11T00:00:00Z';
  const planned = roundRank(training(items, plan(60), savedAt), 1, 'male');
  assert.equal(planned.evaluation?.exercise.arrows, 60);
  assert.equal(planned.finalResult, false);
  const open = roundRank(training(items, unlimited), 1, 'male');
  assert.equal(open.evaluation?.exercise.arrows, 60);
  assert.equal(open.finalResult, false);
  const closed = training(items, unlimited, savedAt);
  assert.equal(roundRank(closed, 1, 'male').evaluation?.exercise.arrows, 60);
  assert.equal(roundRank(closed, 1, 'male').finalResult, false);
  assert.equal(seriesRank(closed, 2, 'male').finalResult, false);
  assert.equal(roundRank(training([series(2, arrows(61, 9))], unlimited, savedAt), 1, 'male').finalResult, false);
});

test('needs an explicit category and keeps the category-specific thresholds', () => {
  const practice = training([series(2, [...arrows(29, 7), hit(0, 'M')])]);
  assert.equal(roundRank(practice, 1, null).reason, 'Выбери категорию сравнения');
  assert.equal(roundRank(practice, 1, 'male').label, 'III');
  assert.equal(roundRank(practice, 1, 'female').label, 'III');
  assert.equal(roundRank(practice, 1, 'female').classLabel, 'КЛб(Ж)');
  const empty = roundRank(training([series(2, [])]), 1, 'male');
  assert.equal(empty.label, null);
  assert.equal(empty.evaluation?.average, null);
});

test('does not pool incompatible conditions or infer a discipline from the equipment name', () => {
  const far = { ...indoor, distanceMeters: 20 };
  const mixed = training([series(2, [hit(10)], indoor), series(3, [hit(10)], far)]);
  assert.match(roundRank(mixed, 1, 'male').reason ?? '', /разные условия/);
  assert.equal(roundRank(mixed, 1, 'male').evaluation, null);
  assert.equal(seriesRank(mixed, 2, 'male').label, 'МСМК');
  assert.equal(seriesRank(mixed, 3, 'male').label, null);
  const missing = { ...indoor, equipment: { ...indoor.equipment!, bow: { name: 'Баребоу', category: null } } };
  assert.match(seriesRank(training([series(2, [hit(10)], missing)]), 2, 'male').reason ?? '', /тип лука/);
  assert.equal(roundRank(training([series(2, [hit(10)]), series(3, [], far)]), 1, 'male').label, 'МСМК');
});

test('matches only verified target combinations and retains unsupported formats in the grid', () => {
  const compound = { ...indoor, equipment: { ...indoor.equipment!, bow: { name: 'БЛ', category: 'compound' } } };
  assert.deepEqual(matchingRankExercises(compound, 'male'), []);
  assert.deepEqual(matchingRankExercises({ ...compound, targetProfileId: 'wa-indoor-inner-v1' }, 'male').map(item => item.sourceRow), [29, 30]);
  const outdoor = { ...compound, distanceMeters: 50, targetDiameterMm: 800, targetProfileId: 'wa-outdoor-six-v1' };
  assert.equal(matchingRankExercises(outdoor, 'female')[0].thresholds.at(-1)?.score, 690);
  assert.deepEqual(matchingRankExercises({ ...outdoor, distanceMeters: 70 }, 'male'), []);
  assert.equal(RANK_REFERENCE.length, 33);
  assert.equal(new Set(RANK_REFERENCE.map(row => row.sourceRow)).size, 33);
  assert.ok(RANK_REFERENCE.every(row => row.male.length === RANK_LABELS.length && row.female.length === RANK_LABELS.length));
  assert.equal(RANK_REFERENCE.find(row => row.sourceRow === 37)?.male[0], 685);
  assert.equal(RANK_REFERENCE.find(row => row.sourceRow === 44)?.female[0], 920);
  assert.equal(RANK_REFERENCE.find(row => row.sourceRow === 25)?.male[0], null);
});

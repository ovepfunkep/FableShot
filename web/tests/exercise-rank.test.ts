import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Conditions } from '../src/conditions.ts';
import { exerciseRank } from '../src/exercise-rank.ts';
import type { Practice } from '../src/practice.ts';

const indoor: Conditions = {
  distanceMeters: 18, targetProfileId: 'wa-indoor-outer-v1', targetDiameterMm: 400,
  equipment: { id: 'kit', name: 'Комплект', bow: { name: 'Лук', category: 'barebow' }, arrows: { name: '', diameterMm: null } },
};
const savedAt = '2026-11-11T00:00:00Z';

function training(scores: number[][], saved: string | null = savedAt): Practice {
  return {
    rounds: scores.map((round, index) => ({
      id: index * 100 + 1,
      series: Array.from({ length: Math.ceil(round.length / 3) }, (_, series) => ({
        id: index * 100 + series + 2,
        shots: round.slice(series * 3, series * 3 + 3).map(points => ({
          points, code: points === 10 ? 'X' : points === 0 ? 'M' : String(points), point: null,
        })),
        conditions: structuredClone(indoor),
      })),
    })),
    nextId: 1000, roundRule: { unit: 'arrows', limit: 30 }, savedAt: saved,
  };
}

const firstRound = Array<number>(30).fill(7);
const secondRound = [...Array<number>(27).fill(6), 10, 10, 0];

test('uses every scored arrow from two compatible rounds and compares exact points', () => {
  const practice = training([firstRound, secondRound]);
  const rank = exerciseRank(practice, 'male');
  assert.equal(rank.evaluation?.exercise.arrows, 60);
  assert.equal(rank.evaluation?.entered, 60);
  assert.equal(rank.evaluation?.points, 392);
  assert.equal(rank.finalResult, true);
  assert.equal(rank.evaluation?.result?.label, 'III');
  assert.equal(rank.evaluation?.next?.score, 429);

  const below = exerciseRank(training([firstRound, [...secondRound.slice(0, 28), 9, 0]]), 'male');
  assert.equal(below.finalResult, true);
  assert.equal(below.evaluation?.points, 391);
  assert.equal(below.evaluation?.result, null);
  assert.equal(below.evaluation?.next?.score, 392);
  assert.equal(exerciseRank(practice, 'female').evaluation?.result?.score, 387);
});

test('uses the reference volume while open and the actual supported volume after saving', () => {
  const open = exerciseRank(training([firstRound], null), 'male');
  assert.equal(open.evaluation?.exercise.arrows, 60);
  assert.equal(open.evaluation?.projected, 420);
  assert.equal(open.evaluation?.result, null);
  assert.equal(open.finalResult, false);
  const atVolume = exerciseRank(training([firstRound, secondRound], null), 'male');
  assert.equal(atVolume.evaluation?.pace?.label, 'III');
  assert.equal(atVolume.evaluation?.result, null);
  assert.equal(atVolume.finalResult, false);
  const saved = exerciseRank(training([firstRound]), 'male');
  assert.equal(saved.evaluation?.exercise.arrows, 30);
  assert.equal(saved.finalResult, true);
});

test('early completion, excess volume and partial series stay at pace comparison', () => {
  for (const practice of [
    training([firstRound, secondRound.slice(0, 27)]),
    training([firstRound, secondRound, [10, 10, 10]]),
    training([firstRound.slice(0, 29), [...secondRound, 10]]),
  ]) {
    const rank = exerciseRank(practice, 'male');
    assert.equal(rank.evaluation?.exercise.arrows, 60);
    assert.equal(rank.evaluation?.result, null);
    assert.equal(rank.finalResult, false);
  }
});

test('rejects mixed scored conditions and ignores an empty series with future conditions', () => {
  const practice = training([firstRound, secondRound]);
  const nextConditions = { ...indoor, distanceMeters: 20 };
  practice.rounds[1].series.push({ id: 300, shots: [], conditions: nextConditions });
  assert.equal(exerciseRank(practice, 'male').finalResult, true);

  practice.rounds[1].series[0].conditions = nextConditions;
  assert.match(exerciseRank(practice, 'male').reason ?? '', /разные условия/);
  assert.equal(exerciseRank(practice, 'male').evaluation, null);

  const differentKit = { ...indoor, equipment: { ...indoor.equipment!, id: 'other-kit' } };
  practice.rounds[1].series[0].conditions = differentKit;
  assert.match(exerciseRank(practice, 'male').reason ?? '', /разные условия/);
  assert.equal(exerciseRank(practice, 'male').evaluation, null);
  assert.equal(exerciseRank(training([firstRound]), null).reason, 'Выбери категорию сравнения');
});

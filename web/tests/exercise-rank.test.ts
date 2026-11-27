import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Conditions } from '../src/conditions.ts';
import { confirmedExerciseRanks, exerciseRank, exerciseRankCoverage, exerciseRankDisplay, legacyExerciseRank, personalBestExerciseCandidates } from '../src/exercise-rank.ts';
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

test('a personal best can come from any full half without changing the first confirmed pair', () => {
  const first = [...Array<number>(26).fill(8), ...Array<number>(4).fill(7)];
  const second = [...Array<number>(29).fill(8), 9];
  const third = [...Array<number>(20).fill(8), ...Array<number>(10).fill(9)];
  const practice = training([first, [10, 10, 10], second, third]);
  const candidates = personalBestExerciseCandidates(practice, 'male');
  assert.deepEqual(candidates.map(rank => [rank.evaluation.exercise.arrows, rank.evaluation.points, rank.coverage.rounds.map(round => round.number)]),
    [[60, 477, [1, 3]], [30, 236, [1]], [30, 241, [3]], [30, 250, [4]]]);
  assert.deepEqual(confirmedExerciseRanks(practice, 'male').map(rank => rank.evaluation.points), [477]);
});

test('five six-arrow ends show the 60-arrow barebow pace alongside the actual short exercise rank', () => {
  const practice = training([Array<number>(30).fill(10)]);
  const ends = practice.rounds[0].series;
  practice.rounds[0].series = ends.filter((_, index) => index % 2 === 0).map((end, index) => ({
    ...end, plannedCount: 6, shots: [...end.shots, ...ends[index * 2 + 1].shots],
  }));
  const rank = exerciseRank(practice, 'male');
  assert.equal(rank.evaluation?.result?.label, 'I');
  assert.equal(rank.forecast?.exercise.arrows, 60);
  assert.deepEqual(exerciseRankDisplay(rank), { forecast: true, label: 'МСМК', actual: 'Разряд I · 30 стрел' });
});

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

test('uses a single complete 30 when another round is incomplete and retains pace if none qualify', () => {
  const short = exerciseRank(training([firstRound, secondRound.slice(0, 27)]), 'male');
  assert.equal(short.evaluation?.entered, 30);
  assert.equal(short.finalResult, true);
  const incomplete = exerciseRank(training([firstRound.slice(0, 29), [...secondRound, 10]]), 'male');
  assert.equal(incomplete.evaluation?.exercise.arrows, 60);
  assert.equal(incomplete.evaluation?.result, null);
  assert.equal(incomplete.finalResult, false);
});

test('selects the first compatible pair across incomplete rounds and skips surplus rounds', () => {
  const high = Array<number>(30).fill(10);
  for (const [rounds, numbers] of [
    [[firstRound, secondRound, [10, 10, 10]], [1, 2]],
    [[firstRound, [10, 10, 10], secondRound], [1, 3]],
    [[firstRound, secondRound, high], [1, 2]],
    [[firstRound, secondRound, high, high, []], [1, 2]],
  ] as const) {
    const practice = training([...rounds]);
    const ranks = confirmedExerciseRanks(practice, 'male');
    assert.equal(ranks.length, 1);
    assert.equal(ranks[0].evaluation.points, 392);
    assert.deepEqual(ranks[0].coverage.rounds, numbers.map(number => ({ id: (number - 1) * 100 + 1, number })));
    assert.match(exerciseRankCoverage(ranks[0])?.label ?? '', /^60 стрел · раунды 1 и [23]$/);
    assert.ok(ranks[0].coverage.excluded.every(round => round.number !== 5));
  }
  const excess = training([firstRound, secondRound, [10, 10, 10]]);
  assert.equal(legacyExerciseRank(excess, 'male').finalResult, false);
  assert.deepEqual(exerciseRank(excess, 'male').coverage?.excluded, [{ id: 201, number: 3, reason: 'incomplete' }]);
});

test('rejects mixed scored conditions and ignores an empty series with future conditions', () => {
  const practice = training([firstRound, secondRound]);
  const nextConditions = { ...indoor, distanceMeters: 20 };
  practice.rounds[1].series.push({ id: 300, shots: [], conditions: nextConditions });
  assert.equal(exerciseRank(practice, 'male').finalResult, true);

  practice.rounds[1].series[0].conditions = nextConditions;
  assert.equal(exerciseRank(practice, 'male').evaluation?.entered, 30);
  assert.deepEqual(exerciseRank(practice, 'male').coverage?.excluded, [{ id: 101, number: 2, reason: 'mixed' }]);

  const differentKit = { ...indoor, equipment: { ...indoor.equipment!, id: 'other-kit' } };
  practice.rounds[1].series[0].conditions = differentKit;
  assert.equal(exerciseRank(practice, 'male').evaluation?.entered, 60);
  assert.equal(legacyExerciseRank(practice, 'male').evaluation, null);
  assert.equal(exerciseRank(training([firstRound]), null).reason, 'Выбери категорию сравнения');
});

test('honors both round limit units and allows a short final series that reaches the arrow limit', () => {
  const practice = training([firstRound, secondRound]);
  for (const round of practice.rounds) {
    const first = round.series[0];
    first.shots.push(round.series[1].shots.shift()!);
    round.series[1].shots.push(round.series[9].shots.shift()!);
  }
  assert.equal(exerciseRank(practice, 'male').evaluation?.entered, 60);
  practice.roundRule = { unit: 'series', limit: 10 };
  assert.equal(exerciseRank(practice, 'male').finalResult, false);
  practice.roundRule = { unit: 'unlimited', limit: null };
  assert.equal(exerciseRank(practice, 'male').finalResult, false);
  const regular = training([firstRound, secondRound]);
  regular.roundRule = { unit: 'series', limit: 10 };
  assert.equal(exerciseRank(regular, 'male').evaluation?.entered, 60);
  regular.roundRule = { unit: 'series', limit: 11 };
  assert.equal(exerciseRank(regular, 'male').finalResult, false);
});

test('chooses full 60 and 72 or the first split 72 and keeps condition groups distinct', () => {
  const high = Array<number>(36).fill(10);
  const outdoor: Conditions = {
    ...indoor, distanceMeters: 70, targetProfileId: 'wa-outdoor-full-v1', targetDiameterMm: 1220,
    equipment: { ...indoor.equipment!, bow: { name: 'Лук', category: 'recurve' } },
  };
  const mixedFormats = training([high, [...firstRound, ...secondRound], high, [...high, ...high]]);
  mixedFormats.roundRule = { unit: 'unlimited', limit: null };
  for (const index of [0, 2, 3]) for (const series of mixedFormats.rounds[index].series) series.conditions = outdoor;
  for (const round of mixedFormats.rounds) for (const series of round.series) series.plannedCount = 3;
  assert.deepEqual(confirmedExerciseRanks(mixedFormats, 'male').map(rank => [
    rank.evaluation.entered, rank.coverage.rounds.map(round => round.number),
  ]), [[72, [1, 3]], [60, [2]]]);
  mixedFormats.rounds = mixedFormats.rounds.filter(round => round.id !== 201);
  assert.deepEqual(exerciseRank(mixedFormats, 'male').coverage?.rounds.map(round => round.id), [301]);

  const incompatible = training([firstRound, Array<number>(30).fill(10)]);
  for (const series of incompatible.rounds[1].series) series.conditions.targetProfileId = 'wa-indoor-full-x-v1';
  assert.equal(exerciseRank(incompatible, 'male').evaluation?.points, 210);
  assert.equal(exerciseRank(incompatible, 'male').evaluation?.entered, 30);
});

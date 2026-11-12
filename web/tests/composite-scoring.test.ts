import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  calculateCompositeScore, displayCompositeScore, practiceCompositeGroups, SCORE_ONLY_PROFILE,
} from '../src/composite-scoring.ts';
import type { CompositeProfile, ScoringEnd } from '../src/composite-scoring.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import { advanceSeries, appendShot, applyConditions, completePractice, emptyPractice, removeShot, startRound } from '../src/practice.ts';
import type { Practice } from '../src/practice.ts';
import type { Shot } from '../src/target.ts';

const fixture = JSON.parse(readFileSync(new URL('../../docs/fixtures/cg3-cases.json', import.meta.url), 'utf8')) as {
  ends: { id: string; scores: number[]; points: ([number, number] | null)[]; expected: {
    status: string; E?: number; E_display?: string; rms?: number; raw_equivalent_display?: string;
  } }[];
  slices: { id: string; profile: CompositeProfile; end_ids: string[]; slice_k: number; expected: {
    G?: number; G_display?: string; classic_total?: number; full_rank_available?: boolean;
  } }[];
};
const end = (id: string, index = 0): ScoringEnd => {
  const definition = fixture.ends.find(candidate => candidate.id === id)!;
  return {
    id: index + 1, number: index + 1, plannedCount: definition.scores.length, closed: true,
    shots: definition.scores.map((points, arrow) => {
      const position = definition.points[arrow];
      return { points, code: points === 0 ? 'M' : String(points), point: position && { x: position[0], y: position[1] } };
    }),
  };
};

test('CG3 uses the shared Android single-series fixture and decimal display', () => {
  for (const { id, expected } of fixture.ends) {
    const score = calculateCompositeScore([end(id)], 1, 10, true, undefined, true);
    assert.equal(score.availability, expected.status.replaceAll('_', '-'), id);
    if (expected.E != null) {
      assert.ok(Math.abs(score.total! - expected.E) < 1e-9, id);
      assert.equal(displayCompositeScore(score.total!), expected.E_display, id);
      assert.ok(Math.abs(score.rms! - expected.rms!) < 1e-9, id);
      if (expected.raw_equivalent_display) assert.equal(displayCompositeScore(score.rawEquivalent!), expected.raw_equivalent_display, id);
    }
  }
  assert.equal(displayCompositeScore(30.07499999999999), '30.08');
  assert.equal(displayCompositeScore(-1.005), '-1.01');
  assert.equal(displayCompositeScore(-0.0001), '0.00');
});

test('CG3 uses the shared Android cumulative fixtures for both profiles', () => {
  for (const { id, end_ids, slice_k, profile, expected } of fixture.slices) {
    const score = calculateCompositeScore(end_ids.map(end), slice_k, 10, true, profile);
    if (expected.G != null) {
      assert.ok(Math.abs(score.total! - expected.G) < 1e-9, id);
      if (expected.G_display) assert.equal(displayCompositeScore(score.total!), expected.G_display, id);
    } else {
      assert.equal(score.total, undefined, id);
    }
    if (expected.classic_total !== undefined) assert.equal(score.classic, expected.classic_total, id);
    if (expected.full_rank_available !== undefined) {
      assert.equal(score.availability === 'available' && score.phase === 'full', expected.full_rank_available, id);
    }
  }
});

const centre: Shot = { points: 10, code: '10', point: { x: 0, y: 0 } };
const miss: Shot = { points: 0, code: 'M', point: null };
const centreSeries = (practice: Practice) => [centre, centre, centre].reduce(appendShot, practice);

test('fully entered open series count and incomplete tails are skipped even after saving', () => {
  const open = centreSeries(emptyPractice());
  assert.equal(practiceCompositeGroups(open)[0].ends.length, 1);
  assert.deepEqual(practiceCompositeGroups(appendShot(emptyPractice(), centre)), []);
  const practice = appendShot(advanceSeries(open), miss);
  const [group] = practiceCompositeGroups(practice);
  assert.deepEqual(group.ends.map(item => item.plannedCount), [3]);
  assert.equal(calculateCompositeScore(group.ends, 1, group.maximumPerArrow, group.geometryVerified).total, 105);
  assert.deepEqual(practiceCompositeGroups(completePractice(practice, '2026-11-11T00:00:00Z'))[0]
    .ends.map(item => item.plannedCount), [3]);
});

test('a deletion from an extended series preserves its plan and the series is skipped', () => {
  const four = appendShot(centreSeries(emptyPractice()), centre);
  const [group] = practiceCompositeGroups(four);
  assert.equal(group.ends[0].plannedCount, 4);
  const partial = removeShot(four, group.ends[0].id, 0);
  assert.deepEqual(practiceCompositeGroups(advanceSeries(partial)), []);
  const later = centreSeries(advanceSeries(partial));
  assert.deepEqual(practiceCompositeGroups(later)[0].ends.map(item => [item.number, item.seriesNumber]), [[1, 2]]);
});

test('changes of conditions separate scores and rounds in identical conditions combine', () => {
  const limited = applyConditions(emptyPractice(), DEFAULT_CONDITIONS, { unit: 'arrows', limit: 3 });
  const active = centreSeries(limited);
  assert.equal(practiceCompositeGroups(active)[0].ends.length, 1);
  const changed = applyConditions(active, { ...DEFAULT_CONDITIONS, distanceMeters: 30 });
  const twoConditions = centreSeries(changed);
  const groups = practiceCompositeGroups(twoConditions);
  assert.deepEqual(groups.map(group => [group.conditions.distanceMeters, group.ends.length]), [[18, 1], [30, 1]]);

  const sameConditions = centreSeries(startRound(centreSeries(limited)));
  assert.deepEqual(practiceCompositeGroups(sameConditions)[0].ends.map(item => item.roundNumber), [1, 2]);
});

test('recorded misses count towards the denominator while coordinates control geometry', () => {
  const shots = [{ ...centre, point: { x: .01, y: 0 } }, { ...centre, point: { x: .05, y: 0 } }, miss];
  const end = { id: 1, number: 1, closed: true, plannedCount: 3, shots };
  const score = calculateCompositeScore([end], 1, 10, true, undefined, true);
  assert.equal(score.classic, 20);
  assert.equal(score.maximum, 30);
  assert.equal(score.knownPositions, 2);
  assert.ok(Math.abs(score.rms! - .02) < 1e-9);
  assert.ok(Math.abs(score.groupBonus! - 4) < 1e-9);
  const wideMiss = calculateCompositeScore([{ ...end, shots: [...shots.slice(0, 2), { ...miss, point: { x: 10, y: 0 } }] }], 1, 10, true);
  assert.equal(wideMiss.groupBonus, 0);
  assert.equal(calculateCompositeScore([{ ...end, plannedCount: 6 }], 1, 10, true).availability, 'incomplete-end');
  const unknownHit = { ...end, shots: [...shots.slice(0, 2), { ...centre, point: null }] };
  assert.equal(calculateCompositeScore([unknownHit], 1, 10, true).availability, 'missing-coordinates');
  const numericEnds = [1, 2, 3].map(number => ({ ...unknownHit, id: number, number }));
  assert.equal(calculateCompositeScore(numericEnds, 3, 10, false, SCORE_ONLY_PROFILE).total, 105);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { HIT_MAP_GRID_SIZE, hitDensity, hitGeometry, hitMapLimit, knownHitPoints } from '../src/hit-map.ts';
import type { Shot } from '../src/target.ts';

test('geometry uses the shot centres, the physical radius and RMS around the centroid', () => {
  const shots: Shot[] = [
    { points: 9, code: '9', point: { x: 0, y: .3 } },
    { points: 9, code: '9', point: { x: .25, y: .3 } },
    { points: 8, code: '8', point: { x: .5, y: .3 } },
  ];
  const result = hitGeometry(shots, 400)!;
  assert.equal(result.known, 3);
  assert.ok(Math.abs(result.rmsMm! - 50 * Math.sqrt(2 / 3)) < 1e-9);
  assert.ok(Math.abs(result.shiftMm - Math.hypot(50, 60)) < 1e-9);
  assert.equal(hitGeometry(shots, 800)?.shiftMm, 2 * result.shiftMm);
});

test('only known positions are used, including a miss with an explicit coordinate', () => {
  const shots: Shot[] = [
    { points: 10, code: '10', point: null },
    { points: 0, code: 'M', point: null },
    { points: 7, code: '7', point: { x: 0, y: Number.NaN } },
    { points: 0, code: 'M', point: { x: 0, y: 1.25 } },
  ];
  assert.deepEqual(knownHitPoints(shots), [{ x: 0, y: 1.25 }]);
  assert.deepEqual(hitGeometry(shots, 400), { known: 1, rmsMm: null, shiftMm: 250 });
  assert.equal(hitGeometry(shots.slice(0, 3), 400), null);
  assert.equal(hitGeometry(shots, 0), null);
});

test('RMS requires three coordinates and preserves a measured zero', () => {
  const shot = { points: 9, code: '9', point: { x: .25, y: 0 } };
  assert.equal(hitGeometry([shot, shot], 400)?.rmsMm, null);
  assert.equal(hitGeometry([shot, shot, shot], 400)?.rmsMm, 0);
});

test('density bins confirmed positions into 24 cells per axis and records the actual peak', () => {
  const points = [{ x: 0, y: 0 }, { x: .01, y: .01 }, { x: .01, y: -.01 }, { x: -.01, y: .01 }];
  const limit = hitMapLimit(points);
  assert.equal(limit, 1.15);
  assert.equal(HIT_MAP_GRID_SIZE, 24);
  assert.deepEqual(hitDensity(points, limit), {
    cells: [{ column: 12, row: 12, count: 2 }, { column: 12, row: 11, count: 1 }, { column: 11, row: 12, count: 1 }],
    peak: 2,
  });
  assert.deepEqual(hitDensity([], limit), { cells: [], peak: 0 });
  const away = { x: -2, y: 2.5 };
  const expandedLimit = hitMapLimit([away]);
  assert.equal(expandedLimit, 2.6);
  assert.deepEqual(hitDensity([away], expandedLimit).cells, [{ column: 2, row: 23, count: 1 }]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Conditions } from '../src/conditions.ts';
import { buildNumberedArrowAnalysis, numberedArrowMapExtent } from '../src/numbered-arrow-analysis.ts';
import type { Point, Shot } from '../src/target.ts';

const conditions: Conditions = {
  distanceMeters: 18, targetProfileId: 'wa-indoor-outer-v1', targetDiameterMm: 400,
  equipment: { id: 'kit', name: 'Учебный набор', bow: { name: 'Лук', category: 'recurve' },
    arrows: { id: 'set', name: 'Карбон', diameterMm: 6, numberedCount: 12 } },
};

function shot(number: number | undefined, point: Point | null, points = 9): Shot {
  return { physicalArrowNumber: number, point, points, code: String(points) };
}

test('numbered shots accumulate by physical number in matching saved conditions', () => {
  const [group] = buildNumberedArrowAnalysis([
    { conditions, shots: [shot(7, { x: .2, y: .1 }), shot(2, { x: .1, y: .2 }), shot(undefined, { x: 0, y: 0 })] },
    { conditions: structuredClone(conditions), shots: [shot(7, null, 3), shot(2, { x: .5, y: .25 })] },
  ]);
  assert.equal(group.arrowsSetId, 'set');
  assert.deepEqual(group.arrows.map(({ number, shotCount, average }) => [number, shotCount, average]), [[2, 2, 9], [7, 2, 6]]);
  assert.deepEqual(group.arrows[1].points, [{ x: .2, y: .1 }]);
  assert.equal(group.arrows[1].rmsMm, null);
  assert.equal(group.arrows[1].shiftMm, null);
});

test('physical numbers from different sets, setups or shooting conditions do not merge', () => {
  const variants = [
    conditions,
    { ...conditions, distanceMeters: 25 },
    { ...conditions, targetDiameterMm: 600 },
    { ...conditions, targetProfileId: 'wa-indoor-inner-v1' },
    { ...conditions, equipment: { ...conditions.equipment!, id: 'another-setup' } },
    { ...conditions, equipment: { ...conditions.equipment!, arrows: { ...conditions.equipment!.arrows, id: 'another-set' } } },
    { ...conditions, equipment: { ...conditions.equipment!, arrows: { ...conditions.equipment!.arrows, diameterMm: 5 } } },
  ];
  const groups = buildNumberedArrowAnalysis(variants.map(conditions => ({ conditions, shots: [shot(1, null)] })));
  assert.equal(groups.length, variants.length);
  assert.ok(groups.every(group => group.arrows[0].shotCount === 1));
  assert.match(groups[0].label, /18 м.*40 см.*Учебный набор.*Карбон/);
});

test('missing arrow set identity, missing numbers and out-of-range numbers are excluded', () => {
  const unknownSet = { ...conditions, equipment: { ...conditions.equipment!, arrows: { name: 'Стрелы', diameterMm: 6 } } };
  assert.deepEqual(buildNumberedArrowAnalysis([
    { conditions: unknownSet, shots: [shot(1, null)] },
    { conditions: { ...conditions, equipment: null }, shots: [shot(1, null)] },
    { conditions, shots: [shot(undefined, null), shot(0, null), shot(1.5, null), shot(1001, null)] },
  ]), []);
});

test('only known coordinates feed centroid and geometry, with millimeter scaling from target diameter', () => {
  const sourceOnly = { ...shot(4, null), imported: true as const, sourcePoint: { x: 1, y: 1 } };
  const [group] = buildNumberedArrowAnalysis([{ conditions, shots: [
    shot(4, { x: .1, y: .3 }), shot(4, { x: .2, y: .3 }), shot(4, { x: .3, y: .3 }), sourceOnly,
  ] }]);
  const [sample] = group.arrows;
  assert.equal(sample.points.length, 3);
  assert.equal(sample.shotCount, 4);
  assert.ok(Math.abs(sample.centroid!.x - .2) < 1e-12);
  assert.ok(Math.abs(sample.centroid!.y - .3) < 1e-12);
  assert.ok(Math.abs(sample.rmsMm! - 200 * Math.sqrt(.02 / 3)) < 1e-12);
  assert.ok(Math.abs(sample.shiftMm! - 200 * Math.hypot(.2, .3)) < 1e-12);
});

test('the shared map extent fits both point and circle bounds', () => {
  const [group] = buildNumberedArrowAnalysis([{ conditions, shots: [
    shot(3, { x: .1, y: .3 }), shot(3, { x: 1.01, y: .3 }), shot(3, { x: 1.01, y: .3 }),
    shot(8, { x: 0, y: 0 }),
  ] }]);
  assert.equal(numberedArrowMapExtent(group, false), 1.01);
  assert.ok(numberedArrowMapExtent(group, true) > 1.01);
  const center = group.arrows[0].centroid!;
  assert.equal(numberedArrowMapExtent(group, true), center.x + group.arrows[0].rmsMm! / 200);
});

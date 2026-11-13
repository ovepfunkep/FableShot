import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptsDiameter, DEFAULT_TARGET, getTargetProfile, isOnFace, outerRadius, scorePoint,
  markTargetPoint, shaftRadius, spotOffsets, spotPoint, summarize, targetInput, TARGET_PROFILES } from '../src/target.ts';

test('ordinary Indoor centre is a ten, not X', () => {
  assert.deepEqual(scorePoint({ x: 0, y: 0 }), { points: 10, code: '10' });
});

test('a 6 mm shaft on a 40 cm face gets the higher value when touching a line', () => {
  const cases = [
    { x: 0.115, points: 10 },
    { x: 0.116, points: 9 },
    { x: 0.515, points: 6 },
    { x: 0.516, points: 5 },
    { x: 1.015, points: 1 },
    { x: 1.016, points: 0 },
  ];
  for (const { x, points } of cases) {
    assert.deepEqual(scorePoint({ x, y: 0 }), { points, code: points ? String(points) : 'M' });
  }
  assert.equal(scorePoint({ x: 0.069, y: -0.092 }).points, 10);
});

test('placement includes the shaft touching the outside of the face', () => {
  assert.equal(isOnFace({ x: 0, y: -1.015 }), true);
  assert.equal(isOnFace({ x: 0, y: -1.016 }), false);
  assert.equal(isOnFace({ x: NaN, y: 0 }), false);
  assert.throws(() => scorePoint({ x: NaN, y: 0 }), RangeError);
});

test('target profiles keep their IDs, allowed diameters and nominal radii', () => {
  const cases = [
    ['practice-full-10-v1', [], 450, 1, '10'],
    ['wa-outdoor-full-v1', [800, 1220], 1220, 1, 'X'],
    ['wa-indoor-outer-v1', [400, 600], 400, 1, '10'],
    ['wa-indoor-inner-v1', [400, 600], 600, 1, '10'],
    ['wa-outdoor-six-v1', [800], 800, .6, 'X'],
    ['wa-indoor-five-outer-v1', [400, 600], 400, .5, '10'],
    ['wa-indoor-five-inner-v1', [400, 600], 600, .5, '10'],
    ['wa-indoor-triple-outer-v1', [400, 600], 400, .5, '10'],
    ['wa-indoor-triple-inner-v1', [400, 600], 600, .5, '10'],
  ] as const;
  assert.deepEqual(TARGET_PROFILES.map(profile => profile.id), cases.map(([id]) => id));
  for (const [profileId, diameters, diameterMm, radius, centerCode] of cases) {
    const profile = getTargetProfile(profileId)!;
    const spec = { ...DEFAULT_TARGET, profileId, diameterMm };
    assert.deepEqual(profile.diameters, diameters);
    assert.equal(acceptsDiameter(profile, diameterMm), true);
    assert.equal(outerRadius(spec), radius);
    assert.deepEqual(scorePoint({ x: 0, y: 0 }, spec), { code: centerCode, points: 10 });
  }
  assert.equal(getTargetProfile('missing'), undefined);
});

test('three-spot centres score independently and the paper between them is not an input', () => {
  const spec = { ...DEFAULT_TARGET, profileId: 'wa-indoor-triple-outer-v1' };
  const profile = getTargetProfile(spec.profileId)!;
  assert.deepEqual(spotOffsets(profile).map(y => {
    const aim = targetInput({ x: 0, y }, profile);
    assert.deepEqual(spotPoint(aim.point, aim.spot), { x: 0, y });
    return [aim.spot, markTargetPoint(aim.point, spec)?.points];
  }), [[0, 10], [1, 10], [2, 10]]);
  assert.equal(markTargetPoint(targetInput({ x: .08, y: -.6 }, profile).point, spec), null);
});

test('reduced targets score their last ring and reject the rest of the nominal face', () => {
  const reduced = { ...DEFAULT_TARGET, profileId: 'wa-outdoor-six-v1', diameterMm: 800 };
  const reducedEdge = outerRadius(reduced) + shaftRadius(reduced);
  assert.equal(isOnFace({ x: reducedEdge, y: 0 }, reduced), true);
  assert.deepEqual(scorePoint({ x: reducedEdge, y: 0 }, reduced), { code: '5', points: 5 });
  assert.equal(isOnFace({ x: .608, y: 0 }, reduced), false);
  assert.deepEqual(scorePoint({ x: .608, y: 0 }, reduced), { code: 'M', points: 0 });

  const indoor = { ...DEFAULT_TARGET, profileId: 'wa-indoor-five-outer-v1' };
  assert.equal(isOnFace({ x: 0, y: -.515 }, indoor), true);
  assert.deepEqual(scorePoint({ x: 0, y: -.515 }, indoor), { code: '6', points: 6 });
  assert.equal(isOnFace({ x: 0, y: -.516 }, indoor), false);
});

test('outdoor X and the small Indoor ten follow the shaft boundary independently', () => {
  const outdoor = { ...DEFAULT_TARGET, profileId: 'wa-outdoor-full-v1', diameterMm: 800 };
  assert.deepEqual(scorePoint({ x: .0575, y: 0 }, outdoor), { code: 'X', points: 10 });
  assert.deepEqual(scorePoint({ x: .058, y: 0 }, outdoor), { code: '10', points: 10 });

  for (const profileId of ['wa-indoor-inner-v1', 'wa-indoor-five-inner-v1']) {
    const spec = { ...DEFAULT_TARGET, profileId };
    assert.deepEqual(scorePoint({ x: .065, y: 0 }, spec), { code: '10', points: 10 });
    assert.deepEqual(scorePoint({ x: .066, y: 0 }, spec), { code: '9', points: 9 });
  }
});

test('the nominal face diameter and shaft diameter both affect line calls', () => {
  const largerFace = { ...DEFAULT_TARGET, diameterMm: 600 };
  const widerArrow = { ...largerFace, shaftDiameterMm: 12 };
  const point = { x: .112, y: 0 };
  assert.equal(shaftRadius(largerFace), .01);
  assert.equal(shaftRadius(widerArrow), .02);
  assert.equal(scorePoint(point, DEFAULT_TARGET).points, 10);
  assert.equal(scorePoint(point, largerFace).points, 9);
  assert.equal(scorePoint(point, widerArrow).points, 10);
});

test('invalid diameters and unknown profiles are rejected', () => {
  const indoor = getTargetProfile(DEFAULT_TARGET.profileId)!;
  const practice = getTargetProfile('practice-full-10-v1')!;
  assert.equal(acceptsDiameter(indoor, 800), false);
  assert.equal(acceptsDiameter(practice, 400.5), false);
  assert.equal(acceptsDiameter(practice, 0), false);
  assert.throws(() => scorePoint({ x: 0, y: 0 }, { ...DEFAULT_TARGET, diameterMm: 800 }), RangeError);
  assert.throws(() => scorePoint({ x: 0, y: 0 }, { ...DEFAULT_TARGET, profileId: 'missing' }), RangeError);
  assert.throws(() => shaftRadius({ ...DEFAULT_TARGET, shaftDiameterMm: .99 }), RangeError);
  assert.throws(() => shaftRadius({ ...DEFAULT_TARGET, shaftDiameterMm: 20.01 }), RangeError);
});

test('the maximum follows entered shots, with misses and recorded X included', () => {
  assert.deepEqual(summarize([]), { points: 0, maximum: 0, average: null });
  assert.deepEqual(summarize([
    { point: { x: 0.12, y: 0 }, points: 9, code: '9' },
    { point: null, points: 0, code: 'M' },
  ]), { points: 9, maximum: 20, average: 4.5 });
  assert.deepEqual(summarize([
    { point: { x: 0, y: 0 }, points: 10, code: 'X' },
    { point: null, points: 0, code: 'M' },
  ]), { points: 10, maximum: 20, average: 5 });
});

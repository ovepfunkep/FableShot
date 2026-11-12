import assert from 'node:assert/strict';
import { test } from 'node:test';
import { elapsedTrainingTime, formatTrainingTime, isTrainingTime, startTrainingTime, stopTrainingTime } from '../src/training-time.ts';

test('resuming counts the new interval and excludes the gap after completion', () => {
  const first = stopTrainingTime(startTrainingTime(1000), 61_000);
  const resumed = startTrainingTime(3_600_000, first, true);
  assert.equal(elapsedTrainingTime(resumed, 3_720_000), 180_000);
  const complete = stopTrainingTime(resumed, 3_720_000);
  assert.equal(complete.partial, false);
  assert.equal(formatTrainingTime(complete.closedMs!), '3 мин');
  assert.equal(isTrainingTime(complete, false), true);
  assert.equal(isTrainingTime(resumed, false), false);
});

test('resuming an older entry and a reversed clock preserve only measured intervals', () => {
  const resumed = startTrainingTime(2000, undefined, true);
  assert.deepEqual(stopTrainingTime(resumed, 1000), { closedMs: null, activeSinceMs: null, partial: true });
  assert.equal(stopTrainingTime(resumed, 12_000).closedMs, 10_000);
});

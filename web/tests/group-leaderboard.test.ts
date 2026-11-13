import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStandings, readRoomSeries, roomConditionChoices } from '../src/group-leaderboard.ts';

test('PG1 compares frozen personal baselines, excludes future scores and requires enough complete arrows', () => {
  const conditions = { distanceMeters: 18, targetProfileId: 'wa-indoor-outer-v1', targetDiameterMm: 400 };
  const end = (name: string, ordinal: number, usual: number, points: number, complete = true) => ({
    entryId: name.repeat(64), ordinal, result: { points, arrows: 6, hits: 6, bowCategory: 'barebow', conditions,
      spread: { positions: 6, squaredDistance: 0, complete }, progressBase: { sessions: 3, arrows: 36, points: usual * 36 } },
  });
  const series = readRoomSeries({ series: [
    end('a', 1, 5, 48), end('a', 2, 5, 48), end('a', 3, 5, 20),
    end('b', 1, 8, 48), end('b', 2, 8, 48),
    end('c', 1, 5, 48), end('c', 2, 5, 48, false),
  ] });
  const early = groupStandings(series, 1, undefined, [], undefined, 'pg1');
  assert.ok(early.every(row => row.place === null));
  const rows = groupStandings(series, 2, undefined, [], undefined, 'pg1');
  assert.deepEqual(rows.map(row => [row.id[0], row.place, row.progress?.percentagePoints]), [
    ['a', 1, 30], ['b', 2, 0], ['c', null, 30],
  ]);
});

test('CG3 ranks tight groups above spread groups at equal scores without including future series', () => {
  const conditions = { distanceMeters: 18, targetProfileId: 'wa-indoor-outer-v1', targetDiameterMm: 400 };
  const end = (name: string, ordinal: number, squaredDistance: number) => ({
    entryId: name.repeat(64), ordinal, result: { points: 30, arrows: 3, hits: 3, bowCategory: 'barebow', conditions,
      spread: { positions: 3, squaredDistance, complete: true } },
  });
  const series = readRoomSeries({ series: [end('a', 1, .03), end('a', 2, 0), end('b', 1, 0)] });
  const rows = groupStandings(series, 1, undefined, [], undefined, 'cg3');
  assert.equal(rows[0].id, 'b'.repeat(64));
  assert.equal(rows[0].composite?.total, 105);
  assert.equal(rows[1].composite?.total, 100);
  assert.equal(rows[1].composite?.shotCount, 3);
  const legacy = { ...series[0], result: { ...series[0].result!, spread: undefined } };
  assert.equal(groupStandings([legacy], 1, undefined, [], undefined, 'cg3')[0].place, null);
});

test('a conditions filter excludes another distance and older series with unknown conditions', () => {
  const entryId = 'a'.repeat(64);
  const result = { points: 20, arrows: 3, bowCategory: 'barebow' };
  const conditions = { distanceMeters: 18, targetProfileId: 'wa-indoor-outer-v1', targetDiameterMm: 400 };
  const series = readRoomSeries({ series: [
    { entryId, ordinal: 1, result },
    { entryId, ordinal: 2, result: { ...result, conditions } },
    { entryId, ordinal: 3, result: { ...result, conditions: { ...conditions, distanceMeters: 25 } } },
  ] });
  const [filter] = roomConditionChoices(series).keys();
  const [row] = groupStandings(series, 3, 'barebow', [], filter);
  assert.equal(row.points, 20);
  assert.equal(row.current, null);
  assert.equal(row.place, null);
  assert.equal(groupStandings(series, 3)[0].points, 60);
});

test('classic leaderboard caps totals at the selected series and shares ties', () => {
  const rows = groupStandings([
    { entryId: 'a', ordinal: 1, result: { points: 20, arrows: 3, bowCategory: 'barebow' } },
    { entryId: 'a', ordinal: 2, result: { points: 30, arrows: 3, bowCategory: 'barebow' } },
    { entryId: 'b', ordinal: 1, result: { points: 20, arrows: 3, bowCategory: 'compound' } },
    { entryId: 'c', ordinal: 2, result: { points: 22, arrows: 3, bowCategory: 'barebow' } },
  ], 1);
  assert.deepEqual(rows.map(({ id, points, place }) => ({ id, points, place })), [
    { id: 'a', points: 20, place: 1 }, { id: 'b', points: 20, place: 1 }, { id: 'c', points: 0, place: null },
  ]);
});

test('missing or deleted series stays partial and duplicate series cannot inflate totals', () => {
  const entryId = 'a'.repeat(64);
  const live = { entryId, ordinal: 2, result: { points: 30, arrows: 3, bowCategory: 'barebow' } };
  const deleted = { entryId, ordinal: 1, result: null };
  const rows = groupStandings(readRoomSeries({ series: [deleted, live] }), 2, 'barebow');
  assert.equal(rows[0].place, null);
  assert.equal(rows[0].points, 30);
  assert.throws(() => readRoomSeries({ series: [live, live] }));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStandings, readRoomSeries } from '../src/group-leaderboard.ts';

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

import assert from 'node:assert/strict';
import test from 'node:test';
import { awardRoomAchievements } from '../src/room-achievements.ts';
import { emptyPractice } from '../src/practice.ts';
import type { Diary, DiaryEntry } from '../src/persistence.ts';
import type { RoomSeries } from '../src/group-leaderboard.ts';

const now = '2026-11-13T12:00:00Z';
const conditions = { distanceMeters: 18, targetDiameterMm: 400, targetProfileId: 'wa-indoor-outer-v1' };
const result = { points: 48, arrows: 6, bowCategory: 'barebow', conditions, hits: 6,
  spread: { positions: 6, squaredDistance: 0, complete: true }, progressBase: { sessions: 3, arrows: 36, points: 180 } };

test('room awards require newly enrolled completed entries and confirmed current revisions', () => {
  const entries: DiaryEntry[] = [1, 2, 3].map(i => {
    const id = String(i);
    const series: RoomSeries[] = [id, 'peer'].flatMap(entryId => [1, 2].map(ordinal => ({ entryId, ordinal, revision: 1, result })));
    return { id, startedAt: now, localDate: `2026-11-0${i}`, practice: { ...emptyPractice(), savedAt: now },
      achievementEnrollment: { epoch: 'test', rankCategory: null, roomAwards: true },
      groupRoomHistory: { receivedAt: Date.parse(now), participants: [], series } };
  });
  const diary: Diary = { version: 1, achievementLedger: { epoch: 'test', grants: [] }, entries,
    groupSeries: entries.map(({ id }) => ({ roomId: id, entryId: id, trainingId: id, ends: [1, 2].map(ordinal => ({
      endId: ordinal, ordinal, revision: 1, acknowledged: 1, result: { ...conditions, scores: '888888', bowCategory: 'barebow' },
    })) })) };
  const earned = awardRoomAchievements(diary, '3', now);
  assert.deepEqual(earned.achievementLedger?.grants.map(({ id, scope }) => [id, scope]), [
    ['ROOM01', 'global'], ['ROOM02', 'global'], ['ROOM03', 'barebow'],
  ]);
  assert.equal(awardRoomAchievements(earned, '3', now), earned);
  const stale = structuredClone(diary);
  stale.groupSeries![2].ends.forEach(end => end.revision++);
  assert.equal(awardRoomAchievements(stale, '3', now), stale);
  const old = structuredClone(diary);
  delete old.entries[2].achievementEnrollment!.roomAwards;
  assert.equal(awardRoomAchievements(old, '3', now), old);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { earnAchievements, groupAchievementGrants, isAchievementEnrollment, isAchievementLedger, queueAchievementGrants, recentAchievementNotices } from '../src/achievement-ledger.ts';
import type { AchievementLedger } from '../src/achievement-ledger.ts';

const earnedAt = '2026-11-11T10:00:00.000Z';
const ledger = (): AchievementLedger => ({ epoch: 'epoch-one', grants: [] });

test('reloading replays only recent unannounced grants, never old or already displayed awards', () => {
  const nowMs = Date.parse(earnedAt);
  const grants = [
    { id: 'START01', scope: 'global', earnedAt },
    { id: 'START02', scope: 'recurve', earnedAt, notifiedAt: earnedAt },
    { id: 'START03', scope: 'recurve', earnedAt: new Date(nowMs - 10_001).toISOString() },
    { id: 'HIT01', scope: 'recurve', earnedAt: new Date(nowMs + 1).toISOString() },
  ];
  assert.deepEqual(recentAchievementNotices({ ...ledger(), grants }, nowMs).map(group => group.leading.id), ['START01']);
  assert.equal(isAchievementLedger({ ...ledger(), grants: [{ ...grants[0], notifiedAt: 'bad' }] }), false);
});

test('waiting notices merge new tiers in the same family while retaining every earned tier once', () => {
  const first = { id: 'START02', scope: 'recurve', earnedAt };
  const better = { id: 'HIT01', scope: 'recurve', earnedAt };
  const other = { id: 'START01', scope: 'global', earnedAt };
  const queue = queueAchievementGrants(groupAchievementGrants([first, other]), [first, better]);
  assert.equal(queue.length, 2);
  const group = queue.find(item => item.leading.id === 'HIT01')!;
  assert.deepEqual(group.additional, [first]);
  assert.equal(queue.flatMap(item => [item.leading, ...item.additional]).length, 3);
});

test('earning requires a supported rule, the correct scope and a finite reached threshold', () => {
  const initial = ledger();
  const result = earnAchievements(initial, [
    { id: 'START05', scope: 'global', progress: 4 },
    { id: 'START01', scope: 'recurve', progress: 1 },
    { id: 'START02', scope: 'global', progress: 1 },
    { id: 'UNKNOWN01', scope: 'global', progress: 10_000 },
    { id: 'START01', scope: 'global', progress: NaN },
    { id: 'START01', scope: 'global', progress: Infinity },
    { id: 'START01', scope: 'global', progress: -1 },
    { id: 'START01', scope: 'global', progress: 1 },
    { id: 'START02', scope: 'recurve', progress: 1 },
  ], earnedAt, 'session-one');
  assert.deepEqual(result.added, [
    { id: 'START01', scope: 'global', earnedAt, sessionId: 'session-one' },
    { id: 'START02', scope: 'recurve', earnedAt, sessionId: 'session-one' },
  ]);
  assert.ok(isAchievementLedger(result.ledger));
  assert.deepEqual(initial, ledger());
});

test('duplicate observations and repeat evaluation preserve the original receipt and award time', () => {
  const observations = [{ id: 'START01', scope: 'global', progress: 1 }, { id: 'START01', scope: 'global', progress: 2 }];
  const first = earnAchievements(ledger(), observations, earnedAt, 'first');
  assert.equal(first.added.length, 1);
  const repeated = earnAchievements(first.ledger, observations, '2026-11-12T11:00:00.000Z', 'later');
  assert.deepEqual(repeated.added, []);
  assert.equal(repeated.ledger, first.ledger);
  assert.deepEqual(repeated.ledger.grants, [{ id: 'START01', scope: 'global', earnedAt, sessionId: 'first' }]);
});

test('all earned tiers remain in the ledger while family grouping leads with the highest tier', () => {
  const ids = ['START01', 'START05', 'START09', 'START10', 'START06', 'START07', 'START08'];
  const first = earnAchievements(ledger(), ids.map(id => ({ id, scope: 'global', progress: 1_000 })), earnedAt);
  assert.deepEqual(new Set(first.ledger.grants.map(grant => grant.id)), new Set(ids));
  const before = structuredClone(first.ledger);
  const groups = groupAchievementGrants(first.ledger.grants);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], { key: 'journey.sessions:global', leading: { id: 'START10', scope: 'global', earnedAt },
    additional: ['START09', 'START05', 'START01'].map(id => ({ id, scope: 'global', earnedAt })) });
  assert.deepEqual(groups[1].additional.map(grant => grant.id), ['START07', 'START06']);
  assert.equal(groups[1].leading.id, 'START08');
  assert.deepEqual(first.ledger, before);
  assert.deepEqual(JSON.parse(JSON.stringify(first.ledger)).grants.map((grant: { id: string }) => grant.id), ids);
});

test('family grouping separates bow categories and uses category-specific rarity', () => {
  const first = earnAchievements(ledger(), [
    { id: 'HIT01', scope: 'compound', progress: 1 },
    { id: 'HIT01', scope: 'barebow', progress: 1 },
    { id: 'HIT02', scope: 'compound', progress: 1 },
    { id: 'HIT02', scope: 'barebow', progress: 1 },
  ], earnedAt);
  const grouped = groupAchievementGrants(first.ledger.grants);
  assert.deepEqual(grouped.map(group => group.key), ['hits.ten:barebow', 'hits.ten:compound']);
  assert.ok(grouped.every(group => group.leading.id === 'HIT02' && group.additional.length === 1));
  assert.equal(first.ledger.grants.length, 4);
});

test('a reset starts a separate epoch and permits the same achievement to earn a new receipt', () => {
  const observations = [{ id: 'START01', scope: 'global', progress: 1 }];
  const prior = earnAchievements(ledger(), observations, earnedAt, 'old-session').ledger;
  const after = earnAchievements({ epoch: 'epoch-two', grants: [] }, observations, '2026-11-12T10:00:00.000Z', 'new-session');
  assert.equal(after.ledger.epoch, 'epoch-two');
  assert.equal(after.added.length, 1);
  assert.equal(after.added[0].sessionId, 'new-session');
  assert.equal(prior.epoch, 'epoch-one');
  assert.equal(prior.grants[0].sessionId, 'old-session');
});

test('ledger validation rejects duplicate receipts and malformed dates or epoch enrollment', () => {
  const grant = { id: 'START01', scope: 'global', earnedAt };
  assert.ok(isAchievementLedger({ epoch: 'one', grants: [grant] }));
  assert.equal(isAchievementLedger({ epoch: 'one', grants: [grant, { ...grant, sessionId: 'other' }] }), false);
  assert.equal(isAchievementLedger({ epoch: '', grants: [] }), false);
  assert.equal(isAchievementLedger({ epoch: 'one', grants: [{ ...grant, earnedAt: 'unknown' }] }), false);
  assert.equal(isAchievementLedger({ epoch: 'one', grants: [{ ...grant, sessionId: '' }] }), false);
  assert.ok(isAchievementEnrollment({ epoch: 'one', rankCategory: null }));
  assert.ok(isAchievementEnrollment({ epoch: 'one', rankCategory: 'female' }));
  assert.equal(isAchievementEnrollment({ epoch: 'one', rankCategory: 'unknown' }), false);
});

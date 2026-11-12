import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveRankAssignment, isRankAssignment, isRankAssignmentDate, isRankAssignments, RANK_DISCIPLINES, RANK_LEVELS, saveRankAssignment, visibleRankAssignments } from '../src/assigned-ranks.ts';
import type { RankAssignment } from '../src/assigned-ranks.ts';

function draft(id: string, changes: Partial<RankAssignment> = {}): RankAssignment {
  return { id, discipline: 'recurve', category: 'male', level: 'III', assignedOn: null, issuedBy: '', reference: '',
    current: true, createdAtMs: 100, updatedAtMs: 100, revision: 0, deletedAtMs: null, ...changes };
}

test('assigned ranks accept Android discipline and level values and refuse malformed fields', () => {
  assert.deepEqual(Object.keys(RANK_DISCIPLINES), ['recurve', 'barebow', 'compound', '3d-recurve', '3d-compound', '3d-traditional', '3d-longbow']);
  assert.deepEqual(RANK_LEVELS, ['III юн.', 'II юн.', 'I юн.', 'III', 'II', 'I', 'КМС', 'МС', 'МСМК']);
  const value = draft('rank', { discipline: '3d-longbow', level: 'МСМК', category: 'female', assignedOn: '2024-02-29', issuedBy: 'Организация', reference: 'Приказ №1' });
  assert.equal(isRankAssignment(value), true);
  for (const change of [{ discipline: 'traditional' }, { level: 'кмс' }, { category: 'any' }, { issuedBy: 'а'.repeat(121) },
    { reference: 'а'.repeat(501) }, { current: 1 }, { id: 'rank\n' }, { revision: -1 }, { deletedAtMs: 2 },
    { createdAtMs: Infinity }, { updatedAtMs: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(isRankAssignment({ ...value, ...change }), false);
  }
});

test('rank dates use canonical calendar days and support the native date range', () => {
  for (const value of ['2024-02-29', '2000-02-29', '0000-02-29', '-0004-02-29', '+10000-01-01', '+999999999-12-31']) {
    assert.equal(isRankAssignmentDate(value), true, value);
  }
  for (const value of ['2026-02-29', '1900-02-29', '2024-04-31', '2024-01-00', '2024-1-02', '-0000-01-01', '+2024-01-01', '2024-01-01\n']) {
    assert.equal(isRankAssignmentDate(value), false, value);
  }
});

test('saving a new current rank retires the prior record only in that discipline and category', () => {
  const first = saveRankAssignment([], draft('first', { assignedOn: '2024-03-01', issuedBy: 'Организация' }), 101);
  const women = saveRankAssignment(first, draft('women', { category: 'female' }), 102);
  const other = saveRankAssignment(women, draft('other', { discipline: 'compound' }), 103);
  const next = saveRankAssignment(other, draft('next', { level: 'II' }), 104);
  assert.equal(other[0].current, true);
  assert.deepEqual(next.map(row => [row.id, row.current, row.revision]), [['first', false, 2], ['women', true, 1], ['other', true, 1], ['next', true, 1]]);
  assert.equal(next[0].assignedOn, '2024-03-01');
  assert.equal(next[0].issuedBy, 'Организация');
  assert.equal(next[0].updatedAtMs, 104);
  assert.equal(isRankAssignments(next), true);
});

test('editing a historical mark can make it current again without changing its identity or creation time', () => {
  let rows = saveRankAssignment([], draft('old'), 101);
  rows = saveRankAssignment(rows, draft('new'), 102);
  rows = saveRankAssignment(rows, { ...rows[0], current: true, level: 'II', createdAtMs: 999 }, 103);
  assert.deepEqual(visibleRankAssignments(rows).map(row => [row.id, row.current, row.level]), [['old', true, 'II'], ['new', false, 'III']]);
  assert.equal(rows[0].createdAtMs, 100);
  assert.equal(rows[0].revision, 3);
});

test('archive preserves the record and historical facts without promoting a different mark', () => {
  const history = saveRankAssignment([], draft('history', { current: false, level: 'III' }), 101);
  const current = saveRankAssignment(history, draft('current', { level: 'КМС', reference: 'Приказ' }), 102);
  const archived = archiveRankAssignment(current, 'current', 1, 103);
  assert.deepEqual(visibleRankAssignments(archived), [archived[0]]);
  assert.deepEqual([archived[1].deletedAtMs, archived[1].current, archived[1].revision, archived[1].reference], [103, false, 2, 'Приказ']);
  assert.equal(archived[0].current, false);
  assert.deepEqual(archiveRankAssignment(archived, 'current', 1, 999), archived);
});

test('conflicting edits and duplicate current scopes are refused', () => {
  const rows = saveRankAssignment([], draft('id'), 101);
  assert.throws(() => saveRankAssignment(rows, draft('id', { level: 'I' }), 102), /rank_assignment_conflict/);
  assert.throws(() => archiveRankAssignment(rows, 'id', 0, 102), /rank_assignment_conflict/);
  const archived = archiveRankAssignment(rows, 'id', 1, 102);
  assert.throws(() => saveRankAssignment(archived, { ...archived[0], current: true, deletedAtMs: null }, 103), /rank_assignment_conflict/);
  assert.equal(isRankAssignments([draft('id'), draft('other')]), false);
  assert.equal(isRankAssignments([draft('id'), draft('id', { category: 'female' })]), false);
});

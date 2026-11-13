import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSeries, appendShot, completePractice, deleteSeries, emptyPractice, replaceShot } from '../src/practice.ts';
import { acknowledgeGroupSeries, flushGroupSeries, isGroupSeriesJournal, newGroupSeriesJournal, pendingGroupSeries, receiveGroupSeries, trackGroupSeries } from '../src/group-series.ts';
import type { GroupSeriesRevision } from '../src/group-series.ts';
import { isDiary, loadDiary, saveDiary, sendPendingGroupSeries, updateGroupSeriesInDiary } from '../src/persistence.ts';
import type { Diary } from '../src/persistence.ts';

const miss = { points: 0, code: 'M', point: null };
const ten = { points: 10, code: '10', point: { x: 0, y: 0 } };
const newJournal = () => newGroupSeriesJournal('room', 'entry', emptyPractice());

test('a local save queues only completed series, including all misses, with stable numbers across edits and deletion', () => {
  const first = appendShot(emptyPractice(), miss);
  const journal = newJournal();
  assert.throws(() => newGroupSeriesJournal('room', 'entry', first));
  assert.equal(trackGroupSeries(journal, first), journal);
  const practice = advanceSeries(first);
  const queued = trackGroupSeries(journal, practice);
  const [published] = pendingGroupSeries(queued);
  assert.equal(published.ordinal, 1);
  assert.equal(published.result?.scores, '0');
  assert.equal(isGroupSeriesJournal(JSON.parse(JSON.stringify(queued))), true);
  assert.equal(trackGroupSeries(queued, practice), queued);

  const corrected = replaceShot(practice, published.endId, 0, ten);
  const edited = trackGroupSeries(queued, corrected);
  assert.equal(pendingGroupSeries(edited)[0].result?.scores, 'T');
  assert.equal(pendingGroupSeries(edited)[0].revision, 2);
  const removed = deleteSeries(corrected, published.endId);
  const tombstone = trackGroupSeries(edited, removed);
  assert.deepEqual(pendingGroupSeries(tombstone), [{ endId: published.endId, ordinal: 1, revision: 3, result: null }]);
  const completed = completePractice(appendShot(removed, ten), '2026-11-13T00:00:00Z');
  assert.equal(pendingGroupSeries(trackGroupSeries(tombstone, completed))[1].ordinal, 2);
});

test('network failure after remote commit retries without duplicates and a late receipt leaves a newer local edit queued', async () => {
  const practice = advanceSeries(appendShot(emptyPractice(), miss));
  const diary = { version: 1 as const, entries: [], groupSeries: [newJournal()] };
  const stored = updateGroupSeriesInDiary(diary, 'entry', practice);
  assert.ok(isDiary(JSON.parse(JSON.stringify(stored))));
  let journal = stored.groupSeries![0];
  let accepted: readonly GroupSeriesRevision[] = [];
  const [first] = pendingGroupSeries(journal);
  const apply = (operation: unknown) => {
    const next = receiveGroupSeries(accepted, operation);
    accepted = next.accepted;
    return next.receipt;
  };
  const record = (receipt: Pick<GroupSeriesRevision, 'endId' | 'revision'>) => { journal = acknowledgeGroupSeries(journal, receipt); };
  await assert.rejects(flushGroupSeries(journal, { async publish(_room, _entry, end) { apply(end); throw Error('offline'); } }, record));
  assert.equal(pendingGroupSeries(journal).length, 1);
  await flushGroupSeries(journal, { async publish(_room, _entry, end) {
    const receipt = apply(end);
    journal = trackGroupSeries(journal, replaceShot(practice, first.endId, 0, ten));
    return receipt;
  } }, record);
  assert.equal(accepted.length, 1);
  assert.equal(pendingGroupSeries(journal)[0].revision, 2);
  await flushGroupSeries(journal, { async publish(_room, _entry, end) { return apply(end); } }, record);
  assert.deepEqual(pendingGroupSeries(journal), []);
  assert.equal(apply(first).revision, 2);
  assert.equal(accepted[0].result?.scores, 'T');
  assert.throws(() => apply({ ...accepted[0], result: first.result }));
  assert.throws(() => apply({ ...first, endId: 999 }));
});

test('series receiver rejects impossible ring values for the target and strips extra data', () => {
  const [operation] = pendingGroupSeries(trackGroupSeries(newJournal(), advanceSeries(appendShot(emptyPractice(), ten))));
  const result = operation.result!;
  assert.throws(() => receiveGroupSeries([], { ...operation, result: { ...result, scores: 'X' } }));
  const accepted = receiveGroupSeries([], { ...operation, secret: 'private', result: { ...result, notes: 'private' } }).accepted;
  assert.deepEqual(accepted, [operation]);
});

test('diary persists the practice and pending revision in the same write and recovers both on reload', async () => {
  const storage = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  try {
    const empty = loadDiary();
    const before: Diary = { ...empty, entries: [{ id: 'entry', startedAt: '2026-11-13T00:00:00Z', practice: emptyPractice() }], groupSeries: [newJournal()] };
    saveDiary(before, empty);
    const practice = advanceSeries(appendShot(before.entries[0].practice, ten));
    const tracked = updateGroupSeriesInDiary(before, 'entry', practice);
    const updated = { ...tracked, entries: [{ ...before.entries[0], practice }] };
    saveDiary(updated, before);
    const reopened = loadDiary();
    assert.deepEqual(reopened.entries[0].practice, practice);
    assert.equal(pendingGroupSeries(reopened.groupSeries![0])[0].result?.scores, 'T');
    const transport = { async publish(_room: string, _entry: string, operation: GroupSeriesRevision) {
      return receiveGroupSeries([], operation).receipt;
    } };
    await assert.rejects(sendPendingGroupSeries('entry', transport, loadDiary, () => false), /сохранить подтверждение/);
    assert.equal(pendingGroupSeries(loadDiary().groupSeries![0]).length, 1);
    await sendPendingGroupSeries('entry', transport, loadDiary, change => {
      const latest = loadDiary();
      saveDiary(change(latest), latest);
      return true;
    });
    assert.deepEqual(pendingGroupSeries(loadDiary().groupSeries![0]), []);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

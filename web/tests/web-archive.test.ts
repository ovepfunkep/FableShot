import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { ACTIVE_DATA_KEY, DATA_KEYS, RECOVERY_DATA_KEY, createAppStorage, decodeStoredData } from '../src/app-storage.ts';
import type { DataRecords } from '../src/app-storage.ts';
import { archiveSourceToken, createWebArchive, inspectWebArchive, lastRecovery, replaceArchiveRecords, unpackArchive } from '../src/web-archive.ts';
import { appendShot, emptyPractice } from '../src/practice.ts';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { DEFAULT_TARGET, markTargetPoint } from '../src/target.ts';
import { emptyTournamentStart, saveTournament } from '../src/tournaments.ts';
import type { Tournament } from '../src/tournaments.ts';
import { RANK_REVISION } from '../src/sport-ranks.ts';

function records(count: number): DataRecords {
  const result = Object.fromEntries(DATA_KEYS.map(key => [key, null])) as DataRecords;
  const practice = appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } });
  result[DATA_KEYS[0]] = JSON.stringify({ version: 1, entries: Array.from({ length: count }, (_, i) => ({
    id: `training-${i}`, startedAt: '2026-11-11T09:00:00Z', practice: { ...practice, savedAt: '2026-11-11T10:00:00Z' },
  })) });
  result['app.fableshot.training-preferences.v1'] = JSON.stringify({ version: 1, preferences: DEFAULT_PREFERENCES });
  return result;
}

test('archive preserves tournament starts and links without creating or modifying training', async () => {
  const original = records(1);
  const diary = JSON.parse(original[DATA_KEYS[0]]!);
  const start = { ...emptyTournamentStart(), category: 'Баребоу', result: '480', place: 2, sessionIds: ['training-0'] };
  const event: Tournament = { id: 'club-cup', title: 'Кубок', from: '2026-11-11', to: '2026-11-12',
    venue: '', note: '', protocol: 'https://example.com/protocol', starts: [start, { ...emptyTournamentStart(), result: 'DNF' }],
    completed: true, attachments: [{ id: 'protocol', name: 'Протокол.png', type: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=' }] };
  const saved = saveTournament(diary, event);
  assert.equal(saved.entries, diary.entries);
  assert.throws(() => saveTournament(saved, { ...event, id: 'another' }), /одному старту/);
  assert.throws(() => saveTournament(diary, { ...event, protocol: 'javascript:alert(1)' }));
  original[DATA_KEYS[0]] = JSON.stringify(saved);
  const restored = await inspectWebArchive(await createWebArchive(original, 'test'));
  assert.deepEqual(restored.records, original);
  assert.equal(restored.summary.trainings, 1);
});

test('archives keep directional misses distinct from the M button and retain shaft scoring at the boundary', async () => {
  const boundary = markTargetPoint({ x: 1.015, y: 0 }, DEFAULT_TARGET);
  const ring = markTargetPoint({ x: 1.06, y: 0 }, DEFAULT_TARGET);
  assert.equal(boundary?.points, 1);
  assert.deepEqual(ring, { code: 'M', points: 0, point: null, missPoint: { x: 1.06, y: 0 } });
  assert.equal(markTargetPoint({ x: 1.101, y: 0 }, DEFAULT_TARGET), null);
  const original = records(1);
  const diary = JSON.parse(original[DATA_KEYS[0]]!);
  const shots = diary.entries[0].practice.rounds[0].series[0].shots;
  shots.push(ring, { code: 'M', points: 0, point: null });
  original[DATA_KEYS[0]] = JSON.stringify(diary);
  const restored = await inspectWebArchive(await createWebArchive(original, 'test'));
  assert.deepEqual(restored.records, original);
  ring!.missPoint!.x = .5;
  shots[1] = ring;
  original[DATA_KEYS[0]] = JSON.stringify(diary);
  await assert.rejects(createWebArchive(original, 'test'));
});

function source(initial: DataRecords, failOn?: string) {
  const map = new Map(Object.entries(initial).filter((pair): pair is [string, string] => pair[1] !== null));
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem(key: string, value: string) {
    if (key === failOn) throw new DOMException('Quota', 'QuotaExceededError');
    map.set(key, value);
  } };
}

test('archive round trip preserves all settings and records with verified counts', async () => {
  const initial = records(2);
  const diary = JSON.parse(initial[DATA_KEYS[0]]!);
  const note = { id: 'standalone', localDate: '2026-11-11', body: 'Сохранить наблюдение', tags: ['форма'],
    place: '', feeling: '', conditions: '', createdAtMs: 1, updatedAtMs: 2 };
  diary.notes = [note, { ...note, id: 'archived', deletedAtMs: 3 }];
  diary.entries[0].notes = [{ ...note, id: 'series-note', seriesId: 2, deletedAtMs: 4 }];
  initial[DATA_KEYS[0]] = JSON.stringify(diary);
  const bytes = await createWebArchive(initial, '0.15.0');
  const preview = await inspectWebArchive(bytes);
  assert.deepEqual(preview.records, initial);
  assert.equal(preview.summary.trainings, 2);
  assert.equal(preview.summary.arrows, 2);
  assert.equal(preview.summary.notes, 3);
  assert.equal(preview.summary.archivedNotes, 2);
});

test('tampered, incomplete, unsafe and oversized ZIP payloads are refused', async () => {
  const bytes = await createWebArchive(records(1), '0.15.0');
  const files = unzipSync(bytes);
  const damaged = { ...files, 'data/web/records.json': new TextEncoder().encode('{}') };
  await assert.rejects(inspectWebArchive(zipSync(damaged)), /контрольная сумма/);
  const missing = { 'manifest.json': files['manifest.json'] };
  await assert.rejects(inspectWebArchive(zipSync(missing)), /формат|сумма/);
  assert.throws(() => unpackArchive(zipSync({ '../bad': new Uint8Array([1]) })), /пути/);
  assert.throws(() => unpackArchive(zipSync({ 'manifest.json': new Uint8Array([1]), 'MANIFEST.JSON': new Uint8Array([2]) })), /пути/);
  const oversized = bytes.slice();
  const view = new DataView(oversized.buffer);
  for (let i = 0; i < oversized.length - 30; i++) if (view.getUint32(i, true) === 0x02014b50) {
    view.setUint32(i + 24, 33 * 1024 * 1024, true); break;
  }
  assert.throws(() => unpackArchive(oversized), /слишком большой/);
});

test('replacement backs up before one active write; fresh writers preserve other sections and stale tabs cannot write', () => {
  const original = records(1);
  const destination = source(original);
  const stale = createAppStorage(() => destination);
  assert.equal(stale.getItem(DATA_KEYS[0]), original[DATA_KEYS[0]]);
  const next = records(3);
  replaceArchiveRecords(next, { records: original, token: archiveSourceToken(destination) }, destination);
  assert.deepEqual(lastRecovery(destination)?.records, original);
  assert.equal(destination.getItem(DATA_KEYS[0]), original[DATA_KEYS[0]]);
  const active = createAppStorage(() => destination);
  assert.equal(active.getItem(DATA_KEYS[0]), next[DATA_KEYS[0]]);
  active.setItem('app.fableshot.training-preferences.v1', JSON.stringify({ version: 1, preferences: { ...DEFAULT_PREFERENCES, haptics: true } }));
  assert.equal(decodeStoredData(destination.getItem(ACTIVE_DATA_KEY)!).records[DATA_KEYS[0]], next[DATA_KEYS[0]]);
  assert.throws(() => stale.setItem(DATA_KEYS[0], original[DATA_KEYS[0]]!), /другом окне/);
});

test('restoring a rank-stage receipt preserves the original evidence without replaying its banner', async () => {
  const backup = records(1);
  const diary = JSON.parse(backup[DATA_KEYS[0]]!);
  const grant = { id: 'SNR06', scope: 'stage-v1:barebow-18-60-male:wa-indoor-outer-v1', sessionId: 'training-0',
    earnedAt: '2026-11-11T10:00:00Z', stageRank: { roundId: 1, seriesIds: [2], revision: RANK_REVISION,
      points: 30, arrows: 3, exerciseArrows: 60, threshold: 553, target: 'wa-indoor-outer-v1',
      bow: 'barebow', distance: 18, diameter: 400 } };
  diary.achievementLedger = { epoch: 'stage-epoch', grants: [grant] };
  backup[DATA_KEYS[0]] = JSON.stringify(diary);
  const preview = await inspectWebArchive(await createWebArchive(backup, 'test'));
  assert.deepEqual(preview.records, backup);
  const original = records(0);
  const destination = source(original);
  replaceArchiveRecords(preview.records, { records: original, token: archiveSourceToken(destination) }, destination);
  const restored = JSON.parse(createAppStorage(() => destination).getItem(DATA_KEYS[0])!);
  assert.deepEqual(restored.achievementLedger.grants, [{ ...grant, notifiedAt: grant.earnedAt }]);
  assert.deepEqual(restored.entries, diary.entries);
});

test('backup/activation quota failures and stale preview leave the old diary active', () => {
  for (const failOn of [RECOVERY_DATA_KEY, ACTIVE_DATA_KEY]) {
    const original = records(1);
    const destination = source(original, failOn);
    assert.throws(() => replaceArchiveRecords(records(2), { records: original, token: archiveSourceToken(destination) }, destination), /Quota/);
    assert.equal(destination.getItem(ACTIVE_DATA_KEY), null);
    assert.equal(createAppStorage(() => destination).getItem(DATA_KEYS[0]), original[DATA_KEYS[0]]);
  }
  const original = records(1);
  const destination = source(original);
  const token = archiveSourceToken(destination);
  destination.setItem(DATA_KEYS[0], records(2)[DATA_KEYS[0]]!);
  assert.throws(() => replaceArchiveRecords(records(3), { records: original, token }, destination), /изменились/);
  assert.equal(destination.getItem(RECOVERY_DATA_KEY), null);
});

test('restoring a checked diary preserves the exact bytes of a corrupt previous diary', () => {
  const damaged = records(1);
  damaged[DATA_KEYS[0]] = '{broken diary';
  const destination = source(damaged);
  const token = archiveSourceToken(destination);
  replaceArchiveRecords(records(2), { records: damaged, token }, destination);
  const backup = JSON.parse(destination.getItem(RECOVERY_DATA_KEY)!);
  assert.equal(backup.records[DATA_KEYS[0]], '{broken diary');
  assert.equal(backup.originalSource, token);
  assert.equal(destination.getItem(DATA_KEYS[0]), '{broken diary');
});

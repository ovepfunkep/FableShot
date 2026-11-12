import { openSettingsCategory } from './journal-navigation.ts';
import { expect, test } from '@playwright/test';
import { DATA_KEYS } from '../src/app-storage.ts';
import type { DataRecords } from '../src/app-storage.ts';
import { createWebArchive } from '../src/web-archive.ts';
import { appendShot, emptyPractice } from '../src/practice.ts';
import { zipSync } from 'fflate';
import { archiveDigest } from '../src/web-archive.ts';
import { nativeArchiveTablePaths } from '../src/native-archive.ts';
import { readFile } from 'node:fs/promises';

function diary(count: number) {
  const practice = appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } });
  return JSON.stringify({ version: 1, entries: Array.from({ length: count }, (_, i) => ({ id: `archive-${i}`,
    startedAt: '2026-11-11T10:00:00Z', practice: { ...practice, savedAt: '2026-11-11T11:00:00Z' } })) });
}
test('checked archive replaces all data after confirmation and can return to the saved previous diary', async ({ page }) => {
  const original = diary(1);
  await page.addInitScript(original => {
    if (!localStorage.getItem('app.fableshot.practice-diary.v1')) localStorage.setItem('app.fableshot.practice-diary.v1', original);
  }, original);
  const records = Object.fromEntries(DATA_KEYS.map(key => [key, null])) as DataRecords;
  records[DATA_KEYS[0]] = diary(2);
  const bytes = await createWebArchive(records, 'test');
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
  await page.getByTestId('archive-file').setInputFiles({ name: 'test.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.getByTestId('archive-preview')).toContainText('2');
  expect(await page.evaluate(() => localStorage.getItem('app.fableshot.active-data.v1'))).toBeNull();
  await page.getByTestId('archive-restore').click();
  await page.getByTestId('archive-confirm-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('nav-history').click();
  await expect(page.locator('[data-testid^="session-archive-"]')).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('app.fableshot.practice-diary.v1'))).toBe(original);
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
  await expect(page.getByTestId('archive-last-backup')).toContainText('1');
  await page.getByTestId('archive-recover').click();
  await page.getByTestId('archive-confirm-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('nav-history').click();
  await expect(page.locator('[data-testid^="session-archive-"]')).toHaveCount(1);
});

test('a second tab cannot race the writer or overwrite the diary', async ({ page, context }) => {
  await page.goto('./');
  const other = await context.newPage();
  await other.goto('./');
  await expect(other.getByRole('alert')).toContainText('другом окне');
  await expect(other.getByTestId('home-start-training')).toHaveCount(0);
  await page.getByTestId('home-start-training').click();
  await page.getByTestId('target').click();
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  await page.close();
  await other.getByRole('button', { name: 'Повторить' }).click();
  await other.getByTestId('home-start-training').click();
  await expect(other.getByTestId('series-score')).toHaveText('10/10');
});

test('profile reset first exports a backup and the local copy can restore its entries', async ({ page }) => {
  await page.addInitScript(initial => {
    if (!localStorage.getItem('app.fableshot.practice-diary.v1')) localStorage.setItem('app.fableshot.practice-diary.v1', initial);
  }, diary(1));
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
  await page.getByTestId('account-reset').click();
  const backup = page.waitForEvent('download');
  await page.getByTestId('archive-confirm-apply').click();
  expect((await backup).suggestedFilename()).toMatch(/^FableShot-.*\.zip$/);
  await page.getByTestId('account-reset-finish').click();
  await page.getByTestId('onboard-skip').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('nav-history').click();
  await expect(page.locator('[data-testid^="session-archive-"]')).toHaveCount(0);
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
  await expect(page.getByTestId('archive-last-backup')).toContainText('1');
  await page.getByTestId('archive-recover').click();
  await page.getByTestId('archive-confirm-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('nav-history').click();
  await expect(page.locator('[data-testid^="session-archive-"]')).toHaveCount(1);
});

test('Android diary activates after confirmation and round-trips the original ZIP', async ({ page, browser }) => {
  const rows = nativeArchiveTablePaths(16);
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const files: Record<string, Uint8Array> = Object.fromEntries(rows.map(path => [path, new Uint8Array()]));
  const at = Date.UTC(2026, 10, 11, 10), target = JSON.stringify({ snapshotVersion: 1, profileId: 'practice-full-10-v1',
    profileVersion: 1, geometryType: 'circle', scoringRuleVersion: 'practice-point-10-v1', diameterMm: 400,
    boundaryRule: 'greater-score', boundaryEpsilon: 1e-9, supportsX: false,
    faces: [{ faceId: 'main', zones: Array.from({ length: 10 }, (_, index) => ({ code: String(10 - index), points: 10 - index,
      outerRadius: (index + 1) / 10, isX: false })) }] });
  const equipment = JSON.stringify({ schema: 1,
    selection: { id: 'kit', kind: 'setup', revision: 1, name: 'Комплект Android', bowId: 'bow', arrowsId: 'arrows' },
    bow: { id: 'bow', kind: 'bow', revision: 1, name: 'Лук Android', category: 'barebow' },
    arrows: { id: 'arrows', kind: 'arrows', revision: 1, name: 'Стрелы Android', diameterMm: null, numberedCount: null } });
  const nativeRows: Record<string, Record<string, unknown>[]> = {
    'data/journal/sessions.jsonl': [{ id: 'native-session', title: 'Android training', createdAtMs: at, startedAtMs: at,
      completedAtMs: at + 60_000, localDate: '2026-11-11', timeZoneId: 'UTC', timeSource: 'app_clock', state: 'completed',
      kind: 'training', sourceKind: 'native', revision: 1, deletedAtMs: null, numberedArrows: null }],
    'data/journal/blocks.jsonl': [{ id: 'native-block', sessionId: 'native-session', ordinal: 0, mode: 'scored',
      distanceMeters: 18, targetProfileId: 'practice-full-10-v1', targetProfileVersion: 1, targetDiameterMm: 400,
      targetSnapshotJson: target, equipmentSnapshotJson: equipment, defaultArrowsPerEnd: 3, revision: 1 }],
    'data/journal/ends.jsonl': [{ id: 'native-end', blockId: 'native-block', ordinal: 0, plannedCount: 3, role: 'scored',
      state: 'closed', createdAtMs: at, closedAtMs: at + 60_000, revision: 1, startsRound: 0 }],
    'data/journal/shots.jsonl': [{ id: 'native-shot', endId: 'native-end', inputIndex: 0, points: 10, zoneCode: '10',
      automaticPoints: null, automaticRuleVersion: null, x: .04, y: .06, faceId: 'main', scoreSource: 'target_computed',
      positionSource: 'manual_target', positionStatus: 'known', physicalArrowNumber: null, createdAtMs: at, updatedAtMs: null,
      revision: 1, shaftDiameterMm: null }],
  };
  const sessions = nativeRows['data/journal/sessions.jsonl'];
  const blocks = nativeRows['data/journal/blocks.jsonl'];
  const ends = nativeRows['data/journal/ends.jsonl'];
  const shots = nativeRows['data/journal/shots.jsonl'];
  for (let index = 1; index < 120; index++) {
    const sessionId = `session-${index}`, blockId = `block-${index}`;
    const start = at - index * 86_400_000;
    sessions.push({ ...sessions[0], id: sessionId, title: `Android training ${index}`, createdAtMs: start,
      startedAtMs: start, completedAtMs: start + 60_000, localDate: new Date(start).toISOString().slice(0, 10) });
    blocks.push({ ...blocks[0], id: blockId, sessionId });
    for (let ordinal = 0; ordinal < 10; ordinal++) {
      const endId = `end-${index}-${ordinal}`;
      ends.push({ ...ends[0], id: endId, blockId, ordinal, createdAtMs: start, closedAtMs: start + 60_000 });
      for (let inputIndex = 0; inputIndex < 3; inputIndex++) {
        shots.push({ ...shots[0], id: `shot-${index}-${ordinal}-${inputIndex}`, endId, inputIndex, createdAtMs: start });
      }
    }
  }
  for (const [path, values] of Object.entries(nativeRows)) files[path] = new TextEncoder().encode(values.map(row => `${JSON.stringify(row)}\n`).join(''));
  files['data/preferences.json'] = encode({ format: 1, values: {} });
  const payloads = await Promise.all(Object.entries(files).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await archiveDigest(bytes) })));
  files['manifest.json'] = encode({ formatVersion: 14, journalSchema: 16, equipmentSchema: 1, preferencesFormat: 1,
    createdAtMs: Date.UTC(2026, 10, 11), appVersion: '0.30.2', rowCounts: Object.fromEntries(rows.map(path => [path, nativeRows[path]?.length ?? 0])), payloads });
  await page.addInitScript(original => {
    if (!localStorage.getItem('app.fableshot.practice-diary.v1')) localStorage.setItem('app.fableshot.practice-diary.v1', original);
  }, diary(1));
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
  const originalZip = Buffer.from(zipSync(files));
  await page.getByTestId('archive-file').setInputFiles({ name: 'native.zip', mimeType: 'application/zip', buffer: originalZip });
  await expect(page.getByTestId('native-archive-preview')).toContainText('формат 14');
  await expect(page.getByTestId('native-archive-preview').locator('div').filter({ has: page.getByText('Совместимые тренировки', { exact: true }) }).locator('dd')).toHaveText('120');
  await expect(page.getByTestId('archive-restore')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('app.fableshot.active-data.v1'))).toBeNull();
  await page.getByTestId('native-archive-activate').click();
  await page.getByTestId('archive-confirm-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  const totals = await page.evaluate(() => {
    const { records } = JSON.parse(localStorage.getItem('app.fableshot.active-data.v1')!);
    const { entries } = JSON.parse(records['app.fableshot.practice-diary.v1']);
    const series = entries.flatMap(entry => entry.practice.rounds.flatMap(round => round.series));
    const shots = series.flatMap(end => end.shots);
    return { entries: entries.length, series: series.length, arrows: shots.length,
      points: shots.reduce((total, shot) => total + shot.points, 0), firstPoint: shots[0].point,
      bowCategory: series[0].conditions.equipment.bow.category,
      numberedCount: series[0].conditions.equipment.arrows.numberedCount ?? null };
  });
  expect(totals).toEqual({ entries: 120, series: 1191, arrows: 3571, points: 35710, firstPoint: { x: .04, y: -.06 },
    bowCategory: 'barebow', numberedCount: null });
  await page.getByTestId('nav-history').click();
  await expect(page.getByText('Android training', { exact: true })).toBeVisible();
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
  await page.getByTestId('archive-recover').click();
  await page.getByTestId('archive-confirm-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId('session-archive-0')).toBeVisible();
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
  await page.getByTestId('archive-recover').click();
  await page.getByTestId('archive-confirm-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
  const originalDownload = page.waitForEvent('download');
  await page.getByTestId('native-archive-original').click();
  expect(await readFile((await (await originalDownload).path())!)).toEqual(originalZip);
  const backupDownload = page.waitForEvent('download');
  await page.getByTestId('archive-save').click();
  const backup = await readFile((await (await backupDownload).path())!);
  const clean = await browser.newContext();
  try {
    const restored = await clean.newPage();
    await restored.goto(new URL('./', page.url()).href);
    // A fresh browser profile can open settings after skipping onboarding.
    await restored.evaluate(() => {
      localStorage.setItem('app.fableshot.training-preferences.v1', JSON.stringify({ version: 1, preferences: {
        hideScores: false, averageHundredths: false, animations: true, haptics: false, keepAwake: true, onboardingSeen: true,
      } }));
    });
    await restored.reload();
    await restored.getByTestId('open-settings').click();
    await openSettingsCategory(restored, 'data', 'settings-archive');
    await restored.getByTestId('settings-archive').click();
    await restored.getByTestId('archive-file').setInputFiles({ name: 'restored.zip', mimeType: 'application/zip', buffer: backup });
    await restored.getByTestId('archive-restore').click();
    await restored.getByTestId('archive-confirm-apply').click();
    await expect(restored.getByTestId('home-screen')).toBeVisible();
    await restored.getByTestId('open-settings').click();
    await openSettingsCategory(restored, 'data', 'settings-archive');
    await restored.getByTestId('settings-archive').click();
    const transferred = restored.waitForEvent('download');
    await restored.getByTestId('native-archive-original').click();
    expect(await readFile((await (await transferred).path())!)).toEqual(originalZip);
  } finally { await clean.close(); }
});

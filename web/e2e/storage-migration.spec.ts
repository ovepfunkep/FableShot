import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ACTIVE_DATA_KEY, DATA_KEYS } from '../src/app-storage.ts';
import { advanceSeries, appendShot, completePractice, emptyPractice } from '../src/practice.ts';
import { createWebArchive } from '../src/web-archive.ts';
import { openSettingsCategory, openTraining } from './journal-navigation.ts';
import { readDiary, readStoredJournal } from './stored-journal.ts';

const startedAt = '2026-10-21T10:00:00Z';
const savedAt = '2026-10-21T11:00:00Z';
const hit = { code: '10', points: 10, point: { x: 0.04753, y: -0.03421 } } as const;

function recordsFor(count: number) {
  let practice = emptyPractice();
  for (let series = 0; series < 10; series++) {
    if (series > 0) practice = advanceSeries(practice);
    for (let arrow = 0; arrow < 6; arrow++) practice = appendShot(practice, hit);
  }
  practice = completePractice(practice, savedAt);
  const diary = { version: 1, entries: Array.from({ length: count }, (_, index) => ({
    id: 'import-' + index, startedAt, practice,
  })) };
  return Object.fromEntries(DATA_KEYS.map(key => [key, key === DATA_KEYS[0] ? JSON.stringify(diary) : null]));
}

async function openArchive(page: Page) {
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-archive');
  await page.getByTestId('settings-archive').click();
}

test('a journal larger than localStorage restores, records an arrow and survives restart', async ({ page }) => {
  const records = recordsFor(1_000);
  expect(records[DATA_KEYS[0]]!.length).toBeGreaterThan(5 * 1024 * 1024);
  const archive = await createWebArchive(records, 'storage-test');
  await page.goto('./');
  await openArchive(page);
  await page.getByTestId('archive-file').setInputFiles({ name: 'large.zip', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  const preview = page.getByTestId('archive-preview');
  await expect(preview).toContainText('1000');
  await expect(preview).toContainText('60000');
  await page.getByTestId('archive-restore').click();
  await page.getByTestId('archive-confirm-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 20_000 });

  await openTraining(page);
  await page.getByTestId('target').click();
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  await page.reload();
  await openTraining(page);
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  const persisted = await readDiary(page);
  expect(persisted.entries).toHaveLength(1_001);
  expect(persisted.entries[0].id).toBe('import-0');
  expect(persisted.entries[999].id).toBe('import-999');
  expect(persisted.entries[1000].practice.rounds[0].series[0].shots).toHaveLength(1);
});

test('an interrupted migration retries the restored snapshot before using legacy keys', async ({ page }) => {
  await page.addInitScript(({ key, base, restored, diaryKey }) => {
    localStorage.setItem(diaryKey, base);
    localStorage.setItem(key, JSON.stringify({ version: 1, epoch: 'restored', records: restored }));
    if (sessionStorage.getItem('interrupted')) return;
    const write = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, id) {
      if (this.name !== 'snapshots' || id !== 'active') return write.call(this, value, id);
      sessionStorage.setItem('interrupted', 'true');
      throw new Error('Проверочный сбой транзакции');
    };
  }, { key: ACTIVE_DATA_KEY, diaryKey: DATA_KEYS[0], base: recordsFor(1)[DATA_KEYS[0]], restored: recordsFor(2) });
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('Проверочный сбой');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  expect((await readDiary(page)).entries).toHaveLength(2);

  await openArchive(page);
  const replacement = await createWebArchive(recordsFor(3), 'storage-test');
  await page.getByTestId('archive-file').setInputFiles({ name: 'replace.zip', mimeType: 'application/zip', buffer: Buffer.from(replacement) });
  await expect(page.getByTestId('archive-preview')).toBeVisible();
  const before = await readStoredJournal(page);
  await page.evaluate(() => {
    const write = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, id) {
      if (this.name === 'snapshots' && id === 'recovery') throw new Error('Проверочный сбой отката');
      return write.call(this, value, id);
    };
  });
  await page.getByTestId('archive-restore').click();
  await page.getByTestId('archive-confirm-apply').click();
  await expect(page.getByTestId('archive-confirm').getByRole('alert')).toContainText('Проверочный сбой отката');
  expect(await readStoredJournal(page)).toEqual(before);
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  expect((await readDiary(page)).entries).toHaveLength(2);
});

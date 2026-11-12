import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { appendShot, advanceSeries, emptyPractice, completePractice } from '../src/practice.ts';
import { openHistoryEntry } from './journal-navigation.ts';

test('share opens a format chooser; PNG, CSV and A4 PDF export offline from the same diary', async ({ page, context }) => {
  let practice = emptyPractice();
  for (let series = 0; series < 12; series++) {
    for (let shot = 0; shot < 3; shot++) practice = appendShot(practice,
      { code: '9', points: 9, point: { x: .15, y: .02 } });
    if (series < 11) practice = advanceSeries(practice);
  }
  practice = completePractice(practice, '2026-11-11T10:00:00Z');
  const diary = JSON.stringify({ version: 1, entries: [{ id: 'exports', startedAt: '2026-11-11T09:00:00Z', practice }] });
  await page.addInitScript(diary => localStorage.setItem('app.fableshot.practice-diary.v1', diary), diary);
  await page.goto('./');
  await expect(page.getByTestId('offline-status')).toHaveText('Готово офлайн');
  await context.setOffline(true);
  await openHistoryEntry(page, 'exports');
  await page.getByTestId('report-share').click();
  await expect(page.getByRole('dialog', { name: 'Поделиться…' })).toBeVisible();
  await expect(page.getByTestId('report-export').locator('img')).toHaveCount(0);
  const imageDownload = page.waitForEvent('download');
  await page.getByTestId('report-export-png').click();
  const image = await imageDownload;
  await image.saveAs('../artifacts/web-0.14.0-poster.png');
  expect((await readFile((await image.path())!)).subarray(1, 4).toString()).toBe('PNG');
  await expect(page.getByTestId('report-export').locator('img')).toHaveCount(1);
  await expect(page.getByTestId('report-export').getByText('Готовлю отчёт…')).toHaveCount(0);
  const csvDownload = page.waitForEvent('download');
  await page.getByTestId('report-export-csv').click();
  const csv = await readFile((await (await csvDownload).path())!, 'utf8');
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(37);
  const pdfDownload = page.waitForEvent('download');
  await page.getByTestId('report-export-pdf').click();
  const pdfFile = await pdfDownload;
  await pdfFile.saveAs('../artifacts/web-0.14.0-report.pdf');
  const pdf = await PDFDocument.load(await readFile((await pdfFile.path())!));
  expect(pdf.getTitle()).toBe('FableShot — тренировка');
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
  for (const page of pdf.getPages()) expect(page.getSize()).toEqual({ width: 595, height: 842 });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!));
  expect(after.entries).toEqual(JSON.parse(diary).entries);
  expect(after.version).toBe(1);
  expect(after.achievementLedger.grants.map((grant: { id: string; sessionId: string }) => ({ id: grant.id, sessionId: grant.sessionId })))
    .toEqual([{ id: 'APP04', sessionId: 'exports' }]);
});

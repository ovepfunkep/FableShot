import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { appendShot, advanceSeries, emptyPractice, completePractice } from '../src/practice.ts';
import { openHistoryEntry } from './journal-navigation.ts';

test('PNG and paged PDF preview offline without downloading, remain cached and share only on request', async ({ page, context }) => {
  let practice = emptyPractice();
  for (let series = 0; series < 12; series++) {
    for (let shot = 0; shot < 3; shot++) practice = appendShot(practice,
      { code: '9', points: 9, point: { x: .15, y: .02 } });
    if (series < 11) practice = advanceSeries(practice);
  }
  practice = completePractice(practice, '2026-11-11T10:00:00Z');
  const diary = JSON.stringify({ version: 1, entries: [{ id: 'exports', startedAt: '2026-11-11T09:00:00Z', practice }] });
  await page.addInitScript(diary => localStorage.setItem('app.fableshot.practice-diary.v1', diary), diary);
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false }));
  const downloads: string[] = [];
  page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.goto('./');
  await expect(page.getByTestId('offline-status')).toHaveText('Готово офлайн');
  await context.setOffline(true);
  await openHistoryEntry(page, 'exports');
  await page.getByTestId('report-share').click();
  const sheet = page.getByTestId('report-export');
  await expect(sheet.locator('img')).toHaveCount(1);
  await expect(page.getByTestId('report-export-share')).toBeEnabled();
  expect(downloads).toEqual([]);
  const poster = await sheet.locator('img').getAttribute('src');
  await sheet.screenshot({ path: '../artifacts/web-0.26.0-png-preview.png' });
  const imageDownload = page.waitForEvent('download');
  await page.getByTestId('report-export-share').click();
  const image = await imageDownload;
  await image.saveAs('../artifacts/web-0.26.0-poster.png');
  expect((await readFile((await image.path())!)).subarray(1, 4).toString()).toBe('PNG');

  await page.getByTestId('report-export-pdf').click();
  await expect(page.getByTestId('report-pdf-page')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('report-pdf-page').screenshot({ path: '../artifacts/web-0.26.1-pdf-first.png' });
  expect(downloads).toHaveLength(1);
  await expect(page.getByTestId('report-export-pdf')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Следующая страница PDF' }).click();
  await expect(page.getByTestId('report-pdf-page')).toHaveAttribute('aria-label', 'Страница PDF 2');
  await expect(page.getByTestId('report-pdf-page')).toBeVisible();
  await page.getByTestId('report-pdf-page').screenshot({ path: '../artifacts/web-0.26.1-pdf-page-2.png' });
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.getByTestId('report-share').click();
  await expect(page.getByTestId('report-export-pdf')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('report-pdf-page')).toHaveAttribute('aria-label', 'Страница PDF 2');
  const pdfDownload = page.waitForEvent('download');
  await page.getByTestId('report-export-share').click();
  const pdfFile = await pdfDownload;
  await pdfFile.saveAs('../artifacts/web-0.26.1-report.pdf');
  const pdf = await PDFDocument.load(await readFile((await pdfFile.path())!));
  expect(pdf.getTitle()).toBe('FableShot — тренировка');
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
  for (const page of pdf.getPages()) expect(page.getSize()).toEqual({ width: 595, height: 842 });
  await page.getByTestId('report-export-png').click();
  await expect(sheet.locator('img')).toHaveAttribute('src', poster!);
  expect(downloads).toHaveLength(2);
  await page.getByText('Экспорт данных', { exact: true }).click();
  const csvDownload = page.waitForEvent('download');
  await page.getByTestId('report-export-csv').click();
  const csv = await readFile((await (await csvDownload).path())!, 'utf8');
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(37);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!));
  expect(after.entries).toEqual(JSON.parse(diary).entries);
  expect(after.achievementLedger.grants.filter((grant: { id: string }) => grant.id === 'APP04')).toHaveLength(1);
  await page.keyboard.press('Escape');
  await page.locator('[data-testid^="report-end-"]').first().click();
  await page.getByTestId('shot-1').click();
  await page.getByTestId('target').click();
  await page.getByTestId('next-end').click();
  await expect(page.getByTestId('shot-1')).toHaveAttribute('aria-label', /10/);
  await page.getByTestId('shot-1').click();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await expect(page.getByTestId('history-shot-editor')).toHaveCount(0);
  await page.getByTestId('report-share').click();
  await expect(sheet.locator('img')).toHaveCount(1);
  await expect(sheet.locator('img')).not.toHaveAttribute('src', poster!);
});

test('Web Share cancellation leaves the cached report available', async ({ page }) => {
  const practice = completePractice(appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } }), '2026-11-11T10:00:00Z');
  await page.addInitScript(practice => {
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries: [{ id: 'share', startedAt: '2026-11-11T09:00:00Z', practice }] }));
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', { value: () => Promise.reject(new DOMException('Отмена', 'AbortError')) });
  }, practice);
  await page.goto('./');
  await openHistoryEntry(page, 'share');
  await page.getByTestId('report-share').click();
  await expect(page.getByTestId('report-export-share')).toBeEnabled();
  await page.getByTestId('report-export-share').click();
  await expect(page.getByTestId('report-export-share')).toBeEnabled();
  await expect(page.getByTestId('report-export').getByRole('alert')).toHaveCount(0);
});

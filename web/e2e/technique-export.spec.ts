import { openTraining, openHistoryEntry } from './journal-navigation.ts';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createTechnique, newTechniqueText, publishTechnique, TECHNIQUE_STORAGE_KEY } from '../src/technique.ts';
import { appendShot, bindTechnique, completePractice, emptyPractice } from '../src/practice.ts';

async function seedMemo(page: Page, completed: boolean) {
  const text = newTechniqueText();
  text.title = 'Проверка памятки';
  const created = createTechnique({ version: 1, documents: [] }, text);
  const { library, version } = publishTechnique(created.library, created.documentId, text);
  const initial = appendShot(emptyPractice(), { point: { x: 0, y: 0 }, points: 10, code: '10' });
  const attached = bindTechnique(initial, {
    versionId: version.id, versionNumber: version.number, title: text.title, payload: version.payload,
    focus1: 'Проверить стойку', focus2: '',
  });
  const practice = completed ? completePractice(attached, '2026-11-11T10:00:00Z') : attached;
  await page.addInitScript(({ key, library, practice }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(library));
    const diary = 'app.fableshot.practice-pilot.v3';
    if (localStorage.getItem(diary) === null) localStorage.setItem(diary, JSON.stringify(practice));
  }, { key: TECHNIQUE_STORAGE_KEY, library, practice });
}

test('the installed web cache can export a real PDF offline without changing the memo', async ({ page, context }) => {
  await seedMemo(page, false);
  await page.goto('./');
  await openTraining(page);
  await expect(page.getByTestId('offline-status')).toHaveText('Готово офлайн');
  const before = await page.evaluate(key => localStorage.getItem(key), TECHNIQUE_STORAGE_KEY);
  await context.setOffline(true);
  await page.getByTestId('training-technique-open').click();
  await page.getByRole('button', { name: 'Экспорт памятки' }).click();
  const download = page.waitForEvent('download');
  await page.getByTestId('technique-export-pdf').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Проверка памятки.pdf');
  const document = await PDFDocument.load(await readFile((await file.path())!));
  expect(document.getTitle()).toBe('Проверка памятки');
  expect(document.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
  expect(await page.evaluate(key => localStorage.getItem(key), TECHNIQUE_STORAGE_KEY)).toBe(before);
});

test('reflection survives reload and hiding its editor does not remove the saved entry', async ({ page }) => {
  await seedMemo(page, true);
  await page.goto('./');
  await openHistoryEntry(page, 'pilot');
  await page.getByTestId('report-technique').click();
  await page.getByTestId('reflection-edit-0').click();
  await page.getByTestId('reflection-worked').fill('Повторялась стойка');
  await page.getByTestId('reflection-rating-yes').click();
  await page.getByTestId('reflection-save').click();
  await expect(page.getByTestId('report-technique-use-0')).toContainText('Повторялась стойка');
  await page.reload();
  await openHistoryEntry(page, 'pilot');
  await page.getByTestId('report-technique').click();
  await expect(page.getByTestId('report-technique-use-0')).toContainText('Получалось');
  await page.locator('.reflection-memo').click();
  await page.getByTestId('technique-back').click();
  await page.getByTestId('setting-technique-reflection').uncheck();
  await page.getByTestId('technique-back').click();
  await expect(page.getByTestId('reflection-edit-0')).toHaveCount(0);
  await expect(page.getByTestId('report-technique-use-0')).toContainText('Повторялась стойка');
});

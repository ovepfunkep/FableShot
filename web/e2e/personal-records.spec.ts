import { expect, test } from '@playwright/test';
import { appendShot, completePractice, emptyPractice } from '../src/practice.ts';
import { openHistoryEntry, openTraining } from './journal-navigation.ts';

test('first completion freezes record comparisons and continuing the session does not award twice', async ({ page }) => {
  let practice = emptyPractice();
  for (let index = 0; index < 3; index++) {
    practice = appendShot(practice, { code: '9', points: 9, point: { x: .15, y: 0 } });
  }
  const entry = { id: 'old-record', title: 'Прежний результат', startedAt: '2026-09-01T09:00:00Z',
    practice: completePractice(practice, '2026-09-01T10:00:00Z') };
  await page.addInitScript(entry => {
    const key = 'app.fableshot.practice-diary.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, entries: [entry] }));
  }, entry);
  await page.goto('./');
  await openTraining(page);
  for (let index = 0; index < 3; index++) await page.getByTestId('target').click();
  await page.getByTestId('next-end').click();
  await page.getByRole('button', { name: 'Отметить промах', exact: true }).click();
  async function finish() {
    await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
    await page.getByTestId('training-confirm').click();
  }
  await finish();
  const records = page.getByTestId('personal-record-report');
  await expect(records).toContainText('Было 27 → Стало 30');
  await expect(records).toContainText('Было 3 → Стало 4');
  await records.screenshot({ path: '../artifacts/web-0.22.0-record-card.png' });
  const banner = page.getByTestId('personal-record-banner');
  await expect(banner).toBeVisible({ timeout: 9000 });
  await expect(banner.getByTestId('record-banner-values')).toContainText('30');
  await page.getByTestId('record-banner-dismiss').click();
  await expect(banner.getByTestId('record-banner-values')).toContainText('4');
  await page.getByTestId('record-banner-dismiss').click();
  await records.getByRole('button').first().click();
  await page.getByTestId('personal-record-previous-session').click();
  await expect(page.getByText('Прежний результат', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(records).toBeVisible();
  await page.getByTestId('session-resume').click();
  await page.getByTestId('session-resume-confirm').click();
  await page.getByRole('button', { name: 'Отметить промах', exact: true }).click();
  await finish();
  await expect(records.getByRole('button')).toHaveCount(2);
  await expect(records).toContainText('Было 3 → Стало 4');
  await page.reload();
  await openHistoryEntry(page);
  await expect(records).toContainText('Было 27 → Стало 30');
  await expect(banner).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { applyConditions, emptyPractice } from '../src/practice.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import { openTraining } from './journal-navigation.ts';

test('rank category is saved, series and round forecasts differ, and the grid opens offline', async ({ page, context }) => {
  const practice = applyConditions(emptyPractice(), { ...DEFAULT_CONDITIONS, equipment: {
    id: 'kit', name: 'Мой комплект', bow: { name: 'Баребоу', category: 'barebow' },
    arrows: { name: 'Стрелы', diameterMm: null },
  } });
  await page.addInitScript(value => localStorage.setItem('app.fableshot.practice-pilot.v3', JSON.stringify(value)), practice);
  await page.goto('./');
  await expect(page.getByTestId('offline-status')).toHaveText('Готово офлайн');
  await context.setOffline(true);
  await openTraining(page);
  await page.getByTestId('rank-round').click();
  await page.getByRole('button', { name: 'Мужчины', exact: true }).click();
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await page.getByTestId('target').click();
  await expect(page.getByTestId('rank-round')).toContainText('МСМК');
  await expect(page.getByTestId('rank-round')).not.toContainText('Темп');
  await expect(page.getByTestId('rank-round').locator('.rank-medal')).toBeVisible();
  await expect(page.getByTestId('rank-series')).toContainText('МСМК');
  await page.getByTestId('next-end').click();
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await expect(page.getByTestId('rank-round')).toContainText('II');
  await expect(page.getByTestId('rank-series')).toContainText('ниже порога');
  await page.getByTestId('rank-series').click();
  await page.getByTestId('rank-open-reference').click();
  await expect(page.getByTestId('rank-reference')).toBeVisible();
  await page.reload();
  await openTraining(page);
  await expect(page.getByTestId('rank-round')).toContainText('II');
});

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
  await page.getByRole('button', { name: 'Указать пол в профиле' }).click();
  const profile = page.getByTestId('profile-screen');
  await expect(profile.getByRole('group', { name: 'Пол для нормативов' })).toBeInViewport();
  await profile.getByRole('button', { name: 'Пол для нормативов' }).click();
  await page.getByRole('dialog', { name: 'Пол для нормативов' }).getByRole('button', { name: 'Мужской', exact: true }).click();
  await profile.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('rank-details')).toBeVisible();
  await page.getByTestId('rank-category-female').click();
  await expect(page.getByTestId('rank-details').getByText('Предпросмотр · Женщины')).toBeVisible();
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await page.getByTestId('target').click();
  await expect(page.getByTestId('rank-round')).toContainText('МСМК');
  await expect(page.getByTestId('rank-round')).not.toContainText('Темп');
  await expect(page.getByTestId('rank-round').locator('.rank-medal')).toBeVisible();
  await expect(page.getByTestId('rank-series')).toContainText('МСМК');
  await page.getByTestId('next-end').click();
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await expect(page.getByTestId('rank-round')).toContainText('II');
  await expect(page.getByTestId('rank-series').locator('strong')).toHaveText('—');
  await expect(page.getByTestId('rank-series')).toHaveAccessibleName(/ниже порога/);
  await page.getByTestId('rank-series').click();
  await page.getByTestId('rank-open-reference').click();
  await expect(page.getByTestId('rank-reference')).toBeVisible();
  await page.reload();
  await openTraining(page);
  await expect(page.getByTestId('rank-round')).toContainText('II');
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  const trend = page.getByTestId('training-mean-trend');
  await trend.getByRole('button', { name: 'Показатель по сериям' }).click();
  await page.getByRole('dialog', { name: 'Показатель по сериям' }).locator('[data-choice-value="rank"]').click();
  await expect(trend.getByTestId('training-mean-value')).toHaveText('—');
  await expect(trend.locator('.training-mean-line')).toHaveAttribute('d', /M\s.+\sL\s/);
});

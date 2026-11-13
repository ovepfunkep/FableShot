import { openTraining } from './journal-navigation.ts';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function openConditions(page: Page) {
  await page.getByRole('button', { name: 'Условия тренировки', exact: true }).click();
  await expect(page.getByTestId('journal-setup')).toBeVisible();
}

async function selectTarget(page: Page, profileId: string) {
  await page.getByTestId('target-profile-choice').click();
  await page.getByTestId(`target-profile-${profileId}`).click();
}

async function hit(page: Page, radiusFraction = 0) {
  const bounds = await page.getByTestId('target').boundingBox();
  if (!bounds) throw new Error('Target unavailable');
  const radius = Math.min(bounds.width, bounds.height) * .44;
  await page.touchscreen.tap(bounds.x + bounds.width / 2 + radius * radiusFraction, bounds.y + bounds.height / 2);
}

test('traffic-light target records and displays hits on all three spots', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('home-change-conditions').click();
  await selectTarget(page, 'wa-indoor-triple-outer-v1');
  await page.getByTestId('start-training').click();
  const target = page.getByTestId('target');
  await expect(target).toHaveAttribute('data-target-profile', 'wa-indoor-triple-outer-v1');
  const box = (await target.boundingBox())!;
  const radius = Math.min(box.width / 1.32, box.height / 3.8);
  for (const offset of [-1.2, 0, 1.2]) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2 + radius * offset);
  }
  await expect(page.getByTestId('series-score')).toHaveText('30/30');
  await page.reload();
  await openTraining(page);
  await expect(page.getByTestId('series-score')).toHaveText('30/30');
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await page.getByTestId('hit-map-mode-points').click();
  const hits = page.getByTestId('hit-map-plot').locator(':scope > circle[fill="#111811"]');
  const coordinates = await hits.evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('cy'))));
  expect(coordinates).toHaveLength(3);
  expect(coordinates[0]).toBeLessThan(coordinates[1]);
  expect(coordinates[1]).toBeLessThan(coordinates[2]);
});

test('new training remembers the last applied setup even if its empty series was trimmed', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('home-change-conditions').click();
  await page.getByTestId('distance-30').click();
  await page.getByTestId('conditions-options').click();
  await expect(page.getByTestId('setting-hide-scores')).toBeHidden();
  await page.getByTestId('round-arrows-60').click();
  await page.getByTestId('conditions-options-done').click();
  await page.getByTestId('start-training').click();
  await hit(page);
  await openConditions(page);
  await page.getByTestId('distance-10').click();
  await page.getByTestId('start-training').click();
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
  await page.getByTestId('training-confirm').click();
  await page.reload();

  await expect(page.getByTestId('home-conditions-grid')).toContainText('10 м');
  await page.getByTestId('home-change-conditions').click();
  await expect(page.getByTestId('distance-field')).toHaveValue('10');
  await page.getByTestId('conditions-options').click();
  await expect(page.getByTestId('round-arrows-field')).toHaveValue('60');
});

test('target changes open a new series with new conditions while earlier hits keep their target', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await hit(page, .08);
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  await openConditions(page);
  await selectTarget(page, 'wa-indoor-inner-v1');
  await page.getByTestId('distance-30').click();
  await page.getByTestId('start-training').click();
  await expect(page.getByTestId('target')).toHaveAttribute('data-target-profile', 'wa-indoor-inner-v1');
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  await hit(page, .08);
  await expect(page.getByTestId('series-score')).toHaveText('9/10');
  await page.getByRole('button', { name: 'Предыдущая серия' }).click();
  await expect(page.getByTestId('target')).toHaveAttribute('data-target-profile', 'wa-indoor-outer-v1');
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await page.getByTestId('report-menu-open').click();
  await page.getByTestId('report-conditions-open').click();
  await expect(page.getByTestId('report-conditions').getByLabel('Дистанция: 18 м')).toBeVisible();
  await expect(page.getByTestId('report-conditions').getByLabel('Дистанция: 30 м')).toBeVisible();
  await page.reload();
  await openTraining(page);
  await expect(page.getByTestId('target')).toHaveAttribute('data-target-profile', 'wa-indoor-inner-v1');
  await expect(page.getByTestId('round-score')).toHaveText('19/20');
});

test('round options support series boundaries and saved presets with a pinned start button', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('./');
  await openTraining(page);
  await openConditions(page);
  await expect(page.getByTestId('start-training')).toBeInViewport({ ratio: 1 });
  await selectTarget(page, 'wa-outdoor-full-v1');
  await expect(page.getByTestId('diameter-field')).toHaveValue('80');
  await page.getByTestId('conditions-options').click();
  await page.getByTestId('volume-fixed').click();
  await page.getByTestId('round-series-field').fill('1');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Сохранить условия в избранное' }).click();
  await page.getByRole('textbox', { name: 'Название набора' }).fill('Открытый рубеж');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByTestId('training-presets').click();
  await page.getByRole('button', { name: /^Открытый рубеж/ }).click();
  await page.getByTestId('start-training').click();
  await expect(page.getByTestId('training-series-open')).toContainText('Серия 1/1');
  await hit(page);
  await expect(page.getByTestId('shot-1')).toHaveText('1X');
  await expect(page.getByTestId('next-end')).toHaveText('Следующий раунд');
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await expect(page.getByTestId('series-score')).toHaveText('10/20');
  await page.getByTestId('next-end').click();
  await expect(page.getByTestId('training-rounds-open')).toContainText('Раунд 2');
  await openConditions(page);
  await expect(page.getByTestId('conditions-options')).toContainText('Раунд');
  await expect(page.getByRole('button', { name: /^Раунд/ })).toHaveCount(0);
  await page.getByTestId('training-presets').click();
  await expect(page.getByRole('button', { name: /^Открытый рубеж/ })).toBeVisible();
});

test('a kit can be created with bow and shaft diameter and is reused after reopening conditions', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await openConditions(page);
  await selectTarget(page, 'wa-indoor-inner-v1');
  await page.getByTestId('conditions-equipment').click();
  await page.getByTestId('equipment-add-choice').click();
  await page.getByTestId('equipment-name').fill('Основной');
  await page.getByRole('button', { name: 'Добавить лук', exact: true }).click();
  await page.getByTestId('equipment-name').fill('Отменить');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByTestId('equipment-name')).toHaveValue('Основной');
  await page.getByRole('button', { name: 'Добавить лук', exact: true }).click();
  await page.getByTestId('equipment-name').fill('Баребоу');
  await page.getByTestId('bow-category-barebow').click();
  await page.getByTestId('equipment-component-save').click();
  await page.getByRole('button', { name: 'Добавить стрелы', exact: true }).click();
  await page.getByTestId('equipment-name').fill('Десяточки');
  await page.getByTestId('equipment-field-diameterMm').fill('10');
  await page.getByTestId('equipment-component-save').click();
  await page.getByTestId('equipment-save').click();
  await expect(page.getByTestId('conditions-equipment')).toContainText('Основной');
  await page.getByTestId('start-training').click();
  await hit(page, .07);
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  await openConditions(page);
  await expect(page.getByTestId('conditions-equipment')).toContainText('Основной');
  await page.getByRole('button', { name: 'Изменить выбранный комплект', exact: true }).click();
  await expect(page.getByTestId('equipment-name')).toHaveValue('Основной');
  await page.getByRole('button', { name: 'Изменить стрелы', exact: true }).click();
  await page.getByTestId('equipment-field-diameterMm').fill('6');
  await page.getByTestId('equipment-component-save').click();
  await page.getByTestId('equipment-save').click();
  await page.getByTestId('start-training').click();
  await hit(page, .07);
  await expect(page.getByTestId('series-score')).toHaveText('9/10');
  await page.getByRole('button', { name: 'Предыдущая серия' }).click();
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
});

test('an unlimited round keeps accepting hits after the classic boundary', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await openConditions(page);
  await page.getByTestId('conditions-options').click();
  await page.getByTestId('volume-free').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('start-training').click();
  for (let index = 0; index < 31; index++) await page.getByRole('button', { name: 'Отметить промах' }).click();
  await expect(page.getByTestId('round-score')).toHaveText('0/310');
  await expect(page.getByTestId('next-end')).toHaveText('Следующая серия');
});

test('Back closes the target selector first and discards an unapplied conditions draft', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await openConditions(page);
  await page.getByTestId('distance-field').fill('30');
  await page.getByTestId('target-profile-choice').click();
  await page.goBack();
  await expect(page.getByTestId('target-profile-sheet')).toHaveCount(0);
  await expect(page.getByTestId('journal-setup')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await openConditions(page);
  await expect(page.getByTestId('distance-field')).toHaveValue('18');
});

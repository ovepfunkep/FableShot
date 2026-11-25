import { openTraining } from './journal-navigation.ts';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Условия тренировки', exact: true }).click();
  await expect(page.getByTestId('conditions-technique')).toBeHidden();
  await page.getByTestId('conditions-advanced').click();
  await expect(page.getByTestId('conditions-technique')).toBeVisible();
}
async function closeSettings(page: Page) {
  await page.getByTestId('start-training').click();
}
async function hit(page: Page) {
  const box = await page.getByTestId('target').boundingBox();
  if (!box) throw new Error('Target unavailable');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test('hiding results removes scores and labels but preserves shots, editing and the report', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await hit(page);
  await openSettings(page);
  await page.getByTestId('setting-hide-scores').click();
  await closeSettings(page);
  await expect(page.getByTestId('series-score')).toHaveCount(0);
  await expect(page.locator('.tile-average')).toHaveCount(0);
  await expect(page.getByTestId('shot-1')).toHaveAccessibleName('Стрела 1: отмечена');
  await page.getByTestId('shot-1').click();
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await page.getByTestId('next-end').click();
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await expect(page.getByTestId('report-round-total-1')).toHaveText('Раунд 1 · 0/10 · 0,0');
  await page.reload();
  await openTraining(page);
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await expect(page.getByTestId('series-score')).toHaveCount(0);
});

test('average precision and disabled animation apply to training, selectors and report after reload', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await hit(page);
  await openSettings(page);
  await page.getByTestId('setting-average-hundredths').click();
  await page.getByTestId('setting-animations').click();
  await closeSettings(page);
  await expect(page.locator('.tile-average').first()).toHaveText('Ср. 10,00');
  await hit(page);
  const score = page.getByTestId('series-score');
  await expect(score).toHaveText('20/20');
  expect(await score.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  await page.reload();
  await openTraining(page);
  await page.getByTestId('training-series-open').click();
  await expect(page.getByTestId('training-series-result-1').locator('.report-series-score')).toHaveText('20/20');
  await expect(page.getByTestId('training-series-result-1').locator('.report-series-average')).toHaveText('10,00');
  await page.getByTestId('training-select-series-1').click();
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await expect(page.getByTestId('report-round-total-1')).toHaveText('Раунд 1 · 20/20 · 10,00');
});

test('screen lock follows training visibility and the keep-awake preference', async ({ page }) => {
  await page.addInitScript(() => {
    const counters = { requested: 0, released: 0 };
    Object.assign(window, { screenLocks: counters });
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => {
      counters.requested++;
      return { release: async () => { counters.released++; }, addEventListener() {} };
    } } });
  });
  await page.goto('./');
  await openTraining(page);
  await expect.poll(() => page.evaluate(() => (window as any).screenLocks.requested)).toBeGreaterThan(0);
  await openSettings(page);
  await page.getByTestId('setting-keep-awake').click();
  const requested = await page.evaluate(() => (window as any).screenLocks.requested);
  await closeSettings(page);
  expect(await page.evaluate(() => (window as any).screenLocks.requested)).toBe(requested);
  expect(await page.evaluate(() => (window as any).screenLocks.released)).toBeGreaterThan(0);
});

test('memo drafts, numbered subpoints and immutable training snapshot survive reopening', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await hit(page);
  await page.getByTestId('training-technique-open').click();
  await page.getByTestId('technique-create').click();
  await page.getByTestId('technique-title').fill('Спокойный выстрел');
  await page.getByTestId('technique-add-step-0').click();
  await page.getByTestId('technique-step-short').fill('Плечи расслаблены');
  await page.getByRole('button', { name: 'Добавить подпункт' }).click();
  const first = page.getByRole('textbox', { name: 'Подпункт 1.1.1', exact: true });
  await expect(first).toBeFocused();
  await first.fill('Проверить стойку\nВыдохнуть');
  await expect(page.getByRole('textbox', { name: 'Подпункт 1.1.2', exact: true })).toBeFocused();
  await page.getByTestId('technique-step-done').click();
  await page.getByTestId('technique-back').click();
  await page.locator('[data-testid^="technique-draft-"]').click();
  await expect(page.getByTestId('technique-title')).toHaveValue('Спокойный выстрел');
  await page.getByTestId('technique-publish').click();
  await page.locator('[data-testid^="technique-read-"]').click();
  await expect(page.getByTestId('technique-reader')).toContainText('1.1.1 Проверить стойку');
  await page.getByRole('button', { name: 'Фокус: выбрать', exact: true }).click();
  await page.getByTestId('technique-apply').click();
  await expect(page.getByTestId('series-score')).toHaveText('10/10');
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await expect(page.getByTestId('report-technique-focus')).toContainText('Плечи расслаблены');
  await page.reload();
  await openTraining(page);
  await page.getByRole('button', { name: 'Статистика', exact: true }).click();
  await page.getByTestId('report-technique-focus').click();
  await expect(page.getByTestId('technique-reader')).toContainText('Спокойный выстрел');
  await expect(page.getByTestId('technique-reader')).toContainText('1.1.2 Выдохнуть');
  await page.getByTestId('technique-back').click();
  await page.getByTestId('technique-back').click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
  await page.getByTestId('training-confirm').click();
  await page.getByTestId('report-technique').click();
  await page.locator('.reflection-memo').click();
  await expect(page.getByTestId('technique-reader')).toContainText('Спокойный выстрел');
  await expect(page.getByTestId('technique-apply')).toHaveCount(0);
});

test('legacy memo lines remain editable, reorderable and repeatable', async ({ page }) => {
  await page.goto('./');
  await openTraining(page);
  await page.getByTestId('training-technique-open').click();
  await page.getByText('Импорт', { exact: true }).click();
  await page.getByRole('button', { name: 'Вставить текст', exact: true }).click();
  await page.getByTestId('technique-paste-text').fill(JSON.stringify({ schema: 1, title: 'Разминка', context: '', description: '',
    phases: [{ id: 'phase-1', title: 'Подготовка', steps: [{ id: 'step-1', short: 'Проверка', detail: 'Стойка\r\nДыхание',
      children: '\nСтойка', visible: true, question: 'Проверить с тренером' }] }], discussed: null, change: '' }));
  await page.getByTestId('technique-paste-apply').click();
  const step = page.getByTestId('technique-step-0-0');
  await expect(step).toContainText('1.1.3 Стойка');
  await step.click();
  const field = (index: number) => page.getByRole('textbox', { name: `Подпункт 1.1.${index}`, exact: true });
  await expect(field(2)).toHaveValue('Дыхание');
  await page.getByRole('button', { name: 'Порядок подпункта 1.1.2' }).click();
  await page.getByRole('button', { name: 'Выше', exact: true }).click();
  await expect(field(1)).toHaveValue('Дыхание');
  await page.getByRole('button', { name: 'Удалить подпункт 1.1.2' }).click();
  await expect(field(3)).toHaveCount(0);
  await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
  await expect(field(3)).toHaveValue('Стойка');
  await page.getByTestId('technique-step-done').click();
  await page.getByTestId('technique-publish').click();
  await page.locator('[data-testid^="technique-read-"]').click();
  const reader = page.getByTestId('technique-reader');
  await expect(reader).toContainText('1.1.1 Дыхание');
  await expect(reader).toContainText('1.1.2 Стойка');
  await expect(reader).toContainText('1.1.3 Стойка');
  await expect(reader).toContainText('Проверить с тренером');
});

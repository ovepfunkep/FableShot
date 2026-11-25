import { expect, test } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { appendShot, completePractice, emptyPractice } from '../src/practice.ts';
import { openTraining } from './journal-navigation.ts';
import { readDiary } from './stored-journal.ts';

test('triple target follows the chosen order after numbered shots and restarts it on a new round', async ({ page }) => {
  const practice = emptyPractice();
  practice.roundRule = { unit: 'arrows', limit: 2 };
  practice.numberedArrows = true;
  Object.assign(practice.rounds[0].series[0].conditions, {
    targetProfileId: 'wa-indoor-triple-x-v1',
    equipment: { id: 'kit', name: 'Комплект', bow: { name: 'Лук', category: 'barebow' },
      arrows: { id: 'numbered', name: 'Стрелы', diameterMm: 6, numberedCount: 3 } },
  });
  await page.addInitScript(({ practice, preferences }) => {
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries: [{ id: 'triple', startedAt: '2026-11-25T00:00:00Z', practice }] }));
    localStorage.setItem('app.fableshot.training-preferences.v1', JSON.stringify({ version: 1, preferences }));
  }, { practice, preferences: { ...DEFAULT_PREFERENCES, onboardingSeen: true, tripleAutoAdvance: true, tripleOrder: [2, 0, 1] } });
  await page.goto('./');
  await openTraining(page);
  const target = page.getByTestId('target');
  await expect(target).toHaveAttribute('data-focused-spot', '2');
  await expect(page.getByRole('button', { name: 'Мишень ниже' })).toBeDisabled();
  const help = page.getByRole('button', { name: 'Гайд по мишени' });
  await expect(help).toHaveText('Гайд');
  await help.click();
  const guide = page.getByTestId('target-guide');
  await expect(guide).toContainText('Переключай пятна');
  await guide.getByRole('button', { name: 'Дальше' }).click();
  await expect.poll(() => guide.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await guide.getByRole('button', { name: 'Готово' }).click();
  await expect(help).toHaveText('');
  await expect(target).toHaveAttribute('data-focused-spot', '2');

  await target.tap();
  await expect(page.getByTestId('physical-arrow-picker')).toBeVisible();
  await expect(target).toHaveAttribute('data-focused-spot', '2');
  await page.getByTestId('physical-arrow-quick-1').click();
  await expect(target).toHaveAttribute('data-focused-spot', '0');
  await page.getByRole('button', { name: 'Отметить промах' }).click();
  await page.getByTestId('physical-arrow-quick-2').click();
  await expect(target).toHaveAttribute('data-focused-spot', '1');
  const [shot, miss] = (await readDiary(page)).entries[0].practice.rounds[0].series[0].shots;
  expect(shot.spot).toBe(2);
  expect(miss.point).toBeNull();
  await page.getByTestId('next-end').click();
  await expect(page.getByTestId('training-rounds-open')).toHaveAttribute('data-new-round', 'true');
  await expect(target).toHaveAttribute('data-focused-spot', '2');
});

test('new training suggests repeated titles and saves the chosen title', async ({ page }) => {
  const practice = completePractice(appendShot(emptyPractice(), { code: 'M', points: 0, point: null }), '2026-11-24T11:00:00Z');
  const history = ['Тихий выстрел', 'тихий   выстрел', 'Контроль', 'Тренировка'].map((title, index) => ({
    id: `old-${index}`, title, startedAt: `2026-11-${24 - index}T10:00:00Z`, practice,
  }));
  await page.addInitScript(entries => localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries })), history);
  await page.goto('./');
  await page.getByTestId('home-change-conditions').click();
  const suggestions = page.getByRole('group', { name: 'Частые названия' });
  await expect(suggestions.getByRole('button')).toHaveText(['Тихий выстрел', 'Контроль']);
  await suggestions.getByRole('button', { name: 'Тихий выстрел' }).click();
  await expect(page.getByRole('textbox', { name: 'Название тренировки' })).toHaveValue('Тихий выстрел');
  await page.getByTestId('start-training').click();
  await expect(page.getByTestId('target')).toBeVisible();
  const created = (await readDiary(page)).entries.find(entry => entry.practice.savedAt === null);
  expect(created?.title).toBe('Тихий выстрел');
});

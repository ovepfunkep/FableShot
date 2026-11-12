import { expect, test } from '@playwright/test';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import type { DiaryEntry } from '../src/persistence.ts';
import { advanceSeries, appendShot, applyConditions, completePractice, emptyPractice } from '../src/practice.ts';

test('personal records filter by conditions and open the series and volume sources', async ({ page }) => {
  const bow = { id: 'bow', name: 'Учебный лук', category: 'recurve' };
  const kit = { id: 'club', name: 'Клубный', bowId: bow.id, arrowsId: null };
  const conditions = { ...DEFAULT_CONDITIONS, equipment: { ...kit, bow, arrows: { name: '', diameterMm: null } } };
  function training(id: string, title: string, day: number, distanceMeters: number, ends: number, points: number): DiaryEntry {
    const startedAt = `2026-10-0${day}T10:00:00Z`;
    let practice = applyConditions(emptyPractice(), { ...conditions, distanceMeters });
    for (let end = 0; end < ends; end++) {
      for (let shot = 0; shot < 3; shot++) practice = appendShot(practice,
        { points, code: String(points), point: { x: points === 10 ? 0 : .15, y: 0 } });
      if (end < ends - 1) practice = advanceSeries(practice);
    }
    return { id, title, startedAt, practice: completePractice(practice, `2026-10-0${day}T11:00:00Z`) };
  }
  const entries = [
    training('low-series', 'Длинная тренировка', 1, 18, 20, 9),
    training('best-series', 'Лучшая серия', 2, 18, 1, 10),
    training('different-distance', 'Другая дистанция', 3, 30, 1, 9),
  ];
  await page.addInitScript(({ entries, bow, kit }) => {
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries }));
    localStorage.setItem('app.fableshot.equipment.v1', JSON.stringify({ bows: [bow], arrows: [], kits: [kit] }));
  }, { entries, bow, kit });
  await page.goto('./');
  await page.getByTestId('open-profile').click();
  await page.getByTestId('profile-personal-records').click();
  const gallery = page.getByTestId('personal-records-screen');
  const cards = gallery.locator('[data-testid^="series-record-"]');
  await expect(cards).toHaveCount(2);
  await gallery.getByTestId('records-search').fill(' 18 ');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('30/30');
  await expect(cards.first()).toContainText('02.10.2026');
  await cards.first().click();
  await expect(page.getByTestId('journal-report').getByText('Лучшая серия', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(gallery).toBeVisible();
  await gallery.getByTestId('records-ranks').click();
  const ranks = page.getByTestId('personal-ranks-screen');
  await ranks.getByTestId('personal-rank-category-male').click();
  const bestRank = ranks.locator('[data-testid^="personal-best-"]');
  await expect(bestRank).toContainText('540/600');
  await ranks.getByTestId('personal-rank-grid').click();
  await expect(page.getByTestId('rank-reference')).toBeVisible();
  await page.keyboard.press('Escape');
  await bestRank.click();
  await expect(page.getByTestId('journal-report').getByText('Длинная тренировка', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await ranks.getByRole('button', { name: 'Назад', exact: true }).click();
  await gallery.getByTestId('records-search').fill('неизвестная мишень');
  await expect(gallery.getByRole('status')).toHaveText('Ничего не найдено');
  await gallery.getByTestId('records-volume').click();
  const volume = gallery.getByTestId('volume-record');
  await expect(volume).toContainText('60');
  await expect(volume).toContainText('Длинная тренировка');
  await volume.click();
  await expect(page.getByTestId('journal-report').getByText('Длинная тренировка', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await gallery.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('profile-screen')).toBeVisible();
  await page.getByTestId('profile-rank-results').click();
  await expect(bestRank).toContainText('540/600');
  await ranks.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('profile-screen')).toBeVisible();
  await page.screenshot({ path: '../artifacts/web-0.24.3-profile.png' });
});

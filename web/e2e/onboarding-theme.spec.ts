import { readStoredJournal } from './stored-journal.ts';
import { expect, test } from '@playwright/test';
import { DATA_KEYS } from '../src/app-storage.ts';
import { appendShot, completePractice, emptyPractice } from '../src/practice.ts';
import { createWebArchive } from '../src/web-archive.ts';
import { openSettingsCategory } from './journal-navigation.ts';

test.use({ storageState: { cookies: [], origins: [] } });

test('first launch previews quick settings, saves them and lets the user revisit the choices', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('./');
  await page.getByTestId('onboard-start').click();
  const quick = page.getByTestId('onboard-preferences');
  const average = quick.getByTestId('onboard-average-example');
  await expect(average).toHaveText('8,3');
  await quick.getByRole('switch', { name: 'Средний до сотых' }).click();
  await expect(average).toHaveText('8,35');
  await quick.getByTestId('style-pop').click();
  await expect(quick.getByRole('region', { name: 'Пример результата' })).toHaveAttribute('data-style', 'pop');
  await expect(page.locator('html')).toHaveAttribute('data-theme-style', 'sport');
  await expect(quick.getByTestId('onboard-achievement-example')).toBeVisible();
  await quick.getByRole('switch', { name: 'Достижения при отметке попаданий' }).click();
  await expect(quick.getByTestId('onboard-achievement-example')).toHaveCount(0);
  await quick.getByLabel('Категория нормативов').selectOption('female');
  await quick.getByTestId('onboard-save-preferences').click();
  await expect(page.getByTestId('start-training')).toBeVisible();
  const { records, diary } = await readStoredJournal(page);
  expect(diary?.entries ?? []).toHaveLength(0);
  await expect.poll(async () => (await readStoredJournal(page)).diary?.achievementLedger?.grants.map(grant => grant.id)).toEqual(['APP11']);
  expect(JSON.parse(records['app.fableshot.training-preferences.v1']!).preferences).toMatchObject({
    themeStyle: 'pop', averageHundredths: true, showAchievementsDuringInput: false, onboardingSeen: true, rankCategory: 'female',
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-style', 'pop');
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'help', 'help-quick-preferences');
  await page.getByTestId('help-quick-preferences').click();
  await expect(average).toHaveText('8,35');
  await quick.getByTestId('style-minimal').click();
  await quick.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('help-quick-preferences')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme-style', 'pop');
});

test('skipping quick settings keeps the existing choices', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('onboard-start').click();
  await page.getByTestId('style-pop').click();
  await page.getByTestId('onboard-skip-preferences').click();
  await expect(page.getByTestId('start-training')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme-style', 'sport');
  const { records } = await readStoredJournal(page);
  const { preferences } = JSON.parse(records['app.fableshot.training-preferences.v1']!);
  expect(preferences.onboardingSeen).toBe(true);
  expect(preferences.themeStyle).toBeUndefined();
});

test('first launch offers an isolated example and lets the user reopen it from settings', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('onboarding-screen')).toBeVisible();
  await expect(page.getByTestId('onboard-start')).toBeVisible();
  await expect(page.getByTestId('onboard-import')).toBeVisible();
  await page.getByTestId('onboard-example').click();
  await page.getByTestId('target').click();
  await expect(page.getByTestId('tutorial-shot-0')).toContainText(/10|X/);
  await page.getByTestId('tutorial-next').click();
  await page.getByTestId('tutorial-next').click();
  await page.getByTestId('tutorial-shot-0').click();
  await page.getByTestId('tutorial-miss').click();
  await page.getByTestId('tutorial-save').click();
  await expect(page.getByTestId('tutorial-shot-0')).toContainText('M');
  await page.getByTestId('tutorial-next').click();
  await page.getByTestId('tutorial-open-report').click();
  const report = page.getByTestId('tutorial-report');
  await expect(report.getByTestId('hit-map-hit')).toHaveCount(6);
  await report.getByTestId('hit-map-series').selectOption('2');
  await expect(report.getByTestId('hit-map-hit')).toHaveCount(3);
  await report.getByRole('button', { name: 'Распределение', exact: true }).click();
  await report.getByTestId('report-zone-10').locator('[data-zone="10"]').first().click();
  await expect(report.getByTestId('shot-distribution-reading')).toContainText('Оценка 10');
  await report.getByRole('button', { name: 'Выйти из примера' }).click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  expect((await readStoredJournal(page)).diary).toBeNull();
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'help', 'settings-onboarding');
  await page.getByTestId('settings-onboarding').click();
  await page.getByTestId('onboard-open-preferences').click();
  await expect(page.getByTestId('onboard-preferences')).toContainText('Уведомления об обновлениях');
  await page.getByTestId('onboard-save-preferences').click();
  await page.getByTestId('onboard-import').click();
  await expect(page.getByTestId('mytargets-import')).toBeVisible();
});

test('style and light theme persist and System follows an appearance change', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('./');
  await page.getByTestId('onboard-skip').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-style', 'sport');
  expect(await page.locator('html').evaluate(root => getComputedStyle(root).fontVariantNumeric)).toBe('tabular-nums');
  const hero = page.getByTestId('home-hero');
  await expect(hero).not.toHaveCSS('background-image', 'none');
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'appearance', 'style-pop');
  const choose = (id: string) => page.locator('.web-theme-settings label').filter({ has: page.getByTestId(id) }).click({ timeout: 5000 });
  await choose('style-pop');
  await choose('appearance-light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-style', 'pop');
  await expect(page.locator('html')).toHaveAttribute('data-theme-appearance', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-style', 'pop');
  await expect(page.locator('html')).toHaveAttribute('data-theme-appearance', 'light');
  await page.screenshot({ path: '../artifacts/web-0.18.0-pop-light.png' });
  const tabCards = [
    ['home', '.journal-home-hero'],
    ['history', '.journal-tab-empty'],
    ['progress', '.journal-tab-empty'],
    ['equipment', '.equipment-catalog-empty'],
  ];
  const backgrounds = new Set<string>();
  for (const [tab, card] of tabCards) {
    await page.getByTestId(`nav-${tab}`).click();
    const shell = page.locator(`.journal-shell[data-tab="${tab}"]`);
    for (const surface of [shell, shell.locator(card)]) {
      await expect(surface).not.toHaveCSS('background-image', 'none');
      backgrounds.add(await surface.evaluate(element => getComputedStyle(element).backgroundImage));
    }
  }
  expect(backgrounds.size).toBe(tabCards.length * 2);
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'appearance', 'style-minimal');
  await choose('style-minimal');
  await choose('appearance-system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme-appearance', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme-appearance', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-style', 'minimal');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  for (const [tab, card] of tabCards) {
    await page.getByTestId(`nav-${tab}`).click();
    const shell = page.locator(`.journal-shell[data-tab="${tab}"]`);
    await expect(shell).toHaveCSS('background-image', 'none');
    await expect(shell.locator(card)).toHaveCSS('background-image', 'none');
  }
});

test('a new installation can restore a FableShot archive directly from welcome', async ({ page }) => {
  const practice = completePractice(appendShot(emptyPractice(), { code: '10', points: 10, point: { x: 0, y: 0 } }), '2026-10-21T11:00:00Z');
  const diary = { version: 1, entries: [{ id: 'restored', startedAt: '2026-10-21T10:00:00Z', practice }] };
  const records = Object.fromEntries(DATA_KEYS.map(key => [key, key === DATA_KEYS[0] ? JSON.stringify(diary) : null]));
  const bytes = await createWebArchive(records, 'restore-test');
  await page.goto('./');
  await page.getByTestId('onboard-restore').click();
  await expect(page.getByTestId('archive-screen')).toBeVisible();
  await page.getByTestId('archive-file').setInputFiles({ name: 'from-old-phone.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.getByTestId('archive-preview')).toContainText('Стрелы');
  expect((await readStoredJournal(page)).diary).toBeNull();
  await page.getByTestId('archive-restore').click();
  await page.getByTestId('archive-confirm-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId('session-restored')).toBeVisible();
  expect((await readStoredJournal(page)).diary).toEqual(diary);
});

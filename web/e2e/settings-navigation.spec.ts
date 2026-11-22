import { expect, test } from '@playwright/test';

test('motion previews switch styles and respect the global animation toggle', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-motion').click();
  const demo = page.locator('.shot-motion-demo');
  for (const [score, animation] of [[5, 'shot-reveal'], [7, 'shot-flip'], [9, 'shot-landing']] as const) {
    await page.getByRole('button', { name: `Показать анимацию для оценки ${score}` }).click();
    await expect(demo.locator('[data-shot-motion="cards"]')).toHaveCSS('animation-name', animation);
  }
  await page.getByRole('button', { name: 'Показать анимацию для оценки 10' }).click();
  await expect(demo.locator('[data-shot-motion="cards"][data-shot-tier="ten"]')).toHaveCSS('animation-name', 'shot-landing');
  await expect(demo.locator('.shot-sparks i')).toHaveCount(7);
  await page.getByRole('button', { name: 'Импульс', exact: true }).click();
  await expect(demo.locator('[data-shot-motion="pulse"]')).toHaveCSS('animation-name', 'shot-pulse');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(demo.locator('[data-shot-motion="pulse"]')).toHaveCSS('animation-name', 'none');
  await page.getByTestId('setting-animations').click();
  await expect(page.getByRole('button', { name: 'Показать анимацию для оценки 10' })).toBeDisabled();
  await expect(demo.locator('[data-shot-motion]')).toHaveCount(0);
});

test('lens controls share saved defaults and overrides with training conditions', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-training').click();
  const slider = page.getByTestId('setting-aim-speed');
  await expect(slider).toHaveValue('70');
  await expect(page.getByTestId('setting-lens-zoom')).toHaveValue('375');
  await slider.fill('100');
  await page.getByTestId('setting-lens-zoom').fill('500');
  await page.reload();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-training').click();
  await expect(page.getByTestId('setting-aim-speed')).toHaveValue('100');
  await expect(page.getByTestId('setting-lens-zoom')).toHaveValue('500');
  const back = page.getByRole('button', { name: 'Назад', exact: true });
  await back.click();
  await back.click();
  await page.getByTestId('home-change-conditions').click();
  await page.getByTestId('conditions-advanced').click();
  await expect(page.getByTestId('setting-lens-zoom')).toHaveValue('500');
  await page.getByTestId('setting-lens-zoom').fill('300');
  await page.reload();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-training').click();
  await expect(page.getByTestId('setting-lens-zoom')).toHaveValue('300');
});

test('settings use native categories and Back returns to the category list', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  const settings = page.getByTestId('settings-screen');
  await expect(settings).toHaveAttribute('data-section', 'root');
  await expect(settings.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('button')).toHaveCount(7);
  await expect(page.getByTestId('settings-version')).toHaveCount(0);
  await page.getByTestId('settings-about').click();
  await expect(page.getByTestId('settings-version')).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/ovepfunkep/FableShot');
  await page.getByText('Благодарности', { exact: true }).click();
  await expect(page.getByText(/Тябина Алексея Владимировича/)).toBeVisible();
  await expect(page.getByText(/Попова Алексея/)).toBeVisible();
  await expect(page.getByText(/Вольные Стрелки/)).toBeVisible();
  await settings.getByRole('button', { name: 'Назад', exact: true }).click();
  for (const section of ['appearance', 'motion', 'training', 'statistics', 'data', 'help']) {
    await page.getByTestId(`settings-${section}`).click();
    await expect(settings).toHaveAttribute('data-section', section);
    await expect(page.getByTestId('settings-version')).toHaveCount(0);
    await expect(settings.getByRole('button', { name: 'Все настройки', exact: true })).toHaveCount(0);
    await settings.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(settings).toHaveAttribute('data-section', 'root');
  }
  await page.getByTestId('settings-motion').click();
  await expect(page.getByTestId('setting-animations')).toBeVisible();
  await expect(page.getByTestId('setting-hide-scores')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(settings).toHaveAttribute('data-section', 'root');
  await settings.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
});

test('achievement visibility hides earned previews and the help section opens the target lesson directly', async ({ page }) => {
  const diary = { version: 1, entries: [], achievementLedger: { epoch: 'settings-test', grants: [
    { id: 'APP08', scope: 'global', earnedAt: '2026-10-01T10:00:00Z', notifiedAt: '2026-10-01T10:00:00Z' },
  ] } };
  await page.addInitScript(diary => {
    const key = 'app.fableshot.practice-diary.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(diary));
  }, diary);
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-motion').click();
  await page.getByRole('switch', { name: 'Показывать достижения', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('open-profile').click();
  await expect(page.getByTestId('profile-achievements')).not.toContainText('У героя есть имя');
  await page.getByRole('button', { name: 'Все достижения', exact: true }).click();
  await page.getByTestId('achievements-earned').click();
  await expect(page.getByText('У героя есть имя', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-help').click();
  await page.getByTestId('help-tutorial').click();
  await expect(page.getByTestId('tutorial-screen')).toBeVisible();
  await expect(page.getByTestId('onboarding-screen')).toHaveCount(0);
  await page.getByTestId('tutorial-exit').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!))).toEqual(diary);
});

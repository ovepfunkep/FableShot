import { readDiary, readStoredJournal } from './stored-journal.ts';
import { expect, test } from '@playwright/test';

test('Home and About link to public privacy and About offers a Sber transfer', async ({ page }) => {
  await page.goto('./');
  const homePolicy = page.getByTestId('home-screen').getByRole('link', { name: 'Политика конфиденциальности' });
  await expect(homePolicy).toHaveAttribute('href', /\/privacy\.html$/);
  const policyHref = (await homePolicy.getAttribute('href'))!;
  const policyUrl = new URL(policyHref, page.url());
  expect(policyUrl.pathname).toBe('/FableShot/privacy.html');
  const policy = await page.request.get(policyUrl.href);
  expect(policy.status()).toBe(200);
  expect(await policy.text()).toContain('Резервные копии на Google Диске');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-about').click();
  await expect(page.getByRole('link', { name: 'Политика конфиденциальности' })).toHaveAttribute('href', policyHref);
  const support = page.getByRole('link', { name: 'Поддержать через СБП' });
  await expect(support).toHaveAttribute('href', /^https:\/\/www\.sberbank\.ru\/ru\/choise_bank\?/);
});

test('motion settings keep the global toggle and omit the individual shot style', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-motion').click();
  await expect(page.getByText('Анимация попаданий', { exact: true })).toHaveCount(0);
  await page.getByTestId('setting-animations').click();
  await expect(page.getByTestId('setting-animations')).toHaveAttribute('aria-checked','false');
});

test('lens controls share saved defaults and overrides with training conditions', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-training').click();
  const slider = page.getByTestId('setting-aim-speed');
  await expect(slider).toHaveValue('40');
  await expect(page.getByTestId('setting-lens-zoom')).toHaveValue('375');
  await slider.fill('100');
  await page.getByTestId('setting-lens-zoom').fill('500');
  await expect(page.getByText('5×', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-training').click();
  await expect(page.getByTestId('setting-aim-speed')).toHaveValue('100');
  await expect(page.getByTestId('setting-lens-zoom')).toHaveValue('500');
  const back = page.getByRole('button', { name: 'Назад', exact: true });
  await back.click();
  await back.click();
  await page.getByTestId('home-start-training').click();
  await page.getByRole('button', { name: 'Переместить панель масштаба' }).click();
  await expect(page.getByTestId('setting-lens-zoom')).toHaveValue('500');
  await page.getByTestId('setting-lens-zoom').fill('300');
  await expect(page.getByText('3×', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-training').click();
  await expect(page.getByTestId('setting-lens-zoom')).toHaveValue('300');
});

test('the settings target uses the selected lens magnification and aim speed without recording a practice', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-training').click();
  const preview = page.getByTestId('lens-settings-preview');
  const target = preview.getByTestId('target');
  await target.scrollIntoViewIfNeeded();
  const lens = preview.getByTestId('lens');
  const speed = page.getByTestId('setting-aim-speed');
  const zoom = page.getByTestId('setting-lens-zoom');
  async function startAim() {
    await target.scrollIntoViewIfNeeded();
    const { x, y, width, height } = (await target.boundingBox())!;
    const center = { x: x + width / 2, y: y + height / 2, radius: Math.min(width, height) * .44 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await expect(lens.locator('strong')).toHaveText('10');
    return center;
  }
  function pixel(offset: number) {
    return lens.locator('canvas').evaluate((canvas: HTMLCanvasElement, distance) => {
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      return Array.from(canvas.getContext('2d')!.getImageData(Math.round(canvas.width / 2 + distance * scale),
        Math.round(canvas.height / 2), 1, 1).data.slice(0, 3));
    }, offset);
  }
  await zoom.fill('150');
  await expect(page.getByText('1,5×', { exact: true })).toBeVisible();
  const first = await startAim();
  expect(await pixel(first.radius * .55)).toEqual([228, 76, 67]);
  await page.mouse.up();

  await zoom.fill('600');
  await speed.fill('20');
  await expect(page.getByText('6×', { exact: true })).toBeVisible();
  await expect(page.getByText('20%', { exact: true })).toBeVisible();
  const slow = await startAim();
  expect(await pixel(slow.radius * .55)).toEqual([244, 206, 68]);
  await page.mouse.move(slow.x + slow.radius * .16, slow.y);
  await expect(lens.locator('strong')).toHaveText('10');
  await page.mouse.up();

  await speed.fill('150');
  await expect(page.getByText('150%', { exact: true })).toBeVisible();
  const fast = await startAim();
  await page.mouse.move(fast.x + fast.radius * .16, fast.y);
  await expect(lens.locator('strong')).not.toHaveText('10');
  await page.mouse.up();
  expect((await readStoredJournal(page)).diary?.entries ?? []).toHaveLength(0);
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
  expect(await readDiary(page)).toEqual(diary);
});

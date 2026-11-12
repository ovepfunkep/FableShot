import { expect, test } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { WEB_RELEASE_VERSION } from '../src/web-releases.ts';

test.use({ storageState: { cookies: [], origins: [] } });

test('important changes from skipped releases appear once and remain available in settings', async ({ page }) => {
  await page.addInitScript(preferences => {
    const key = 'app.fableshot.training-preferences.v1';
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ version: 1, preferences }));
  }, { ...DEFAULT_PREFERENCES, webReleaseSeen: 13, onboardingSeen: true });
  await page.goto('./');
  const notes = page.getByTestId('release-notes');
  await expect(notes).toContainText(`0.13.0 → ${WEB_RELEASE_VERSION}`);
  await expect(notes).toContainText('MyTargets');
  await expect(notes).toContainText('корзина');
  await expect(notes).toContainText('часы стрельбы');
  await page.getByTestId('release-notes-confirm').click();
  await page.reload();
  await expect(notes).toHaveCount(0);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-about').click();
  await page.getByTestId('settings-version').click();
  await expect(page.getByTestId('release-history-13')).toBeVisible();
  await expect(page.getByTestId('release-history-17')).toBeVisible();
});

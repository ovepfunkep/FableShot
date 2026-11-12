import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function openSettingsCategory(page: Page, category: 'data' | 'help' | 'appearance' | 'motion', targetId: string) {
  const entry = page.getByTestId(`settings-${category}`);
  const target = page.getByTestId(targetId);
  await expect(entry.or(target)).toBeVisible();
  if (await entry.isVisible()) await entry.click();
  await expect(target).toBeVisible();
}

export async function openTraining(page: Page) {
  await page.getByTestId('home-start-training').click();
}

export async function openHistoryEntry(page: Page, id?: string) {
  await page.getByTestId('nav-history').click();
  await (id ? page.getByTestId(`session-${id}`) : page.locator('[data-testid^="session-"]').first()).click();
}

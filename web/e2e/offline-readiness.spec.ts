import { expect, test } from '@playwright/test';

test('offline preparation stays pending while the service worker installs slowly', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const worker = Object.assign(new EventTarget(), { state: 'installing', scriptURL: new URL('sw.js', location.href).href });
    const registration = Object.assign(new EventTarget(), { installing: worker, waiting: null });
    const serviceWorkers = Object.assign(new EventTarget(), {
      controller: null as typeof worker | null,
      register: async () => registration,
    });
    Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorkers });
    window.addEventListener('activate-test-worker', () => {
      serviceWorkers.controller = worker;
      serviceWorkers.dispatchEvent(new Event('controllerchange'));
    });
  });
  await page.goto('./');
  const status = page.getByTestId('offline-status');
  await expect(status).toHaveText('Готовим офлайн');
  await page.clock.fastForward(16_000);
  await expect(status).toHaveText('Готовим офлайн');
  await page.evaluate(() => window.dispatchEvent(new Event('activate-test-worker')));
  await expect(status).toHaveText('Готово офлайн');
});

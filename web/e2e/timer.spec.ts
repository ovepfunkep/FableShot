import { openSettingsCategory, openTraining } from './journal-navigation.ts';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function freezeClock(page: Page) {
  const time = new Date('2026-11-11T12:00:00.000Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}

async function openTimer(page: Page) {
  await page.getByTestId('practice-timer-open').click();
  await expect(page.getByTestId('practice-timer-window')).toBeVisible();
}

async function setDurations(page: Page, series = '5', rest = '3') {
  await page.getByTestId('timer-series-seconds').fill(series);
  await page.getByTestId('timer-rest-seconds').fill(rest);
  await page.getByTestId('timer-save-durations').click();
}

test('start schedules distinct sounds and pausing cancels the pending signal', async ({ page }) => {
  await page.addInitScript(() => {
    class AudioProbe {
      state = 'running';
      currentTime = 0;
      destination = {};
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
      createOscillator() {
        return {
          frequency: { value: 0 }, connect() {}, disconnect() {},
          start() {
            const root = document.documentElement;
            root.dataset.sounds = [root.dataset.sounds, this.frequency.value].filter(Boolean).join(',');
          },
          stop(at?: number) {
            if (at === undefined) document.documentElement.dataset.cancelledSound = 'yes';
          },
        };
      }
      async close() {}
    }
    Object.defineProperty(window, 'AudioContext', { value: AudioProbe });
  });
  await freezeClock(page);
  await page.goto('./');
  await openTraining(page);
  await openTimer(page);
  await setDurations(page, '2', '1');
  const root = page.locator('html');
  const face = page.locator('.practice-timer-face');
  await expect(root).not.toHaveAttribute('data-sounds', /./);
  await page.getByTestId('timer-toggle').click();
  await expect(face).toHaveAttribute('data-timer-tone', 'series');
  await expect(root).toHaveAttribute('data-sounds', '880');
  await page.getByTestId('timer-toggle').click();
  await expect(root).toHaveAttribute('data-cancelled-sound', 'yes');
  await page.getByTestId('timer-reset').click();
  await page.getByTestId('timer-phase-Rest').click();
  await page.getByTestId('timer-toggle').click();
  await expect(face).toHaveAttribute('data-timer-tone', 'rest');
  await expect(root).toHaveAttribute('data-sounds', '880,540,680');
  await page.clock.runFor(1300);
  await expect(face).toHaveAttribute('data-timer-tone', 'finished');
});

test('vibration is opt-in and fires once per new shot and timer completion', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'vibrate', { value: () => {
      const root = document.documentElement;
      root.dataset.vibrations = String(Number(root.dataset.vibrations ?? 0) + 1);
      return true;
    } });
  });
  await freezeClock(page);
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'motion', 'setting-haptics');
  const haptics = page.getByTestId('setting-haptics');
  await expect(haptics).toHaveAttribute('aria-checked', 'false');
  await haptics.click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await openTraining(page);
  const root = page.locator('html');
  const miss = page.getByRole('button', { name: 'Отметить промах' });
  await miss.click();
  await expect(root).toHaveAttribute('data-vibrations', '1');
  await page.reload();
  await openTraining(page);
  await expect(root).not.toHaveAttribute('data-vibrations', /./);
  await openTimer(page);
  await setDurations(page, '1');
  await page.getByTestId('timer-toggle').click();
  await page.clock.runFor(1500);
  await expect(page.getByTestId('timer-status')).toHaveText('Время вышло');
  await expect(root).toHaveAttribute('data-vibrations', '1');
  await page.clock.runFor(1500);
  await expect(root).toHaveAttribute('data-vibrations', '1');
});

test('the timer finishes while closed and durations survive a page restart', async ({ page }) => {
  await freezeClock(page);
  await page.goto('./');
  await openTraining(page);
  await openTimer(page);
  await setDurations(page);
  await expect(page.getByTestId('timer-remaining')).toHaveText('00:05');
  await page.getByTestId('timer-toggle').click();
  await page.clock.fastForward(2000);
  await expect(page.getByTestId('timer-remaining')).toHaveText('00:03');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('practice-timer-window')).toHaveCount(0);
  await page.clock.fastForward(4000);
  await openTimer(page);
  await expect(page.getByTestId('timer-remaining')).toHaveText('00:00');
  await expect(page.getByTestId('timer-status')).toHaveText('Время вышло');
  await expect(page.getByTestId('timer-toggle')).toHaveText('Ещё раз');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('training-series-open')).toContainText('Серия 1');
  await expect(page.getByTestId('series-score')).toHaveText('0/0');
  await page.reload();
  await openTraining(page);
  await openTimer(page);
  await expect(page.getByTestId('timer-series-seconds')).toHaveValue('5');
  await expect(page.getByTestId('timer-rest-seconds')).toHaveValue('3');
  await expect(page.getByTestId('timer-remaining')).toHaveText('00:05');
  await expect(page.getByTestId('timer-status')).toHaveText('Готов к запуску');
});

test('manual pause preserves remaining time and reset restores the chosen duration', async ({ page }) => {
  await freezeClock(page);
  await page.goto('./');
  await openTraining(page);
  await openTimer(page);
  await setDurations(page);
  await page.getByTestId('timer-toggle').click();
  await expect(page.getByTestId('timer-series-seconds')).toBeDisabled();
  await page.clock.fastForward(2100);
  await page.getByTestId('timer-toggle').click();
  await expect(page.getByTestId('timer-status')).toHaveText('На паузе');
  await expect(page.getByTestId('timer-toggle')).toHaveText('Продолжить');
  await page.clock.fastForward(20_000);
  await expect(page.getByTestId('timer-remaining')).toHaveText('00:03');
  await page.getByTestId('timer-toggle').click();
  await page.clock.fastForward(3000);
  await expect(page.getByTestId('timer-status')).toHaveText('Время вышло');
  await page.getByTestId('timer-toggle').click();
  await expect(page.getByTestId('timer-remaining')).toHaveText('00:05');
  await expect(page.getByTestId('timer-toggle')).toHaveText('Пауза');
  await page.getByTestId('timer-reset').click();
  await expect(page.getByTestId('timer-remaining')).toHaveText('00:05');
  await expect(page.getByTestId('timer-status')).toHaveText('Готов к запуску');
  await expect(page.getByTestId('timer-series-seconds')).toBeEnabled();
});

test('changing an ongoing phase requires confirmation and the new phase waits for start', async ({ page }) => {
  await freezeClock(page);
  await page.goto('./');
  await openTraining(page);
  await openTimer(page);
  await page.getByTestId('timer-toggle').click();
  await page.clock.fastForward(1000);
  await page.getByTestId('timer-phase-Rest').click();
  const confirmation = page.getByRole('dialog', { name: 'Сменить режим?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByTestId('timer-phase-Series')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('timer-remaining')).toHaveText('01:59');
  await page.getByTestId('timer-phase-Rest').click();
  await page.getByTestId('timer-confirm-phase').click();
  await expect(page.getByTestId('timer-phase-Rest')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('timer-remaining')).toHaveText('01:00');
  await expect(page.getByTestId('timer-status')).toHaveText('Готов к запуску');
  await expect(page.getByTestId('timer-toggle')).toHaveText('Запустить');
});

test('a settings write failure keeps the draft and does not change the countdown duration', async ({ page }) => {
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'app.fableshot.timer-settings.v1') throw new DOMException('Storage full', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await page.goto('./');
  await openTraining(page);
  await openTimer(page);
  await page.getByTestId('timer-series-seconds').fill('0');
  await expect(page.getByTestId('timer-save-durations')).toBeDisabled();
  await expect(page.getByText('От 1 до 3600 секунд')).toBeVisible();
  await page.getByTestId('timer-series-seconds').fill('7');
  await page.getByTestId('timer-save-durations').click();
  await expect(page.getByText('Не удалось сохранить длительности. Попробуй ещё раз.')).toBeVisible();
  await expect(page.getByTestId('timer-series-seconds')).toHaveValue('7');
  await expect(page.getByTestId('timer-remaining')).toHaveText('02:00');
});

test('only the changed clock digit animates and stable characters keep their DOM nodes', async ({ page }) => {
  await freezeClock(page);
  await page.goto('./');
  await openTraining(page);
  await openTimer(page);
  await setDurations(page);
  const firstDigit = await page.getByTestId('timer-character-0').elementHandle();
  const colon = await page.getByTestId('timer-character-2').elementHandle();
  const lastDigit = await page.getByTestId('timer-character-4').elementHandle();
  await page.getByTestId('timer-toggle').click();
  await page.clock.runFor(1000);
  await expect(page.getByTestId('timer-remaining')).toHaveText('00:04');
  expect(await firstDigit!.evaluate(element => element === document.querySelector('[data-testid="timer-character-0"]'))).toBe(true);
  expect(await colon!.evaluate(element => element === document.querySelector('[data-testid="timer-character-2"]'))).toBe(true);
  expect(await lastDigit!.evaluate(element => element.isConnected)).toBe(false);
  await expect.poll(() => page.getByTestId('timer-character-4').evaluate(element => element.getAnimations().length)).toBe(1);
  expect(await firstDigit!.evaluate(element => element.getAnimations().length)).toBe(0);
  expect(await colon!.evaluate(element => element.getAnimations().length)).toBe(0);
});

test('unreadable timer settings remain intact while the diary accepts hits', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('app.fableshot.timer-settings.v1', '{broken'));
  await page.goto('./');
  await openTraining(page);
  await page.getByTestId('practice-timer-open').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('practice-timer-window')).toHaveCount(0);
  await page.getByRole('button', { name: 'Отметить промах', exact: true }).click();
  await expect(page.getByTestId('series-score')).toHaveText('0/10');
  expect(await page.evaluate(() => localStorage.getItem('app.fableshot.timer-settings.v1'))).toBe('{broken');
});

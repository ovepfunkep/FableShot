import { expect, test } from '@playwright/test';
import { appendShot, applyConditions, emptyPractice } from '../src/practice.ts';
import { DEFAULT_CONDITIONS } from '../src/conditions.ts';
import { DEFAULT_PREFERENCES } from '../src/preferences.ts';
import { openHistoryEntry, openTraining } from './journal-navigation.ts';

test('the first completed barebow series awards a rank-pace group and keeps its evidence in statistics', async ({ page }) => {
  await page.addInitScript(defaults => {
    if (localStorage.getItem('app.fableshot.practice-diary.v1')) return;
    localStorage.setItem('app.fableshot.training-preferences.v1', JSON.stringify({
      version: 1, preferences: { ...defaults, rankCategory: 'male', onboardingSeen: true },
    }));
    localStorage.setItem('app.fableshot.equipment.v1', JSON.stringify({
      bows: [{ id: 'bow', name: 'Лук', category: 'barebow' }],
      arrows: [{ id: 'arrows', name: 'Стрелы', diameterMm: 6 }],
      kits: [{ id: 'kit', name: 'Основной', bowId: 'bow', arrowsId: 'arrows' }],
    }));
  }, DEFAULT_PREFERENCES);
  await page.goto('./');
  await page.clock.install();
  await page.getByTestId('home-change-conditions').click();
  await page.getByTestId('conditions-equipment').click();
  await page.getByTestId('equipment-select-kit').click();
  await page.getByTestId('start-training').click();
  const stageAwards = () => page.evaluate(() => {
    const diary = JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!);
    return diary.achievementLedger.grants.filter((grant: { stageRank?: unknown }) => grant.stageRank);
  });
  for (let i = 0; i < 3; i++) await page.getByTestId('target').click();
  expect(await stageAwards()).toHaveLength(0);
  await page.getByRole('button', { name: 'Следующая серия', exact: true }).click();
  await expect.poll(async () => (await stageAwards()).length).toBe(6);
  const notice = page.getByTestId('achievement-notice');
  await expect(notice).toContainText('Коротко, на мировом');
  await expect(notice).toContainText('+5');
  await page.clock.fastForward(12_001);
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
  await page.getByTestId('training-confirm').click();
  const achievements = page.getByTestId('session-achievements');
  await expect(achievements).not.toContainText('Коротко, на мировом');
  await achievements.getByRole('button', { name: /Получено достижений:/ }).click();
  const details = page.getByRole('dialog', { name: 'Достижения тренировки' });
  const mythic = details.locator('[data-rarity="Mythic"]').filter({ hasText: 'Коротко, на мировом' });
  await expect(mythic).toContainText('порог 553 из 600');
  await expect(details.locator('[data-rarity="Legendary"]').filter({ hasText: 'Мастер короткого метра' })).toBeVisible();
  expect(await mythic.evaluate(node => getComputedStyle(node).borderInlineStartColor)).not.toBe(
    await details.locator('[data-rarity="Legendary"]').first().evaluate(node => getComputedStyle(node).borderInlineStartColor));
  await page.keyboard.press('Escape');
  await page.reload();
  await openHistoryEntry(page);
  await expect(achievements.getByRole('button', { name: /Получено достижений:/ })).toBeVisible();
  expect(await stageAwards()).toHaveLength(6);
});

test('deleting and restoring achievement evidence updates its status without a second award', async ({ page }) => {
  const epoch = 'validity-epoch';
  const practice = { ...appendShot(emptyPractice(), { code: 'M', points: 0, point: null }), savedAt: '2026-11-11T10:00:00Z' };
  const diary = { version: 1, entries: [{ id: 'evidence', startedAt: '2026-11-11T09:00:00Z', practice,
    achievementEnrollment: { epoch, rankCategory: null } }], achievementLedger: { epoch,
    grants: [{ id: 'START01', scope: 'global', earnedAt: '2026-11-11T10:00:00Z', notifiedAt: '2026-11-11T10:00:00Z', sessionId: 'evidence' }] } };
  await page.addInitScript(diary => {
    if (!localStorage.getItem('app.fableshot.practice-diary.v1')) localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify(diary));
  }, diary);
  await page.goto('./');
  await openHistoryEntry(page, 'evidence');
  await page.getByTestId('report-menu-open').click();
  await page.getByRole('button', { name: 'Удалить тренировку', exact: true }).click();
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await page.getByTestId('open-profile').click();
  await page.getByRole('button', { name: 'Все достижения', exact: true }).click();
  await expect(page.getByTestId('achievement-earned-START01')).toHaveClass(/achievement-state-unconfirmed/);
  await page.getByTestId('achievement-START01').click();
  await expect(page.getByTestId('achievement-moment-START01')).toContainText('Текущие записи больше не подтверждают условие');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('nav-history').click();
  await page.getByTestId('history-filters').click();
  await page.getByRole('checkbox', { name: 'Корзина' }).check();
  await page.keyboard.press('Escape');
  await page.getByTestId('session-evidence').click();
  await page.getByRole('button', { name: 'Восстановить тренировку', exact: true }).click();
  await page.getByTestId('open-profile').click();
  await page.getByRole('button', { name: 'Все достижения', exact: true }).click();
  await expect(page.getByTestId('achievement-earned-START01')).toHaveClass(/achievement-state-earned/);
  await expect(page.getByTestId('achievement-notice')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!).achievementLedger.grants)).toHaveLength(1);
});

test('profile and memo actions earn only from new explicit actions and distinct publications', async ({ page }) => {
  await page.goto('./');
  await page.clock.install();
  await page.getByTestId('open-profile').click();
  await page.getByRole('button', { name: 'Изменить имя', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя', exact: true }).fill('Лучник');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByTestId('achievement-notice')).toContainText('У героя есть имя');
  await page.clock.fastForward(4001);
  await page.getByRole('button', { name: 'Моя техника', exact: true }).click();
  await page.getByTestId('technique-create').click();
  await page.getByTestId('technique-title').fill('Мой выстрел');
  await page.getByTestId('technique-add-step-0').click();
  await page.getByTestId('technique-step-short').fill('Выдохнуть');
  await page.getByTestId('technique-step-done').click();
  await page.getByTestId('technique-publish').click();
  const ids = () => page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!).achievementLedger.grants.map((grant: { id: string }) => grant.id));
  await expect.poll(ids).toEqual(['APP08', 'MIND03']);
  await page.getByLabel('Действия памятки Мой выстрел').click();
  await page.locator('[data-testid^="technique-edit-"]').click();
  await page.getByTestId('technique-publish').click();
  expect(await ids()).toEqual(['APP08', 'MIND03']);
  await page.getByLabel('Действия памятки Мой выстрел').click();
  await page.locator('[data-testid^="technique-edit-"]').click();
  await page.getByTestId('technique-step-0-0').click();
  await page.getByTestId('technique-step-short').fill('Выдохнуть и расслабить плечи');
  await page.getByTestId('technique-step-done').click();
  await page.getByTestId('technique-publish').click();
  await expect.poll(ids).toEqual(['APP08', 'MIND03', 'MIND04']);
  await page.reload();
  await page.getByTestId('open-profile').click();
  await expect(page.getByTestId('profile-achievements')).toContainText('3');
  await page.getByTestId('profile-achievements').getByRole('button', { name: /У героя есть имя/ }).click();
  await expect(page.getByTestId('achievement-detail-APP08')).toHaveAttribute('data-state', 'earned');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('achievement-notice')).toHaveCount(0);
});

test('new performance earns grouped notices, persists in report/gallery, and reset excludes old sessions', async ({ page }) => {
  const equipment = { id: 'kit', name: 'Основной', bow: { name: 'Лук', category: 'recurve' as const },
    arrows: { name: 'Стрелы', diameterMm: 6 } };
  const practice = appendShot(applyConditions(emptyPractice(), { ...DEFAULT_CONDITIONS, equipment }),
    { code: '10', points: 10, point: { x: 0, y: 0 } });
  const legacy = { id: 'old', startedAt: '2026-11-01T09:00:00Z', practice: { ...practice, savedAt: '2026-11-01T10:00:00Z' } };
  await page.addInitScript(({ legacy }) => {
    if (localStorage.getItem('app.fableshot.practice-diary.v1')) return;
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({ version: 1, entries: [legacy] }));
    localStorage.setItem('app.fableshot.equipment.v1', JSON.stringify({
      bows: [{ id: 'bow', name: 'Лук', category: 'recurve' }],
      arrows: [{ id: 'arrows', name: 'Стрелы', diameterMm: 6 }],
      kits: [{ id: 'kit', name: 'Основной', bowId: 'bow', arrowsId: 'arrows' }],
    }));
  }, { legacy });
  await page.goto('./');
  await page.getByTestId('open-profile').click();
  await expect(page.getByTestId('profile-achievements')).toContainText('0');
  await page.getByRole('button', { name: 'Все достижения', exact: true }).click();
  await page.getByTestId('achievements-earned').click();
  await expect(page.getByText('В этой категории пока нет полученных достижений.')).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.clock.install();
  await openTraining(page);
  for (let i = 0; i < 3; i++) await page.getByTestId('target').click();
  const notice = page.getByTestId('achievement-notice');
  await expect(notice).toBeVisible();
  await expect(notice.locator('.achievement-notice-clock')).toBeVisible();
  // A family announces only its best tier; the lower tier remains available in details.
  await expect(notice).toContainText('+');
  const leading = await notice.locator('strong').innerText();
  await page.clock.fastForward(2500);
  await expect(notice.locator('strong')).toHaveText(leading);
  const bounds = (await notice.boundingBox())!;
  await page.mouse.move(bounds.x + 200, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 110, bounds.y + 30);
  await page.mouse.up();
  await expect(notice.locator('strong')).not.toHaveText(leading);
  await page.clock.fastForward(4001);
  await page.clock.fastForward(4001);
  await page.clock.fastForward(4001);
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
  await page.getByTestId('training-confirm').click();
  await expect(page.getByTestId('session-achievements')).toContainText('Получено достижений:');
  await expect(notice).toContainText('Начало пути');
  await page.clock.fastForward(4001);
  await page.screenshot({ path: '../artifacts/web-0.19.0-achievement-report.png', fullPage: true });
  await page.reload();
  await openHistoryEntry(page);
  await expect(page.getByTestId('session-achievements')).toContainText('Получено достижений:');
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('open-profile').click();
  await page.getByRole('button', { name: 'Все достижения', exact: true }).click();
  await page.getByTestId('achievement-scope-recurve').click();
  await page.getByTestId('achievements-earned').click();
  await expect(page.getByText('Тройной эспрессо', { exact: true })).toBeVisible();
  await page.getByText('Тройной эспрессо', { exact: true }).click();
  await expect(page.getByTestId('achievement-detail-START02')).toHaveAttribute('data-state', 'earned');
  await expect(page.getByTestId('achievement-moment-HIT01')).toContainText('Получено');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: '../artifacts/web-0.19.0-achievement-gallery.png', fullPage: true });
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-data').click();
  await page.getByRole('button', { name: 'Обнулить достижения', exact: true }).click();
  await page.getByTestId('achievement-reset-confirm').click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('open-profile').click();
  await expect(page.getByTestId('profile-achievements')).toContainText('0');
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('app.fableshot.practice-diary.v1')!));
  expect(state.entries).toHaveLength(2);
  expect(state.achievementLedger.grants).toEqual([]);
});

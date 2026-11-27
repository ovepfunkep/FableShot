import { readDiary } from './stored-journal.ts';
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
  const stageAwards = async () => (await readDiary(page)).achievementLedger!.grants.filter(grant => grant.stageRank);
  for (let i = 0; i < 3; i++) await page.getByTestId('target').click();
  expect(await stageAwards()).toHaveLength(0);
  const notice = page.getByTestId('achievement-notice');
  await expect(notice).toContainText('Десятка, мы знакомы?');
  await page.clock.runFor(18_000);
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
  await page.getByTestId('training-confirm').click();
  await expect.poll(async () => (await stageAwards()).length).toBe(6);
  await expect(notice).toContainText('Коротко, на мировом');
  await expect(notice).toContainText('+5');
  await notice.getByRole('button', { name: 'Посмотреть полученные достижения' }).click();
  const moment = page.getByRole('dialog', { name: 'Полученные достижения' });
  await expect(moment.getByText('Получено наград · 7')).toBeVisible();
  await expect(moment.getByText('1 из 2')).toBeVisible();
  await expect(moment.getByRole('heading', { name: 'Норматив', exact: true })).toBeVisible();
  const lowerTier = page.getByTestId('achievement-details').getByRole('list').getByText('Мастер короткого метра', { exact: true });
  await moment.getByRole('button', { name: 'Посмотреть достижение и ещё 5 уровней' }).click();
  const leading = page.getByRole('dialog', { name: 'Коротко, на мировом' });
  await expect(lowerTier).toHaveCount(0);
  await leading.getByRole('button', { name: 'Ещё уровни · 5' }).click();
  await expect(lowerTier).toBeVisible();
  await leading.getByRole('button', { name: 'Свернуть уровни' }).click();
  await expect(lowerTier).toHaveCount(0);
  await page.keyboard.press('Escape');
  await moment.getByRole('button', { name: 'Следующий тип наград' }).click();
  await expect(moment.getByText('2 из 2')).toBeVisible();
  await expect(moment.getByText('Начало пути', { exact: true })).toBeVisible();
  await moment.getByRole('button', { name: 'Предыдущий тип наград' }).click();
  await expect(moment.getByText('1 из 2')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(moment).toHaveCount(0);
  const achievements = page.getByTestId('session-achievements');
  await expect(achievements).not.toContainText('Коротко, на мировом');
  await achievements.getByRole('button', { name: /Получено достижений:/ }).click();
  const details = page.getByRole('dialog', { name: 'Достижения тренировки' });
  const mythic = details.locator('.achievement-tier[data-rarity="Mythic"]').filter({ hasText: 'Коротко, на мировом' });
  await details.getByRole('button', { name: 'Посмотреть достижение и ещё 5 уровней' }).click();
  const tier = page.getByRole('dialog', { name: 'Коротко, на мировом' });
  await tier.getByRole('button', { name: 'Ещё уровни · 5' }).click();
  const legendary = tier.locator('.achievement-tier[data-rarity="Legendary"]').filter({ hasText: 'Мастер короткого метра' });
  await expect(legendary).toBeVisible();
  expect(await mythic.evaluate(node => getComputedStyle(node).borderInlineStartColor)).not.toBe(
    await legendary.evaluate(node => getComputedStyle(node).borderInlineStartColor));
  const medal = tier.locator('.achievement-medal').first();
  await expect.poll(() => medal.evaluate(node => getComputedStyle(node, '::after').animationIterationCount)).toBe('infinite');
  const threshold = tier.getByText(/порог 553 из 600/);
  await expect(threshold).toBeHidden();
  await tier.getByText('Точные условия', { exact: true }).click();
  await expect(threshold).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await openHistoryEntry(page);
  await expect(achievements.getByRole('button', { name: /Получено достижений:/ })).toBeVisible();
  expect(await stageAwards()).toHaveLength(6);
});

test('profile and gallery use compact stacks and keep the locked mystery secret', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    if (localStorage.getItem('app.fableshot.practice-diary.v1')) return;
    localStorage.setItem('app.fableshot.practice-diary.v1', JSON.stringify({
      version: 1, entries: [], achievementLedger: { epoch: 'profile-stacks',
        grants: [
          ...['START01', 'START05', 'START09', 'APP11'].map(id => ({
            id, scope: 'global', earnedAt: '2026-11-11T10:00:00Z', nativeSnapshot: true,
          })),
          { id: 'HIT05', scope: 'recurve', earnedAt: '2026-11-11T10:00:00Z', nativeSnapshot: true },
        ] },
    }));
  });
  await page.goto('./');
  await page.getByTestId('open-profile').click();
  const profile = page.getByTestId('profile-achievements');
  const one = profile.getByRole('button', { name: /Ноль целых, сто процентов серьёзно/ });
  const many = profile.getByRole('button', { name: 'Продолжение следует', exact: true });
  expect((await one.boundingBox())?.height).toBe((await many.boundingBox())?.height);
  const expand = profile.getByRole('button', { name: 'Посмотреть достижение и ещё 2 уровней' });
  await expand.click();
  const leader = page.getByTestId('achievement-details');
  await leader.getByRole('button', { name: 'Ещё уровни · 2' }).click();
  await expect(leader.getByRole('button', { name: 'Начало пути', exact: true })).toBeVisible();
  await leader.getByRole('button', { name: 'Свернуть уровни' }).click();
  await expect(leader.getByRole('button', { name: 'Начало пути', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await profile.getByRole('button', { name: 'X-Men: полный состав' }).click();
  const details = page.getByRole('dialog', { name: 'X-Men: полный состав' });
  await expect.poll(() => details.locator('.achievement-medal').evaluate(node => getComputedStyle(node, '::after').animationName)).toBe('none');
  await expect(details.getByText('Уложите все шесть стрел серии в зону X.')).toBeVisible();
  await expect(details.getByText(/Сохраните полную серию из 6 стрел/)).toBeHidden();
  await details.getByText('Точные условия', { exact: true }).click();
  await expect(details.getByText(/Сохраните полную серию из 6 стрел/)).toBeVisible();
  await page.keyboard.press('Escape');
  await profile.getByRole('button', { name: 'Все достижения' }).click();
  const gallery = page.getByTestId('achievements-screen');
  const mystery = gallery.getByTestId('achievement-mystery');
  await expect(mystery.locator('.achievement-flavor > span')).toHaveText(['На пробном щите', 'Десять, девять и десять', 'Три стрелы подряд']);
  await expect(gallery).not.toContainText('Охотник за пикселями');
  await expect(gallery).not.toContainText('Краткосрочная память');
  const group = gallery.getByTestId('achievement-START09');
  await group.getByRole('button', { name: 'Посмотреть достижение и ещё 2 уровней' }).click();
  await page.getByTestId('achievement-details').getByRole('button', { name: 'Ещё уровни · 2' }).click();
  await page.getByTestId('achievement-details').getByRole('button', { name: 'Начало пути', exact: true }).click();
  await expect(page.getByTestId('achievement-details').getByTestId('achievement-detail-START01')).toBeVisible();
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
  await expect(page.getByTestId('achievement-earned-START01')).toHaveCount(0);
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
  expect((await readDiary(page)).achievementLedger!.grants).toHaveLength(1);
});

test('profile and memo actions earn only from new explicit actions and distinct publications', async ({ page }) => {
  await page.goto('./');
  await page.clock.install();
  await page.getByTestId('open-profile').click();
  await page.getByRole('button', { name: 'Изменить имя', exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя', exact: true }).fill('Лучник');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByTestId('achievement-notice')).toContainText('У героя есть имя');
  await page.clock.runFor(4400);
  await page.getByRole('button', { name: 'Моя техника', exact: true }).click();
  await page.getByTestId('technique-create').click();
  await page.getByTestId('technique-title').fill('Мой выстрел');
  await page.getByTestId('technique-add-step-0').click();
  await page.getByTestId('technique-step-short').fill('Выдохнуть');
  await page.getByTestId('technique-step-done').click();
  await page.getByTestId('technique-publish').click();
  const ids = async () => (await readDiary(page)).achievementLedger!.grants.map(grant => grant.id);
  await expect.poll(ids).toEqual(['APP08', 'MIND03']);
  await expect(page.getByTestId('achievement-notice')).toContainText('Гэндальф записал');
  await page.clock.runFor(4400);
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
  await expect(page.getByTestId('achievement-notice')).toContainText('Режиссёрские правки');
  await expect.poll(async () => (await readDiary(page)).achievementLedger!.grants.every(grant => !!grant.notifiedAt)).toBe(true);
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
  const notice = page.getByTestId('achievement-notice');
  await page.getByTestId('target').click();
  await expect(notice).toContainText('Десятка, мы знакомы?');
  await notice.getByRole('button', { name: 'Посмотреть полученные достижения' }).click();
  const firstMoment = page.getByRole('dialog', { name: 'Полученные достижения' });
  await expect(firstMoment.getByText('Получено наград · 1')).toBeVisible();
  await expect(firstMoment.getByRole('button', { name: 'Следующий тип наград' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(firstMoment).toHaveCount(0);
  for (let i = 0; i < 2; i++) await page.getByTestId('target').click();
  await expect(notice).toBeVisible();
  await expect(notice.locator('.achievement-notice-clock')).toBeVisible();
  // A family announces only its best tier; the lower tier remains available in details.
  await expect(notice).toContainText('+');
  const title = notice.locator('.achievement-stack-leading strong');
  const leading = await title.innerText();
  await page.clock.fastForward(2500);
  await expect(title).toHaveText(leading);
  const bounds = (await notice.boundingBox())!;
  await page.mouse.move(bounds.x + 200, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 110, bounds.y + 30);
  await page.mouse.up();
  await expect(title).not.toHaveText(leading);
  await page.clock.runFor(13_500);
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
  await page.getByTestId('training-confirm').click();
  await expect(page.getByTestId('session-achievements')).toContainText('Получено достижений:');
  const highlight = page.getByTestId('training-finish-highlight');
  await expect(highlight.locator('span')).toHaveText('Тройной эспрессо');
  await expect(highlight.locator('strong')).toHaveText('30/30');
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
  await page.getByTestId('achievement-details').getByRole('button', { name: /Ещё уровни/ }).click();
  await expect(page.getByTestId('achievement-details').getByTestId('achievement-moment-HIT01')).toContainText('Получено');
  await page.getByTestId('achievement-details').getByRole('button', { name: 'Десятка, мы знакомы?', exact: true }).click();
  await expect(page.getByTestId('achievement-detail-START02')).toHaveAttribute('data-state', 'earned');
  await page.getByRole('button', { name: 'Ко всем уровням' }).click();
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
  const state = await readDiary(page);
  expect(state.entries).toHaveLength(2);
  expect(state.achievementLedger.grants).toEqual([]);
});

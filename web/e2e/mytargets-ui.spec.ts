import { openSettingsCategory } from './journal-navigation.ts';
import { expect, test } from '@playwright/test';
import initSqlJs from 'sql.js';
import { zipSync } from 'fflate';
import { MYTARGETS_HEADERS } from '../src/mytargets-import.ts';

const csv = [MYTARGETS_HEADERS.join(';'),
  'Synthetic import;2025-01-02;;Indoor;CSV recurve;CSV carbon;1;18 m;WA Full (40 cm);1;12:00:00;9;;;',
  'Synthetic import;2025-01-02;;Indoor;CSV recurve;CSV carbon;1;18 m;WA Full (40 cm);1;12:00:00;10;;;',
].join('\r\n');

test('MyTargets CSV preview adds confirmed measured arrows and repeated import adds nothing', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-mytargets');
  await page.getByTestId('settings-mytargets').click();
  await page.getByTestId('mytargets-file').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('mytargets-preview')).toContainText('Выбрано: 1, стрел: 2');
  await expect(page.getByTestId('mytargets-apply')).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('app.fableshot.active-data.v1'))).toBeNull();
  await page.getByTestId('mytargets-confirm').check();
  await expect(page.getByTestId('mytargets-result')).toContainText('тренировок: 1, стрел: 2');
  await page.getByTestId('mytargets-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByTestId('achievement-notice')).toContainText('Правильный выбор');
  const awards = await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('app.fableshot.active-data.v1')!).records['app.fableshot.practice-diary.v1']).achievementLedger.grants.map((grant: { id: string }) => grant.id));
  expect(awards).toEqual(['APP01']);
  const imported = await page.evaluate(() => {
    const active = JSON.parse(localStorage.getItem('app.fableshot.active-data.v1')!);
    const diary = JSON.parse(active.records['app.fableshot.practice-diary.v1']);
    return { entries: diary.entries, equipment: JSON.parse(active.records['app.fableshot.equipment.v1']),
      recovery: !!localStorage.getItem('app.fableshot.recovery-data.v1') };
  });
  expect(imported.recovery).toBe(true);
  expect(imported.entries).toHaveLength(1);
  expect(imported.entries[0].title).toBe('Synthetic import');
  expect(imported.entries[0].practice.rounds[0].series[0].shots).toEqual([
    { points: 9, code: '9', point: null, imported: true }, { points: 10, code: '10', point: null, imported: true },
  ]);
  expect(imported.equipment.bows).toHaveLength(1);
  expect(imported.equipment.bows[0]).toMatchObject({ name: 'CSV recurve', category: null });
  expect(imported.equipment.arrows).toHaveLength(1);
  expect(imported.equipment.arrows[0]).toMatchObject({ name: 'CSV carbon', diameterMm: null });
  expect(imported.equipment.kits).toHaveLength(1);
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-mytargets');
  await page.getByTestId('settings-mytargets').click();
  await page.getByTestId('mytargets-file').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByTestId('mytargets-confirm').check();
  await expect(page.getByTestId('mytargets-result')).toContainText('тренировок: 0, стрел: 0. Пропущено стрел: 2');
  await expect(page.getByTestId('mytargets-apply')).toBeDisabled();
});

test('MyTargets SQLite ZIP imports offline with original Y coordinates and complete equipment after reload', async ({ page, context }) => {
  const sqlite = await initSqlJs();
  const db = new sqlite.Database();
  let zip: Uint8Array;
  try {
    db.run(`PRAGMA user_version=27;
      CREATE TABLE Training(id INTEGER PRIMARY KEY,title TEXT,date TEXT,standardRoundId INTEGER,bowId INTEGER,arrowId INTEGER,indoor INTEGER);
      CREATE TABLE Round(id INTEGER PRIMARY KEY,trainingId INTEGER,\`index\` INTEGER,shotsPerEnd INTEGER,distance TEXT,targetId INTEGER,targetScoringStyleIndex INTEGER,targetDiameter TEXT);
      CREATE TABLE End(id INTEGER PRIMARY KEY,roundId INTEGER,\`index\` INTEGER,exact INTEGER,saveTime TEXT,reachedPoints INTEGER,shotCount INTEGER);
      CREATE TABLE Shot(id INTEGER PRIMARY KEY,endId INTEGER,\`index\` INTEGER,x REAL,y REAL,scoringRing INTEGER,arrowNumber INTEGER);
      CREATE TABLE StandardRound(id INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE Bow(id INTEGER PRIMARY KEY,name TEXT,type INTEGER);
      CREATE TABLE Arrow(id INTEGER PRIMARY KEY,name TEXT,diameter TEXT,maxArrowNumber INTEGER);
      INSERT INTO StandardRound VALUES(1,'Synthetic round');
      INSERT INTO Bow VALUES(1,'Synthetic recurve',0);
      INSERT INTO Arrow VALUES(1,'Synthetic carbon','6mm',12);
      INSERT INTO Training VALUES(1,'Offline ZIP import','2025-02-03',1,1,1,1);
      INSERT INTO Round VALUES(1,1,0,3,'18m',0,1,'40cm');
      INSERT INTO End VALUES(1,1,0,1,'12:00:00',19,2);
      INSERT INTO Shot VALUES(1,1,0,0.1,-0.2,1,7),(2,1,1,0.3,0.4,2,8),(3,1,2,0,0,-2,NULL);`);
    zip = zipSync({ '/data.db': db.export() });
  } finally { db.close(); }
  const file = { name: 'synthetic.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) };
  await page.goto('./');
  await expect(page.getByTestId('offline-status')).toHaveText('Готово офлайн');
  await context.setOffline(true);
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-mytargets');
  await page.getByTestId('settings-mytargets').click();
  await page.getByTestId('mytargets-file').setInputFiles(file);
  await expect(page.getByTestId('mytargets-preview')).toContainText('Выбрано: 1, стрел: 2');
  await expect(page.getByTestId('mytargets-preview')).toContainText('Пустых ячеек в источнике: 1');
  await expect(page.getByTestId('mytargets-result')).toContainText('тренировок: 1, стрел: 2');
  await page.getByTestId('mytargets-apply').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  const persisted = await page.evaluate(() => {
    const active = JSON.parse(localStorage.getItem('app.fableshot.active-data.v1')!);
    return { diary: JSON.parse(active.records['app.fableshot.practice-diary.v1']),
      equipment: JSON.parse(active.records['app.fableshot.equipment.v1']) };
  });
  expect(persisted.diary.entries).toHaveLength(1);
  expect(persisted.diary.entries[0].title).toBe('Offline ZIP import');
  const series = persisted.diary.entries[0].practice.rounds[0].series[0];
  expect(series.shots).toEqual([
    { points: 10, code: '10', point: { x: .1, y: -.2 }, sourcePoint: { x: .1, y: -.2 }, imported: true, physicalArrowNumber: 7 },
    { points: 9, code: '9', point: { x: .3, y: .4 }, sourcePoint: { x: .3, y: .4 }, imported: true, physicalArrowNumber: 8 },
  ]);
  expect(persisted.equipment.bows).toHaveLength(1);
  expect(persisted.equipment.bows[0]).toMatchObject({ name: 'Synthetic recurve', category: 'recurve' });
  expect(persisted.equipment.arrows).toHaveLength(1);
  expect(persisted.equipment.arrows[0]).toMatchObject({ name: 'Synthetic carbon', diameterMm: 6, numberedCount: 12 });
  expect(persisted.equipment.kits).toHaveLength(1);
  expect(persisted.equipment.kits[0]).toMatchObject({ bowId: persisted.equipment.bows[0].id, arrowsId: persisted.equipment.arrows[0].id });
  expect(series.conditions.equipment).toMatchObject({ id: persisted.equipment.kits[0].id,
    bow: { name: 'Synthetic recurve', category: 'recurve' }, arrows: { id: persisted.equipment.arrows[0].id, diameterMm: 6, numberedCount: 12 } });
  await page.getByTestId('open-settings').click();
  await openSettingsCategory(page, 'data', 'settings-mytargets');
  await page.getByTestId('settings-mytargets').click();
  await page.getByTestId('mytargets-file').setInputFiles(file);
  await expect(page.getByTestId('mytargets-result')).toContainText('тренировок: 0, стрел: 0. Пропущено стрел: 2');
  await expect(page.getByTestId('mytargets-apply')).toBeDisabled();
});

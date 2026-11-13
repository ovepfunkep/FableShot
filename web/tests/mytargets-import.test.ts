import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { zipSync, strToU8 } from 'fflate';
import { parseMyTargets, findMyTargetsDuplicates, MYTARGETS_HEADERS } from '../src/mytargets-import.ts';
import { readMyTargetsZip } from '../src/mytargets-zip.ts';
import { isLibrary } from '../src/equipment.ts';
import { isConditions } from '../src/conditions.ts';

function csv(rows: Partial<Record<(typeof MYTARGETS_HEADERS)[number], string>>[]) {
  const defaults = ['Training', '2024-03-01', 'Practice', 'Indoor', '', '', '1', '18m', 'WA Full (40cm)', '1', '12:00:00', '10', '', '0.1', '-0.2'];
  return strToU8([MYTARGETS_HEADERS, ...rows.map(row => MYTARGETS_HEADERS.map((header, index) => row[header] ?? defaults[index]))]
    .map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(';')).join('\r\n'));
}

async function fixture(sql = ''): Promise<Uint8Array> {
  const sqlite = await initSqlJs();
  const db = new sqlite.Database();
  try {
    db.run(`PRAGMA user_version=27;
      CREATE TABLE Training(id INTEGER PRIMARY KEY,title TEXT,date TEXT,standardRoundId INTEGER,bowId INTEGER,arrowId INTEGER,indoor INTEGER);
      CREATE TABLE Round(id INTEGER PRIMARY KEY,trainingId INTEGER,\`index\` INTEGER,shotsPerEnd INTEGER,distance TEXT,targetId INTEGER,targetScoringStyleIndex INTEGER,targetDiameter TEXT);
      CREATE TABLE End(id INTEGER PRIMARY KEY,roundId INTEGER,\`index\` INTEGER,exact INTEGER,saveTime TEXT,reachedPoints INTEGER,shotCount INTEGER);
      CREATE TABLE Shot(id INTEGER PRIMARY KEY,endId INTEGER,\`index\` INTEGER,x REAL,y REAL,scoringRing INTEGER,arrowNumber INTEGER);
      CREATE TABLE StandardRound(id INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE Bow(id INTEGER PRIMARY KEY,name TEXT,type INTEGER,description TEXT);
      CREATE TABLE Arrow(id INTEGER PRIMARY KEY,name TEXT,diameter TEXT,maxArrowNumber INTEGER,comment TEXT);
      INSERT INTO StandardRound VALUES(1,'Practice');
      INSERT INTO Bow VALUES(1,'Recurve',0,'Unrepresented source note');
      INSERT INTO Arrow VALUES(1,'Carbon','0.6cm',12,'Source note');
      INSERT INTO Training VALUES(1,'Training','2024-03-01',1,1,1,1);
      INSERT INTO Round VALUES(1,1,0,3,'20yd',0,1,'40cm');
      INSERT INTO End VALUES(1,1,0,1,'12:00:00',19,2);
      INSERT INTO Shot VALUES(1,1,0,0.1,-0.2,1,7),(2,1,1,0.3,0.4,2,NULL),(3,1,2,0,0,-2,NULL);
      ${sql}`);
    return zipSync({ '/data.db': db.export(), '/image.jpg': new Uint8Array([1, 2, 3]) });
  } finally { db.close(); }
}
const allShots = (p: Awaited<ReturnType<typeof parseMyTargets>>) => p.sessions.flatMap(s => s.rounds).flatMap(r => r.series).flatMap(s => s.shots);

test('ZIP validates explicit structure, saved scores, units, coordinate axes and equipment catalog', async () => {
  const preview = await parseMyTargets(await fixture());
  assert.equal(preview.sourceFormat, 'zip');
  assert.equal(preview.sessions[0].localDate, '2024-03-01');
  const round = preview.sessions[0].rounds[0];
  assert.equal(round.plannedArrows, 3);
  assert.equal(round.conditions?.distanceMeters, 18.288);
  assert.equal(round.conditions?.targetDiameterMm, 400);
  assert.ok(isConditions(round.conditions));
  assert.ok(isLibrary(preview.equipment));
  assert.equal(preview.equipment.arrows[0].diameterMm, 6);
  assert.equal(preview.equipment.bows[0].category, 'recurve');
  assert.equal(preview.equipmentSourceRows[0].values.description, 'Unrepresented source note');
  assert.deepEqual(allShots(preview).map(s => [s.points, s.code]), [[10, '10'], [9, '9']]);
  assert.deepEqual(allShots(preview)[0].point, { x: .1, y: -.2 });
  assert.equal(allShots(preview)[0].physicalArrowNumber, 7);
  assert.equal(preview.skippedEmptySlots, 1);
  assert.equal(preview.ignoredAttachments, 1);
  assert.equal(preview.warnings.filter(w => w.blocking).length, 0);
});

test('ZIP numeric entry and placeholder misses keep unknown points; exact centre remains real', async () => {
  const numeric = await parseMyTargets(await fixture('UPDATE End SET exact=0;'));
  assert.ok(allShots(numeric).every(s => s.point === null));
  assert.ok(allShots(numeric).every(s => s.rawPoint !== null));
  const missed = await parseMyTargets(await fixture('UPDATE Shot SET x=0,y=0,scoringRing=-1 WHERE id=1; UPDATE End SET reachedPoints=9;'));
  assert.equal(allShots(missed)[0].code, 'M');
  assert.equal(allShots(missed)[0].point, null);
  const centred = await parseMyTargets(await fixture('UPDATE Shot SET x=0,y=0 WHERE id=1;'));
  assert.deepEqual(allShots(centred)[0].point, { x: 0, y: 0 });
});

test('ZIP mismatched totals and unsupported target block only affected series without guessing scores', async () => {
  const mismatched = await parseMyTargets(await fixture('UPDATE End SET reachedPoints=20;'));
  assert.ok(mismatched.warnings.some(w => w.blocking && w.code === 'archive_series_totals_mismatch'));
  const unsupported = await parseMyTargets(await fixture('UPDATE Round SET targetId=999;'));
  assert.equal(unsupported.sessions[0].rounds[0].conditions, null);
  assert.equal(allShots(unsupported)[0].points, null);
  assert.equal(allShots(unsupported)[0].point, null);
  assert.ok(unsupported.warnings.some(w => w.blocking && w.code === 'unsupported_archive_score'));
});

test('ZIP repeated round indices retain distinct source IDs and incomplete plan', async () => {
  const p = await parseMyTargets(await fixture(`INSERT INTO Round VALUES(2,1,0,6,'18m',2,2,'40cm');
    INSERT INTO End VALUES(2,2,0,1,'12:01:00',10,1); INSERT INTO Shot VALUES(4,2,0,0,0,0,NULL);`));
  assert.deepEqual(p.sessions[0].rounds.map(r => r.sourceId), ['t1:r1', 't1:r2']);
  assert.equal(p.sessions[0].rounds[1].conditions?.targetProfileId, 'wa-indoor-five-inner-v1');
  assert.equal(p.sessions[0].rounds[1].plannedArrows, 6);
});

test('ZIP preserves reduced-face scores and converts exact positions to nominal-radius coordinates', async () => {
  for (const [target, diameter, profile, scale] of [
    [5, '40cm', 'wa-indoor-triple-outer-v1', .5],
    [2, '122cm', 'wa-indoor-five-outer-v1', .5],
    [1, '40cm', 'wa-outdoor-six-v1', .6],
  ] as const) {
    const preview = await parseMyTargets(await fixture(`UPDATE Round SET targetId=${target}, targetDiameter='${diameter}', targetScoringStyleIndex=0;
      UPDATE Shot SET scoringRing=0 WHERE id=1;`));
    assert.equal(preview.sessions[0].rounds[0].conditions?.targetProfileId, profile);
    assert.deepEqual(preview.requiredConfirmations, []);
    assert.deepEqual(allShots(preview).map(shot => shot.points), [10, 9]);
    assert.equal(allShots(preview)[0].code, 'X');
    assert.deepEqual(allShots(preview)[0].point, { x: .1 * scale, y: -.2 * scale });
    assert.deepEqual(allShots(preview)[0].rawPoint, { x: .1, y: -.2 });
    assert.deepEqual(allShots(preview).map(shot => shot.spot), target === 5 ? [0, 1] : [undefined, undefined]);
  }
});

test('ZIP rejects wrong SQLite version, broken references, invalid IDs and duplicate shot indexes', async () => {
  for (const sql of ['PRAGMA user_version=26;', 'UPDATE Shot SET endId=999;', 'UPDATE Shot SET id=-1 WHERE id=1;', 'UPDATE Shot SET `index`=0 WHERE id=2;', 'UPDATE Training SET date=NULL;', 'UPDATE Shot SET x=NULL WHERE id=3;']) {
    await assert.rejects(parseMyTargets(await fixture(sql)));
  }
});

test('ZIP validates paths, collisions, sizes and CRC before accepting source', async () => {
  for (const entries of [
    { '../data.db': strToU8('x') }, { '//data.db': strToU8('x') },
    { 'data.db': strToU8('x'), '/data.db': strToU8('x') },
    { 'data.db': strToU8('x'), 'extra.txt': strToU8('x') },
  ]) assert.throws(() => readMyTargetsZip(zipSync(entries)));
  const large = zipSync({ 'data.db': strToU8('x') }, { level: 0 });
  const view = new DataView(large.buffer); const central = large.findIndex((_, i) => i + 4 <= large.length && view.getUint32(i, true) === 0x02014b50);
  view.setUint32(central + 24, 26 * 1024 * 1024, true);
  assert.throws(() => readMyTargetsZip(large), /archive_too_large/);
  const corrupt = zipSync({ 'data.db': strToU8('database') }, { level: 0 });
  corrupt[30 + 'data.db'.length] ^= 1;
  assert.throws(() => readMyTargetsZip(corrupt), /archive_corrupt/);
});

test('CSV quotes, newlines, physical arrow numbers, X and explicit unknown positions are preserved', async () => {
  const p = await parseMyTargets(csv([
    { Title: 'A; "quoted"\nname', Points: 'X', 'Arrow numbers': '3' },
    { Title: 'A; "quoted"\nname', Points: 'M', x: '0', y: '0' },
    { Title: 'A; "quoted"\nname', Points: '10', x: '', y: '' },
  ]));
  assert.equal(p.sessions[0].title, 'A; "quoted"\nname');
  assert.deepEqual(allShots(p).map(s => [s.code, s.points]), [['X', 10], ['M', 0], ['10', 10]]);
  assert.deepEqual(allShots(p)[0].point, { x: .1, y: -.2 });
  assert.equal(allShots(p)[0].physicalArrowNumber, 3);
  assert.equal(allShots(p)[1].point, null);
  assert.equal(allShots(p)[2].point, null);
  assert.equal(p.sessions[0].rounds[0].plannedArrows, null);
  assert.ok(p.requiredConfirmations.some(c => c.startsWith('csv_conditions_and_series_plan:')));
});

test('CSV detects reset ambiguity with split/join preview and does not split condition changes', async () => {
  const source = csv([{ End: '1' }, { End: '2' }, { End: '1' }]);
  const p = await parseMyTargets(source);
  assert.equal(p.sessions.length, 2);
  assert.ok(p.requiredConfirmations.some(c => c.startsWith('session_boundary:')));
  const joined = await parseMyTargets(source, { joinBeforeRecords: [4] });
  assert.equal(joined.sessions.length, 1);
  assert.equal(joined.sessions[0].rounds[0].series.length, 3);
  const changed = await parseMyTargets(csv([{ End: '2' }, { End: '1', Distance: '30m' }]));
  assert.equal(changed.sessions.length, 1);
  assert.equal(changed.sessions[0].rounds.length, 2);
});

test('CSV localized targets map as review candidates; unsupported conditions stay null', async () => {
  const known = await parseMyTargets(csv([{ Target: 'WA полный (40cm)' }, { Target: 'WA 5 колец (40cm)' }]));
  assert.deepEqual(known.sessions[0].rounds.map(r => r.conditions?.targetProfileId), ['wa-indoor-outer-v1', 'wa-indoor-five-outer-v1']);
  const unknown = await parseMyTargets(csv([{ Target: 'Unknown target', Distance: 'far', Date: '2024-02-31' }]));
  assert.equal(unknown.sessions[0].localDate, null);
  assert.equal(unknown.sessions[0].rounds[0].conditions, null);
  assert.equal(allShots(unknown)[0].point, null);
  assert.deepEqual(allShots(unknown)[0].rawPoint, { x: .1, y: -.2 });
});

test('CSV imports named bows, arrow sets and kits with stable IDs while leaving unknown specifications unknown', async () => {
  const source = csv([
    { Bow: '  Recurve named bow  ', Arrow: 'Carbon arrows', 'Arrow numbers': '7' },
    { Bow: 'Recurve named bow', Arrow: 'Carbon arrows', End: '2' },
    { Bow: 'Recurve named bow', Arrow: 'Other arrows', End: '3' },
  ]);
  const preview = await parseMyTargets(source);
  assert.ok(isLibrary(preview.equipment));
  assert.equal(preview.equipment.bows.length, 1);
  assert.equal(preview.equipment.arrows.length, 2);
  assert.equal(preview.equipment.kits.length, 2);
  assert.equal(preview.equipment.bows[0].name, 'Recurve named bow');
  assert.equal(preview.equipment.bows[0].category, null);
  assert.equal(preview.equipment.arrows[0].diameterMm, null);
  assert.equal(preview.equipment.arrows[0].numberedCount, undefined);
  assert.equal(allShots(preview)[0].physicalArrowNumber, 7);
  const snapshots = preview.sessions[0].rounds.map(round => round.conditions?.equipment);
  assert.equal(snapshots[0]?.id, snapshots[1]?.id);
  assert.equal(snapshots[0]?.arrows.id, preview.equipment.arrows[0].id);
  assert.equal(snapshots[0]?.arrows.diameterMm, null);
  assert.equal(snapshots[0]?.arrows.numberedCount, undefined);
  assert.equal(snapshots[0]?.bow.category, null);
  const otherFile = await parseMyTargets(csv([{ Bow: 'Recurve named bow', Arrow: 'Carbon arrows', Title: 'Different export' }]));
  assert.equal(otherFile.equipment.bows[0].id, preview.equipment.bows[0].id);
  assert.equal(otherFile.equipment.arrows[0].id, preview.equipment.arrows[0].id);
  assert.equal(otherFile.equipment.kits[0].id, preview.equipment.kits[0].id);
  assert.equal(preview.equipmentSourceRows[0].values.name, '  Recurve named bow  ');
  assert.ok(preview.requiredConfirmations.some(key => key.startsWith('equipment_mapping:')));
});

test('CSV incomplete or overlong equipment names never fabricate gear and preserve valid named candidates', async () => {
  const preview = await parseMyTargets(csv([
    { Bow: 'Only bow', Arrow: '', End: '1' },
    { Bow: '', Arrow: 'Only arrows', End: '2' },
    { Bow: 'x'.repeat(101), Arrow: 'Only arrows', End: '3', Target: 'Unmapped target' },
  ]));
  assert.ok(isLibrary(preview.equipment));
  assert.equal(preview.equipment.bows.length, 1);
  assert.equal(preview.equipment.arrows.length, 1);
  assert.equal(preview.equipment.kits.length, 2);
  assert.ok(preview.equipment.kits.some(kit => kit.bowId === null));
  assert.ok(preview.equipment.kits.some(kit => kit.arrowsId === null));
  const unknown = preview.sessions[0].rounds[2];
  assert.equal(unknown.conditions, null);
  assert.equal(unknown.equipment?.arrows.name, 'Only arrows');
  assert.equal(unknown.equipment?.bow.name, '');
  assert.ok(preview.warnings.some(warning => warning.code === 'equipment_name_mapping_required'));
});

test('CSV rejects malformed UTF-8, quoting, header collisions and inconsistent widths', async () => {
  await assert.rejects(parseMyTargets(new Uint8Array([255])));
  await assert.rejects(parseMyTargets(strToU8('"unclosed')));
  await assert.rejects(parseMyTargets(strToU8(MYTARGETS_HEADERS.join(';') + '\nwrong;width')));
  await assert.rejects(parseMyTargets(strToU8([...MYTARGETS_HEADERS, 'Title'].join(';'))));
});

test('CSV provenance counts blank records while embedded newlines stay inside their logical record', async () => {
  const source = new TextDecoder().decode(csv([{ Title: 'A\nB' }]));
  const p = await parseMyTargets(strToU8('\n' + source.replace('\r\n', '\r\n\r\n')));
  assert.equal(allShots(p)[0].sourceRecord, 4);
});

test('provenance keys are stable for repeated bytes; different files only warn about possible overlap', async () => {
  const source = csv([{ Points: 'X' }]);
  const first = await parseMyTargets(source), second = await parseMyTargets(source);
  assert.equal(first.fileHash, second.fileHash);
  assert.equal(first.sessions[0].fingerprint, second.sessions[0].fingerprint);
  const end = first.sessions[0].rounds[0].series[0];
  const result = findMyTargetsDuplicates(second, { sourceRecords: [{ fileHash: first.fileHash, sourceRecord: 2 }], seriesFingerprints: [end.fingerprint] });
  assert.deepEqual(result.alreadyImported, [allShots(first)[0].sourceId]);
  assert.deepEqual(result.possibleOverlaps, [end.sourceId]);
  const different = findMyTargetsDuplicates(second, { sourceRecords: [{ fileHash: 'other-file', sourceRecord: 2 }], overlapFingerprints: [end.overlapFingerprint!] });
  assert.deepEqual(different.alreadyImported, []);
  assert.deepEqual(different.possibleOverlaps, [end.sourceId]);
});

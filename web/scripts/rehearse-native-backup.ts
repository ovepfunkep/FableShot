/** Local-only data rehearsal. Does not create an Android archive or write app storage. */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildNativeConversion } from '../src/native-conversion.ts';
import { buildNativeRecords } from '../src/native-activation.ts';
import { nativeArchiveTablePaths } from '../src/native-archive.ts';
import type { NativeArchiveInspection, NativeArchiveRow } from '../src/native-archive.ts';
import { DIARY_KEY } from '../src/persistence.ts';
import type { Diary } from '../src/persistence.ts';

const [backupPath, reportPath] = process.argv.slice(2);
if (!backupPath || !reportPath) throw Error('Usage: node scripts/rehearse-native-backup.ts BACKUP REPORT.json');
const root = resolve(backupPath), report = resolve(reportPath);
const rawManifest = readFileSync(join(root, 'manifest.json'));
const manifest = JSON.parse(rawManifest.toString('utf8').replace(/^\uFEFF/, ''));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
if (!Array.isArray(manifest.files) || !manifest.files.length) throw Error('Missing backup file manifest');
// Verify every file before copying anything. Reject paths rather than resolving them outside the backup.
for (const file of manifest.files) {
  if (typeof file.name !== 'string' || !/^[\w.-]+$/.test(file.name) || basename(file.name) !== file.name) throw Error('Unsafe backup filename');
  const bytes = readFileSync(join(root, file.name));
  if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw Error(`Backup integrity mismatch: ${file.name}`);
}
mkdirSync(resolve('artifacts/rehearsals'), { recursive: true });
const isolated = mkdtempSync(resolve('artifacts/rehearsals/native-'));
for (const file of manifest.files) copyFileSync(join(root, file.name), join(isolated, file.name));
const tables: Record<string, NativeArchiveRow[]> = {};
const databaseChecks: { kind: string; schema: number; integrity: string; foreignKeyErrors: number }[] = [];
let schema = 0;
for (const [kind, filename] of [['journal', 'fableshot.db'], ['equipment', 'fableshot-equipment.db']]) {
  const db = new DatabaseSync(join(isolated, filename));
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if (kind === 'journal') schema = version;
    const integrity = String(db.prepare('PRAGMA integrity_check').get()!.integrity_check);
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all().length;
    if (integrity !== 'ok' || foreignKeyErrors) throw Error(`Invalid ${kind} database`);
    databaseChecks.push({ kind, schema: version, integrity, foreignKeyErrors });
    for (const path of nativeArchiveTablePaths(schema).filter(path => path.startsWith(`data/${kind}/`))) {
      const table = basename(path, '.jsonl');
      tables[path] = db.prepare(`SELECT * FROM "${table}"`).all() as NativeArchiveRow[];
    }
  } finally { db.close(); }
}
const table = (name: string) => tables[`data/journal/${name}.jsonl`] ?? [];
const inspection: NativeArchiveInspection = {
  manifest: { formatVersion: schema - 2, journalSchema: schema, equipmentSchema: 1, preferencesFormat: 1,
    createdAtMs: Date.parse(manifest.createdUtc), appVersion: manifest.version, rowCounts: Object.fromEntries(
      Object.entries(tables).map(([path, rows]) => [path, rows.length])), payloads: [] },
  tables, preferences: { format: 1, values: {} }, sources: {},
  summary: { sessions: table('sessions').length, blocks: table('blocks').length, ends: table('ends').length,
    shots: table('shots').length, unscoredArrows: 0, equipmentItems: tables['data/equipment/equipment_items.jsonl'].length,
    sourceFiles: 0, totalRows: Object.values(tables).reduce((n, rows) => n + rows.length, 0), verifiedBytes: 0,
    validation: 'envelope-and-core-relations', unverified: ['raw-backup-rehearsal-only', 'preferences-not-decoded', 'archive-envelope-not-tested'] },
};
const conversion = buildNativeConversion(inspection);
// A temporary provenance receipt identifies this backup manifest, never a purported Android ZIP.
const projection = buildNativeRecords(conversion, { sha256: hash(rawManifest), bytes: rawManifest.length });
const diary: Diary = JSON.parse(projection.records[DIARY_KEY]!);
const webShots = diary.entries.flatMap(entry => entry.practice.rounds.flatMap(round => round.series.flatMap(series => series.shots)));
let checkedShots = 0;
for (const candidate of conversion.candidates) {
  const entry = diary.entries.find(entry => entry.nativeArchiveSession === candidate.sourceId);
  if (!entry) continue;
  const series = entry.practice.rounds.flatMap(round => round.series);
  for (const end of candidate.retainedFacts.ends) {
    const target = series.find(series => series.id === candidate.roundLocations[String(end.id)]?.webSeriesId);
    const original = candidate.retainedFacts.shots.filter(shot => shot.endId === end.id)
      .sort((a, b) => Number(a.inputIndex) - Number(b.inputIndex));
    if (!target && !original.length) continue;
    if (!target || target.shots.length !== original.length) throw Error('Converted series size differs');
    original.forEach((shot, index) => {
      const converted = target.shots[index];
      if (converted.points !== shot.points || (converted.physicalArrowNumber ?? null) !== shot.physicalArrowNumber ||
        (converted.point?.x ?? null) !== shot.x || (converted.point?.y ?? null) !== (shot.y === null ? null : -Number(shot.y))) {
        throw Error('Converted score, arrow number or coordinates differ');
      }
      checkedShots++;
    });
  }
}
const frequencies = (codes: string[]) => Object.fromEntries([...new Set(codes)].sort().map(code => [code, codes.filter(item => item === code).length]));
const result = {
  sourceBackup: basename(root), isolation: isolated, databaseChecks,
  scope: 'Database conversion only. Preferences, source ZIP envelope and device activation are not verified.',
  source: { sessions: table('sessions').length, shots: table('shots').length,
    points: table('shots').reduce((sum, row) => sum + Number(row.points), 0) },
  projected: { sessions: diary.entries.length, shots: webShots.length, points: webShots.reduce((sum, shot) => sum + shot.points, 0) },
  checks: { individuallyComparedShots: checkedShots, fields: ['points', 'physicalArrowNumber', 'x', 'inverted-y'],
    projectedEquipment: conversion.equipmentCandidates.filter(item => item.item !== null).length,
    achievementReceipts: diary.achievementLedger?.grants.length ?? 0,
    recordReceipts: diary.entries.reduce((n, entry) => n + (entry.personalRecords?.length ?? 0), 0) },
  candidateBlockers: frequencies(conversion.candidates.flatMap(candidate => candidate.blockers)),
  omissions: frequencies(projection.omissions.map(item => item.code)), retained: projection.retained,
};
mkdirSync(resolve(report, '..'), { recursive: true });
writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

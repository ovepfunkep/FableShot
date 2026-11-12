import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendShot, advanceSeries, emptyPractice, startRound, completePractice } from '../src/practice.ts';
import { reportCsv, reportCsvCell, reportSnapshot, REPORT_CSV_COLUMNS } from '../src/report-export.ts';
import { posterCards } from '../src/report-poster.ts';

const hit = { code: '9', points: 9, point: { x: .15, y: -.03 } };
function fixture() {
  let practice = appendShot(emptyPractice(), structuredClone(hit));
  practice = appendShot(practice, { points: 0, code: 'M', point: null });
  practice = advanceSeries(practice);
  practice = appendShot(practice, structuredClone(hit));
  practice = startRound(practice);
  practice = appendShot(practice, structuredClone(hit));
  return { id: 'exports', startedAt: '2026-11-11T10:00:00Z', practice: completePractice(practice, '2026-11-11T11:00:00Z') };
}

test('CSV quotes spreadsheet formulas safely while preserving numeric values and embedded quotes', () => {
  assert.equal(reportCsvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(reportCsvCell(' -5'), '"\' -5"');
  assert.equal(reportCsvCell(-.3), '"-0.3"');
  assert.equal(reportCsvCell('a;"b"'), '"a;""b"""');
  assert.equal(reportCsvCell(null), '""');
});

test('CSV includes misses, physical numbers, original conditions and Y-up coordinates without editing the entry', () => {
  const entry = fixture();
  entry.practice.rounds[0].series[0].shots[0].physicalArrowNumber = 7;
  const before = JSON.stringify(entry);
  const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(reportCsv(entry));
  assert.ok(csv.startsWith('\uFEFF"format";'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 5);
  const parse = (line: string) => line.match(/"(?:[^"]|"")*"/g)!.map(cell => cell.slice(1, -1).replaceAll('""', '"'));
  const row = Object.fromEntries(REPORT_CSV_COLUMNS.map((column, i) => [column, parse(lines[1])[i]]));
  assert.equal(row.x, '0.15');
  assert.equal(row.y, '0.03');
  assert.equal(row.physical_arrow_number, '7');
  assert.equal(row.round_number, '1');
  const miss = Object.fromEntries(REPORT_CSV_COLUMNS.map((column, i) => [column, parse(lines[2])[i]]));
  assert.equal(miss.points, '0'); assert.equal(miss.zone, 'M'); assert.equal(miss.y, '');
  assert.equal(JSON.stringify(entry), before);
});

test('poster uses entered maxima and every shot exactly once across round-card pages', () => {
  const entry = fixture();
  const snapshot = reportSnapshot(entry, null, true);
  assert.equal(snapshot.result.points, 27);
  assert.equal(snapshot.result.maximum, 40);
  assert.equal(snapshot.average, '6,75');
  const { cards, columns } = posterCards(snapshot);
  assert.equal(columns, 2);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(card => card.round.number), [1, 2]);
  assert.equal(cards.flatMap(card => card.rows).flatMap(row => row.codes).length, 4);
  assert.equal(snapshot.analysis[0].distribution[0], 1);
  const long = fixture();
  long.practice.rounds[0].series[0].shots = Array.from({ length: 200 }, () => structuredClone(hit));
  const split = posterCards(reportSnapshot(long, null, false));
  assert.equal(split.columns, 1);
  assert.equal(split.cards.flatMap(card => card.rows).flatMap(row => row.codes).length, 202);
  assert.ok(split.cards.some(card => card.rows.some(row => row.continuation)));
});

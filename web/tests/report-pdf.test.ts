import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { appendShot, advanceSeries, completePractice, emptyPractice, startRound } from '../src/practice.ts';
import { reportSnapshot } from '../src/report-export.ts';
import { createReportPdf } from '../src/report-pdf.ts';
import type { DiaryEntry } from '../src/persistence.ts';

const fonts = Promise.all(['regular', 'bold'].map(weight => readFile(new URL(`../public/fonts/manrope-pdf-${weight}.ttf`, import.meta.url))))
  .then(([regular, bold]) => ({ regular, bold }));

function fixture(): DiaryEntry {
  let practice = emptyPractice();
  const conditions = { ...practice.rounds[0].series[0].conditions,
    equipment: { id: 'kit', name: 'Учебный комплект', bow: { name: 'Лук', category: 'recurve' as const },
      arrows: { id: 'set', name: 'Карбон', diameterMm: 6, numberedCount: 3 } } };
  practice.rounds[0].series[0].conditions = conditions;
  for (let round = 0; round < 2; round++) {
    if (round) practice = startRound(practice);
    for (let i = 0; i < 9; i++) {
      if (i > 0 && i % 3 === 0) practice = advanceSeries(practice);
      practice = appendShot(practice, { code: '9', points: 9, point: { x: .15, y: (i % 3) * .01 }, physicalArrowNumber: i % 3 + 1 });
    }
  }
  return { id: 'pdf', title: 'Клубный вечер', startedAt: '2026-11-11T10:00:00Z',
    trainingTime: { closedMs: 3_600_000, activeSinceMs: null, partial: false }, practice: completePractice(practice, '2026-11-11T11:00:00Z'),
    personalRecords: [{ id: 'record', sessionId: 'pdf', kind: 'series', ruleVersion: 1, label: 'Новый рекорд серии', previousValue: 23,
      value: 27, previousSessionId: 'previous', recordedAtMs: 1, notifiedAtMs: null }] };
}

async function extract(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    const operators = await (await pdf.getPage(1)).getOperatorList();
    return { pages, firstPageHasRaster: operators.fnArray.includes(OPS.paintImageXObject) };
  } finally { await task.destroy(); }
}

test('detailed PDF is a standalone vector report with rounds, awards, records, norms and numbered-arrow analysis', async () => {
  const entry = fixture(), original = JSON.stringify(entry);
  const snapshot = reportSnapshot(entry, 'male', true, { grants: [{ id: 'START01', scope: 'all', earnedAt: '2026-11-11T11:00:00Z', sessionId: 'pdf' }] });
  const bytes = await createReportPdf(snapshot, await fonts);
  const { pages, firstPageHasRaster } = await extract(bytes);
  assert.equal(firstPageHasRaster, false);
  assert.match(pages[0], /ПОДРОБНЫЙ ОТЧЁТ/);
  assert.match(pages[0], /Клубный вечер/);
  const text = pages.join(' ');
  for (const title of ['Нормативы', 'Личные рекорды', 'Новый рекорд серии', 'Начало пути', 'Раунд 1', 'Раунд 2',
    'Общие очки', 'Карта попаданий', 'Плотность', 'Распределение попаданий', 'Сравнение попаданий']) assert.ok(text.includes(title), title);
  assert.match(text, /162\s*\/\s*180/);
  assert.match(text, /1 ч 0 мин/);
  const document = await PDFDocument.load(bytes);
  for (const page of document.getPages()) assert.deepEqual(page.getSize(), { width: 595, height: 842 });
  assert.equal(JSON.stringify(entry), original);
});

test('long series continue across PDF cards and disabled statistics are not exported', async () => {
  const entry = fixture();
  const first = entry.practice.rounds[0].series[0];
  first.shots = Array.from({ length: 201 }, () => structuredClone(first.shots[0])); first.plannedCount = 201;
  const snapshot = reportSnapshot(entry, 'male', false, { disabledStatistics: ['numbered_arrows', 'hit_map', 'distribution', 'mean_trend', 'norms', 'records'] });
  const { pages } = await extract(await createReportPdf(snapshot, await fonts));
  const text = pages.join(' ');
  assert.match(text, /201 стрел/);
  assert.equal((text.match(/Р1 · Серия 1/g) ?? []).length, 3);
  assert.match(text, /Р2 · Серия 1/);
  for (const title of ['Сравнение попаданий', 'Карта попаданий', 'Распределение попаданий', 'Нормативы', 'Личные рекорды']) assert.equal(text.includes(title), false, title);
});

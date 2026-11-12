import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createTechniquePdf, wrapPdfText } from '../src/technique-pdf.ts';
import { newTechniqueText } from '../src/technique.ts';

const fonts = {
  regular: await readFile(new URL('../public/fonts/manrope-pdf-regular.ttf', import.meta.url)),
  bold: await readFile(new URL('../public/fonts/manrope-pdf-bold.ttf', import.meta.url)),
};

test('PDF line wrapping keeps words when possible and splits long words without losing text', () => {
  assert.deepEqual(wrapPdfText('один два три', 8, value => value.length), ['один два', 'три']);
  assert.equal(wrapPdfText('длинноеслово'.repeat(20), 10, value => value.length).join(''), 'длинноеслово'.repeat(20));
  assert.deepEqual(wrapPdfText('   ', 10, value => value.length), []);
  assert.throws(() => wrapPdfText('а', 0, value => value.length));
});

test('PDF is A4 with Cyrillic font, full hidden details and multiple pages, without editing its source', async () => {
  const text = newTechniqueText();
  text.title = 'Спокойный выстрел';
  text.context = 'Баребоу · 18 м';
  text.description = 'Личная памятка для разбора с тренером.';
  text.phases = [{ id: 'phase', title: '1. Подготовка', steps: Array.from({ length: 20 }, (_, i) => ({
    id: `step-${i}`, short: `Пункт ${i + 1}`, detail: 'Проверить положение тела. '.repeat(35),
    children: 'Плечи расслаблены\nДышать спокойно', visible: false, question: 'Обсудить на следующей тренировке',
  })) }];
  const before = JSON.stringify(text);
  const bytes = await createTechniquePdf(text, fonts, 'Версия 2');
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() > 2);
  assert.equal(document.getTitle(), text.title);
  assert.deepEqual(document.getPage(0).getSize(), { width: 595, height: 842 });
  assert.equal(JSON.stringify(text), before);
});

test('invalid data and unsupported glyphs report an error rather than producing a broken PDF', async () => {
  await assert.rejects(createTechniquePdf({ ...newTechniqueText(), schema: 2 } as never, fonts), /формат/);
  await assert.rejects(createTechniquePdf({ ...newTechniqueText(), title: 'Невидимый \u{10ffff}' }, fonts), /не поддерживаются/);
});

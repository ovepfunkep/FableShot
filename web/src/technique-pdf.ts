import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { isTechniqueText, techniqueSubpoints } from './technique.ts';
import type { TechniqueText } from './technique.ts';

const pageSize: [number, number] = [595, 842];
const ink = rgb(26 / 255, 36 / 255, 30 / 255);
const muted = rgb(.44, .47, .44);
const accent = rgb(198 / 255, 244 / 255, 61 / 255);
const stripNumber = (value: string) => value.replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '').trim();

/** Greedy line wrapping with measured glyph widths, including unbroken long words. */
export function wrapPdfText(source: string, width: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  let rest = source.replace(/\t/g, '    ').trim();
  while (rest) {
    const chars = Array.from(rest);
    let low = 1, high = chars.length, count = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (measure(chars.slice(0, middle).join('')) <= width) { count = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (count === 0) throw new Error('Не удалось разместить символ в PDF. Сохрани памятку в TXT.');
    if (count < chars.length && chars[count] !== ' ' && chars[count - 1] !== ' ') {
      const breakAt = chars.slice(0, count).lastIndexOf(' ');
      if (breakAt > 0) count = breakAt;
    }
    lines.push(chars.slice(0, count).join('').trimEnd());
    rest = chars.slice(count).join('').trimStart();
  }
  return lines;
}

/** A4 reading copy matching Android TechniquePdf; never edits or publishes the memo. */
export async function createTechniquePdf(text: TechniqueText, fonts: { regular: Uint8Array; bold: Uint8Array }, versionLabel?: string): Promise<Uint8Array> {
  if (!isTechniqueText(text, true)) throw new Error('Проверь формат памятки перед экспортом.');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const plain = JSON.stringify(text) + (versionLabel ?? '');
  const missing = Array.from(new Set(Array.from(plain).filter(character => character.codePointAt(0)! > 31 && !supported.has(character.codePointAt(0)!))));
  if (missing.length) throw new Error(`В PDF не поддерживаются символы «${missing.slice(0, 8).join(' ')}». Убери их или сохрани памятку в TXT.`);
  pdf.setTitle(text.title.trim() || 'Моя памятка');
  pdf.setAuthor('FableShot');
  pdf.setSubject('Моя техника: полная расшифровка');
  let page: PDFPage;
  let y = 0;
  function draw(value: string, x: number, top: number, size: number, color: RGB = ink, heavy = false) {
    page.drawText(value, { font: heavy ? bold : font, x, y: 842 - top, size, color });
  }
  function startPage() {
    page = pdf.addPage(pageSize);
    const number = pdf.getPageCount();
    draw('FABLESHOT  /  МОЯ ТЕХНИКА', 42, 28, 9, rgb(77 / 255, 99 / 255, 45 / 255), true);
    draw(String(number), 540, 816, 9, muted);
    y = 58;
  }
  function room(height: number) { if (y + height > 785) startPage(); }
  function paragraph(raw: string, size = 11, heavy = false, indent = 0, color = ink) {
    for (const source of raw.split(/\r?\n/)) {
      if (!source.trim()) { room(7); y += 7; continue; }
      const face: PDFFont = heavy ? bold : font;
      const lines = wrapPdfText(source, 511 - indent, value => face.widthOfTextAtSize(value, size));
      for (const line of lines) {
        room(size + 6);
        draw(line, 42 + indent, y, size, color, heavy);
        y += size + 5;
      }
    }
    y += 5;
  }
  startPage();
  paragraph(text.title.trim() || 'Моя памятка', 24, true);
  if (versionLabel) paragraph(versionLabel, 9, false, 0, muted);
  if (text.context.trim()) paragraph(text.context, 11, true);
  if (text.description.trim()) paragraph(text.description);
  for (const [i, phase] of text.phases.entries()) {
    room(80); y += 10;
    page!.drawRectangle({ x: 42, y: 842 - (y + 8), width: 5, height: 24, color: accent });
    paragraph(`${i + 1}. ${stripNumber(phase.title) || 'Фаза'}`, 14, true, 8);
    y += 7;
    for (const [j, step] of phase.steps.entries()) {
      room(50);
      paragraph(`${i + 1}.${j + 1}. ${stripNumber(step.short) || `Пункт ${j + 1}`}`, 12, true);
      for (const line of techniqueSubpoints(step, i + 1, j + 1)) paragraph(line, 11, false, 16);
      if (step.question.trim()) paragraph(`Уточнить с тренером: ${step.question}`, 10, false, 16, rgb(112 / 255, 72 / 255, 32 / 255));
      y += 8;
    }
  }
  if (text.discussed || text.change.trim()) {
    room(22);
    if (text.discussed) paragraph(`Обсуждал с тренером: ${text.discussed} · личная отметка`, 9, false, 0, muted);
    if (text.change.trim()) paragraph(`Изменения версии: ${text.change}`, 9, false, 0, muted);
  }
  return pdf.save();
}

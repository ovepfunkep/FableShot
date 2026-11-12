import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { wrapPdfText } from './technique-pdf.ts';
import type { ReportSnapshot } from './report-export.ts';
import { formatAverage } from './preferences.ts';
import { getTargetProfile } from './target.ts';

/** A4 pages use the exact same immutable snapshot and complete series as the PNG cards. */
export async function createReportPdf(images: readonly Uint8Array[], snapshot: ReportSnapshot,
  fonts: { regular: Uint8Array; bold: Uint8Array }): Promise<Uint8Array> {
  if (!images.length) throw new Error('Нет данных для отчёта.');
  const pdf = await PDFDocument.create();
  pdf.setTitle('FableShot — тренировка');
  pdf.setAuthor('FableShot');
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  for (const bytes of images) {
    const image = await pdf.embedPng(bytes);
    const page = pdf.addPage([595, 842]);
    const scale = Math.min(559 / image.width, 806 / image.height);
    page.drawImage(image, { x: (595 - image.width * scale) / 2, y: 842 - 18 - image.height * scale,
      width: image.width * scale, height: image.height * scale });
  }
  const ink = rgb(.09, .15, .1);
  const green = rgb(.28, .4, .16);
  const gray = rgb(.45, .5, .45);
  const zoneHex = ['#334331', '#f6f5eb', '#f6f5eb', '#242b2e', '#242b2e', '#359ac3', '#359ac3', '#e94c40', '#e94c40', '#f6d544', '#f6d544'];
  const color = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  for (const [index, scope] of snapshot.analysis.entries()) {
    let page = pdf.addPage([595, 842]);
    let y = 800;
    const supported = new Set(font.getCharacterSet());
    function text(value: string, size = 11, heavy = false) {
      if (Array.from(value).some(char => !supported.has(char.codePointAt(0)!))) throw new Error('Для PDF замени необычные символы в названии снаряжения или сохрани PNG.');
      const face = heavy ? bold : font;
      for (const line of wrapPdfText(value, 511, line => face.widthOfTextAtSize(line, size))) {
        if (y < 50) { page = pdf.addPage([595, 842]); y = 800; }
        page.drawText(line, { x: 42, y, size, font: face, color: ink }); y -= size + 6;
      }
    }
    const decimal = (value: number | null | undefined) => value == null ? '—' : formatAverage(value, true);
    text('FABLESHOT / СТАТИСТИКА', 18, true);
    text(snapshot.conditions[index], 10);
    const { result, geometry, composite, distribution, shots } = scope;
    text(`${result.points}/${result.maximum} очков · средний ${decimal(result.average)} · ${shots.length} стрел`, 13, true);
    text(`Кучность RMS: ${decimal(geometry?.rmsMm)} мм · смещение: ${decimal(geometry?.shiftMm)} мм`);
    text(`Доля десяток: ${decimal(distribution[10] / shots.length * 100)}%`);
    if (composite?.total !== undefined) {
      text(`Общие очки: ${decimal(composite.total)} / 105`, 13, true);
      text(`Попадания ${decimal(composite.base)} · кучность +${decimal(composite.groupBonus)} · стабильность +${decimal(composite.stabilityBonus)}`);
    }
    for (const progress of scope.progress) {
      text(`Прогресс${progress.fullRankAvailable ? '' : ' (предварительно)'}: ${progress.relativePercent == null ? `${decimal(progress.rawIncrease)} балла` : `${progress.relativePercent >= 0 ? '+' : ''}${decimal(progress.relativePercent)}%`}`, 12, true);
      text(`Средний базы ${decimal(progress.baselineAverage)} → ${decimal(progress.currentAverage)}`);
    }
    if (y < 510) { page = pdf.addPage([595, 842]); y = 800; }
    y -= 20;
    page.drawText('Карта попаданий', { x: 42, y, size: 12, font: bold, color: ink });
    page.drawText('Распределение зон', { x: 320, y, size: 12, font: bold, color: ink });
    const center = { x: 157, y: y - 125 };
    const profile = getTargetProfile(scope.conditions.targetProfileId);
    const limit = shots.reduce((limit, shot) => shot.point ? Math.max(limit, Math.hypot(shot.point.x, shot.point.y)) : limit, 1);
    const radius = 102 / limit;
    for (const zone of [...profile?.zones ?? []].reverse()) {
      page.drawCircle({ x: center.x, y: center.y, size: radius * zone.outerRadius,
        color: color(zoneHex[zone.points]), borderColor: gray, borderWidth: .4 });
    }
    for (const shot of shots) if (shot.point) page.drawCircle({ x: center.x + shot.point.x * radius,
      y: center.y - shot.point.y * radius, size: 2, color: ink, borderColor: rgb(1, 1, 1), borderWidth: .5 });
    const highest = Math.max(...distribution, 1);
    distribution.forEach((count, zone) => {
      const x = 321 + zone * 20;
      const bottom = y - 210;
      page.drawRectangle({ x, y: bottom, width: 15, height: count / highest * 155, color: green });
      page.drawText(zone === 0 ? 'M' : String(zone), { x, y: bottom - 15, size: 8, font, color: ink });
      page.drawText(String(count), { x, y: bottom + count / highest * 155 + 5, size: 8, font, color: ink });
    });
    y -= 280;
    page.drawText('Средний балл по сериям', { x: 42, y, size: 12, font: bold, color: ink });
    y -= 165;
    for (const mean of [0, 5, 10]) {
      page.drawText(String(mean), { x: 42, y: y + mean * 14, size: 9, font, color: gray });
      page.drawLine({ start: { x: 62, y: y + mean * 14 }, end: { x: 545, y: y + mean * 14 }, color: gray, thickness: .3 });
    }
    const positions = scope.series.map((series, i) => ({ x: scope.series.length === 1 ? 303 : 65 + i * 475 / (scope.series.length - 1), y: y + (series.average ?? 0) * 14 }));
    positions.forEach((point, i) => {
      if (i) page.drawLine({ start: positions[i - 1], end: point, color: green, thickness: 1.5 });
      page.drawCircle({ ...point, size: 2.5, color: green });
    });
  }
  return pdf.save();
}

import type { DiaryEntry } from './persistence.ts';
import { buildProgressTimeline } from './progress-timeline.ts';
import { formatAverage } from './preferences.ts';
import { wrapPdfText } from './technique-pdf.ts';
import { loadReportFonts } from './report-share-session.ts';

export async function createProgressPdf(entries: readonly DiaryEntry[], period: string): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, { default: fontkit }, fonts] = await Promise.all([
    import('pdf-lib'), import('@pdf-lib/fontkit'), loadReportFonts(),
  ]);
  const pdf = await PDFDocument.create();
  pdf.setTitle('FableShot — отчёт по тренировкам');
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const supported = new Set(regular.getCharacterSet());
  const ink = rgb(.08, .14, .09);
  const edge = rgb(.83, .88, .83);
  let page = pdf.addPage([595, 842]);
  let y = 0;
  function pageHeader() {
    page.drawRectangle({ x: 0, y: 770, width: 595, height: 72, color: ink });
    page.drawText('FABLESHOT', { x: 42, y: 804, size: 17, font: bold, color: rgb(.78, .96, .24) });
    page.drawText('Отчёт по тренировкам', { x: 42, y: 782, size: 12, font: regular, color: rgb(1, 1, 1) });
    page.drawText(String(pdf.getPageCount()), { x: 530, y: 35, size: 9, font: regular, color: ink });
    y = 740;
  }
  function ensure(height: number) {
    if (y - height >= 56) return;
    page = pdf.addPage([595, 842]);
    pageHeader();
  }
  function text(value: string, size = 10, emphasis = false) {
    const font = emphasis ? bold : regular;
    const safe = Array.from(value, char => supported.has(char.codePointAt(0)!) ? char : ' ').join('');
    for (const line of wrapPdfText(safe, 511, value => font.widthOfTextAtSize(value, size))) {
      ensure(size + 5);
      page.drawText(line, { x: 42, y, size, font, color: ink });
      y -= size + 5;
    }
  }
  pageHeader();
  const shots = entries.flatMap(entry => entry.practice.rounds.flatMap(round => round.series.flatMap(series => series.shots)));
  const points = shots.reduce((sum, shot) => sum + shot.points, 0);
  text(period, 18, true);
  text(`${entries.length} тренировок · ${shots.length} стрел · ${points} очков · средний ${formatAverage(shots.length ? points / shots.length : null, true)}`, 11);
  const groups = buildProgressTimeline(entries);
  for (const group of groups) {
    y -= 12;
    ensure(75);
    page.drawLine({ start: { x: 42, y: y + 7 }, end: { x: 553, y: y + 7 }, thickness: .6, color: edge });
    text(group.label, 12, true);
    const arrows = group.points.reduce((sum, point) => sum + point.arrows, 0);
    const total = Math.round(group.points.reduce((sum, point) => sum + (point.values.average ?? 0) * point.arrows, 0));
    text(`${group.points.length} тренировок · ${arrows} стрел · ${total}/${arrows * 10} · средний ${formatAverage(total / arrows, true)}`);
    for (const point of group.points) {
      text(`${point.date} · ${point.title} · ${Math.round((point.values.average ?? 0) * point.arrows)}/${point.arrows * 10} · средний ${formatAverage(point.values.average, true)}`);
    }
  }
  const listed = new Set(groups.flatMap(group => group.points.map(point => point.sessionId)));
  const undated = entries.filter(entry => !listed.has(entry.id));
  if (undated.length) {
    y -= 12;
    ensure(55);
    text('Тренировки без даты', 12, true);
    for (const entry of undated) {
      const shots = entry.practice.rounds.flatMap(round => round.series.flatMap(series => series.shots));
      const score = shots.reduce((sum, shot) => sum + shot.points, 0);
      text(`${entry.title || 'Тренировка'} · ${score}/${shots.length * 10} · средний ${formatAverage(shots.length ? score / shots.length : null, true)}`);
    }
  }
  return pdf.save();
}

export async function renderProgressPages(pdfBytes: Uint8Array): Promise<File[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const task = pdfjs.getDocument({ data: pdfBytes, isEvalSupported: false });
  try {
    const pdf = await task.promise;
    const files: File[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Не удалось подготовить страницу PNG.');
      files.push(new File([blob], `FableShot-прогресс-${index}.png`, { type: 'image/png' }));
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    return files;
  } finally {
    await task.destroy();
  }
}

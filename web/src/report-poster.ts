import type { ReportSnapshot } from './report-export.ts';
import { formatAverage } from './preferences.ts';
import { reportSectionShown } from './report-composition.ts';
import type { ReportComposition } from './report-composition.ts';
import { summarize } from './target.ts';

const palette = { background: '#0e160f', surface: '#1a271d', ink: '#f2f6ee', muted: '#b2beb1',
  accent: '#c6f43d', edge: '#334331', gold: '#f4d35e' };
const zoneColors = ['#334331', '#f6f5eb', '#f6f5eb', '#242b2e', '#242b2e', '#359ac3', '#359ac3', '#e94c40', '#e94c40', '#f6d544', '#f6d544'];
type Row = { number: number; continuation: boolean; codes: { code: string; points: number }[]; score?: string };
type Card = { round: ReportSnapshot['rounds'][number]; rows: Row[]; part: number; parts: number };

/** Same ten-series round cards as TrainingPoster.kt; long series flow without dropping shots. */
export function posterCards(snapshot: ReportSnapshot, composition?: ReportComposition): { cards: Card[]; columns: number } {
  const showShots = composition?.showShots ?? true;
  const columns = (showShots && snapshot.rounds.some(round => round.series.some(series => series.shots.length > 6))) || snapshot.conditions.length > 6 ? 1 : 2;
  if (!reportSectionShown(snapshot, composition, 'series')) return { cards: [], columns };
  const perRow = columns === 1 ? 18 : 6;
  const cards = snapshot.rounds.flatMap(round => {
    const rows = round.series.flatMap(series => {
      if (!showShots) {
        const result = summarize(series.shots);
        return [{ number: series.number, continuation: false, codes: [], score: `${result.points}/${result.maximum} · ${formatAverage(result.average, snapshot.hundredths)}` }];
      }
      const rows: Row[] = [];
      for (let offset = 0; offset < series.shots.length; offset += perRow) {
        rows.push({ number: series.number, continuation: offset > 0, codes: series.shots.slice(offset, offset + perRow) });
      }
      return rows;
    });
    const parts = Math.ceil(rows.length / 10);
    return Array.from({ length: parts }, (_, part) => ({ round, rows: rows.slice(part * 10, part * 10 + 10), part: part + 1, parts }));
  });
  if (cards.length / columns > 100) throw new Error('Для картинки слишком много страниц. Выбери подробный PDF.');
  return { cards, columns };
}

async function encodePoster(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  let timeout = 0;
  try {
    const blob = await Promise.race([
      new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')),
      // Chromium can defer an idle canvas encode while another report is open.
      new Promise<null>(resolve => { timeout = window.setTimeout(() => resolve(null), 1_000); }),
    ]);
    if (blob) return new Uint8Array(await blob.arrayBuffer());
    const data = canvas.toDataURL('image/png');
    if (!data.startsWith('data:image/png;base64,')) throw new Error('Не удалось создать картинку.');
    return Uint8Array.from(atob(data.slice('data:image/png;base64,'.length)), character => character.charCodeAt(0));
  } finally { window.clearTimeout(timeout); }
}

export async function createReportPosters(snapshot: ReportSnapshot, composition?: ReportComposition): Promise<Uint8Array[]> {
  await document.fonts.ready;
  const { cards, columns } = posterCards(snapshot, composition);
  const showResult = reportSectionShown(snapshot, composition, 'result');
  const rank = reportSectionShown(snapshot, composition, 'norms') ? snapshot.rankDisplay : null;
  const composite = reportSectionShown(snapshot, composition, 'general_score') ? snapshot.composite : null;
  const showDistribution = composition?.sections.includes('distribution') ?? false;
  const result: Uint8Array[] = [];
  const pages = Math.max(1, Math.ceil(cards.length / columns));
  for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось открыть рисование отчёта.');
    function face(size: number, bold = false) { ctx!.font = `${bold ? 700 : 400} ${size}px Manrope, sans-serif`; }
    function wrap(text: string, width: number, size: number, bold = false): string[] {
      face(size, bold);
      const lines: string[] = [];
      let line = '';
      for (const char of text) {
        if (line && ctx!.measureText(line + char).width > width) { lines.push(line); line = ''; }
        line += char;
      }
      if (line) lines.push(line);
      return lines;
    }
    const conditionLines = snapshot.conditions.flatMap((condition, i) => wrap(`${snapshot.conditions.length > 1 ? `${i + 1}. ` : ''}${condition}`, 968, 27));
    const titleLines = wrap(snapshot.title, 968, 42, true);
    const conditionsTop = 146 + titleLines.length * 54;
    const heroTop = conditionsTop + conditionLines.length * 37 + 13;
    const band = rank?.label ? snapshot.interval : null;
    const heroHeight = showResult || rank?.label || composite !== null
      ? (showResult || rank?.label ? 198 : 44) + (composite !== null ? 55 : 0) + (band ? 115 : 0) : 0;
    const distributionTop = heroTop + (heroHeight ? heroHeight + 24 : 0);
    const gridTop = distributionTop + (showDistribution ? 166 : 0);
    const pageCards = cards.slice(pageIndex * columns, (pageIndex + 1) * columns);
    const gridHeight = pageCards.length ? 122 + Math.max(...pageCards.map(card => card.rows.length)) * 64 : 0;
    canvas.height = Math.max(320, gridTop + gridHeight + 106);
    if (canvas.height > 16000) throw new Error('Слишком много данных для картинки. Выбери подробный PDF.');
    function text(value: string, x: number, y: number, size = 27, color = palette.ink, bold = false) {
      face(size, bold); ctx!.fillStyle = color; ctx!.fillText(value, x, y);
    }
    function box(x: number, y: number, width: number, height: number) {
      ctx!.beginPath(); ctx!.roundRect(x, y, width, height, 30);
      ctx!.fillStyle = palette.surface; ctx!.fill(); ctx!.strokeStyle = palette.edge; ctx!.lineWidth = 2; ctx!.stroke();
    }
    ctx.fillStyle = palette.background; ctx.fillRect(0, 0, 1080, canvas.height);
    ctx.strokeStyle = '#c6f43d0c'; ctx.lineWidth = 2;
    for (const radius of [160, 240, 330, 430]) { ctx.beginPath(); ctx.arc(1030, 260, radius, 0, Math.PI * 2); ctx.stroke(); }
    text('FABLESHOT', 56, 76, 38, palette.accent, true);
    if (snapshot.startLabel) {
      face(23);
      text(snapshot.startLabel, 1024 - ctx.measureText(snapshot.startLabel).width, 76, 23, palette.muted);
    }
    titleLines.forEach((line, i) => text(line, 56, 132 + i * 54, 42, palette.ink, true));
    conditionLines.forEach((line, i) => text(line, 56, conditionsTop + i * 37, 27, palette.muted));
    if (heroHeight) box(56, heroTop, 968, heroHeight);
    if (showResult) {
      text('Результат', 88, heroTop + 42, 25, palette.muted, true);
      text(`${snapshot.result.points} / ${snapshot.result.maximum}`, 88, heroTop + 111, rank?.label ? 63 : 75, palette.ink, true);
      const detail = [!snapshot.disabledStatistics.includes('average') && `Средний ${snapshot.average}`,
        !snapshot.disabledStatistics.includes('volume') && `${snapshot.result.maximum / 10} стрел`,
        !snapshot.disabledStatistics.includes('training_time') && snapshot.duration].filter(Boolean).join(' · ');
      if (detail) text(detail, 88, heroTop + 160, 24, palette.muted);
    }
    if (rank?.label) {
      const x = showResult ? 758 : 88;
      text(rank.forecast ? 'Темп' : 'Разряд', x, heroTop + 42, 20, palette.gold, true);
      text(rank.label, x, heroTop + 110, 54, palette.gold, true);
      text(rank.actual ?? snapshot.rankClass ?? '', x, heroTop + 155, 19, palette.muted);
    }
    if (composite !== null) text(`Общие очки ${composite} / 105`, 88, heroTop + (showResult || rank?.label ? 218 : 56), 25, palette.accent, true);
    if (band) {
      const fraction = Math.max(0, Math.min(1, (band.points - band.lowerScore) / Math.max(1, band.upperScore - band.lowerScore)));
      const scale = heroTop + heroHeight - 56;
      text(`${band.lower} · ${band.lowerScore}`, 88, scale - 24, 23, palette.muted);
      text(`${band.upper} · ${band.upperScore}`, 695, scale - 24, 23, palette.muted);
      ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.strokeStyle = palette.edge;
      ctx.beginPath(); ctx.moveTo(100, scale); ctx.lineTo(980, scale); ctx.stroke();
      ctx.strokeStyle = palette.accent; ctx.beginPath(); ctx.moveTo(100, scale); ctx.lineTo(100 + 880 * fraction, scale); ctx.stroke();
      ctx.fillStyle = palette.ink; ctx.beginPath(); ctx.arc(100 + 880 * fraction, scale, 11, 0, Math.PI * 2); ctx.fill();
    }
    if (showDistribution) {
      box(56, distributionTop, 968, 142);
      text('Распределение попаданий', 88, distributionTop + 42, 25, palette.ink, true);
      const counts = zoneColors.map((_, zone) => snapshot.analysis.reduce((sum, scope) => sum + scope.distribution[zone], 0));
      const total = counts.reduce((sum, count) => sum + count, 0);
      let x = 88;
      counts.forEach((count, zone) => {
        if (!count) return;
        const width = 904 * count / total;
        ctx.fillStyle = zoneColors[zone]; ctx.fillRect(x, distributionTop + 67, width, 34);
        if (width > 33) text(zone ? String(zone) : 'M', x + 7, distributionTop + 93, 21, zone === 0 || zone === 3 || zone === 4 ? palette.ink : palette.background, true);
        x += width;
      });
      text(`Доля 10 · ${formatAverage(100 * counts[10] / total, false)}%      Доля 10+9 · ${formatAverage(100 * (counts[10] + counts[9]) / total, false)}%`, 88, distributionTop + 128, 21, palette.muted);
    }
    const width = columns === 1 ? 968 : 472;
    pageCards.forEach((card, column) => {
      const left = 56 + column * (width + 24);
      box(left, gridTop, width, 122 + card.rows.length * 64);
      text(`Раунд ${card.round.number}${card.parts > 1 ? ` · ${card.part}/${card.parts}` : ''}`, left + 22, gridTop + 46, 32, palette.ink, true);
      text(`${card.round.result.points}/${card.round.result.maximum} · ${formatAverage(card.round.result.average, false)}`, left + 22, gridTop + 85, 25, palette.muted);
      card.rows.forEach((row, i) => {
        const top = gridTop + 112 + i * 64;
        text(`${String(row.number).padStart(2, '0')}${row.continuation ? '…' : ''}`, left + 22, top + 31, 23, palette.muted);
        if (row.score) text(row.score, left + 74, top + 31, 26, palette.ink, true);
        row.codes.forEach((shot, shotIndex) => {
          const x = left + 74 + shotIndex * 50;
          ctx.beginPath(); ctx.roundRect(x, top, 43, 43, 10); ctx.fillStyle = zoneColors[shot.points]; ctx.fill();
          const label = shot.code;
          face(22, true); ctx.fillStyle = shot.points === 0 || shot.points === 3 || shot.points === 4 ? palette.ink : '#111811';
          ctx.fillText(label, x + (43 - ctx.measureText(label).width) / 2, top + 30);
        });
      });
    });
    text('Каждая стрела — часть истории.', 56, canvas.height - 62, 24, palette.muted);
    text(`${pageIndex + 1} / ${pages}`, 937, canvas.height - 62, 22, palette.muted);
    result.push(await encodePoster(canvas));
  }
  return result;
}

import type { ReportSnapshot } from './report-export.ts';
import { formatAverage } from './preferences.ts';
import { reportSectionShown } from './report-composition.ts';
import type { ReportComposition } from './report-composition.ts';
import { summarize } from './target.ts';
import { exerciseRankCoverage } from './exercise-rank.ts';
import { distributionHeight, distributionWidth, reportDistribution } from './report-distribution.ts';

const palette = { background: '#0e160f', surface: '#1a271d', ink: '#f2f6ee', muted: '#b2beb1',
  accent: '#c6f43d', edge: '#334331', gold: '#f4d35e' };
const zoneColors = ['#334331', '#f6f5eb', '#f6f5eb', '#242b2e', '#242b2e', '#359ac3', '#359ac3', '#e94c40', '#e94c40', '#f6d544', '#f6d544'];
type Row = { number: number; continuation: boolean; codes: { code: string; points: number }[]; score: string; average: string; total: string };
type Card = { round: ReportSnapshot['rounds'][number]; rows: Row[]; part: number };

/** Round tables use up to ten rows per card. Long series continue on the next row. */
export function posterCards(snapshot: ReportSnapshot, composition?: ReportComposition): { cards: Card[]; columns: number } {
  const showShots = composition?.showShots ?? true;
  const columns = (showShots && snapshot.rounds.some(round => round.series.some(series => series.shots.length > 6))) || snapshot.conditions.length > 6 ? 1 : 2;
  if (!reportSectionShown(snapshot, composition, 'series')) return { cards: [], columns };
  const perRow = columns === 1 ? 18 : 6;
  const cards = snapshot.rounds.flatMap(round => {
    let cumulative = 0;
    const rows = round.series.flatMap(series => {
      const result = summarize(series.shots);
      cumulative += result.points;
      const final = { score: `${result.points}/${result.maximum}`, average: formatAverage(result.average, snapshot.hundredths), total: String(cumulative) };
      if (!showShots) {
        return [{ number: series.number, continuation: false, codes: [], ...final }];
      }
      const rows: Row[] = [];
      for (let offset = 0; offset < series.shots.length; offset += perRow) {
        rows.push({ number: series.number, continuation: offset > 0, codes: series.shots.slice(offset, offset + perRow),
          ...(offset + perRow >= series.shots.length ? final : { score: '', average: '', total: '' }) });
      }
      return rows;
    });
    const parts = Math.ceil(rows.length / 10);
    return Array.from({ length: parts }, (_, part) => ({ round, rows: rows.slice(part * 10, part * 10 + 10), part: part + 1 }));
  });
  return { cards, columns };
}

const cardHeight = (card: Card) => 64 + card.rows.length * 42;
const pageLimit = 1500, footerHeight = 58, gap = 24;

export function posterTablePages(cards: readonly Card[], columns: number, firstTop: number) {
  const pages: { top: number; height: number; cards: readonly Card[] }[][] = [[]];
  let top = firstTop;
  for (let offset = 0; offset < cards.length; offset += columns) {
    const row = cards.slice(offset, offset + columns);
    const height = Math.max(...row.map(cardHeight));
    if (top + height + footerHeight > pageLimit) { pages.push([]); top = 106; }
    pages[pages.length - 1].push({ top, height, cards: row });
    top += height + gap;
  }
  return pages;
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
  const result: Uint8Array[] = [];
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
  const introPages: { lines: { value: string; size: number; y: number }[]; bottom: number }[] = [{ lines: [], bottom: 122 }];
  function placeIntroLine(value: string, size: number, height: number) {
    let page = introPages.at(-1)!;
    if (page.bottom + height + footerHeight > pageLimit) {
      page = { lines: [], bottom: 122 };
      introPages.push(page);
    }
    page.lines.push({ value, size, y: page.bottom });
    page.bottom += height;
  }
  titleLines.forEach(line => placeIntroLine(line, 42, 50));
  introPages.at(-1)!.bottom += 10;
  conditionLines.forEach(line => placeIntroLine(line, 27, 36));
  const resultShown = reportSectionShown(snapshot, composition, 'result');
  const posterRank = reportSectionShown(snapshot, composition, 'norms') ? snapshot.rankDisplay : null;
  const rankCoverage = posterRank?.label ? exerciseRankCoverage(snapshot.rankDetails) : null;
  const posterComposite = reportSectionShown(snapshot, composition, 'general_score') ? snapshot.composite : null;
  const distributionShown = reportSectionShown(snapshot, composition, 'distribution') && !!composition;
  const heroHeight = resultShown || posterRank?.label || posterComposite !== null
    ? (resultShown || posterRank?.label ? 168 : 74) + (rankCoverage ? 26 : 0) + (posterComposite !== null ? 42 : 0) : 0;
  const summaryHeight = heroHeight ? heroHeight + gap : 0;
  if (summaryHeight && introPages.at(-1)!.bottom + summaryHeight + footerHeight > pageLimit) {
    introPages.push({ lines: [], bottom: 110 });
  }
  const summaryPage = introPages.length - 1;
  const heroTop = introPages[summaryPage].bottom;
  const gridTop = heroTop + summaryHeight;
  const layout = posterTablePages(cards, columns, gridTop);
  const lastTable = layout.at(-1)!.at(-1);
  const distributionScale = 1.36;
  const distributionCardHeight = 48 + distributionHeight * distributionScale;
  let distributionTop = lastTable ? lastTable.top + lastTable.height + gap : gridTop;
  if (distributionShown && distributionTop + distributionCardHeight + footerHeight > pageLimit) {
    layout.push([]);
    distributionTop = 106;
  }
  const pages = layout.length + summaryPage;
  if (pages > 100) throw new Error('Слишком много данных для картинки. Выбери подробный PDF.');
  for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
    const first = pageIndex === 0;
    const summary = pageIndex === summaryPage;
    const showResult = summary && resultShown;
    const rank = summary ? posterRank : null;
    const composite = summary ? posterComposite : null;
    const showDistribution = distributionShown && pageIndex === pages - 1;
    const racks = layout[pageIndex - summaryPage] ?? [];
    const lastRack = racks.at(-1);
    const contentBottom = showDistribution ? distributionTop + distributionCardHeight
      : lastRack ? lastRack.top + lastRack.height : summary ? gridTop : introPages[pageIndex]?.bottom ?? 110;
    canvas.height = Math.max(250, Math.min(pageLimit, contentBottom + footerHeight));
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
    text(first ? 'FABLESHOT' : titleLines[0] || 'FABLESHOT', 56, first ? 76 : 66, first ? 38 : 32, palette.accent, true);
    if (snapshot.startLabel) {
      face(23);
      text(snapshot.startLabel, 1024 - ctx.measureText(snapshot.startLabel).width, first ? 76 : 92, 23, palette.muted);
    }
    introPages[pageIndex]?.lines.forEach(line => text(line.value, 56, line.y, line.size, line.size === 42 ? palette.ink : palette.muted, line.size === 42));
    if (summary && heroHeight) box(56, heroTop, 968, heroHeight);
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
      if (rankCoverage) text(rankCoverage.label, x, heroTop + 180, 18, palette.muted);
    }
    if (composite !== null) text(`Общие очки ${composite} / 105`, 88,
      heroTop + (showResult || rank?.label ? 193 : 48) + (rankCoverage ? 26 : 0), 25, palette.accent, true);
    if (showDistribution) {
      box(56, distributionTop, 968, distributionCardHeight);
      text('Распределение попаданий', 88, distributionTop + 42, 25, palette.ink, true);
      const counts = zoneColors.map((_, zone) => snapshot.analysis.reduce((sum, scope) => sum + scope.distribution[zone], 0));
      ctx.save();
      ctx.translate((1080 - distributionWidth * distributionScale) / 2, distributionTop + 47);
      ctx.scale(distributionScale, distributionScale);
      for (const mark of reportDistribution(counts, snapshot.distributionView)) {
        if (mark.type === 'tile') {
          ctx.beginPath(); ctx.roundRect(mark.x, mark.y, mark.side, mark.side, 2);
          ctx.fillStyle = mark.color; ctx.fill();
        } else if (mark.type === 'path') {
          ctx.beginPath(); mark.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
          ctx.lineWidth = .85; ctx.strokeStyle = mark.color ? palette.surface : palette.muted;
          if (mark.color) { ctx.closePath(); ctx.fillStyle = mark.color; ctx.fill(); }
          ctx.stroke();
        } else {
          face(mark.size, true); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = mark.color ?? palette.ink; ctx.fillText(mark.text, mark.x, mark.y);
        }
      }
      ctx.restore();
    }
    const width = columns === 1 ? 968 : 472;
    racks.forEach(rack => rack.cards.forEach((card, column) => {
      const left = 56 + column * (width + 24);
      const gridTop = rack.top;
      box(left, gridTop, width, cardHeight(card));
      text(`Раунд ${card.round.number}${card.part > 1 ? ' · продолжение' : ` — ${card.round.result.points}/${card.round.result.maximum}`}`, left + 16, gridTop + 29, 23, palette.ink, true);
      const metrics = left + width - 175;
      const middle = (value: string, x: number, y: number, size: number, color: string, bold = false) => {
        face(size, bold);
        text(value, x - ctx.measureText(value).width / 2, y, size, color, bold);
      };
      text('№', left + 16, gridTop + 55, 17, palette.muted);
      if (card.rows.some(row => row.codes.length)) text('Попадания', left + 62, gridTop + 55, 17, palette.muted);
      middle('Очки', metrics + 32, gridTop + 55, 17, palette.muted);
      middle('Ср.', metrics + 99, gridTop + 55, 17, palette.muted);
      middle('Σ', metrics + 151, gridTop + 55, 17, palette.muted);
      card.rows.forEach((row, i) => {
        const top = gridTop + 64 + i * 42;
        text(`${row.number}${row.continuation ? '…' : ''}`, left + 16, top + 27, 19, palette.muted);
        middle(row.score, metrics + 32, top + 27, 19, palette.ink, true);
        middle(row.average, metrics + 99, top + 27, 19, palette.muted);
        middle(row.total, metrics + 151, top + 27, 19, palette.accent, true);
        row.codes.forEach((shot, shotIndex) => {
          const x = left + 58 + shotIndex * (columns === 1 ? 39 : 38);
          ctx.beginPath(); ctx.roundRect(x, top + 3, 33, 33, 8); ctx.fillStyle = zoneColors[shot.points]; ctx.fill();
          const label = shot.code;
          face(19, true); ctx.fillStyle = shot.points === 0 || shot.points === 3 || shot.points === 4 ? palette.ink : '#111811';
          ctx.fillText(label, x + (33 - ctx.measureText(label).width) / 2, top + 26);
        });
      });
    }));
    text(`${pageIndex + 1} / ${pages}`, 937, canvas.height - 22, 22, palette.muted);
    result.push(await encodePoster(canvas));
  }
  return result;
}

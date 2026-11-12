import type { ReportSnapshot } from './report-export.ts';
import { formatAverage } from './preferences.ts';

const palette = { background: '#0e160f', surface: '#1a271d', ink: '#f2f6ee', muted: '#b2beb1',
  accent: '#c6f43d', edge: '#334331', gold: '#f4d35e' };
const zoneColors = ['#334331', '#f6f5eb', '#f6f5eb', '#242b2e', '#242b2e', '#359ac3', '#359ac3', '#e94c40', '#e94c40', '#f6d544', '#f6d544'];
type Row = { number: number; continuation: boolean; codes: { code: string; points: number }[] };
type Card = { round: ReportSnapshot['rounds'][number]; rows: Row[]; part: number; parts: number };

/** Same ten-series round cards as TrainingPoster.kt; long series flow without dropping shots. */
export function posterCards(snapshot: ReportSnapshot): { cards: Card[]; columns: number } {
  const columns = snapshot.rounds.some(round => round.series.some(series => series.shots.length > 6)) || snapshot.conditions.length > 6 ? 1 : 2;
  const perRow = columns === 1 ? 18 : 6;
  const cards = snapshot.rounds.flatMap(round => {
    const rows = round.series.flatMap(series => {
      const rows: Row[] = [];
      for (let offset = 0; offset < series.shots.length; offset += perRow) {
        rows.push({ number: series.number, continuation: offset > 0, codes: series.shots.slice(offset, offset + perRow) });
      }
      return rows;
    });
    const parts = Math.ceil(rows.length / 10);
    return Array.from({ length: parts }, (_, part) => ({ round, rows: rows.slice(part * 10, part * 10 + 10), part: part + 1, parts }));
  });
  if (cards.length / columns > 100) throw new Error('Для картинки слишком много страниц. Выгрузи CSV или раздели тренировку.');
  return { cards, columns };
}

export async function createReportPosters(snapshot: ReportSnapshot): Promise<Uint8Array[]> {
  await document.fonts.ready;
  const { cards, columns } = posterCards(snapshot);
  const result: Uint8Array[] = [];
  const pages = Math.ceil(cards.length / columns);
  for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось открыть рисование отчёта.');
    function face(size: number, bold = false) { ctx!.font = `${bold ? 700 : 400} ${size}px Manrope, sans-serif`; }
    function wrap(text: string, width: number, size: number): string[] {
      face(size);
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
    const heroTop = 145 + conditionLines.length * 38;
    const heroHeight = snapshot.interval ? 430 : 320;
    const gridTop = heroTop + heroHeight + 28;
    const pageCards = cards.slice(pageIndex * columns, (pageIndex + 1) * columns);
    canvas.height = Math.max(1350, gridTop + 125 + Math.max(...pageCards.map(card => card.rows.length)) * 64 + 115);
    if (canvas.height > 16000) throw new Error('Слишком много разных условий для картинки. Сохрани CSV.');
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
    const date = new Date(snapshot.startedAt);
    if (Number.isFinite(date.getTime())) text(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(date), 730, 76, 23, palette.muted);
    text(snapshot.completed ? 'ТРЕНИРОВКА ЗАВЕРШЕНА' : 'ТРЕНИРОВКА ПРОДОЛЖАЕТСЯ', 56, 116, 20, palette.muted);
    conditionLines.forEach((line, i) => text(line, 56, 168 + i * 38, 27));
    box(56, heroTop, 968, heroHeight);
    text('ОБЩИЙ РЕЗУЛЬТАТ', 88, heroTop + 48, 24, palette.muted, true);
    text(`${snapshot.result.points} / ${snapshot.result.maximum}`, 88, heroTop + 150, snapshot.rank ? 70 : 94, palette.ink, true);
    if (snapshot.rank) {
      text('УРОВЕНЬ ПО ОЧКАМ', 758, heroTop + 48, 18, palette.gold, true);
      text(snapshot.rank, 758, heroTop + 125, 58, palette.gold, true);
      text(snapshot.rankClass ?? '', 758, heroTop + 163, 23, palette.muted);
    }
    text(`Средний ${snapshot.average} · ${snapshot.result.maximum / 10} стрел`, 88, heroTop + 205, 28, palette.muted);
    text(snapshot.composite === null ? 'Общие очки — отдельно по условиям или полным сериям'
      : `Общие очки ${snapshot.composite} / 105`, 88, heroTop + 256, 25, palette.accent, true);
    if (snapshot.interval) {
      const band = snapshot.interval;
      const fraction = Math.max(0, Math.min(1, (band.points - band.lowerScore) / Math.max(1, band.upperScore - band.lowerScore)));
      text(`${band.lower} · ${band.lowerScore}`, 88, heroTop + 300, 23, palette.muted);
      text(`${band.upper} · ${band.upperScore}`, 590, heroTop + 300, 23, palette.muted);
      ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.strokeStyle = palette.edge;
      ctx.beginPath(); ctx.moveTo(100, heroTop + 330); ctx.lineTo(980, heroTop + 330); ctx.stroke();
      ctx.strokeStyle = palette.accent; ctx.beginPath(); ctx.moveTo(100, heroTop + 330); ctx.lineTo(100 + 880 * fraction, heroTop + 330); ctx.stroke();
      ctx.fillStyle = palette.ink; ctx.beginPath(); ctx.arc(100 + 880 * fraction, heroTop + 330, 11, 0, Math.PI * 2); ctx.fill();
      text(`+${band.points - band.lowerScore} очков от порога`, 88, heroTop + 382, 23, palette.accent);
      text(`Ещё ${band.upperScore - band.points} до ${band.upper}`, 590, heroTop + 382, 23, palette.accent);
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
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value)
      : reject(new Error('Не удалось создать картинку.')), 'image/png'));
    result.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return result;
}

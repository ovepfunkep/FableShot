import { formatAverage } from './preferences.ts';
import type { DistributionView } from './report-composition.ts';
import { center, distributionMosaic, inner, outer, ringLabels } from './shot-distribution-layout.ts';
import { zoneColor } from './target.ts';

export type DistributionMark =
  | { type: 'tile'; x: number; y: number; side: number; color: string }
  | { type: 'path'; points: [number, number][]; color?: string }
  | { type: 'label'; x: number; y: number; text: string; size: number; color?: string };

export const distributionWidth = 450;
export const distributionHeight = 252;

export function reportDistribution(counts: readonly number[], view: DistributionView): DistributionMark[] {
  const marks: DistributionMark[] = [];
  const zones = counts.map((count, score) => ({ count, score, label: score ? String(score) : 'M' })).reverse().filter(zone => zone.count > 0);
  const total = zones.reduce((sum, zone) => sum + zone.count, 0);
  if (!total) return marks;
  const fill = (score: number) => score === 10 ? '#ffe15d' : score === 9 ? '#e5b545' : zoneColor(score);
  const ink = (score: number) => score === 0 || score === 3 || score === 4 ? '#ffffff' : '#111811';
  if (view === 'mosaic') {
    const layout = distributionMosaic(zones, total);
    const side = Math.min(30, (distributionWidth - 16) / layout.columns, 176 / layout.rows);
    const left = (distributionWidth - side * layout.columns) / 2;
    const top = (184 - side * layout.rows) / 2;
    for (const zone of zones) {
      const cells = layout.cellsByScore.get(zone.score) ?? [];
      cells.forEach(({ column, row }, i) => {
        const x = left + column * side, y = top + row * side;
        marks.push({ type: 'tile', x, y, side: side - 2, color: fill(zone.score) });
        if (!i) marks.push({ type: 'label', x: x + side / 2 - 1, y: y + side / 2 - 1, size: Math.min(13, side * .56), text: zone.label, color: ink(zone.score) });
      });
    }
    zones.forEach((zone, index) => marks.push({ type: 'label', x: distributionWidth * (index + .5) / zones.length,
      y: 204, size: 11, text: `${zone.label} · ${zone.count}` }));
  } else {
    const scale = .86;
    const cx = distributionWidth / 2;
    const cy = 105;
    const xy = (angle: number, radius: number): [number, number] => [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
    for (const zone of ringLabels(zones, total)) {
      const steps = Math.max(2, Math.ceil((zone.end - zone.start) / .095));
      const angles = Array.from({ length: steps + 1 }, (_, i) => zone.start + (zone.end - zone.start) * i / steps);
      marks.push({ type: 'path', color: fill(zone.score), points: [...angles.map(angle => xy(angle, outer)), ...angles.reverse().map(angle => xy(angle, inner))] });
      const x = cx + (zone.left ? -118 : 118), y = cy + (zone.y - center) * scale;
      marks.push({ type: 'path', points: [xy(zone.middle, outer), xy(zone.middle, outer + 8), [x, y]] });
      marks.push({ type: 'label', x: x + (zone.left ? -25 : 25), y, size: 12, text: zone.fontSize < 9 ? `${zone.label} · ${zone.count}` : String(zone.count) });
      if (zone.fontSize >= 9) {
        const [x, y] = xy(zone.middle, (outer + inner) / 2);
        marks.push({ type: 'label', x, y, size: Math.min(zone.fontSize, 12), text: zone.label, color: ink(zone.score) });
      }
    }
    marks.push({ type: 'label', x: cx, y: cy - 7, size: 17, text: String(total) },
      { type: 'label', x: cx, y: cy + 12, size: 11, text: 'стрел' });
  }
  marks.push({ type: 'label', x: distributionWidth / 2, y: 231, size: 13,
    text: `Доля 10 · ${formatAverage(100 * counts[10] / total, false)}%      Доля 10+9 · ${formatAverage(100 * (counts[10] + counts[9]) / total, false)}%` });
  return marks;
}

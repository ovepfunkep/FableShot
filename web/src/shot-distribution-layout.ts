import { packMosaicGroups } from './mosaic-layout.ts';

export type Zone = { score: number; count: number; label: string };
export const mosaicLimit = 120;
export const center = 110;
export const outer = 104;
export const inner = 58;

export function distributionMosaic(zones: readonly Zone[], total: number) {
  const exact = total <= mosaicLimit;
  const extra = mosaicLimit - zones.length;
  let seen = 0;
  const weighted = zones.map(({ score, count }) => {
    const before = seen;
    seen += count;
    return { score, tiles: exact ? count : 1 + Math.round(extra * seen / total) - Math.round(extra * before / total) };
  });
  return packMosaicGroups(weighted);
}

export function ringLabels(zones: readonly Zone[], total: number) {
  let angle = -Math.PI / 2;
  const sectors = zones.map(zone => {
    const start = angle;
    angle += 2 * Math.PI * zone.count / total;
    const middle = (start + angle) / 2;
    const left = Math.cos(middle) < 0;
    const fontSize = Math.min(14, Math.floor((outer + inner) * (angle - start) / (2 * zone.label.length * .8)));
    return { ...zone, start, end: angle, middle, left, fontSize, y: center + Math.sin(middle) * (outer + 15) };
  });
  for (const left of [true, false]) {
    const side = sectors.filter(sector => sector.left === left).sort((a, b) => a.y - b.y);
    let limit = -8;
    for (const sector of side) {
      sector.y = Math.max(sector.y, limit);
      limit = sector.y + 16;
    }
    limit = 228;
    for (const sector of [...side].reverse()) {
      sector.y = Math.min(sector.y, limit);
      limit = sector.y - 16;
    }
  }
  return sectors;
}

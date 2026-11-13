import type { Point, Shot } from './target.ts';
import { spotPoint } from './target.ts';

export const HIT_MAP_GRID_SIZE = 24;

export function knownHitPoints(shots: readonly Shot[], layout = false): Point[] {
  const points: Point[] = [];
  for (const { point, spot } of shots) {
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(layout ? spotPoint(point, spot) : point);
  }
  return points;
}

export function knownMissPoints(shots: readonly Shot[], layout = false): Point[] {
  return shots.flatMap(shot => shot.missPoint ? [layout ? spotPoint(shot.missPoint, shot.spot) : shot.missPoint] : []);
}

export function hitCentroid(points: readonly Point[]): Point | null {
  if (!points.length) return null;
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function hitGeometry(shots: readonly Shot[], diameterMm: number): {
  known: number;
  rmsMm: number | null;
  shiftMm: number;
} | null {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) return null;
  const points = knownHitPoints(shots);
  const center = hitCentroid(points);
  if (!center) return null;

  const radiusMm = diameterMm / 2;
  const squaredDistances = points.reduce((sum, point) =>
    sum + (point.x - center.x) ** 2 + (point.y - center.y) ** 2, 0);
  return {
    known: points.length,
    rmsMm: points.length >= 3 ? radiusMm * Math.sqrt(squaredDistances / points.length) : null,
    shiftMm: radiusMm * Math.hypot(center.x, center.y),
  };
}

export function hitMapLimit(points: readonly Point[], minimum = 1.15): number {
  return points.reduce((limit, { x, y }) => Math.max(limit, Math.max(Math.abs(x), Math.abs(y)) + .1), minimum);
}

export function hitDensity(points: readonly Point[], limit: number) {
  const cells = new Map<number, { column: number; row: number; count: number }>();
  const axisCell = (value: number) =>
    Math.min(HIT_MAP_GRID_SIZE - 1, Math.max(0, Math.floor((value + limit) / (2 * limit) * HIT_MAP_GRID_SIZE)));

  let peak = 0;
  for (const point of points) {
    const column = axisCell(point.x);
    const row = axisCell(point.y);
    const index = row * HIT_MAP_GRID_SIZE + column;
    const existing = cells.get(index);
    const cell = existing ?? { column, row, count: 0 };
    if (!existing) cells.set(index, cell);
    cell.count += 1;
    peak = Math.max(peak, cell.count);
  }
  return { cells: [...cells.values()], peak };
}

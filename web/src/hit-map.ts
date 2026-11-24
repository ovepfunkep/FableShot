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

const distanceSquared = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function hullHalf(points: readonly Point[]) {
  const half: Point[] = [];
  for (const point of points) {
    while (half.length >= 2 && cross(half[half.length - 2], half[half.length - 1], point) <= 0) half.pop();
    half.push(point);
  }
  return half.slice(0, -1);
}

export function maximumSpread(shots: readonly Shot[], diameterMm: number): number | null {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) return null;
  const points = knownHitPoints(shots.filter(shot => shot.points > 0));
  if (points.length < 2) return null;
  let maximum = 0;
  if (points.length <= 200) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) maximum = Math.max(maximum, distanceSquared(points[i], points[j]));
    }
  } else {
    const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y)
      .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
    if (sorted.length < 2) return 0;
    const hull = [...hullHalf(sorted), ...hullHalf([...sorted].reverse())];
    let opposite = 1;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      while (cross(a, b, hull[(opposite + 1) % hull.length]) > cross(a, b, hull[opposite])) {
        opposite = (opposite + 1) % hull.length;
      }
      const next = hull[(opposite + 1) % hull.length];
      maximum = Math.max(maximum, distanceSquared(a, hull[opposite]), distanceSquared(b, hull[opposite]),
        distanceSquared(a, next), distanceSquared(b, next));
    }
  }
  return Math.sqrt(maximum) * diameterMm / 2;
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

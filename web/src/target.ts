export type Point = { x: number; y: number };
export type Hit = { points: number; code: string };
export type Shot = Hit & { point: Point | null; physicalArrowNumber?: number; imported?: true; sourcePoint?: Point };
export type TargetSpec = { profileId: string; diameterMm: number; shaftDiameterMm: number };
export type TargetProfile = {
  id: string;
  title: string;
  diameters: readonly number[];
  archiveDiameters?: readonly number[];
  zones: readonly (Hit & { outerRadius: number })[];
};

const BOUNDARY_EPSILON = 1e-9;
const xZone = { code: 'X', points: 10, outerRadius: .05 };

function rings(minimum = 1, smallTen = false): TargetProfile['zones'] {
  return Array.from({ length: 11 - minimum }, (_, index) => {
    const points = 10 - index;
    return { code: String(points), points, outerRadius: smallTen && points === 10 ? .05 : (index + 1) / 10 };
  });
}

// Radii are measured against the full nominal face, even for reduced targets.
export const TARGET_PROFILES: readonly TargetProfile[] = [
  { id: 'practice-full-10-v1', title: 'Учебная · свой диаметр', diameters: [], zones: rings() },
  { id: 'wa-outdoor-full-v1', title: 'Полная · 1–10 и X', diameters: [800, 1220], zones: [xZone, ...rings()] },
  { id: 'wa-indoor-outer-v1', title: 'Indoor · обычная десятка', diameters: [400, 600], zones: rings() },
  { id: 'wa-indoor-inner-v1', title: 'Indoor · малая десятка', diameters: [400, 600], zones: rings(1, true) },
  { id: 'wa-outdoor-six-v1', title: 'Зоны 5–10 и X', diameters: [800], archiveDiameters: [400], zones: [xZone, ...rings(5)] },
  { id: 'wa-indoor-five-outer-v1', title: 'Indoor · зоны 6–10', diameters: [400, 600], archiveDiameters: [1220], zones: rings(6) },
  { id: 'wa-indoor-five-inner-v1', title: 'Indoor · зоны 6–10, малая десятка', diameters: [400, 600], zones: rings(6, true) },
];

export const DEFAULT_TARGET: TargetSpec = {
  profileId: 'wa-indoor-outer-v1', diameterMm: 400, shaftDiameterMm: 6,
};
export const SHAFT_RADIUS = DEFAULT_TARGET.shaftDiameterMm / DEFAULT_TARGET.diameterMm;

export function getTargetProfile(id: string): TargetProfile | undefined {
  return TARGET_PROFILES.find(profile => profile.id === id);
}

export function acceptsDiameter(profile: TargetProfile, mm: number): boolean {
  return Number.isSafeInteger(mm) && mm > 0 &&
    (profile.diameters.length === 0 || profile.diameters.includes(mm) || profile.archiveDiameters?.includes(mm) === true);
}

function requireProfile(spec: TargetSpec): TargetProfile {
  const profile = getTargetProfile(spec.profileId);
  if (!profile) throw new RangeError('Unknown target profile');
  if (!acceptsDiameter(profile, spec.diameterMm)) throw new RangeError('Target diameter does not match its profile');
  return profile;
}

export function shaftRadius(spec: TargetSpec): number {
  if (!Number.isFinite(spec.shaftDiameterMm) || spec.shaftDiameterMm < 1 || spec.shaftDiameterMm > 20) {
    throw new RangeError('Arrow shaft diameter must be between 1 and 20 mm');
  }
  if (!Number.isSafeInteger(spec.diameterMm) || spec.diameterMm <= 0) {
    throw new RangeError('Target diameter must be a positive integer');
  }
  return spec.shaftDiameterMm / spec.diameterMm;
}

export function outerRadius(spec: TargetSpec): number {
  return requireProfile(spec).zones.at(-1)!.outerRadius;
}

export function isOnFace(point: Point, spec: TargetSpec = DEFAULT_TARGET): boolean {
  return Math.hypot(point.x, point.y) <= outerRadius(spec) + shaftRadius(spec);
}

/** The shaft's nearest edge decides the score while the stored centre stays unchanged. */
export function scorePoint(point: Point, spec: TargetSpec = DEFAULT_TARGET): Hit {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError('Target coordinates must be finite');
  }
  const profile = requireProfile(spec);
  const nearestEdge = Math.max(0, Math.hypot(point.x, point.y) - shaftRadius(spec));
  const zone = profile.zones.find(candidate => nearestEdge <= candidate.outerRadius + BOUNDARY_EPSILON);
  return zone ? { points: zone.points, code: zone.code } : { points: 0, code: 'M' };
}

export function summarize(shots: readonly Shot[]): { points: number; maximum: number; average: number | null } {
  const points = shots.reduce((total, shot) => total + shot.points, 0);
  return {
    points,
    maximum: shots.length * 10,
    average: shots.length === 0 ? null : points / shots.length,
  };
}

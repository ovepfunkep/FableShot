import type { Conditions } from './conditions.ts';
import type { Practice } from './practice.ts';
import { acceptsDiameter, getTargetProfile, summarize } from './target.ts';
import type { Shot } from './target.ts';

export const STANDARD_PROFILE = 'cg3-standard-v1';
export const SCORE_ONLY_PROFILE = 'cg3-score-only-v1';
export type CompositeProfile = typeof STANDARD_PROFILE | typeof SCORE_ONLY_PROFILE;
type Availability = 'available' | 'no-data' | 'incomplete-slice' | 'incomplete-end' | 'insufficient-end-shots' |
  'insufficient-ends' | 'missing-coordinates' | 'unverified-geometry' | 'unknown-maximum' | 'invalid-data';

export type ScoringEnd = {
  id: number;
  number: number;
  plannedCount: number;
  closed: boolean;
  shots: readonly Shot[];
};

export type CompositeScore = {
  availability: Availability;
  phase: 'single' | 'early' | 'full';
  endCount: number;
  shotCount: number;
  knownPositions: number;
  classic: number;
  maximum: number | null;
  base?: number;
  rms?: number;
  q?: number;
  deviation?: number;
  stability?: number;
  groupBonus?: number;
  stabilityBonus?: number;
  total?: number;
  rawEquivalent?: number;
};

const removeDustOptions = { maximumFractionDigits: 12, roundingMode: 'halfEven', useGrouping: false } as const;
const removeDust = new Intl.NumberFormat('en-US', removeDustOptions);
const hundredths = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const tenThousandths = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4, useGrouping: false });

export function displayCompositeScore(value: number): string {
  const text = hundredths.format(Number(removeDust.format(value)));
  return text === '-0.00' ? '0.00' : text;
}

export function displayGroupRms(value: number): string {
  return tenThousandths.format(value);
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function groupSpread(shots: readonly Shot[]) {
  const points = shots.flatMap(shot => shot.point === null ? [] : [shot.point]);
  if (points.length < 2) return { squaredDistance: 0, pointCount: 0 };
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return { squaredDistance: points.reduce((sum, point) => sum + (point.x - cx) ** 2 + (point.y - cy) ** 2, 0), pointCount: points.length };
}

export type CompositeEndFacts = {
  number: number; arrows: number; points: number; closed: boolean; complete: boolean;
  positions: number; missingPositions: boolean; squaredDistance: number; pointCount: number;
};

function groupRms(ends: readonly CompositeEndFacts[]): number | undefined {
  let squaredDistance = 0;
  let pointCount = 0;
  for (const end of ends) {
    squaredDistance += end.squaredDistance;
    pointCount += end.pointCount;
  }
  return pointCount ? Math.sqrt(squaredDistance / pointCount) : undefined;
}

/** The Android CG3 calculation. A known miss without a mark contributes only to the score and stability. */
export function calculateCompositeScore(
  ends: readonly ScoringEnd[],
  slice: number,
  maximumPerArrow: number | null,
  geometryVerified: boolean,
  profile: CompositeProfile = STANDARD_PROFILE,
  singleEnd = false,
): CompositeScore {
  const chosen = ends.filter(end => singleEnd ? end.number === slice : end.number <= slice)
    .sort((first, second) => first.number - second.number);
  const h = maximumPerArrow ?? Infinity;
  const valid = new Set(chosen.map(end => end.id)).size === chosen.length && chosen.every(end =>
    Number.isInteger(end.plannedCount) && end.plannedCount >= 1 && end.shots.length <= end.plannedCount &&
    end.shots.every(({ points, point }) => Number.isInteger(points) && points >= 0 && points <= h &&
      (point === null || Number.isFinite(point.x) && Number.isFinite(point.y))));
  const facts = chosen.map(end => ({
    number: end.number, arrows: end.shots.length, points: summarize(end.shots).points, closed: end.closed,
    complete: end.shots.length === end.plannedCount, positions: end.shots.filter(shot => shot.point !== null).length,
    missingPositions: end.shots.some(shot => shot.points > 0 && shot.point === null), ...groupSpread(end.shots),
  }));
  return calculateCompositeFacts(facts, slice, maximumPerArrow, geometryVerified, profile, singleEnd, valid);
}

export function calculateCompositeFacts(chosen: readonly CompositeEndFacts[], slice: number, maximumPerArrow: number | null,
  geometryVerified: boolean, profile: CompositeProfile = STANDARD_PROFILE, singleEnd = false, valid = true): CompositeScore {
  const endScores = chosen.map(end => end.points);
  const shotCount = chosen.reduce((count, end) => count + end.arrows, 0);
  const knownPositions = chosen.reduce((count, end) => count + end.positions, 0);
  const classic = endScores.reduce((sum, points) => sum + points, 0);
  const h = maximumPerArrow !== null && Number.isInteger(maximumPerArrow) && maximumPerArrow > 0 ? maximumPerArrow : null;
  const maximum = h === null ? null : h * shotCount;
  const result: CompositeScore = {
    availability: 'available', phase: singleEnd ? 'single' : slice < 3 ? 'early' : 'full',
    endCount: chosen.length, shotCount, knownPositions, classic, maximum,
  };
  const unavailable = (availability: Availability) => ({ ...result, availability });
  if (slice < 1) return unavailable('no-data');
  if (chosen.length !== (singleEnd ? 1 : slice) || chosen.some((end, index) => end.number !== (singleEnd ? slice : index + 1))) {
    return unavailable('incomplete-slice');
  }
  if (shotCount === 0) return unavailable('no-data');
  if (h === null || maximum === null) return unavailable('unknown-maximum');
  if (!valid) return unavailable('invalid-data');

  const a = classic / maximum;
  result.base = 100 * a;
  if (chosen.some(end => !end.closed || !end.complete)) return unavailable('incomplete-end');
  if (profile === STANDARD_PROFILE && chosen.some(end => end.arrows < 3)) return unavailable('insufficient-end-shots');
  const full = !singleEnd && chosen.length >= 3 && shotCount >= 9;
  if (profile === SCORE_ONLY_PROFILE && !full) return unavailable('insufficient-ends');
  if (profile === STANDARD_PROFILE && !geometryVerified) return unavailable('unverified-geometry');
  if (profile === STANDARD_PROFILE && chosen.some(end => end.missingPositions)) {
    return unavailable('missing-coordinates');
  }

  const deviation = full ? Math.sqrt(chosen.reduce((sum, end, index) => {
    const count = end.arrows;
    const mean = endScores[index] / (h * count);
    return sum + count * (mean - a) ** 2;
  }, 0) / shotCount) : undefined;
  const stability = deviation === undefined ? undefined : clampFraction(1 - deviation / .15);
  const rms = profile === STANDARD_PROFILE ? groupRms(chosen) : undefined;
  if (rms !== undefined && !Number.isFinite(rms)) return unavailable('invalid-data');
  const q = profile === STANDARD_PROFILE ? (rms === undefined ? 0 : clampFraction(1 - rms / .10)) : undefined;
  const groupBonus = q === undefined ? undefined : q * (full ? 4 : 5);
  const stabilityBonus = stability === undefined ? undefined : stability * (profile === SCORE_ONLY_PROFILE ? 5 : 1);
  const total = Math.min(105, Math.max(0, result.base + (groupBonus ?? 0) + (stabilityBonus ?? 0)));
  return { ...result, rms, q, deviation, stability, groupBonus, stabilityBonus, total, rawEquivalent: total * maximum / 100 };
}

type PracticeScoringEnd = ScoringEnd & { roundNumber: number; seriesNumber: number };
type PracticeScoringGroup = {
  key: string;
  conditions: Conditions;
  maximumPerArrow: number | null;
  geometryVerified: boolean;
  ends: PracticeScoringEnd[];
};

export function conditionsKey({ distanceMeters, targetProfileId, targetDiameterMm, equipment }: Conditions): string {
  return JSON.stringify([distanceMeters, targetProfileId, targetDiameterMm, equipment && [
    equipment.id, equipment.name, equipment.bow.name, equipment.bow.category,
    equipment.arrows.id, equipment.arrows.name, equipment.arrows.diameterMm, equipment.arrows.numberedCount,
  ]]);
}

export function practiceCompositeGroups(practice: Practice): PracticeScoringGroup[] {
  const groups = new Map<string, PracticeScoringGroup>();
  practice.rounds.forEach((round, roundIndex) => round.series.forEach((series, seriesIndex) => {
    const { conditions, id, shots } = series;
    // Legacy web entries lack the recorded plan. Preserve entered volumes of three or more.
    const plannedCount = series.plannedCount ?? Math.max(3, shots.length);
    if (plannedCount < 1 || shots.length !== plannedCount) return;

    const key = conditionsKey(conditions);
    let group = groups.get(key);
    if (!group) {
      const target = getTargetProfile(conditions.targetProfileId);
      group = {
        key, conditions,
        maximumPerArrow: target ? Math.max(...target.zones.map(zone => zone.points)) : null,
        geometryVerified: !!target && acceptsDiameter(target, conditions.targetDiameterMm), ends: [],
      };
      groups.set(key, group);
    }
    group.ends.push({
      id, shots, closed: true, plannedCount, number: group.ends.length + 1,
      roundNumber: roundIndex + 1, seriesNumber: seriesIndex + 1,
    });
  }));
  return [...groups.values()];
}

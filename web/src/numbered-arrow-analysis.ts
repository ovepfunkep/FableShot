import { conditionsKey } from './composite-scoring.ts';
import { isConditions } from './conditions.ts';
import type { Conditions } from './conditions.ts';
import { validNumberedCount } from './equipment.ts';
import { hitCentroid, hitGeometry, knownHitPoints } from './hit-map.ts';
import { getTargetProfile } from './target.ts';
import type { Point, Shot } from './target.ts';

export type NumberedArrowSeries = { conditions: Conditions; shots: readonly Shot[] };
export type NumberedArrowSample = {
  number: number;
  shotCount: number;
  average: number;
  points: Point[];
  centroid: Point | null;
  rmsMm: number | null;
  shiftMm: number | null;
};
export type NumberedArrowGroup = {
  key: string;
  label: string;
  arrowsSetId: string;
  conditions: Conditions;
  arrows: NumberedArrowSample[];
};

const numberText = new Intl.NumberFormat('ru-RU');

/** Physical numbers identify arrows only within the recorded set and conditions. */
export function buildNumberedArrowAnalysis(series: readonly NumberedArrowSeries[]): NumberedArrowGroup[] {
  const groups = new Map<string, {
    conditions: Conditions;
    arrowsSetId: string;
    samples: Map<number, Shot[]>;
  }>();

  for (const { conditions, shots } of series) {
    const arrowsSetId = conditions.equipment?.arrows.id;
    if (!arrowsSetId?.trim() || !isConditions(conditions)) continue;
    const key = conditionsKey(conditions);
    for (const shot of shots) {
      if (!validNumberedCount(shot.physicalArrowNumber)) continue;
      let group = groups.get(key);
      if (!group) {
        group = { conditions, arrowsSetId, samples: new Map() };
        groups.set(key, group);
      }
      const number = shot.physicalArrowNumber;
      const sample = group.samples.get(number);
      if (sample) sample.push(shot);
      else group.samples.set(number, [shot]);
    }
  }

  return [...groups].map(([key, { conditions, arrowsSetId, samples }]) => {
    const { distanceMeters, targetDiameterMm, targetProfileId, equipment } = conditions;
    const label = [
      `${numberText.format(distanceMeters)} м`, `${numberText.format(targetDiameterMm / 10)} см`,
      getTargetProfile(targetProfileId)?.title, equipment?.name, equipment?.arrows.name,
    ].filter(Boolean).join(' · ');
    const arrows = [...samples].sort(([a], [b]) => a - b).map(([number, shots]) => {
      const points = knownHitPoints(shots);
      // Match the native numbered-arrow panel's minimum for both geometry measurements.
      const geometry = points.length >= 3 ? hitGeometry(shots, targetDiameterMm) : null;
      return {
        number, shotCount: shots.length,
        average: shots.reduce((sum, shot) => sum + shot.points, 0) / shots.length,
        points, centroid: geometry ? hitCentroid(points) : null,
        rmsMm: geometry?.rmsMm ?? null, shiftMm: geometry?.shiftMm ?? null,
      };
    });
    return { key, label, arrowsSetId, conditions, arrows };
  });
}

/** Keep the same scale when selecting an arrow, including the extent of visible RMS circles. */
export function numberedArrowMapExtent(group: NumberedArrowGroup, showGrouping: boolean): number {
  let extent = 1;
  for (const arrow of group.arrows) {
    for (const point of arrow.points) extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
    if (showGrouping && arrow.centroid && arrow.rmsMm !== null) {
      const rms = 2 * arrow.rmsMm / group.conditions.targetDiameterMm;
      extent = Math.max(extent, Math.abs(arrow.centroid.x) + rms, Math.abs(arrow.centroid.y) + rms);
    }
  }
  return extent;
}

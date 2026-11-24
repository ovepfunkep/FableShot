import type { Shot, TargetSpot } from './target.ts';
import { getTargetProfile, isOnFace, isInMissRing, markTargetPoint } from './target.ts';
import { DEFAULT_CONDITIONS, DEFAULT_ROUND_RULE, MAX_SERIES_ARROWS, isConditions, isRoundRule } from './conditions.ts';
import type { Conditions, RoundRule } from './conditions.ts';
import type { TechniqueSelection } from './technique.ts';
import type { TechniqueReflections } from './technique-reflection.ts';
import { validNumberedCount } from './equipment.ts';
import type { ProgressBaseline } from './progress-scoring.ts';
import { progressConditionKey } from './progress-scoring.ts';

export type Series = { id: number; shots: Shot[]; conditions: Conditions; plannedCount?: number; progressBaselineId?: number };
export type Round = { id: number; series: Series[] };
export type TechniqueUse = { seriesId: number; arrowsBefore: number | null; selection: TechniqueSelection };
export type Practice = { rounds: Round[]; savedAt: string | null; nextId: number; roundRule: RoundRule; numberedArrows?: boolean | null; techniqueUses?: TechniqueUse[]; techniqueReflections?: TechniqueReflections; progressBaselines?: Record<string, ProgressBaseline> };

export function attachProgressBaseline(practice: Practice, baseline: ProgressBaseline): Practice {
  const current = currentSeries(practice);
  if (!current || practice.savedAt !== null || current.series.shots.length || current.series.progressBaselineId !== undefined) return practice;
  const id = current.series.id;
  return {
    ...practice,
    progressBaselines: { ...practice.progressBaselines, [id]: baseline },
    rounds: practice.rounds.map(round => round.id === current.round.id ? { ...round,
      series: round.series.map(series => series.id === id ? { ...series, progressBaselineId: id } : series),
    } : round),
  };
}

export function usedArrowNumbers(shots: readonly Shot[], exceptIndex: number): Set<number> {
  return new Set(shots.flatMap((shot, index) => index !== exceptIndex && shot.physicalArrowNumber !== undefined ? [shot.physicalArrowNumber] : []));
}

function validateArrowNumber(series: Series, index: number, number: number | undefined) {
  if (number === undefined) return;
  const previous = series.shots[index]?.physicalArrowNumber;
  const count = series.conditions.equipment?.arrows.numberedCount ?? 0;
  if (!validNumberedCount(number) || (number > count && previous !== number)) throw new Error('Этот номер отсутствует в наборе стрел.');
  if (usedArrowNumbers(series.shots, index).has(number)) throw new Error('Этот номер уже записан в серии.');
}

export function bindTechnique(practice: Practice, selection: TechniqueSelection): Practice {
  const current = currentSeries(practice);
  if (practice.savedAt !== null || !current || JSON.stringify(practice.techniqueUses?.at(-1)?.selection) === JSON.stringify(selection)) return practice;
  const use: TechniqueUse = { seriesId: current.series.id, arrowsBefore: current.series.shots.length, selection: structuredClone(selection) };
  return { ...practice, techniqueUses: [...(practice.techniqueUses ?? []), use] };
}

export const ROUND_LIMIT = 30;

export function emptyPractice(): Practice {
  return openRound({ rounds: [], savedAt: null, nextId: 1, roundRule: { ...DEFAULT_ROUND_RULE } });
}

export function currentSeries(practice: Practice): { round: Round; series: Series } | null {
  const round = practice.rounds.at(-1);
  const series = round?.series.at(-1);
  return round && series ? { round, series } : null;
}

export function findSeries(practice: Practice, id: number): { round: Round; series: Series } | null {
  for (const round of practice.rounds) {
    const series = round.series.find(candidate => candidate.id === id);
    if (series) return { round, series };
  }
  return null;
}

export function roundShots(round: Round): Shot[] {
  return round.series.flatMap(series => series.shots);
}

export function isRoundFull(practice: Practice): boolean {
  const current = currentSeries(practice);
  if (!current || practice.roundRule.unit === 'unlimited') return false;
  const count = practice.roundRule.unit === 'arrows' ? roundShots(current.round).length
    : current.round.series.filter(series => series.shots.length > 0).length;
  return count >= practice.roundRule.limit!;
}

function hasShots(practice: Practice): boolean {
  return practice.rounds.some(round => round.series.some(series => series.shots.length > 0));
}

function updateSeries(practice: Practice, target: { round: Round; series: Series }, shots: Shot[]): Practice {
  // Preserve the expanded series count when a hit is removed, as in Android.
  const plannedCount = Math.max(target.series.plannedCount ?? 3, target.series.shots.length, shots.length);
  const updated = { ...target.series, shots, ...(plannedCount > 3 ? { plannedCount } : {}) };
  return {
    ...practice,
    rounds: practice.rounds.map(round => round.id === target.round.id
      ? { ...round, series: round.series.map(series => series.id === target.series.id ? updated : series) }
      : round),
  };
}

function openRound(practice: Practice, conditions = currentSeries(practice)?.series.conditions ?? DEFAULT_CONDITIONS,
  baselineId = currentSeries(practice)?.series.progressBaselineId ?? null): Practice {
  const { nextId } = practice;
  return {
    ...practice,
    rounds: [...practice.rounds, { id: nextId, series: [{ id: nextId + 1, shots: [], conditions: structuredClone(conditions),
      ...(baselineId === null ? {} : { progressBaselineId: baselineId }) }] }],
    nextId: nextId + 2,
  };
}

function openSeries(practice: Practice, conditions = currentSeries(practice)?.series.conditions ?? DEFAULT_CONDITIONS,
  baselineId = currentSeries(practice)?.series.progressBaselineId ?? null): Practice {
  const round = practice.rounds.at(-1);
  if (!round) return openRound(practice, conditions, baselineId);
  return {
    ...practice,
    rounds: [...practice.rounds.slice(0, -1), { ...round, series: [...round.series,
      { id: practice.nextId, shots: [], conditions: structuredClone(conditions),
        ...(baselineId === null ? {} : { progressBaselineId: baselineId }) }] }],
    nextId: practice.nextId + 1,
  };
}

function trimEmptyTail(practice: Practice): Practice {
  const current = currentSeries(practice);
  if (!current || current.series.shots.length) return practice;
  const rounds = practice.rounds.slice(0, -1);
  if (current.round.series.length > 1) {
    rounds.push({ ...current.round, series: current.round.series.slice(0, -1) });
  }
  return { ...practice, rounds };
}

function keepNonemptyCompleted(practice: Practice, conditions = currentSeries(practice)?.series.conditions ?? DEFAULT_CONDITIONS): Practice {
  if (practice.savedAt === null || hasShots(practice)) return practice;
  return openRound({ ...practice, rounds: [], savedAt: null }, conditions);
}

export function appendShot(practice: Practice, shot: Shot): Practice {
  const current = currentSeries(practice);
  if (!current || practice.savedAt !== null || current.series.shots.length >= MAX_SERIES_ARROWS ||
    (practice.roundRule.unit === 'arrows' && isRoundFull(practice))) return practice;
  validateArrowNumber(current.series, current.series.shots.length, shot.physicalArrowNumber);
  return updateSeries(practice, current, [...current.series.shots, shot]);
}

export function replaceShot(practice: Practice, seriesId: number, index: number, shot: Shot): Practice {
  const target = findSeries(practice, seriesId);
  if (!target?.series.shots[index] || target.series.shots[index] === shot) return practice;
  validateArrowNumber(target.series, index, shot.physicalArrowNumber);
  const shots = [...target.series.shots];
  const originalMark = shots[index].originalMark;
  shots[index] = originalMark && !shot.originalMark ? { ...shot, originalMark } : shot;
  return updateSeries(practice, target, shots);
}

export function removeShot(practice: Practice, seriesId: number, index: number): Practice {
  const target = findSeries(practice, seriesId);
  if (!target?.series.shots[index]) return practice;
  const shots = target.series.shots.filter((_, position) => position !== index);
  return keepNonemptyCompleted(updateSeries(practice, target, shots), target.series.conditions);
}

export function advanceSeries(practice: Practice): Practice {
  const current = currentSeries(practice);
  if (!current || practice.savedAt !== null) return practice;
  if (isRoundFull(practice)) return openRound(trimEmptyTail(practice), current.series.conditions, current.series.progressBaselineId ?? null);
  return current.series.shots.length > 0 ? openSeries(practice) : practice;
}

export function startRound(practice: Practice): Practice {
  const current = currentSeries(practice);
  if (!current || practice.savedAt !== null || !roundShots(current.round).length) return practice;
  return openRound(trimEmptyTail(practice), current.series.conditions, current.series.progressBaselineId ?? null);
}

export function applyConditions(practice: Practice, conditions: Conditions, rule?: RoundRule, numberedArrows?: boolean | null): Practice {
  if (practice.savedAt !== null || !isConditions(conditions) || (rule !== undefined && !isRoundRule(rule))) return practice;
  if (rule !== undefined && hasShots(practice) &&
    (rule.unit !== practice.roundRule.unit || rule.limit !== practice.roundRule.limit)) return practice;
  const current = currentSeries(practice);
  if (!current) return practice;
  const sameConditions = JSON.stringify(current.series.conditions) === JSON.stringify(conditions);
  const sameRule = rule === undefined || (rule.unit === practice.roundRule.unit && rule.limit === practice.roundRule.limit);
  const sameNumbering = numberedArrows === undefined || (practice.numberedArrows ?? null) === numberedArrows;
  if (sameConditions && sameRule && sameNumbering) return practice;
  const next = { ...practice, ...(rule ? { roundRule: { ...rule } } : {}), ...(!sameNumbering ? { numberedArrows } : {}) };
  if (sameConditions) return next;
  if (!current.series.shots.length) {
    return { ...next, rounds: next.rounds.map(round => round.id === current.round.id
      ? { ...round, series: round.series.map(series => {
        if (series.id !== current.series.id) return series;
        const { progressBaselineId: _oldBaseline, ...remaining } = series;
        return { ...remaining, conditions: structuredClone(conditions) };
      }) } : round) };
  }
  return isRoundFull(next) ? openRound(next, conditions, null) : openSeries(next, conditions, null);
}

type CorrectionChoice = { key: string; label: string; codes: readonly string[]; inOrder?: TargetSpot };
export class ConditionsCorrectionReview extends Error {
  readonly choices: readonly CorrectionChoice[];
  constructor(choices: readonly CorrectionChoice[]) {
    super('Проверь сопоставление попаданий с новой мишенью.');
    this.choices = choices;
  }
}

export function preparePracticeConditionsCorrection(practice: Practice, patch: Partial<Conditions>, answers: Readonly<Record<string, string>> = {}) {
  const changedSeriesIds: number[] = [];
  const choices: CorrectionChoice[] = [];
  let before = 0, after = 0, preservedScores = 0;
  const rounds = practice.rounds.map((round, roundIndex) => ({ ...round, series: round.series.map((series, seriesIndex) => {
    const label = `Раунд ${roundIndex + 1} · серия ${seriesIndex + 1}`;
    const previous = series.conditions;
    const conditions = { ...previous, ...patch };
    if (!isConditions(conditions)) throw new Error(`${label}. Диаметр должен подходить выбранной мишени.`);
    for (const shot of series.shots) before += shot.points;
    if (JSON.stringify(conditions) === JSON.stringify(previous)) {
      for (const shot of series.shots) after += shot.points;
      return series;
    }
    const profile = getTargetProfile(conditions.targetProfileId)!;
    const spec = { profileId: profile.id, diameterMm: conditions.targetDiameterMm,
      shaftDiameterMm: conditions.equipment?.arrows.diameterMm ?? 6 };
    const geometryChanged = spec.profileId !== previous.targetProfileId || spec.diameterMm !== previous.targetDiameterMm ||
      spec.shaftDiameterMm !== (previous.equipment?.arrows.diameterMm ?? 6);
    const oldProfile = getTargetProfile(previous.targetProfileId)!;
    const shots = geometryChanged ? series.shots.map((shot, index) => {
      const point = shot.point ?? shot.missPoint;
      const arrow = `${label} · стрела ${index + 1}`;
      const origin = shot.originalMark ?? { profileId: oldProfile.id, diameterMm: previous.targetDiameterMm,
        point: shot.point, missPoint: shot.missPoint, spot: shot.spot, code: shot.code, points: shot.points };
      const topologyChanged = !!profile.vertical !== !!oldProfile.vertical;
      const relocate = !!point && topologyChanged;
      let spot = shot.spot;
      if (relocate && profile.vertical) {
        const key = `spot-${series.id}-${index}`;
        const value = answers[key];
        if (value !== '1' && value !== '2' && value !== '3') {
          choices.push({ key, label: `${arrow} · пятно`, codes: ['1', '2', '3'],
            ...(series.shots.length === 3 && { inOrder: index as TargetSpot }) });
          return shot;
        }
        spot = (Number(value) - 1) as TargetSpot;
      } else if (relocate) {
        if (answers['merge-spots'] !== 'Перенести') {
          if (!choices.some(choice => choice.key === 'merge-spots')) choices.push({ key: 'merge-spots',
            label: 'Перенос попаданий с центров трёх пятен на общую мишень', codes: ['Перенести'] });
          return shot;
        }
        spot = undefined;
      }
      if (shot.imported || !point) {
        if ((shot.points && !profile.zones.some(zone => zone.code === shot.code)) ||
          (shot.point && !isOnFace(shot.point, spec)) || (shot.missPoint && !isInMissRing(shot.missPoint, spec))) {
          const key = `score-${series.id}-${index}`;
          const codes = ['M', ...profile.zones.map(zone => zone.code)];
          const code = answers[key];
          if (!codes.includes(code)) {
            choices.push({ key, label: `${arrow} · оценка была ${shot.code}`, codes });
            return shot;
          }
          const { missPoint: _miss, ...original } = shot;
          return { ...original, point: null, code, points: profile.zones.find(zone => zone.code === code)?.points ?? 0,
            spot: undefined, originalMark: origin };
        }
        preservedScores++;
        return topologyChanged ? { ...shot, spot: profile.vertical ? spot : undefined, originalMark: origin } : shot;
      }
      const marked = markTargetPoint(point, spec);
      if (!marked) {
        const key = `score-${series.id}-${index}`;
        if (answers[key] !== 'M') {
          choices.push({ key, label: `${arrow} · вне новой мишени`, codes: ['M'] });
          return shot;
        }
      }
      const { point: _point, missPoint: _miss, ...original } = shot;
      return { ...original, ...(marked ?? { point: null, code: 'M', points: 0 }),
        spot: marked ? spot : undefined, originalMark: origin };
    }) : series.shots;
    for (const shot of shots) after += shot.points;
    changedSeriesIds.push(series.id);
    const baseline = practice.progressBaselines?.[series.progressBaselineId ?? ''];
    const { progressBaselineId, ...rest } = series;
    return { ...rest, conditions, shots, ...(baseline?.conditionKey === progressConditionKey(conditions) && { progressBaselineId }) };
  }) }));
  if (choices.length) throw new ConditionsCorrectionReview(choices);
  return { practice: changedSeriesIds.length ? { ...practice, rounds } : practice,
    changedSeriesIds, preview: { before, after, preservedScores } };
}

export function completePractice(practice: Practice, savedAt: string): Practice {
  if (practice.savedAt !== null || !hasShots(practice) || !Number.isFinite(Date.parse(savedAt))) return practice;
  return { ...trimEmptyTail(practice), savedAt };
}

export function resumePractice(practice: Practice): Practice {
  if (practice.savedAt === null) return practice;
  const active = { ...practice, savedAt: null };
  return isRoundFull(active) ? openRound(active) : openSeries(active);
}

export function deleteSeries(practice: Practice, seriesId: number): Practice {
  const target = findSeries(practice, seriesId);
  if (!target) return practice;
  const remaining = target.round.series.filter(series => series.id !== seriesId);
  const removedCurrent = currentSeries(practice)?.series.id === seriesId;
  const rounds = practice.rounds.flatMap(round => round.id !== target.round.id ? [round]
    : remaining.length ? [{ ...round, series: remaining }] : []);
  const next = { ...practice, rounds };
  if (practice.savedAt !== null) return keepNonemptyCompleted(next, target.series.conditions);
  if (!removedCurrent) return next;
  return remaining.length ? openSeries(next, target.series.conditions, target.series.progressBaselineId ?? null)
    : openRound(next, target.series.conditions, target.series.progressBaselineId ?? null);
}

export function deleteRound(practice: Practice, roundId: number): Practice {
  if (!practice.rounds.some(round => round.id === roundId)) return practice;
  const current = currentSeries(practice);
  const conditions = current?.series.conditions ?? DEFAULT_CONDITIONS;
  const next = { ...practice, rounds: practice.rounds.filter(round => round.id !== roundId) };
  if (practice.savedAt !== null) return keepNonemptyCompleted(next, conditions);
  return current?.round.id === roundId ? openRound(next, conditions, current.series.progressBaselineId ?? null) : next;
}

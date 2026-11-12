import { currentSeries } from './practice.ts';
import type { Practice, Round, Series } from './practice.ts';
import { RANK_REVISION, roundRank, seriesRank, STAGE_RANK_LABELS } from './sport-ranks.ts';
import type { RankCategory, StageRank } from './sport-ranks.ts';
import { summarize } from './target.ts';

export const STAGE_RANK_ENROLLMENT_VERSION = 1;

export type StageRankBasis = {
  roundId: number;
  seriesIds: number[];
  revision: string;
  points: number;
  arrows: number;
  exerciseArrows: number;
  threshold: number;
  target: string;
  bow: string;
  distance: number;
  diameter: number;
};

const full = (series: Series) => series.shots.length >= 3 && series.shots.length === (series.plannedCount ?? 3);

function fullRound(practice: Practice, series: readonly Series[]) {
  if (!series.every(full)) return false;
  const arrows = series.reduce((total, item) => total + item.shots.length, 0);
  if (arrows < 30) return false;
  const { unit, limit } = practice.roundRule;
  return unit === 'unlimited' || (unit === 'arrows' ? arrows : series.length) === limit;
}

function collect(rank: StageRank, kind: 'SNR' | 'RNR', round: Round, series: Series[], previousPoints?: number) {
  const { evaluation, conditions } = rank;
  if (!evaluation || !conditions) return [];
  const { exercise, points, entered } = evaluation;
  const scope = `stage-v1:${exercise.id}:${conditions.targetProfileId}`;
  return exercise.thresholds.flatMap(({ label, score }) => {
    const tier = STAGE_RANK_LABELS.findIndex(level => level === label);
    if (tier < 0 || points * exercise.arrows < score * entered ||
      (previousPoints !== undefined && previousPoints * exercise.arrows >= score * entered)) return [];
    const stageRank: StageRankBasis = {
      roundId: round.id, seriesIds: series.map(item => item.id), revision: RANK_REVISION,
      points, arrows: entered, exerciseArrows: exercise.arrows, threshold: score,
      target: conditions.targetProfileId, bow: exercise.bow, distance: exercise.distance, diameter: conditions.targetDiameterMm,
    };
    return [{ id: `${kind}0${tier + 1}`, scope, progress: 1, stageRank }];
  });
}

/** Awards are triggered by a closure or a shot correction in an already closed sample. */
export function observeStageRanks(before: Practice, after: Practice, category: RankCategory | null,
  storedCategories: Readonly<Record<string, RankCategory | null>> | undefined) {
  const previousRound = before.savedAt === null ? before.rounds.at(-1) : undefined;
  const previousOpen = before.savedAt === null ? currentSeries(before)?.series : undefined;
  const openRound = after.savedAt === null ? after.rounds.at(-1) : undefined;
  const openSeries = after.savedAt === null ? currentSeries(after)?.series : undefined;
  let categories = storedCategories;
  if (previousOpen && previousOpen.id !== openSeries?.id && !Object.hasOwn(categories ?? {}, previousOpen.id) &&
    after.rounds.some(round => round.series.some(series => series.id === previousOpen.id))) {
    categories = { ...categories, [previousOpen.id]: category };
  }
  if (previousRound && previousRound.id !== openRound?.id && !Object.hasOwn(categories ?? {}, previousRound.id) &&
    after.rounds.some(round => round.id === previousRound.id)) {
    categories = { ...categories, [previousRound.id]: category };
  }
  const observations: ReturnType<typeof collect> = [];
  for (const round of after.rounds) {
    const previous = before.rounds.find(item => item.id === round.id);
    if (round === previous && round.id !== previousRound?.id) continue;
    const previousSeries = new Map(previous?.series.map(series => [series.id, series]));
    for (const series of round.series) {
      const old = previousSeries.get(series.id);
      const seriesCategory = categories?.[series.id];
      if (series === openSeries || !full(series) || !old || !seriesCategory) continue;
      if (series.id === previousOpen?.id) {
        observations.push(...collect(seriesRank(after, series.id, seriesCategory), 'SNR', round, [series]));
      } else if (series.shots !== old.shots && series.shots.length === old.shots.length) {
        observations.push(...collect(seriesRank(after, series.id, seriesCategory), 'SNR', round, [series], summarize(old.shots).points));
      }
    }
    const roundCategory = categories?.[round.id];
    if (round === openRound || !roundCategory || !fullRound(after, round.series)) continue;
    if (round.id === previousRound?.id) {
      observations.push(...collect(roundRank(after, round.id, roundCategory), 'RNR', round, round.series));
    } else if (previous &&
      round.series.length === previous.series.length && round.series.every((series, index) =>
        series.id === previous.series[index].id && series.shots.length === previous.series[index].shots.length)) {
      observations.push(...collect(roundRank(after, round.id, roundCategory), 'RNR', round, round.series,
        summarize(previous.series.flatMap(series => series.shots)).points));
    }
  }
  return { observations, categories };
}

export function confirmsStageRank(practice: Practice, kind: 'series' | 'round', basis: StageRankBasis): boolean {
  const round = practice.rounds.find(item => item.id === basis.roundId);
  if (!round) return false;
  const sample = kind === 'series' ? round.series.filter(item => item.id === basis.seriesIds[0])
    : round.series.slice(0, basis.seriesIds.length);
  if (sample.length !== basis.seriesIds.length || sample.some((series, index) => series.id !== basis.seriesIds[index] ||
    series.conditions.targetProfileId !== basis.target || series.conditions.targetDiameterMm !== basis.diameter ||
    series.conditions.distanceMeters !== basis.distance || series.conditions.equipment?.bow.category !== basis.bow || !full(series))) return false;
  if (kind === 'round' && !fullRound(practice, sample)) return false;
  const shots = sample.flatMap(series => series.shots);
  return summarize(shots).points * basis.exerciseArrows >= basis.threshold * shots.length;
}

export function stageRankBasisLabel(basis: StageRankBasis): string {
  const average = (basis.points / basis.arrows).toFixed(2).replace('.', ',');
  return `${basis.points} очков / ${basis.arrows} стрел · средний ${average} · порог ${basis.threshold} из ${basis.exerciseArrows * 10}`;
}

import { conditionsKey } from './composite-scoring.ts';
import type { Conditions } from './conditions.ts';
import type { Practice, Series } from './practice.ts';
import { evaluateRank, matchingRankExercises, rankDisplayLabel, sameRankConditions } from './sport-ranks.ts';
import type { RankCategory, RankEvaluation, RankExercise, StageRank } from './sport-ranks.ts';

const bowClasses = { recurve: 'КЛ', barebow: 'КЛб', compound: 'БЛ' } as const;

type RoundReference = { id: number; number: number };
type RankRound = RoundReference & { conditions: Conditions | null; entered: number; points: number; complete: boolean };
type Exclusion = RoundReference & { reason: 'mixed' | 'incomplete' | 'conditions' | 'extra' };
type Coverage = { arrows: number; rounds: RoundReference[]; excluded: Exclusion[] };
export type ExerciseRank = StageRank & { forecast: RankEvaluation | null; coverage: Coverage | null };
type ConfirmedExerciseRank = ExerciseRank & {
  evaluation: RankEvaluation; coverage: Coverage; finalResult: true;
  classLabel: string; bow: NonNullable<StageRank['bow']>; conditions: Conditions;
};
export const EXERCISE_RANK_VERSION = 1;

function seriesFull(item: Series): boolean {
  return item.shots.length === (item.plannedCount ?? Math.max(3, item.shots.length));
}

function rankRounds(practice: Practice, category: RankCategory): RankRound[] {
  return practice.rounds.flatMap((round, index) => {
    const series = round.series.filter(item => item.shots.length > 0);
    if (!series.length) return [];
    const first = series[0].conditions;
    const conditions = series.every(item => sameRankConditions(first, item.conditions)) ? first : null;
    const shots = series.flatMap(item => item.shots);
    const entered = shots.length;
    const points = shots.reduce((total, shot) => total + shot.points, 0);
    const { unit, limit } = practice.roundRule ?? { unit: 'unlimited', limit: null };
    const last = series.at(-1)!;
    const complete = unit === 'arrows' && limit !== null
      ? entered === limit && series.slice(0, -1).every(seriesFull) && last.shots.length <= (last.plannedCount ?? Infinity)
      : series.every(seriesFull) && (unit === 'series' && limit !== null ? series.length === limit :
        !!conditions && matchingRankExercises(conditions, category).some(exercise =>
          entered === exercise.arrows || entered * 2 === exercise.arrows));
    return [{ id: round.id, number: index + 1, conditions, entered, points, complete }];
  });
}

function confirmedRank(conditions: Conditions, exercise: RankExercise, used: RankRound[], all: RankRound[]): ConfirmedExerciseRank {
  const { bow, category } = exercise;
  const evaluation = evaluateRank(exercise, used.reduce((sum, round) => sum + round.points, 0), exercise.arrows);
  const forecastExercise = bow === 'barebow' && exercise.arrows === 30
    ? matchingRankExercises(conditions, category).find(item => item.arrows === 60) ?? exercise : exercise;
  const forecast = forecastExercise === exercise ? evaluation : evaluateRank(forecastExercise, evaluation.points, evaluation.entered);
  const excluded: Exclusion[] = all.filter(round => !used.includes(round)).map(round => ({
    id: round.id, number: round.number,
    reason: !round.conditions ? 'mixed' : !round.complete ? 'incomplete' :
      !sameRankConditions(conditions, round.conditions) ? 'conditions' : 'extra',
  }));
  return {
    scopeLabel: 'Упражнение', classLabel: `${bowClasses[bow]}(${category === 'male' ? 'М' : 'Ж'})`,
    bow, category, conditions, reason: null, evaluation, forecast, label: evaluation.result?.label ?? 'ниже порога',
    finalResult: true, coverage: { arrows: exercise.arrows, rounds: used.map(({ id, number }) => ({ id, number })), excluded },
  };
}

function exerciseRankCandidates(practice: Practice, category: RankCategory | null, includeIndividualRounds: boolean): ConfirmedExerciseRank[] {
  if (practice.savedAt === null || !category) return [];
  const rounds = rankRounds(practice, category);
  const groups: { conditions: Conditions; rounds: RankRound[] }[] = [];
  for (const round of rounds) {
    const { conditions } = round;
    if (!round.complete || !conditions) continue;
    const group = groups.find(group => sameRankConditions(conditions, group.conditions));
    if (group) group.rounds.push(round);
    else groups.push({ conditions, rounds: [round] });
  }
  const ranked = groups.flatMap(({ conditions, rounds: group }) => {
    const candidates = matchingRankExercises(conditions, category);
    return candidates.flatMap(exercise => {
      const single = group.find(round => round.entered === exercise.arrows);
      const pair = group.filter(round => round.entered * 2 === exercise.arrows).slice(0, 2);
      const hasPair = pair.length === 2;
      if (includeIndividualRounds) {
        const attempts = group.filter(round => round.entered === exercise.arrows).map(round => [round]);
        if (hasPair) attempts.push(pair);
        return attempts.map(used => confirmedRank(conditions, exercise, used, rounds));
      }
      if (!single && !hasPair) return [];
      // The shorter line of a split exercise is used only when a full pair cannot be formed.
      if (candidates.some(item => item.arrows === exercise.arrows * 2) &&
        group.filter(round => round.entered === exercise.arrows).length >= 2) return [];
      const used = single && (!hasPair || single.number < pair[1].number) ? [single] : pair;
      return [confirmedRank(conditions, exercise, used, rounds)];
    });
  }).sort((a, b) => b.evaluation.entered - a.evaluation.entered ||
    a.coverage.rounds.at(-1)!.number - b.coverage.rounds.at(-1)!.number);
  return ranked;
}

export function personalBestExerciseCandidates(practice: Practice, category: RankCategory | null): ConfirmedExerciseRank[] {
  return exerciseRankCandidates(practice, category, true);
}

export function confirmedExerciseRanks(practice: Practice, category: RankCategory | null): ConfirmedExerciseRank[] {
  const ranked = exerciseRankCandidates(practice, category, false);
  const firstByFormat = new Map<string, ConfirmedExerciseRank>();
  for (const rank of ranked) {
    const id = rank.evaluation.exercise.id;
    if (!firstByFormat.has(id)) firstByFormat.set(id, rank);
  }
  return [...firstByFormat.values()];
}

export function exerciseRank(practice: Practice, category: RankCategory | null): ExerciseRank {
  return confirmedExerciseRanks(practice, category)[0] ?? calculateRank(practice, category, false);
}

// Receipts recorded before round selection are revalidated by their original rule.
export function legacyExerciseRank(practice: Practice, category: RankCategory | null): ExerciseRank {
  return calculateRank(practice, category, true);
}

function calculateRank(practice: Practice, category: RankCategory | null, legacy: boolean): ExerciseRank {
  const series = practice.rounds.flatMap(round => round.series).filter(item => item.shots.length > 0);
  const first = series[0]?.conditions ?? null;
  const conditions = first && series.every(item => legacy
    ? conditionsKey(item.conditions) === conditionsKey(first) : sameRankConditions(item.conditions, first)) ? first : null;
  const bowCategory = conditions?.equipment?.bow.category;
  const bow: StageRank['bow'] = bowCategory === 'recurve' || bowCategory === 'barebow' || bowCategory === 'compound' ? bowCategory : null;
  const classLabel = bow && category ? `${bowClasses[bow]}(${category === 'male' ? 'М' : 'Ж'})` : null;
  const base = { scopeLabel: 'Упражнение', classLabel, bow, category, conditions, coverage: null };
  const unavailable = (reason: string): ExerciseRank => ({
    ...base, reason, evaluation: null, forecast: null, label: null, finalResult: false,
  });
  if (!first) return unavailable('Нет зачётных стрел');
  if (!conditions) return unavailable('В тренировке разные условия. Общий норматив недоступен.');
  if (!bowCategory) return unavailable('Укажи тип лука в снаряжении тренировки');
  if (!category) return unavailable('Выбери категорию сравнения');
  const candidates = matchingRankExercises(conditions, category);
  if (!candidates.length) return unavailable('Для этих условий пока нет поддерживаемого норматива');

  const entered = series.reduce((count, item) => count + item.shots.length, 0);
  const points = series.reduce((total, item) => item.shots.reduce((sum, shot) => sum + shot.points, total), 0);
  const saved = legacy && practice.savedAt !== null;
  // A rolling round limit does not specify the total volume of the exercise.
  const actualExercise = saved ? candidates.find(item => item.arrows === entered) : undefined;
  const exercise = actualExercise ?? candidates.find(item => item.arrows === 60) ?? candidates[0];
  const evaluation = evaluateRank(exercise, points, entered);
  const forecastExercise = bow === 'barebow' && conditions.distanceMeters === 18 && conditions.targetDiameterMm === 400
    ? candidates.find(item => item.arrows === 60) ?? exercise : exercise;
  const forecast = forecastExercise === exercise ? evaluation : evaluateRank(forecastExercise, points, entered);
  // Legacy entries lack an explicit count for series of three or more arrows.
  const fullSeries = series.every(seriesFull);
  const finalResult = saved && evaluation.complete && fullSeries;
  return {
    ...base, reason: null, evaluation: { ...evaluation, result: finalResult ? evaluation.result : null }, forecast,
    label: (finalResult ? evaluation : forecast).pace?.label ?? 'ниже порога', finalResult,
  };
}

export function exerciseRankCoverage(rank: ExerciseRank) {
  if (!rank.coverage) return null;
  const { arrows, rounds, excluded } = rank.coverage;
  const numbers = rounds.map(round => round.number);
  const label = `${arrows} стрел · ${numbers.length === 1 ? 'раунд' : 'раунды'} ${numbers.join(' и ')}`;
  const reasons: Record<Exclusion['reason'], string> = {
    mixed: 'смешанные условия', incomplete: 'неполный или неподдерживаемый объём',
    conditions: 'другие условия', extra: 'сверх зачётного объёма',
  };
  const explanation = excluded.length
    ? `Вне зачёта: ${excluded.map(round => `раунд ${round.number} (${reasons[round.reason]})`).join(', ')}.` : null;
  return { label, explanation };
}

export function exerciseRankDisplay(rank: ExerciseRank) {
  const pace = rank.forecast?.pace?.label ?? null;
  const separate = rank.finalResult && pace !== null && pace !== rank.label;
  const forecast = !!rank.evaluation && (!rank.finalResult || separate);
  return { forecast, label: rankDisplayLabel(forecast ? pace ?? rank.label : rank.label),
    actual: separate ? `Разряд ${rankDisplayLabel(rank.label)} · ${rank.evaluation!.entered} стрел` : null };
}

import { conditionsKey } from './composite-scoring.ts';
import type { Practice } from './practice.ts';
import { evaluateRank, matchingRankExercises } from './sport-ranks.ts';
import type { RankCategory, StageRank } from './sport-ranks.ts';

const bowClasses = { recurve: 'КЛ', barebow: 'КЛб', compound: 'БЛ' } as const;

export function exerciseRank(practice: Practice, category: RankCategory | null): StageRank {
  const series = practice.rounds.flatMap(round => round.series).filter(item => item.shots.length > 0);
  const first = series[0]?.conditions ?? null;
  const key = first && conditionsKey(first);
  const conditions = series.every(item => conditionsKey(item.conditions) === key) ? first : null;
  const bowCategory = conditions?.equipment?.bow.category;
  const bow: StageRank['bow'] = bowCategory === 'recurve' || bowCategory === 'barebow' || bowCategory === 'compound' ? bowCategory : null;
  const classLabel = bow && category ? `${bowClasses[bow]}(${category === 'male' ? 'М' : 'Ж'})` : null;
  const base = { scopeLabel: 'Упражнение', classLabel, bow, category, conditions };
  const unavailable = (reason: string): StageRank => ({
    ...base, reason, evaluation: null, label: null, finalResult: false,
  });
  if (!first) return unavailable('Нет зачётных стрел');
  if (!conditions) return unavailable('В тренировке разные условия. Общий норматив недоступен.');
  if (!bowCategory) return unavailable('Укажи тип лука в снаряжении тренировки');
  if (!category) return unavailable('Выбери категорию сравнения');
  const candidates = matchingRankExercises(conditions, category);
  if (!candidates.length) return unavailable('Для этих условий пока нет поддерживаемого норматива');

  const entered = series.reduce((count, item) => count + item.shots.length, 0);
  const points = series.reduce((total, item) => item.shots.reduce((sum, shot) => sum + shot.points, total), 0);
  const saved = practice.savedAt !== null;
  // A rolling round limit does not specify the total volume of the exercise.
  const actualExercise = saved ? candidates.find(item => item.arrows === entered) : undefined;
  const exercise = actualExercise ?? candidates.find(item => item.arrows === 60) ?? candidates[0];
  const evaluation = evaluateRank(exercise, points, entered);
  // Legacy entries lack an explicit count for series of three or more arrows.
  const fullSeries = series.every(item => item.shots.length === (item.plannedCount ?? Math.max(3, item.shots.length)));
  const finalResult = saved && evaluation.complete && fullSeries;
  return {
    ...base, reason: null, evaluation: { ...evaluation, result: finalResult ? evaluation.result : null },
    label: evaluation.pace?.label ?? 'ниже порога', finalResult,
  };
}

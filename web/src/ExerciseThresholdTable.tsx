import { useState } from 'react';
import { formatAverage } from './preferences.ts';
import type { RankEvaluation, RankThreshold } from './sport-ranks.ts';
import './exercise-rank.css';

const pointPlural = new Intl.PluralRules('ru-RU');
function pointAmount(points: number) {
  const plural = pointPlural.select(points);
  return `${points} ${plural === 'one' ? 'очко' : plural === 'few' ? 'очка' : 'очков'}`;
}

function thresholdDetail(threshold: RankThreshold, evaluation: RankEvaluation, finalResult: boolean) {
  const gap = threshold.score - evaluation.points;
  if (finalResult) return gap > 0 ? `До ${threshold.label} · ${pointAmount(gap)}`
    : gap < 0 ? `${threshold.label} · на ${pointAmount(-gap)} выше порога` : `${threshold.label} · ровно по порогу`;

  if (gap <= 0) return `${threshold.label} · порог по очкам набран`;
  const remaining = evaluation.exercise.arrows - evaluation.entered;
  if (remaining <= 0) return `${threshold.label} · порог ${pointAmount(threshold.score)}`;
  const required = gap / remaining;
  return required > 10 ? `${threshold.label} · порог уже недостижим`
    : `До ${threshold.label} · на оставшихся нужен средний ${formatAverage(required, true)}`;
}

export function ExerciseThresholdTable({ evaluation, finalResult, saved, showAverage, showVolume }: {
  evaluation: RankEvaluation; finalResult: boolean; saved: boolean; showAverage: boolean; showVolume: boolean;
}) {
  const [selectedLabel, setSelectedLabel] = useState<RankThreshold['label'] | null>(null);
  const { exercise, pace, next } = evaluation;
  const selected = exercise.thresholds.find(threshold => threshold.label === selectedLabel);
  const detail = selected ?? next;
  const volume = showVolume && !finalResult;
  const status = finalResult ? null : evaluation.entered > exercise.arrows ? 'Объём больше справочного'
    : evaluation.complete ? (saved ? 'Есть незаполненные серии' : 'Упражнение не завершено') : null;
  const state = (threshold: RankThreshold) => threshold.label === pace?.label ? 'reached'
    : threshold.label === next?.label ? 'next' : undefined;
  return <>
    <div className="exercise-rank__table-wrap">
      <table className="exercise-rank__table" aria-label={`Пороги нормативов за ${exercise.arrows} стрел`}
        style={exercise.thresholds.length > 6 ? { minWidth: `${5 + exercise.thresholds.length * 2}rem` } : undefined}>
        <thead><tr>
          <th scope="col">Разряд</th>
          {exercise.thresholds.map(threshold => <th key={threshold.label} scope="col" data-rank-state={state(threshold)} data-rank-selected={selected === threshold}>
            <button type="button" aria-pressed={selected === threshold}
              onClick={() => setSelectedLabel(selected === threshold ? null : threshold.label)}>{threshold.label}</button>
          </th>)}
        </tr></thead>
        <tbody>
          <tr><th scope="row">Очки</th>
            {exercise.thresholds.map(threshold => <td key={threshold.label} data-rank-state={state(threshold)} data-rank-selected={selected === threshold}>{threshold.score}</td>)}
          </tr>
          {showAverage && <tr className="exercise-rank__averages"><th scope="row">За стрелу</th>
            {exercise.thresholds.map(threshold => <td key={threshold.label} data-rank-state={state(threshold)} data-rank-selected={selected === threshold}>
              {formatAverage(threshold.score / exercise.arrows, true)}
            </td>)}
          </tr>}
        </tbody>
      </table>
    </div>
    {(detail || volume || status) && <footer className="exercise-rank__footer">
      {detail && <strong aria-live="polite" data-testid="exercise-rank-next">{thresholdDetail(detail, evaluation, finalResult)}</strong>}
      {volume && <span data-testid="exercise-rank-progress">{evaluation.entered} из {exercise.arrows} стрел</span>}
      {status && <span>{status}</span>}
    </footer>}
  </>;
}

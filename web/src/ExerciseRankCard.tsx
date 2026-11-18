import { useId, useMemo, useState } from 'react';
import { exerciseRank } from './exercise-rank.ts';
import type { Practice } from './practice.ts';
import { formatAverage } from './preferences.ts';
import { RankDetails, RankMedal } from './SportRanks.tsx';
import type { RankCategory, RankEvaluation, RankThreshold } from './sport-ranks.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';
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

function ExerciseThresholdTable({ evaluation, finalResult, saved, showAverage, showVolume }: {
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
          {exercise.thresholds.map(threshold => <th key={threshold.label} scope="col" data-rank-state={state(threshold)}>
            <button type="button" aria-pressed={selected === threshold}
              onClick={() => setSelectedLabel(selected === threshold ? null : threshold.label)}>{threshold.label}</button>
          </th>)}
        </tr></thead>
        <tbody>
          <tr><th scope="row">Очки</th>
            {exercise.thresholds.map(threshold => <td key={threshold.label} data-rank-state={state(threshold)}>{threshold.score}</td>)}
          </tr>
          {showAverage && <tr className="exercise-rank__averages"><th scope="row">За стрелу</th>
            {exercise.thresholds.map(threshold => <td key={threshold.label} data-rank-state={state(threshold)}>
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

export function ExerciseRankCard({ practice, category, onCategory, onOpenReference }: {
  practice: Practice;
  category: RankCategory | null;
  onCategory: (category: RankCategory) => void;
  onOpenReference: () => void;
}) {
  const titleId = useId();
  const { preferences } = useTrainingPreferences();
  const [details, setDetails] = useState(false);
  const rank = useMemo(() => exerciseRank(practice, category), [practice, category]);
  const { evaluation, finalResult } = rank;
  const showAverage = statisticVisible(preferences, 'average');
  const showVolume = statisticVisible(preferences, 'volume');
  const showResult = statisticVisible(preferences, 'result');

  return <section className="exercise-rank" aria-labelledby={titleId} data-testid="report-exercise-rank">
    <header>
      <h3 id={titleId}>Нормативы</h3>
      <button type="button" className="training-mean-help" aria-label="Разбор норматива упражнения" data-testid="exercise-rank-open" onClick={() => setDetails(true)}>?</button>
    </header>
    {evaluation && category ? <>
      <div className="exercise-rank__summary">
        <p className="exercise-rank__level" data-testid="exercise-rank-level">
          {evaluation.pace && <RankMedal />}
          {evaluation.pace ? finalResult ? `${rank.label} по очкам` : `Темп ${rank.label}` : 'Ниже порога'}
        </p>
        {(showResult || showAverage) && <p className="exercise-rank__score">
          {showResult && <><strong>{evaluation.points}</strong> / {evaluation.entered * 10}</>}
          {showResult && showAverage && ' · '}
          {showAverage && <>ср. <strong>{formatAverage(evaluation.average, true)}</strong></>}
        </p>}
      </div>
      <ExerciseThresholdTable key={evaluation.exercise.id} evaluation={evaluation} finalResult={finalResult}
        saved={practice.savedAt !== null} showAverage={showAverage} showVolume={showVolume} />
    </> : <p data-testid="exercise-rank-unavailable">{rank.reason}</p>}
    {details && <RankDetails rank={rank} onClose={() => setDetails(false)} onCategory={onCategory}
      onOpenReference={() => { setDetails(false); onOpenReference(); }} />}
  </section>;
}

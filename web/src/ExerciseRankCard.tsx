import { useId, useMemo, useState } from 'react';
import { exerciseRank, exerciseRankDisplay } from './exercise-rank.ts';
import type { Practice } from './practice.ts';
import { formatAverage } from './preferences.ts';
import { RankDetails, RankMedal } from './SportRanks.tsx';
import type { RankCategory } from './sport-ranks.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';
import { ExerciseThresholdTable } from './ExerciseThresholdTable.tsx';
import './exercise-rank.css';

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
  const display = exerciseRankDisplay(rank);
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
          {rank.forecast?.pace && <RankMedal />}
          {display.label === '—' ? '—' : display.forecast ? `Темп ${display.label}` : `${display.label} по очкам`}
        </p>
        {(showResult || showAverage) && <p className="exercise-rank__score">
          {showResult && <><strong>{evaluation.points}</strong> / {evaluation.entered * 10}</>}
          {showResult && showAverage && ' · '}
          {showAverage && <>ср. <strong>{formatAverage(evaluation.average, true)}</strong></>}
        </p>}
      </div>
      {display.actual && <p className="exercise-rank__score">{display.actual}</p>}
      <ExerciseThresholdTable key={evaluation.exercise.id} evaluation={evaluation} finalResult={finalResult}
        saved={practice.savedAt !== null} showAverage={showAverage} showVolume={showVolume} />
    </> : <p data-testid="exercise-rank-unavailable">{rank.reason}</p>}
    {details && <RankDetails rank={rank} forecast={display.actual ? rank.forecast : null} onClose={() => setDetails(false)} onCategory={onCategory}
      onOpenReference={() => { setDetails(false); onOpenReference(); }} />}
  </section>;
}

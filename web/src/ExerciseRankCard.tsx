import { useId, useMemo, useState } from 'react';
import { exerciseRank } from './exercise-rank.ts';
import type { Practice } from './practice.ts';
import { formatAverage } from './preferences.ts';
import { RankDetails, RankScale } from './SportRanks.tsx';
import type { RankCategory } from './sport-ranks.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';
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
  const next = evaluation?.next;

  return <section className="exercise-rank" aria-labelledby={titleId} data-testid="report-exercise-rank">
    <header>
      <h3 id={titleId}>Нормативы</h3>
      <button type="button" className="training-mean-help" aria-label="Разбор норматива упражнения" data-testid="exercise-rank-open" onClick={() => setDetails(true)}>?</button>
    </header>
    {evaluation && category ? <>
      <p className="exercise-rank__level" data-testid="exercise-rank-level">
        {finalResult ? 'По очкам' : 'Разряд'} · {rank.label}
      </p>
      {statisticVisible(preferences, 'average') && <RankScale evaluation={evaluation} />}
      {statisticVisible(preferences, 'volume') && <p data-testid="exercise-rank-progress">
        {evaluation.entered} из {evaluation.exercise.arrows} стрел
      </p>}
      {!finalResult && <p>
        {evaluation.entered > evaluation.exercise.arrows ? 'Объём больше справочного'
          : evaluation.complete && practice.savedAt !== null ? 'Есть незаполненные серии'
          : 'Упражнение не завершено'}
      </p>}
      {next && <p data-testid="exercise-rank-next">
        {finalResult ? `До ${next.label} · ${next.score - evaluation.points} очков`
          : `Следующий рубеж · ${next.label} от ${formatAverage(next.score / evaluation.exercise.arrows, true)} за стрелу`}
      </p>}
    </> : <p data-testid="exercise-rank-unavailable">{rank.reason}</p>}
    {details && <RankDetails rank={rank} onClose={() => setDetails(false)} onCategory={onCategory}
      onOpenReference={() => { setDetails(false); onOpenReference(); }} />}
  </section>;
}

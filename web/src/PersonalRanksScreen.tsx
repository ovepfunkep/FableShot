import { useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { confirmedExerciseRanks } from './exercise-rank.ts';
import type { DiaryEntry } from './persistence.ts';
import { formatAverage } from './preferences.ts';
import { timelineDate } from './progress-timeline.ts';
import { RANK_SOURCE } from './sport-ranks.ts';
import type { RankCategory, StageRank } from './sport-ranks.ts';
import { RankCategoryPreview, RankReference } from './SportRanks.tsx';
import { Icon } from './TrainingChrome.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './personal-records-screen.css';

type BestRank = { entry: DiaryEntry; classLabel: string; evaluation: NonNullable<StageRank['evaluation']> };

export function bestRankResults(entries: readonly DiaryEntry[], category: RankCategory | null) {
  const best = new Map<string, BestRank>();
  if (!category) return [];
  for (const entry of entries) {
    if (entry.deletedAt || entry.practice.savedAt === null) continue;
    for (const { evaluation, classLabel } of confirmedExerciseRanks(entry.practice, category)) {
      const previous = best.get(evaluation.exercise.id);
      const startedAt = Date.parse(entry.startedAt) || Date.parse(entry.createdAt ?? '') || 0;
      const previousStartedAt = previous ? Date.parse(previous.entry.startedAt) || Date.parse(previous.entry.createdAt ?? '') || 0 : 0;
      if (previous && (previous.evaluation.points - evaluation.points ||
        startedAt - previousStartedAt || entry.id.localeCompare(previous.entry.id)) >= 0) continue;
      best.set(evaluation.exercise.id, { entry, evaluation, classLabel });
    }
  }
  return [...best.values()].sort(({ evaluation: a }, { evaluation: b }) =>
    a.exercise.bow.localeCompare(b.exercise.bow) || a.exercise.distance - b.exercise.distance || a.exercise.arrows - b.exercise.arrows);
}

export function PersonalRanksScreen({ entries, onBack, onOpen, onProfile }: {
  entries: readonly DiaryEntry[]; onBack: () => void; onOpen: (id: string) => void; onProfile: () => void;
}) {
  const { preferences } = useTrainingPreferences();
  const [panel, setPanel] = useState<'reference' | 'help' | null>(null);
  const [preview, setPreview] = useState<RankCategory | null>(null);
  const profileCategory = preferences.rankCategory ?? null;
  const category = profileCategory && (preview ?? profileCategory);
  const results = useMemo(() => bestRankResults(entries, category), [entries, category]);
  return <main className="conditions-page" data-testid="personal-ranks-screen">
    <header className="topbar">
      <button type="button" className="icon-button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button>
      <h1>Лучшие по нормативам</h1>
    </header>
    <div className="conditions-content personal-records-content">
      <button type="button" className="primary personal-records-ranks" data-testid="personal-rank-grid" onClick={() => setPanel('reference')}>
        <Icon name="notes" />Разрядная сетка
      </button>
      <div className="personal-records-tabs">
        <RankCategoryPreview profileCategory={profileCategory} category={category} onCategory={setPreview} testId="personal-rank-category" onProfile={onProfile} />
        <button type="button" aria-label="О нормативах ЕВСК" onClick={() => setPanel('help')}>?</button>
      </div>
      {category && !results.length && <p className="personal-records-empty" data-testid="personal-ranks-empty" role="status">
        Пока нет полного совместимого упражнения.
      </p>}
      {results.map(({ entry, evaluation, classLabel }) => {
        const { exercise, points, average, result, next } = evaluation;
        const date = timelineDate(entry);
        return <button type="button" className="personal-records-card" data-testid={`personal-best-${exercise.id}`}
          key={exercise.id} onClick={() => onOpen(entry.id)}>
          <span className="personal-records-conditions">{classLabel} · {exercise.distance} м · {exercise.arrows} стрел</span>
          <span className="personal-records-numbers"><strong>{points}/{exercise.arrows * 10}</strong>
            <span>Ср. {formatAverage(average, preferences.averageHundredths)}</span></span>
          <span className="personal-records-conditions">{result?.label ?? '—'}</span>
          <span className="personal-records-meta">{date ? date.split('-').reverse().join('.') : 'Дата не указана'} · {entry.title || 'Тренировка'}</span>
          {next && <span className="personal-records-meta">До {next.label}: {next.score - points} очков</span>}
          <Icon name="right" />
        </button>;
      })}
    </div>
    {panel === 'reference' && <RankReference initialBow={results[0]?.evaluation.exercise.bow} initialCategory={profileCategory}
      onClose={() => setPanel(null)} onProfile={onProfile} />}
    {panel === 'help' && <BottomSheet title="О нормативах ЕВСК" onClose={() => setPanel(null)}>
      <p>Здесь собраны лучшие результаты полных упражнений. Для официального присвоения разряда учитываются также возраст и условия соревнований.</p>
      <a href={RANK_SOURCE} target="_blank" rel="noreferrer">Источник · Минспорт России</a>
    </BottomSheet>}
  </main>;
}

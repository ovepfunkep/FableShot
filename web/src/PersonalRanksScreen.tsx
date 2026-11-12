import { useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { exerciseRank } from './exercise-rank.ts';
import type { DiaryEntry } from './persistence.ts';
import { formatAverage } from './preferences.ts';
import { timelineDate } from './progress-timeline.ts';
import { RANK_CATEGORIES, RANK_SOURCE } from './sport-ranks.ts';
import type { RankCategory, StageRank } from './sport-ranks.ts';
import { RankReference } from './SportRanks.tsx';
import { Icon } from './TrainingChrome.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './personal-records-screen.css';

type BestRank = { entry: DiaryEntry; classLabel: string; evaluation: NonNullable<StageRank['evaluation']> };

export function bestRankResults(entries: readonly DiaryEntry[], category: RankCategory | null) {
  const best = new Map<string, BestRank>();
  if (!category) return [];
  for (const entry of entries) {
    if (entry.deletedAt || entry.practice.savedAt === null) continue;
    const rank = exerciseRank(entry.practice, category);
    const evaluation = rank.evaluation;
    if (!rank.finalResult || !evaluation || !rank.classLabel) continue;
    const previous = best.get(evaluation.exercise.id);
    const startedAt = Date.parse(entry.startedAt) || Date.parse(entry.createdAt ?? '') || 0;
    const previousStartedAt = previous ? Date.parse(previous.entry.startedAt) || Date.parse(previous.entry.createdAt ?? '') || 0 : 0;
    if (previous && (previous.evaluation.points - evaluation.points ||
      startedAt - previousStartedAt || entry.id.localeCompare(previous.entry.id)) > 0) continue;
    best.set(evaluation.exercise.id, { entry, evaluation, classLabel: rank.classLabel });
  }
  return [...best.values()].sort(({ evaluation: a }, { evaluation: b }) =>
    a.exercise.bow.localeCompare(b.exercise.bow) || a.exercise.distance - b.exercise.distance || a.exercise.arrows - b.exercise.arrows);
}

export function PersonalRanksScreen({ entries, onBack, onOpen }: {
  entries: readonly DiaryEntry[]; onBack: () => void; onOpen: (id: string) => void;
}) {
  const { preferences, update, error } = useTrainingPreferences();
  const [panel, setPanel] = useState<'reference' | 'help' | null>(null);
  const category = preferences.rankCategory ?? null;
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
      <div className="personal-records-tabs" role="group" aria-label="Категория сравнения">
        {(Object.entries(RANK_CATEGORIES) as [RankCategory, string][]).map(([id, label]) => <button
          type="button" key={id} aria-pressed={category === id} data-testid={`personal-rank-category-${id}`}
          onClick={() => update({ ...preferences, rankCategory: id })}>{label}</button>)}
        <button type="button" aria-label="О нормативах ЕВСК" onClick={() => setPanel('help')}>?</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!results.length && <p className="personal-records-empty" data-testid="personal-ranks-empty" role="status">
        {category ? 'Пока нет полного совместимого упражнения.' : 'Выбери категорию сравнения.'}
      </p>}
      {results.map(({ entry, evaluation, classLabel }) => {
        const { exercise, points, average, result, next } = evaluation;
        const date = timelineDate(entry);
        return <button type="button" className="personal-records-card" data-testid={`personal-best-${exercise.id}`}
          key={exercise.id} onClick={() => onOpen(entry.id)}>
          <span className="personal-records-conditions">{classLabel} · {exercise.distance} м · {exercise.arrows} стрел</span>
          <span className="personal-records-numbers"><strong>{points}/{exercise.arrows * 10}</strong>
            <span>Ср. {formatAverage(average, preferences.averageHundredths)}</span></span>
          <span className="personal-records-conditions">{result?.label ?? 'Ниже начального порога'}</span>
          <span className="personal-records-meta">{date ? date.split('-').reverse().join('.') : 'Дата не указана'} · {entry.title || 'Тренировка'}</span>
          {next && <span className="personal-records-meta">До {next.label}: {next.score - points} очков</span>}
          <Icon name="right" />
        </button>;
      })}
    </div>
    {panel === 'reference' && <RankReference initialBow={results[0]?.evaluation.exercise.bow} initialCategory={category} onClose={() => setPanel(null)} />}
    {panel === 'help' && <BottomSheet title="О нормативах ЕВСК" onClose={() => setPanel(null)}>
      <p>Здесь собраны лучшие результаты полных упражнений. Для официального присвоения разряда учитываются также возраст и условия соревнований.</p>
      <a href={RANK_SOURCE} target="_blank" rel="noreferrer">Источник · Минспорт России</a>
    </BottomSheet>}
  </main>;
}

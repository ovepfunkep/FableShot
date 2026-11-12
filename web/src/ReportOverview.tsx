import { useEffect, useState } from 'react';
import { currentSeries, roundShots } from './practice.ts';
import type { Practice } from './practice.ts';
import type { DiaryEntry } from './persistence.ts';
import { getTargetProfile, summarize } from './target.ts';
import type { Conditions } from './conditions.ts';
import type { Shot } from './target.ts';
import { SeriesResult } from './SeriesResult.tsx';
import { formatAverage } from './preferences.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { TechniqueReflection } from './TechniqueReflection.tsx';
import type { TechniqueSelection } from './technique.ts';
import { RankTag } from './SportRanks.tsx';
import { roundRank } from './sport-ranks.ts';
import { TrainingMeanTrend } from './TrainingMeanTrend.tsx';
import { TrainingReportMetrics } from './TrainingReportMetrics.tsx';
import { ExerciseRankCard } from './ExerciseRankCard.tsx';
import { statisticVisible } from './statistics-visibility.ts';
import { ReportExport } from './ReportExport.tsx';
import { PersonalRecordCard } from './PersonalRecordCard.tsx';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import { elapsedTrainingTime, formatTrainingTime } from './training-time.ts';
import type { TrainingTime } from './training-time.ts';
import type { DiaryNoteScope } from './diary-notes.ts';
import { SessionAchievements } from './AchievementNotices.tsx';
import type { AchievementGrant } from './achievement-ledger.ts';
import './report-overview.css';

function result(shots: readonly Shot[], hundredths: boolean, showPoints: boolean, showAverage: boolean) {
  const { points, maximum, average } = summarize(shots);
  return [showPoints && `${points}/${maximum}`, showAverage && formatAverage(average, hundredths)].filter(Boolean).join(' · ');
}

function ReportIcon({ name }: { name: 'back' | 'target' | 'distance' | 'bow' }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'back' && <path d="M14 5l-7 7 7 7M7 12h14" />}
    {name === 'target' && <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>}
    {name === 'distance' && <path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4M3 4v2m18-2v2" />}
    {name === 'bow' && <path d="M7 3q13 9 0 18L7 3m0 9h14m-4-4 4 4-4 4" />}
  </svg>;
}

function ReportDuration({ time }: { time: TrainingTime }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (time.activeSinceMs === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [time.activeSinceMs]);
  const elapsed = elapsedTrainingTime(time, now);
  if (elapsed === null) return null;
  const value = formatTrainingTime(elapsed);
  return <span className="report-duration" data-testid="report-training-time"
    aria-label={`${time.partial ? 'Учтённое время' : 'Время тренировки'} ${value}`}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="13" r="8" /><path d="M9 2h6m-3 0v3m0 3v5l3 2m4-9 2-2" />
    </svg>{value}{time.partial && <small>учтено</small>}
  </span>;
}

export function ReportOverview({ practice, entries, entryId, onBack, onSelectSeries, onResume, onTechnique, onChange, onOpenMemo, onRank, onRankReference, onTrash, onNotes, grants, onAchievement, onOpenRecordSession, onPause }: {
  practice: Practice;
  entries: readonly DiaryEntry[];
  entryId: string | null;
  onBack: () => void;
  onSelectSeries: (seriesId: number) => void;
  onResume: () => void;
  onTechnique: () => void;
  onChange: (next: Practice) => boolean;
  onOpenMemo: (selection: TechniqueSelection) => void;
  onRank: (roundId: number) => void;
  onRankReference: () => void;
  onTrash: (deleted: boolean) => boolean;
  onNotes: (scope: DiaryNoteScope) => void;
  grants: readonly AchievementGrant[];
  onAchievement: (id: 'APP04') => void;
  onOpenRecordSession: (id: string) => void;
  onPause: () => void;
}) {
  const { preferences, update } = useTrainingPreferences();
  const [exportOpen, setExportOpen] = useState(false);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const entry = entries.find(entry => entry.id === entryId);
  const deleted = !!entry?.deletedAt;
  const [trashOpen, setTrashOpen] = useState(false);
  const visible = (feature: Parameters<typeof statisticVisible>[1]) => statisticVisible(preferences, feature);
  const summary = (shots: readonly Shot[]) => result(shots, preferences.averageHundredths, visible('result'), visible('average'));
  const technique = practice.techniqueUses?.at(-1)?.selection;
  const focus = technique ? [technique.focus1, technique.focus2].filter(Boolean) : [];
  const hasShots = practice.rounds.some(round => round.series.some(series => series.shots.length > 0));
  const uniqueConditions = new Map<string, Conditions>();
  for (const round of practice.rounds) for (const series of round.series) {
    if (series.shots.length) uniqueConditions.set(JSON.stringify(series.conditions), series.conditions);
  }
  const currentConditions = currentSeries(practice)?.series.conditions;
  if (!uniqueConditions.size && currentConditions) uniqueConditions.set(JSON.stringify(currentConditions), currentConditions);
  const canResume = !!entry && !!(practice.savedAt || entry.paused) && !deleted;

  return <main className="report-page" data-testid="journal-report">
    <header className="report-bar">
      <button type="button" className="report-back" aria-label="Назад" onClick={onBack}><ReportIcon name="back" /></button>
      <h1>Статистика</h1>
      <div className="report-heading-actions">
        {canResume && <button type="button" className="icon-button" aria-label="Продолжить тренировку" data-testid="session-resume" onClick={() => setResumeOpen(true)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        </button>}
        {hasShots && entry && <button type="button" className="icon-button" aria-label="Поделиться тренировкой" data-testid="report-share" onClick={() => setExportOpen(true)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="6" cy="12" r="3" /><circle cx="18" cy="5" r="3" /><circle cx="18" cy="19" r="3" /><path d="m9 10 6-4M9 14l6 4" /></svg>
        </button>}
        {!!uniqueConditions.size && <button type="button" className="icon-button" aria-label="Условия тренировки" data-testid="report-conditions-open"
          onClick={() => setConditionsOpen(true)}><Icon name="notes" /></button>}
      </div>
    </header>
    <div className="report-body" data-testid="report-screen">
      <div className="report-title-row">
        <h2 className="report-title">{entry?.title || 'Тренировка'}</h2>
        {canResume && <button type="button" className="icon-button" aria-label="Удалить тренировку" onClick={() => setTrashOpen(true)}><Icon name="delete" /></button>}
      </div>
      {entry && (!deleted || !!entry.notes?.length) && <button type="button" className="report-notes-link" onClick={() => onNotes({})}>
        <Icon name="notes" /> Заметки тренировки
      </button>}
      {entry?.trainingTime && visible('training_time') && <ReportDuration time={entry.trainingTime} />}
      {practice.savedAt === null && (!!focus.length || !!technique?.versionId) && <button type="button" className="report-focus" data-testid="report-technique-focus" onClick={onTechnique}>
        <span aria-hidden="true">☷</span><span>{focus.length ? focus.join(' · ') : technique?.title}</span>
      </button>}
      {practice.savedAt !== null && !deleted && <TechniqueReflection practice={practice} onChange={onChange} onOpenMemo={onOpenMemo} />}
      {deleted && <button type="button" className="report-resume" onClick={() => { if (onTrash(false)) onBack(); }}>Восстановить тренировку</button>}
      {entry && !practice.savedAt && !entry.paused && !deleted && <button type="button" className="report-resume" data-testid="session-pause" onClick={onPause}>Приостановить тренировку</button>}
      {!hasShots && <p className="report-empty">Нет попаданий</p>}
      {preferences.showAchievementNotices !== false && <SessionAchievements grants={grants} />}
      {visible('records') && !!entry?.personalRecords?.length && <PersonalRecordCard records={entry.personalRecords}
        availableSessionIds={new Set(entries.filter(item => !item.deletedAt && item.practice.savedAt).map(item => item.id))}
        onSession={onOpenRecordSession} />}
      {visible('series') && practice.rounds.map((round, roundIndex) => {
        const shots = roundShots(round);
        if (!shots.length) return null;
        return <section className="report-round" key={round.id} data-testid={`report-round-${roundIndex + 1}`}>
          <div className="report-round-heading">
            <h3 data-testid={`report-round-total-${roundIndex + 1}`}>Раунд {roundIndex + 1}{summary(shots) && ` · ${summary(shots)}`}</h3>
            {visible('norms') && <RankTag rank={roundRank(practice, round.id, preferences.rankCategory ?? null)} testId={`report-rank-${roundIndex + 1}`} onOpen={() => onRank(round.id)} />}
          </div>
          {round.series.map((series, seriesIndex) => series.shots.length > 0 && <button type="button" className="report-series"
            key={series.id} data-testid={`report-end-${series.id}`} disabled={deleted} onClick={() => onSelectSeries(series.id)}>
            <SeriesResult number={seriesIndex + 1} shots={series.shots} summary={summary(series.shots)}
              totalTestId={`report-series-total-${series.id}`} showHits={visible('result')} />
          </button>)}
        </section>;
      })}
      {visible('mean_trend') && <TrainingMeanTrend practice={practice} />}
      {hasShots && visible('norms') && <ExerciseRankCard practice={practice} category={preferences.rankCategory ?? null}
        onCategory={rankCategory => update({ ...preferences, rankCategory })} onOpenReference={onRankReference} />}
      <TrainingReportMetrics practice={practice} entries={entries} />
    </div>
    {hasShots && entry && <ReportExport entry={{ ...entry, practice }} grants={grants} open={exportOpen} onClose={() => setExportOpen(false)} onAchievement={onAchievement} />}
    {conditionsOpen && <BottomSheet title="Условия тренировки" onClose={() => setConditionsOpen(false)}>
      <div className="report-conditions" data-testid="report-conditions">
        {[...uniqueConditions].map(([key, conditions]) => <div key={key} className="report-condition-group">
          <span aria-label={`Мишень: ${conditions.targetDiameterMm / 10} см, ${getTargetProfile(conditions.targetProfileId)?.title}`}>
            <ReportIcon name="target" />{conditions.targetDiameterMm / 10} см · {getTargetProfile(conditions.targetProfileId)?.title}
          </span>
          <span aria-label={`Дистанция: ${conditions.distanceMeters} м`}><ReportIcon name="distance" />{conditions.distanceMeters} м</span>
          {conditions.equipment && <span className="report-condition-kit" aria-label={`Комплект: ${conditions.equipment.name}`}>
            <ReportIcon name="bow" />{conditions.equipment.name}
          </span>}
        </div>)}
      </div>
    </BottomSheet>}
    {resumeOpen && canResume && <BottomSheet title="Продолжить тренировку?" onClose={() => setResumeOpen(false)}>
      <button type="button" className="primary" data-testid="session-resume-confirm" onClick={() => {
        setResumeOpen(false);
        onResume();
      }}>Продолжить</button>
    </BottomSheet>}
    {trashOpen && <BottomSheet title="Удалить тренировку?" onClose={() => setTrashOpen(false)}>
      <p>Тренировка переместится в корзину. Её можно восстановить из истории.</p>
      <button type="button" className="report-resume" onClick={() => { if (onTrash(true)) { setTrashOpen(false); onBack(); } }}>В корзину</button>
    </BottomSheet>}
  </main>;
}

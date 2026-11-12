import { useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import type { DiaryEntry } from './persistence.ts';
import { currentSeries } from './practice.ts';
import type { Practice, Series } from './practice.ts';
import { formatAverage } from './preferences.ts';
import { calculateProgress, formatProgress, progressSourceChanges } from './progress-scoring.ts';
import { Icon } from './TrainingChrome.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';

type ReportSeries = Series & { round: number; number: number };
const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' });

export function ProgressScoreCard({ practice, series, entries }: {
  practice: Practice; series: readonly ReportSeries[]; entries: readonly DiaryEntry[];
}) {
  const { preferences } = useTrainingPreferences();
  const [blockId, setBlockId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const samples = useMemo(() => {
    const grouped = new Map<number, ReportSeries[]>();
    for (const item of series) {
      const id = item.progressBaselineId;
      if (id === undefined || practice.progressBaselines?.[String(id)]?.status !== 'ready') continue;
      const block = grouped.get(id);
      if (block) block.push(item);
      else grouped.set(id, [item]);
    }
    return [...grouped.entries()];
  }, [practice.progressBaselines, series]);
  const sample = samples.find(([id]) => id === blockId) ?? samples.at(-1);
  const baseline = sample ? practice.progressBaselines?.[String(sample[0])] : undefined;
  const changes = useMemo(() => baseline ? progressSourceChanges(baseline, entries) : [], [baseline, entries]);
  if (!sample || !baseline) return null;
  const result = calculateProgress(baseline, sample[1], practice.savedAt === null ? currentSeries(practice)?.series.id : undefined);
  if (!result || result.currentAverage === null || result.baselineAverage === null) return null;
  const value = formatProgress(result);
  const baselineMean = formatAverage(result.baselineAverage, preferences.averageHundredths);
  const currentMean = formatAverage(result.currentAverage, preferences.averageHundredths);

  return <section className="report-metrics-card" aria-label="Прогресс в этих условиях" data-testid="progress-score-card">
    <header className="report-metrics-heading">
      <Icon name="stats" />
      <h3>Прогресс в этих условиях</h3>
      <button type="button" className="training-mean-help" aria-label="О базе сравнения" onClick={() => setOpen(true)}>?</button>
    </header>
    {samples.length > 1 && <label className="report-metrics-scope">Блок сравнения
      <select value={sample[0]} onChange={event => setBlockId(Number(event.target.value))}>
        {samples.map(([id, [first]]) => <option key={id} value={id}>С раунда {first.round} · серии {first.number}</option>)}
      </select>
    </label>}
    <div className="report-metrics-inline">
      <button type="button" className="progress-score-value" onClick={() => setOpen(true)} data-testid="progress-score-value">
        {!result.fullRankAvailable && <span aria-label="Предварительно">≈ </span>}{value}
      </button>
      {statisticVisible(preferences, 'average') && <span>Средний балл<strong data-testid="progress-score-average">{baselineMean} → {currentMean}</strong></span>}
    </div>
    {changes.length > 0 && <p className="report-metrics-muted" data-testid="progress-source-changed">Часть исходных тренировок изменилась или недоступна. Сравнение использует сохранённые результаты.</p>}
    {open && <BottomSheet title="База сравнения" tag="progress-score-help" onClose={() => setOpen(false)}>
      <div className="progress-score-help">
        <p>Средний балл был {baselineMean}, сейчас {currentMean}. База сохранена {date.format(new Date(baseline.frozenAt))}.</p>
        <p>{result.relativePercent !== null
          ? 'Процент показывает, на сколько изменился средний балл относительно обычного результата.'
          : 'Средний балл базы равен нулю, поэтому изменение показано в баллах.'}</p>
        {!result.fullRankAvailable && <p>Оценка предварительная. Для полного результата нужны не менее 12 стрел в закрытых полных сериях.</p>}
        <h3>Тренировки в базе</h3>
        <ul>
          {baseline.sources.map(source => {
            const change = changes.find(item => item.sessionId === source.sessionId)?.status;
            return <li key={source.sessionId}>
              <span>{date.format(new Date(source.completedAt))}{change === 'changed' ? ' · изменена' : change === 'deleted' ? ' · удалена' : change === 'unavailable' ? ' · нет в дневнике' : ''}</span>
              <span>{source.scoredCount} стрел · {formatAverage(source.scoreSum / source.scoredCount, preferences.averageHundredths)}</span>
            </li>;
          })}
        </ul>
      </div>
    </BottomSheet>}
  </section>;
}

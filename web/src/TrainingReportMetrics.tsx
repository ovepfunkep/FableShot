import { useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { CompositeScoreCard } from './CompositeScoreCard.tsx';
import { conditionsKey } from './composite-scoring.ts';
import type { Conditions } from './conditions.ts';
import { hitGeometry } from './hit-map.ts';
import type { Practice, Series } from './practice.ts';
import type { DiaryEntry } from './persistence.ts';
import { ProgressScoreCard } from './ProgressScoreCard.tsx';
import { formatAverage } from './preferences.ts';
import { getTargetProfile, summarize } from './target.ts';
import type { Shot } from './target.ts';
import { TrainingHitMap } from './TrainingHitMap.tsx';
import { NumberedArrowAnalysis } from './NumberedArrowAnalysis.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';
import './training-report-metrics.css';

type ScopedSeries = Series & { round: number; number: number };
type Scope = { key: string; conditions: Conditions; series: ScopedSeries[] };

function reportScopes(practice: Practice): Scope[] {
  const scopes = new Map<string, Scope>();
  practice.rounds.forEach((round, r) => round.series.forEach((series, s) => {
    if (!series.shots.length) return;
    const key = conditionsKey(series.conditions);
    let scope = scopes.get(key);
    if (!scope) {
      scope = { key, conditions: series.conditions, series: [] };
      scopes.set(key, scope);
    }
    scope.series.push({ ...series, round: r + 1, number: s + 1 });
  }));
  return [...scopes.values()];
}

function scopeLabel(scope: Scope): string {
  const { distanceMeters, targetDiameterMm, targetProfileId, equipment } = scope.conditions;
  return [`${distanceMeters} м`, `${targetDiameterMm / 10} см`, getTargetProfile(targetProfileId)?.title,
    equipment?.name].filter(Boolean).join(' · ');
}

function ResultCard({ shots, diameterMm }: { shots: readonly Shot[]; diameterMm: number }) {
  const { preferences } = useTrainingPreferences();
  const { points, maximum, average } = summarize(shots);
  const geometry = hitGeometry(shots, diameterMm);
  const rms = geometry?.rmsMm;
  const visible = (feature: Parameters<typeof statisticVisible>[1]) => statisticVisible(preferences, feature);
  const showOffset = !visible('hit_map') && visible('offset');
  if (!(['result', 'average', 'volume', 'grouping'] as const).some(visible) && !showOffset) return null;
  return <section className="report-metrics-card report-metrics-result" aria-label="Результат" data-testid="report-result">
    <h3>{visible('result') ? 'Результат' : 'Показатели'}</h3>
    {visible('result') && <><div className="report-metrics-score"><strong>{points}</strong><span>/ {maximum}</span></div>
    <progress aria-label="Доля от максимума" value={points} max={maximum} /></>}
    {visible('volume') && <p className="report-metrics-muted">Стрел: {shots.length}</p>}
    <div className="report-metrics-inline">
      {visible('average') && <span>Средний балл<strong data-testid="report-result-average">{formatAverage(average, preferences.averageHundredths)}</strong></span>}
      {visible('grouping') && <span>Кучность<strong data-testid="report-result-grouping">{rms == null ? '—' : `${formatAverage(rms, false)} мм`}</strong></span>}
      {showOffset && <span>Смещение<strong>{geometry ? `${formatAverage(geometry.shiftMm, false)} мм` : '—'}</strong></span>}
    </div>
  </section>;
}

function ZoneDistribution({ shots }: { shots: readonly Shot[] }) {
  const [help, setHelp] = useState(false);
  const { preferences } = useTrainingPreferences();
  const distribution = statisticVisible(preferences, 'distribution');
  const tens = statisticVisible(preferences, 'zone_trend');
  const counts = new Array<number>(11).fill(0);
  for (const shot of shots) counts[shot.points]++;
  const highest = Math.max(...counts, 1);
  const tenShare = 100 * counts[10] / shots.length;
  if (!distribution && !tens) return null;
  return <section className="report-metrics-card" aria-label="Распределение попаданий" data-testid="report-zone-distribution">
    <header className="report-metrics-heading"><h3>{distribution ? 'Распределение попаданий' : 'Доля десяток'}</h3>
      <button type="button" className="training-mean-help" aria-label="О распределении попаданий" onClick={() => setHelp(true)}>?</button>
    </header>
    {distribution && <div className="report-zone-bars" role="list" aria-label="Попадания по зонам">
      {counts.map((count, zone) => {
        const label = zone === 0 ? 'M' : String(zone);
        return <div className="report-zone-column" key={zone} role="listitem" aria-label={`${label}: ${count}`} data-testid={`report-zone-${label}`}>
          <span>{count}</span>
          <div className={zone === 0 ? 'report-zone-bar is-miss' : 'report-zone-bar'}
            style={{ height: count ? `max(3px, ${count / highest * 70}px)` : 0 }} />
          <strong>{label}</strong>
        </div>;
      })}
    </div>}
    {tens && <p className="report-metrics-muted">Доля десяток <strong data-testid="report-ten-share">{formatAverage(tenShare, false)}%</strong></p>}
    {help && <BottomSheet title="Распределение попаданий" onClose={() => setHelp(false)}>
      <p>Столбики показывают число стрел в каждой зоне. M — промах. X входит в десятки. Координаты для этого графика не нужны.</p>
    </BottomSheet>}
  </section>;
}

export function TrainingReportMetrics({ practice, entries }: { practice: Practice; entries: readonly DiaryEntry[] }) {
  const { preferences } = useTrainingPreferences();
  const visible = (feature: Parameters<typeof statisticVisible>[1]) => statisticVisible(preferences, feature);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const scopes = useMemo(() => reportScopes(practice), [practice]);
  const scope = scopes.find(item => item.key === selectedKey) ?? scopes[0];
  const shots = useMemo(() => scope?.series.flatMap(series => series.shots) ?? [], [scope]);
  if (!scope || !(['result', 'average', 'volume', 'grouping', 'offset', 'general_score', 'progress_score', 'hit_map', 'distribution', 'zone_trend', 'numbered_arrows'] as const).some(visible)) return null;
  return <>
    {scopes.length > 1 && <label className="report-metrics-scope">
      <span>Условия расчёта</span>
      <select data-testid="report-metrics-scope" value={scope.key} onChange={event => setSelectedKey(event.currentTarget.value)}>
        {scopes.map((item, index) => <option key={item.key} value={item.key}>{index + 1}. {scopeLabel(item)}</option>)}
      </select>
    </label>}
    <ResultCard shots={shots} diameterMm={scope.conditions.targetDiameterMm} />
    {visible('general_score') && <CompositeScoreCard practice={practice} conditions={scope.conditions} />}
    {visible('progress_score') && <ProgressScoreCard key={`progress:${scope.key}`} practice={practice} series={scope.series} entries={entries} />}
    {visible('hit_map') && <TrainingHitMap key={`map:${scope.key}`} series={scope.series} conditions={scope.conditions} />}
    {visible('numbered_arrows') && <NumberedArrowAnalysis key={`arrows:${scope.key}`} series={scope.series} />}
    <ZoneDistribution shots={shots} />
  </>;
}

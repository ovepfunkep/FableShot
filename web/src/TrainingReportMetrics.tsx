import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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
import { ReportRoundFilter } from './ReportRoundFilter.tsx';
import { ShotDistribution } from './ShotDistribution.tsx';
import type { DistributionView } from './ShotDistribution.tsx';
import { exerciseRank } from './exercise-rank.ts';
import { RankDetails, RankMedal } from './SportRanks.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { reportBlockOrder, statisticVisible } from './statistics-visibility.ts';
import type { ReportBlock } from './statistics-visibility.ts';
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

function ResultCard({ shots, diameterMm, practice, onRankReference }: { shots: readonly Shot[]; diameterMm: number | null; practice: Practice; onRankReference: () => void }) {
  const { preferences, update } = useTrainingPreferences();
  const [rankOpen, setRankOpen] = useState(false);
  const { points, maximum, average } = summarize(shots);
  const geometry = diameterMm === null ? null : hitGeometry(shots, diameterMm);
  const rms = geometry?.rmsMm;
  const visible = (feature: Parameters<typeof statisticVisible>[1]) => statisticVisible(preferences, feature);
  const showGrouping = diameterMm !== null && visible('grouping');
  const showOffset = diameterMm !== null && !visible('hit_map') && visible('offset');
  const rank = useMemo(() => exerciseRank(practice, preferences.rankCategory ?? null), [practice, preferences.rankCategory]);
  if (!(['result', 'average', 'volume', 'norms'] as const).some(visible) && !showGrouping && !showOffset) return null;
  const hasMetrics = visible('average') || showGrouping || visible('volume') || showOffset;
  return <section className="report-metrics-card report-metrics-result" aria-label="Результат" data-testid="report-result">
    <div className="report-result-score-row">
      <div className="report-result-main">
        <h3>{visible('result') ? 'Результат' : 'Показатели'}</h3>
        {visible('result') && <div className="report-metrics-score" data-testid="report-result-score"><strong>{points}</strong><span>/ {maximum}</span></div>}
      </div>
      {visible('norms') && <button type="button" className="report-result-rank" title={rank.reason ?? (rank.finalResult ? 'Разряд по всей тренировке' : 'Прогноз по среднему баллу')}
        aria-label="Разряд по всей тренировке" aria-haspopup="dialog" onClick={() => setRankOpen(true)}
        data-forecast={!!rank.evaluation && !rank.finalResult}>
        <span>Разряд</span><strong><RankMedal /><span data-testid="report-result-rank">{rank.label ?? '—'}</span></strong>
      </button>}
    </div>
    {visible('result') && <progress aria-label="Доля от максимума" value={points} max={maximum} />}
    {hasMetrics && <dl className="report-metric-grid report-result-metrics">
      {visible('average') && <div><dt>Средний</dt><dd data-testid="report-result-average">{formatAverage(average, preferences.averageHundredths)}</dd></div>}
      {showGrouping && <div><dt>Кучность</dt><dd data-testid="report-result-grouping">{rms == null ? '—' : `${formatAverage(rms, false)} мм`}</dd></div>}
      {visible('volume') && <div><dt>Стрел</dt><dd data-testid="report-result-volume">{shots.length}</dd></div>}
      {showOffset && <div><dt>Смещение</dt><dd>{geometry ? `${formatAverage(geometry.shiftMm, false)} мм` : '—'}</dd></div>}
    </dl>}
    {rankOpen && <RankDetails rank={rank} onClose={() => setRankOpen(false)}
      onCategory={category => update({ ...preferences, rankCategory: category })}
      onOpenReference={() => { setRankOpen(false); onRankReference(); }} />}
  </section>;
}

function ZoneDistribution({ series, view, onView }: {
  series: readonly ScopedSeries[]; view: DistributionView; onView: (view: DistributionView) => void;
}) {
  const [help, setHelp] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const rounds = [...new Set(series.map(entry => entry.round))];
  const round = selectedRound !== null && rounds.includes(selectedRound) ? selectedRound : null;
  const shots = series.filter(entry => round === null || entry.round === round).flatMap(entry => entry.shots);
  const { preferences } = useTrainingPreferences();
  const distribution = statisticVisible(preferences, 'distribution');
  const showShare = statisticVisible(preferences, 'zone_trend');
  const counts = new Array<number>(11).fill(0);
  for (const shot of shots) counts[shot.points]++;
  const tenShare = shots.length ? 100 * counts[10] / shots.length : null;
  const topShare = shots.length ? 100 * (counts[10] + counts[9]) / shots.length : null;
  if (!distribution && !showShare) return null;
  return <section className="report-metrics-card" aria-label="Распределение попаданий" data-testid="report-zone-distribution">
    <header className="report-metrics-heading"><h3>{distribution ? 'Распределение попаданий' : 'Доля 10 и 10+9'}</h3>
      <button type="button" className="training-mean-help" aria-label="О распределении попаданий" onClick={() => setHelp(true)}>?</button>
    </header>
    <div className="shot-distribution-controls">
      <ReportRoundFilter rounds={rounds} value={round} onChange={setSelectedRound} label="Раунд распределения попаданий" />
      {distribution && <div className="shot-distribution-views" role="group" aria-label="Вид распределения">
        <button type="button" aria-pressed={view === 'mosaic'} onClick={() => onView('mosaic')}>Мозаика</button>
        <button type="button" aria-pressed={view === 'pie'} onClick={() => onView('pie')}>Круговая</button>
      </div>}
    </div>
    {distribution && <ShotDistribution key={round ?? 'all'} counts={counts} total={shots.length} view={view} />}
    {showShare && <div className="report-zone-shares">
      <div><p className="report-metrics-muted">Доля 10 <strong data-testid="report-ten-share">{formatAverage(tenShare, false)}%</strong></p>
        <progress max={100} value={tenShare ?? 0} aria-label="Доля десяток" /></div>
      <div><p className="report-metrics-muted">Доля 10+9 <strong data-testid="report-top-share">{formatAverage(topShare, false)}%</strong></p>
        <progress max={100} value={topShare ?? 0} aria-label="Доля девяток и десяток" /></div>
    </div>}
    {help && <BottomSheet title="Распределение попаданий" onClose={() => setHelp(false)}>
      <p>В мозаике одна плитка соответствует стреле. Для длинной тренировки плитки показывают пропорции. В круговой диаграмме ширина сектора показывает долю оценки. Нажми на оценку, чтобы увидеть точное количество и долю.</p>
      <p>M — промах. X входит в десятки. Координаты для расчёта не нужны.</p>
    </BottomSheet>}
  </section>;
}

export function TrainingReportMetrics({ practice, entries, overview, onRankReference }: {
  practice: Practice; entries: readonly DiaryEntry[]; overview: Partial<Record<ReportBlock, ReactNode>>; onRankReference: () => void;
}) {
  const { preferences } = useTrainingPreferences();
  const visible = (feature: Parameters<typeof statisticVisible>[1]) => statisticVisible(preferences, feature);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [distributionView, setDistributionView] = useState<DistributionView>('mosaic');
  const scopes = useMemo(() => reportScopes(practice), [practice]);
  const scope = scopes.find(item => item.key === selectedKey) ?? scopes[0];
  const shots = useMemo(() => practice.rounds.flatMap(round => round.series.flatMap(series => series.shots)), [practice]);
  const mixed = scopes.length > 1;
  const showScopedGeometry = mixed && !visible('hit_map') && (visible('grouping') || visible('offset'));
  const mayShowResult = (['result', 'average', 'volume', 'norms'] as const).some(visible) ||
    !mixed && (visible('grouping') || !visible('hit_map') && visible('offset'));
  const blocks = { ...overview };
  if (scope && (['result', 'average', 'volume', 'grouping', 'offset', 'norms', 'general_score', 'progress_score', 'hit_map', 'distribution', 'zone_trend', 'numbered_arrows'] as const).some(visible)) {
    Object.assign(blocks, {
      result: mayShowResult && <ResultCard shots={shots} diameterMm={mixed ? null : scope.conditions.targetDiameterMm}
        practice={practice} onRankReference={onRankReference} />,
      general_score: visible('general_score') && <CompositeScoreCard practice={practice} conditions={scope.conditions} />,
      progress_score: visible('progress_score') && <ProgressScoreCard key={`progress:${scope.key}`} practice={practice} series={scope.series} entries={entries} />,
      hit_map: visible('hit_map') && <TrainingHitMap key={`map:${scope.key}`} series={scope.series} conditions={scope.conditions} />,
      numbered_arrows: visible('numbered_arrows') && <NumberedArrowAnalysis key={`arrows:${scope.key}`} series={scope.series} />,
      distribution: (visible('distribution') || visible('zone_trend')) && <ZoneDistribution key={`distribution:${scope.key}`} series={scope.series} view={distributionView} onView={setDistributionView} />,
    });
  }
  const order = reportBlockOrder(preferences).filter(id => blocks[id]);
  const firstMetric = order.find(id => id !== 'result' && !(id in overview));
  const showScope = scope && mixed && (firstMetric || showScopedGeometry);
  const scopedGeometry = scope && showScopedGeometry ? hitGeometry(scope.series.flatMap(item => item.shots), scope.conditions.targetDiameterMm) : null;
  const scopeControls = showScope && <div className="report-scoped-controls">
    <label className="report-metrics-scope">
      <span>Условия расчёта</span>
      <select className="report-scope-select" data-testid="report-metrics-scope" value={scope.key} onChange={event => setSelectedKey(event.currentTarget.value)}>
        {scopes.map((item, index) => <option key={item.key} value={item.key}>{index + 1}. {scopeLabel(item)}</option>)}
      </select>
    </label>
    {showScopedGeometry && <dl className="report-metric-grid report-scoped-geometry" aria-live="polite">
      {visible('grouping') && <div><dt>Кучность</dt><dd>{scopedGeometry?.rmsMm == null ? '—' : `${formatAverage(scopedGeometry.rmsMm, false)} мм`}</dd></div>}
      {visible('offset') && <div><dt>Смещение</dt><dd>{scopedGeometry ? `${formatAverage(scopedGeometry.shiftMm, false)} мм` : '—'}</dd></div>}
    </dl>}
  </div>;
  return <>{order.map(id => <ReportBlockSlot key={id} id={id}>
    {id === firstMetric && scopeControls}
    {blocks[id]}
  </ReportBlockSlot>)}
    {!firstMetric && scopeControls}
  </>;
}

function ReportBlockSlot({ id, children }: { id: ReportBlock; children: ReactNode }) {
  return <div className="report-ordered-block" data-report-block={id}>{children}</div>;
}

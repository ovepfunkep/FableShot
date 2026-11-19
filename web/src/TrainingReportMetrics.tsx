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
import { zoneColor } from './TargetBoard.tsx';
import { getTargetProfile, summarize } from './target.ts';
import type { Shot } from './target.ts';
import { TrainingHitMap } from './TrainingHitMap.tsx';
import { NumberedArrowAnalysis } from './NumberedArrowAnalysis.tsx';
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

function ResultCard({ shots, diameterMm }: { shots: readonly Shot[]; diameterMm: number }) {
  const { preferences } = useTrainingPreferences();
  const { points, maximum, average } = summarize(shots);
  const geometry = hitGeometry(shots, diameterMm);
  const rms = geometry?.rmsMm;
  const visible = (feature: Parameters<typeof statisticVisible>[1]) => statisticVisible(preferences, feature);
  const showOffset = !visible('hit_map') && visible('offset');
  if (!(['result', 'average', 'volume', 'grouping'] as const).some(visible) && !showOffset) return null;
  return <section className="report-metrics-card report-metrics-result" aria-label="Результат" data-testid="report-result">
    <header className="report-result-header">
      <h3>{visible('result') ? 'Результат' : 'Показатели'}</h3>
      <div className="report-metrics-inline">
        {visible('average') && <span>Средний балл<strong data-testid="report-result-average">{formatAverage(average, preferences.averageHundredths)}</strong></span>}
        {visible('grouping') && <span>Кучность<strong data-testid="report-result-grouping">{rms == null ? '—' : `${formatAverage(rms, false)} мм`}</strong></span>}
        {showOffset && <span>Смещение<strong>{geometry ? `${formatAverage(geometry.shiftMm, false)} мм` : '—'}</strong></span>}
      </div>
    </header>
    {visible('result') && <><div className="report-metrics-score"><strong>{points}</strong><span>/ {maximum}</span></div>
    <progress aria-label="Доля от максимума" value={points} max={maximum} /></>}
    {visible('volume') && <p className="report-metrics-muted">Стрел: {shots.length}</p>}
  </section>;
}

const pieCenter = 80;
const pieRadius = 78;

function piePoint(angle: number, radius: number) {
  return [pieCenter + Math.cos(angle) * radius, pieCenter + Math.sin(angle) * radius] as const;
}

function ZonePie({ counts, total }: { counts: readonly number[]; total: number }) {
  const zones = counts.map((count, score) => ({ count, score, label: score === 0 ? 'M' : String(score) }))
    .reverse().filter(({ count }) => count > 0);
  if (!zones.length) return null;
  let counted = 0;
  const slices = zones.map(zone => {
    const start = 2 * Math.PI * counted / total - Math.PI / 2;
    counted += zone.count;
    const end = 2 * Math.PI * counted / total - Math.PI / 2;
    const [x, y] = piePoint((start + end) / 2, zones.length === 1 ? 0 : 52);
    return { ...zone, start, end, x, y };
  });
  return <div className="report-zone-layout">
    <svg className="report-zone-pie" viewBox="0 0 160 160" aria-hidden="true">
      {slices.map(({ score, start, end }) => {
        const fill = zoneColor(score);
        if (slices.length === 1) return <circle key={score} cx={pieCenter} cy={pieCenter} r={pieRadius} fill={fill} />;
        const [x1, y1] = piePoint(start, pieRadius);
        const [x2, y2] = piePoint(end, pieRadius);
        return <path key={score} fill={fill} stroke="#777c74" strokeWidth="1" strokeLinejoin="round"
          d={`M ${pieCenter} ${pieCenter} L ${x1} ${y1} A ${pieRadius} ${pieRadius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`} />;
      })}
      {slices.filter(({ count, label }) => count / total >= (label.length === 2 ? .07 : .05)).map(({ score, label, x, y }) =>
        <text key={score} x={x} y={y} textAnchor="middle" dominantBaseline="central"
          fill={score === 0 || score === 3 || score === 4 ? '#fff' : '#101510'}>{label}</text>)}
    </svg>
    <ul className="report-zone-legend" aria-label="Попадания по зонам">
      {zones.map(({ count, score, label }) => <li key={score} data-testid={`report-zone-${label}`}>
        <strong data-zone={score} style={{ color: zoneColor(score) }}>{label}</strong>: {count}
      </li>)}
    </ul>
  </div>;
}

function ZoneDistribution({ shots }: { shots: readonly Shot[] }) {
  const [help, setHelp] = useState(false);
  const { preferences } = useTrainingPreferences();
  const distribution = statisticVisible(preferences, 'distribution');
  const showShare = statisticVisible(preferences, 'zone_trend');
  const counts = new Array<number>(11).fill(0);
  for (const shot of shots) counts[shot.points]++;
  const shareMode = preferences.distributionShare ?? '10';
  const share = 100 * (counts[10] + (shareMode === '10+9' ? counts[9] : 0)) / shots.length;
  if (!distribution && !showShare) return null;
  return <section className="report-metrics-card" aria-label="Распределение попаданий" data-testid="report-zone-distribution">
    <header className="report-metrics-heading"><h3>{distribution ? 'Распределение попаданий' : `Доля ${shareMode}`}</h3>
      <button type="button" className="training-mean-help" aria-label="О распределении попаданий" onClick={() => setHelp(true)}>?</button>
    </header>
    {distribution && <ZonePie counts={counts} total={shots.length} />}
    {showShare && <p className="report-metrics-muted">{distribution && `Доля ${shareMode} `}<strong data-testid="report-ten-share">{formatAverage(share, false)}%</strong></p>}
    {help && <BottomSheet title="Распределение попаданий" onClose={() => setHelp(false)}>
      <p>Размер сектора показывает долю стрел с этой оценкой. Справа указано их количество. M — промах, X входит в десятки. Координаты для расчёта не нужны.</p>
    </BottomSheet>}
  </section>;
}

export function TrainingReportMetrics({ practice, entries, overview }: {
  practice: Practice; entries: readonly DiaryEntry[]; overview: Partial<Record<ReportBlock, ReactNode>>;
}) {
  const { preferences } = useTrainingPreferences();
  const visible = (feature: Parameters<typeof statisticVisible>[1]) => statisticVisible(preferences, feature);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const scopes = useMemo(() => reportScopes(practice), [practice]);
  const scope = scopes.find(item => item.key === selectedKey) ?? scopes[0];
  const shots = useMemo(() => scope?.series.flatMap(series => series.shots) ?? [], [scope]);
  const blocks = { ...overview };
  if (scope && (['result', 'average', 'volume', 'grouping', 'offset', 'general_score', 'progress_score', 'hit_map', 'distribution', 'zone_trend', 'numbered_arrows'] as const).some(visible)) {
    Object.assign(blocks, {
      result: <ResultCard shots={shots} diameterMm={scope.conditions.targetDiameterMm} />,
      general_score: visible('general_score') && <CompositeScoreCard practice={practice} conditions={scope.conditions} />,
      progress_score: visible('progress_score') && <ProgressScoreCard key={`progress:${scope.key}`} practice={practice} series={scope.series} entries={entries} />,
      hit_map: visible('hit_map') && <TrainingHitMap key={`map:${scope.key}`} series={scope.series} conditions={scope.conditions} />,
      numbered_arrows: visible('numbered_arrows') && <NumberedArrowAnalysis key={`arrows:${scope.key}`} series={scope.series} />,
      distribution: <ZoneDistribution shots={shots} />,
    });
  }
  const order = reportBlockOrder(preferences).filter(id => blocks[id]);
  const firstMetric = order.find(id => !(id in overview));
  return <>{order.map(id => <ReportBlockSlot key={id} id={id}>
    {id === firstMetric && scope && scopes.length > 1 && <label className="report-metrics-scope">
      <span>Условия расчёта</span>
      <select data-testid="report-metrics-scope" value={scope.key} onChange={event => setSelectedKey(event.currentTarget.value)}>
        {scopes.map((item, index) => <option key={item.key} value={item.key}>{index + 1}. {scopeLabel(item)}</option>)}
      </select>
    </label>}
    {blocks[id]}
  </ReportBlockSlot>)}</>;
}

function ReportBlockSlot({ id, children }: { id: ReportBlock; children: ReactNode }) {
  return <div className="report-ordered-block" data-report-block={id}>{children}</div>;
}

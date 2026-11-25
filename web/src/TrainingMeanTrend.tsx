import { useMemo, useRef, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import type { Practice } from './practice.ts';
import { getTargetProfile, summarize } from './target.ts';
import { hitGeometry, maximumSpread } from './hit-map.ts';
import { chartLabel, chartScale, rankAverageScale } from './chart-metrics.ts';
import { seriesRank } from './sport-ranks.ts';
import type { RankEvaluation } from './sport-ranks.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './training-mean-trend.css';
import { statisticVisible } from './statistics-visibility.ts';

const width = 300, top = 8, bottom = 152;
const metrics = [
  { key: 'average', label: 'Средний балл', unit: '/ 10', feature: 'average' },
  { key: 'rank', label: 'Норматив (темп)', unit: '', feature: 'norms' },
  { key: 'spread', label: 'Разброс', unit: 'мм', feature: 'grouping' },
  { key: 'rms', label: 'Кучность (RMS)', unit: 'мм', feature: 'grouping' },
  { key: 'shift', label: 'Смещение', unit: 'мм', feature: 'offset' },
  { key: 'tenShare', label: 'Доля десяток', unit: '%', feature: 'zone_trend' },
  { key: 'xShare', label: 'Доля X', unit: '%', feature: 'zone_trend' },
  { key: 'goldShare', label: 'Доля 10+9', unit: '%', feature: 'zone_trend' },
  { key: 'missShare', label: 'Доля промахов', unit: '%', feature: 'zone_trend' },
] as const;

export function TrainingMeanTrend({ practice, initialSeriesPosition }: { practice: Practice; initialSeriesPosition?: number }) {
  const { preferences, update } = useTrainingPreferences();
  const restoredSeries = useRef(initialSeriesPosition);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const choices = metrics.filter(item => statisticVisible(preferences, item.feature));
  const metric = choices.find(item => item.key === preferences.statisticsView?.seriesMetric) ?? choices[0];
  const points = useMemo(() => {
    let scoreSum = 0;
    let arrowCount = 0;
    return practice.rounds.flatMap((round, r) =>
    round.series.flatMap((series, s) => {
      const { shots, conditions } = series;
      if (!shots.length || !metric) return [];
      const geometry = ['spread', 'rms', 'shift'].includes(metric.key) ? hitGeometry(shots, conditions.targetDiameterMm) : null;
      let value: number | null = null;
      let rank: RankEvaluation | null = null;
      let runningAverage: number | null = null;
      switch (metric.key) {
        case 'average': {
          const summary = summarize(shots);
          value = summary.average;
          scoreSum += summary.points;
          arrowCount += shots.length;
          runningAverage = scoreSum / arrowCount;
          break;
        }
        case 'rank':
          rank = seriesRank(practice, series.id, preferences.rankCategory ?? null).evaluation;
          value = rank?.average ?? null;
          break;
        case 'spread': value = preferences.maximumSpread ? maximumSpread(shots, conditions.targetDiameterMm) : geometry?.rmsMm ?? null; break;
        case 'rms': value = geometry?.rmsMm ?? null; break;
        case 'shift': value = geometry?.shiftMm ?? null; break;
        case 'tenShare': value = 100 * shots.filter(shot => shot.points === 10).length / shots.length; break;
        case 'xShare': value = shots.some(shot => shot.code === 'X') || getTargetProfile(conditions.targetProfileId)?.zones.some(zone => zone.code === 'X')
          ? 100 * shots.filter(shot => shot.code === 'X').length / shots.length : null; break;
        case 'goldShare': value = 100 * shots.filter(shot => shot.points >= 9).length / shots.length; break;
        case 'missShare': value = 100 * shots.filter(shot => shot.points === 0).length / shots.length; break;
      }
      return [{ id: series.id, round: r + 1, series: s + 1, count: shots.length, value, rank, runningAverage }];
    }));
  }, [practice, metric, preferences.maximumSpread, preferences.rankCategory]);
  if (!metric || !points.length) return null;
  const usable = points.flatMap((point, index) => point.value === null ? [] : [index]);
  const index = usable.find(i => points[i].id === selectedId) ??
    (restoredSeries.current === undefined ? usable.at(-1) : usable[Math.min(restoredSeries.current, usable.length - 1)]);
  const selected = index === undefined ? null : points[index];
  const select = (i: number | undefined) => { if (i !== undefined) setSelectedId(points[i].id); };
  const selectedPosition = index === undefined ? -1 : usable.indexOf(index);
  const x = (i: number) => points.length === 1 ? width / 2 : top + i * (width - 2 * top) / (points.length - 1);
  const values = usable.map(i => points[i].value!);
  const exercises = new Map(points.flatMap(point => point.rank ? [[point.rank.exercise.id, point.rank.exercise] as const] : []));
  const rankAxis = metric.key === 'rank' ? rankAverageScale(values, exercises.size === 1 ? exercises.values().next().value : undefined) : null;
  const { lower, upper, ticks } = rankAxis ?? chartScale(values, metric.key);
  const y = (value: number) => bottom - (value - lower) * (bottom - top) / (upper - lower);
  const seriesLabel = selected ? `Раунд ${selected.round} · серия ${selected.series}` : '';
  const valueLabel = selected?.value == null ? '' : rankAxis ? selected.rank?.pace?.label ?? '—'
    : chartLabel(metric.key, selected.value, metric.key === 'average' && preferences.averageHundredths);
  const path = usable.map(i => {
    const connected = i > 0 && points[i - 1].value !== null && points[i - 1].rank?.exercise.id === points[i].rank?.exercise.id;
    return `${connected ? 'L' : 'M'} ${x(i)} ${y(points[i].value!)}`;
  }).join(' ');
  const guide = metric.key === 'average' && points.length > 1 ? points.reduce((line, point, i) => {
    const current = y(point.runningAverage!);
    if (!i) return `M ${x(i)} ${current}`;
    const midpoint = (x(i - 1) + x(i)) / 2;
    return `${line} C ${midpoint} ${y(points[i - 1].runningAverage!)} ${midpoint} ${current} ${x(i)} ${current}`;
  }, '') : null;

  return <section className="training-mean" aria-labelledby="training-mean-title" data-testid="training-mean-trend"
    data-series-position={selectedPosition < 0 ? undefined : selectedPosition}>
    <header>
      <Icon name="stats" /><h3 id="training-mean-title">По сериям</h3>
      <select className="report-scope-select" aria-label="Показатель по сериям" value={metric.key} onChange={event => {
        void update({ ...preferences, statisticsView: { ...preferences.statisticsView, seriesMetric: event.currentTarget.value } });
      }}>{choices.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      <button type="button" className="training-mean-help" aria-label="О графике по сериям" onClick={() => setHelp(true)}>?</button>
    </header>
    {index === undefined ? <p>Нет данных для этого показателя.</p> : <>
      <div className="training-mean-chart">
        <div className="training-mean-axis" aria-hidden="true">
          {[...ticks].reverse().map(value => <span key={value} style={{ top: `${y(value) / 160 * 100}%` }}>
            {rankAxis?.thresholds.find(item => item.average === value)?.label ?? chartLabel(rankAxis ? 'average' : metric.key, value)}
          </span>)}
        </div>
        <button type="button" className="icon-button training-mean-prev" data-testid="training-mean-prev"
          aria-label="Предыдущая серия на графике" disabled={selectedPosition <= 0} onClick={() => select(usable[selectedPosition - 1])}><Icon name="left" /></button>
        <svg viewBox={`0 0 ${width} 160`} preserveAspectRatio="none" role="img"
          aria-label={`${metric.label}. ${seriesLabel}, ${valueLabel} ${metric.unit}`}
          data-testid="training-mean-chart" onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeX = (event.clientX - rect.left) * width / rect.width;
            select(usable.reduce((nearest, i) => Math.abs(x(i) - relativeX) < Math.abs(x(nearest) - relativeX) ? i : nearest));
          }}>
          {ticks.map(value => <line className="training-mean-guide" key={value} x1={0} x2={width} y1={y(value)} y2={y(value)} />)}
          {points.map((point, i) => i > 0 && point.round !== points[i - 1].round &&
            <line key={point.id} className="training-mean-round" x1={(x(i - 1) + x(i)) / 2} x2={(x(i - 1) + x(i)) / 2} y1={top} y2={bottom} />)}
          {guide && <path className="training-mean-running" data-testid="training-mean-running" d={guide} />}
          <path className="training-mean-line" d={path} />
          {usable.map(i => <ellipse key={points[i].id} cx={x(i)} cy={y(points[i].value!)} rx={2.9} ry={2.9} />)}
          <line className="training-mean-marker" x1={x(index)} x2={x(index)} y1={top} y2={bottom} />
          <ellipse cx={x(index)} cy={y(points[index].value!)} rx={5} ry={5} />
        </svg>
        <button type="button" className="icon-button training-mean-next" data-testid="training-mean-next"
          aria-label="Следующая серия на графике" disabled={selectedPosition === usable.length - 1} onClick={() => select(usable[selectedPosition + 1])}><Icon name="right" /></button>
      </div>
      <div className="training-mean-reading" aria-live="polite">
        <span>{seriesLabel}</span>
        <span data-testid="training-mean-value"><strong>{valueLabel}</strong> {metric.unit}</span>
        {rankAxis && selected?.value != null && <span>ср. {chartLabel('average', selected.value, preferences.averageHundredths)}</span>}
        {guide && selected?.runningAverage != null && <span>Накопительное среднее {chartLabel('average', selected.runningAverage, preferences.averageHundredths)}</span>}
        {selected && statisticVisible(preferences, 'volume') && <span>Стрел: {selected.count}</span>}
      </div>
    </>}
    {help && <BottomSheet title="График по сериям" onClose={() => setHelp(false)}>
      <p>Каждая точка соответствует серии. Шкала автоматически подстраивается под выбранный показатель. Пунктир разделяет раунды.</p>
    </BottomSheet>}
  </section>;
}

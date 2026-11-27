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
import { conditionsKey } from './composite-scoring.ts';
import { ChoicePicker } from './ChoicePicker.tsx';
import { StatisticRules } from './StatisticRules.tsx';
import { useChartScrub } from './useChartScrub.ts';

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

const explanations: Record<typeof metrics[number]['key'], string> = {
  average: 'Сколько очков в среднем принесла одна стрела серии.',
  rank: 'На какой разряд хватило бы очков, если сохранить средний балл этой серии до конца упражнения.',
  spread: 'Насколько далеко попадания разошлись на мишени.',
  rms: 'Типичное расстояние попаданий от центра группы. Чем меньше, тем плотнее группа.',
  shift: 'На сколько миллиметров центр группы сместился от центра мишени.',
  tenShare: 'Какая часть всех стрел серии принесла 10 очков, включая X.',
  xShare: 'Какая часть всех стрел серии попала во внутреннюю десятку X.',
  goldShare: 'Какая часть всех стрел серии принесла 9 или 10 очков.',
  missShare: 'Какая часть всех стрел серии отмечена промахами.',
};

export type TrendSeriesPosition = { round: number; series: number };

export function TrainingMeanTrend({ practice, initialSeriesPosition }: { practice: Practice; initialSeriesPosition?: TrendSeriesPosition }) {
  const { preferences, update } = useTrainingPreferences();
  const restoredSeries = useRef(initialSeriesPosition);
  const chart = useRef<SVGSVGElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const choices = metrics.filter(item => statisticVisible(preferences, item.feature));
  const metric = choices.find(item => item.key === preferences.statisticsView?.seriesMetric) ?? choices[0];
  const points = useMemo(() => {
    let sum = 0;
    let count = 0;
    let lastKey = '';
    return practice.rounds.flatMap((round, r) =>
    round.series.flatMap((series, s) => {
      const { shots, conditions } = series;
      if (!shots.length || !metric) return [];
      const geometry = ['spread', 'rms', 'shift'].includes(metric.key) ? hitGeometry(shots, conditions.targetDiameterMm) : null;
      let value: number | null = null;
      let rank: RankEvaluation | null = null;
      switch (metric.key) {
        case 'average': {
          const summary = summarize(shots);
          value = summary.average;
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
      const key = JSON.stringify([conditionsKey(conditions), rank?.exercise.id]);
      if (key !== lastKey || value === null) { sum = 0; count = 0; }
      lastKey = key;
      const weight = metric.key === 'average' || metric.key === 'rank' || metric.key.endsWith('Share') ? shots.length : 1;
      if (value !== null) { sum += value * weight; count += weight; }
      return [{ id: series.id, round: r + 1, series: s + 1, count: shots.length, value, rank, key,
        runningAverage: count ? sum / count : null }];
    }));
  }, [practice, metric, preferences.maximumSpread, preferences.rankCategory]);
  const usable = points.flatMap((point, index) => point.value === null ? [] : [index]);
  const x = (i: number) => points.length === 1 ? width / 2 : top + i * (width - 2 * top) / (points.length - 1);
  const select = (i: number | undefined) => { if (i !== undefined) setSelectedId(points[i].id); };
  const scrub = useChartScrub<SVGSVGElement>(clientX => {
    const rect = chart.current?.getBoundingClientRect();
    if (!rect?.width || !usable.length) return;
    const relativeX = (clientX - rect.left) * width / rect.width;
    select(usable.reduce((nearest, i) => Math.abs(x(i) - relativeX) < Math.abs(x(nearest) - relativeX) ? i : nearest));
  });
  if (!metric || !points.length) return null;
  const requested = restoredSeries.current;
  const nearest = requested && usable.reduce<number | undefined>((best, i) => {
    if (best === undefined) return i;
    const current = points[i], previous = points[best];
    const roundDistance = Math.abs(current.round - requested.round) - Math.abs(previous.round - requested.round);
    const seriesDistance = Math.abs(current.series - requested.series) - Math.abs(previous.series - requested.series);
    return roundDistance < 0 || (roundDistance === 0 && seriesDistance < 0) ? i : best;
  }, undefined);
  const index = usable.find(i => points[i].id === selectedId) ?? nearest ?? usable.at(-1);
  const selected = index === undefined ? null : points[index];
  const selectedPosition = index === undefined ? -1 : usable.indexOf(index);
  const values = usable.flatMap(i => [points[i].value!, points[i].runningAverage!]);
  const exercises = new Map(points.flatMap(point => point.rank ? [[point.rank.exercise.id, point.rank.exercise] as const] : []));
  const rankAxis = metric.key === 'rank' ? rankAverageScale(values, exercises.size === 1 ? exercises.values().next().value : undefined) : null;
  const { lower, upper, ticks } = rankAxis ?? chartScale(values, metric.key);
  const displayedTicks = ticks.length > 5
    ? ticks.filter((_, i) => i === 0 || i === ticks.length - 1 || i % Math.ceil(ticks.length / 4) === 0)
    : ticks;
  const y = (value: number) => bottom - (value - lower) * (bottom - top) / (upper - lower);
  const seriesLabel = selected ? `Раунд ${selected.round} · серия ${selected.series}` : '';
  const valueLabel = selected?.value == null ? '' : rankAxis ? selected.rank?.pace?.label ?? '—'
    : chartLabel(metric.key, selected.value, metric.key === 'average' && preferences.averageHundredths);
  const path = usable.map(i => {
    const connected = i > 0 && points[i - 1].value !== null && points[i - 1].key === points[i].key;
    return `${connected ? 'L' : 'M'} ${x(i)} ${y(points[i].value!)}`;
  }).join(' ');
  const guide = usable.length > 1 ? usable.map(i => {
    const point = points[i], previous = points[i - 1];
    const current = y(point.runningAverage!);
    if (previous?.runningAverage == null || previous.key !== point.key) return `M ${x(i)} ${current}`;
    const midpoint = (x(i - 1) + x(i)) / 2;
    return `C ${midpoint} ${y(previous.runningAverage)} ${midpoint} ${current} ${x(i)} ${current}`;
  }).join(' ') : null;

  return <section className="training-mean" aria-labelledby="training-mean-title" data-testid="training-mean-trend"
    data-trend-round={selected?.round} data-trend-series={selected?.series}>
    <header>
      <Icon name="stats" /><h3 id="training-mean-title">По сериям</h3>
      <ChoicePicker label="Показатель по сериям" variant="ghost" value={metric.key}
        options={choices.map(item => ({ value: item.key, label: item.label }))}
        onChange={seriesMetric => { void update({ ...preferences, statisticsView: { ...preferences.statisticsView, seriesMetric } }); }} />
      <button type="button" className="training-mean-help" aria-label={`О показателе «${metric.label}»`} onClick={() => setHelp(true)}>?</button>
    </header>
    {index === undefined ? <p>Нет данных для этого показателя.</p> : <>
      <div className="training-mean-chart" data-rank={!!rankAxis}>
        <div className="training-mean-axis" aria-hidden="true">
          {[...displayedTicks].reverse().map(value => <span key={value} style={{ top: `${y(value) / 160 * 100}%` }}>
            {rankAxis?.thresholds.find(item => item.average === value)?.label ?? chartLabel(rankAxis ? 'average' : metric.key, value)}
          </span>)}
        </div>
        <svg ref={chart} viewBox={`0 0 ${width} 160`} preserveAspectRatio="none" role="group" tabIndex={0}
          aria-label={`${metric.label}. ${seriesLabel}, ${valueLabel} ${metric.unit}`}
          data-testid="training-mean-chart" {...scrub} onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            select(usable[selectedPosition + (event.key === 'ArrowLeft' ? -1 : 1)]);
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
      </div>
      <div className="training-mean-reading" aria-live="polite">
        <span>{seriesLabel}</span>
        <span data-testid="training-mean-value"><strong>{valueLabel}</strong> {metric.unit}</span>
        {rankAxis && selected?.value != null && <span>ср. {chartLabel('average', selected.value, preferences.averageHundredths)}</span>}
        {guide && selected?.runningAverage != null && <span className="training-mean-running-label">
          {['spread', 'rms', 'shift'].includes(metric.key) ? 'Среднее по сериям' : 'Накопительное среднее'}{' '}
          {chartLabel(rankAxis ? 'average' : metric.key, selected.runningAverage, preferences.averageHundredths)} {rankAxis ? '/ 10' : metric.unit}
        </span>}
        {selected && statisticVisible(preferences, 'volume') && <span>Стрел: {selected.count}</span>}
      </div>
    </>}
    {help && <BottomSheet title={metric.label} onClose={() => setHelp(false)}>
      <p>{metric.key === 'spread' ? preferences.maximumSpread
        ? 'Расстояние в миллиметрах между двумя самыми далёкими друг от друга попаданиями серии.'
        : 'Типичное расстояние в миллиметрах от попаданий до центра группы (RMS).'
        : explanations[metric.key]}</p>
      <StatisticRules>
        <p>{metric.key === 'average' || metric.key === 'rank' || metric.key.endsWith('Share')
          ? 'В расчёт входят все введённые стрелы серии, в том числе промахи и стрелы неполной серии.'
          : 'В расчёт входят выстрелы с координатами. Синяя линия усредняет серии, где значение доступно.'}</p>
        <p>Пропущенные данные и смена условий прерывают линию. Пунктир отмечает границы раундов. Шкала подстраивается под результаты.</p>
      </StatisticRules>
    </BottomSheet>}
  </section>;
}

import { useMemo, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import type { Practice } from './practice.ts';
import { formatAverage } from './preferences.ts';
import { summarize } from './target.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './training-mean-trend.css';
import { statisticVisible } from './statistics-visibility.ts';

const width = 300;
const top = 8;
const bottom = 152;

export function TrainingMeanTrend({ practice }: { practice: Practice }) {
  const { preferences } = useTrainingPreferences();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const points = useMemo(() => practice.rounds.flatMap((round, r) =>
    round.series.flatMap((series, s) => {
      const { average } = summarize(series.shots);
      return average === null ? [] : [{ id: series.id, round: r + 1, series: s + 1, count: series.shots.length, average }];
    })), [practice]);
  const storedIndex = points.findIndex(point => point.id === selectedId);
  const index = storedIndex < 0 ? points.length - 1 : storedIndex;
  const selected = points[index];
  if (!selected) return null;

  const x = (i: number) => points.length === 1 ? width / 2 : top + i * (width - 2 * top) / (points.length - 1);
  const y = (average: number) => bottom - average * (bottom - top) / 10;
  const averageText = formatAverage(selected.average, preferences.averageHundredths);
  const seriesLabel = `Раунд ${selected.round} · серия ${selected.series}`;

  function select(i: number) {
    if (points[i]) setSelectedId(points[i].id);
  }

  return <section className="training-mean" aria-labelledby="training-mean-title" data-testid="training-mean-trend">
    <header>
      <Icon name="stats" />
      <h3 id="training-mean-title">Средний балл по сериям</h3>
      <button type="button" className="training-mean-help" aria-label="О графике среднего балла" onClick={() => setHelp(true)}>?</button>
    </header>
    <div className="training-mean-chart">
      <div className="training-mean-axis" aria-hidden="true"><span>10</span><span>5</span><span>0</span></div>
      <button type="button" className="icon-button training-mean-prev" data-testid="training-mean-prev"
        aria-label="Предыдущая серия на графике" disabled={index === 0} onClick={() => select(index - 1)}><Icon name="left" /></button>
      <svg viewBox={`0 0 ${width} 160`} preserveAspectRatio="none" role="img"
        aria-label={`Средний балл от 0 до 10. ${seriesLabel}, средний ${averageText}`}
        data-testid="training-mean-chart" onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relativeX = (event.clientX - rect.left) * width / rect.width;
          const i = Math.round((relativeX - top) * (points.length - 1) / (width - 2 * top));
          select(Math.max(0, Math.min(i, points.length - 1)));
        }}>
        {[0, 5, 10].map(value => <line className="training-mean-guide" key={value} x1={0} x2={width} y1={y(value)} y2={y(value)} />)}
        {points.map((point, i) => i > 0 && point.round !== points[i - 1].round &&
          <line key={point.id} className="training-mean-round" x1={(x(i - 1) + x(i)) / 2} x2={(x(i - 1) + x(i)) / 2} y1={top} y2={bottom} />)}
        <polyline className="training-mean-line" points={points.map((point, i) => `${x(i)},${y(point.average)}`).join(' ')} />
        {points.map((point, i) => <ellipse key={point.id} cx={x(i)} cy={y(point.average)} rx={2.9} ry={2.9} />)}
        <line className="training-mean-marker" x1={x(index)} x2={x(index)} y1={top} y2={bottom} />
        <ellipse cx={x(index)} cy={y(selected.average)} rx={5} ry={5} />
      </svg>
      <button type="button" className="icon-button training-mean-next" data-testid="training-mean-next"
        aria-label="Следующая серия на графике" disabled={index === points.length - 1} onClick={() => select(index + 1)}><Icon name="right" /></button>
    </div>
    <div className="training-mean-reading" aria-live="polite">
      <span>{seriesLabel}</span>
      <span data-testid="training-mean-value"><strong>{averageText}</strong> / 10</span>
      {statisticVisible(preferences, 'volume') && <span>Стрел: {selected.count}</span>}
    </div>
    {help && <BottomSheet title="Средний балл по сериям" onClose={() => setHelp(false)}>
      <p>Каждая точка — средний балл внесённых стрел одной серии, включая неполную. Промах считается за ноль. Пунктир разделяет раунды.</p>
    </BottomSheet>}
  </section>;
}

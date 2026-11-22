import type { Shot } from './target.ts';
import { zoneColor } from './target.ts';
import './series-result.css';

/** The same compact contents in statistics and the active series picker. */
export function SeriesResult({ number, shots, score, average, totalTestId, showHits, cumulative }: {
  number: number; shots: readonly Shot[]; score?: string; average?: string; totalTestId?: string; showHits: boolean; cumulative?: number;
}) {
  return <>
    <span className="report-series-number" data-digits={Math.min(4, String(number).length)} aria-label={`Серия ${number}`}>{number}</span>
    {showHits && <span className="report-hits">
      {shots.length ? shots.map((shot, index) => <span key={index} className="report-hit" style={{
        backgroundColor: shot.points === 0 ? 'var(--raised)' : zoneColor(shot.points),
        color: shot.points === 0 ? 'var(--muted)' : shot.points === 3 || shot.points === 4 ? '#fff' : '#111811',
      }}>{shot.code}</span>) : <span className="series-result-empty">Нет попаданий</span>}
    </span>}
    {(score || average || cumulative !== undefined) && <span className="report-series-summary" data-testid={totalTestId}>
      {score !== undefined && <strong className="report-series-score" aria-label={`Очки ${score}`}>{score}</strong>}
      {average !== undefined && <span className="report-series-average" aria-label={`Средний балл ${average}`}>{average}</span>}
      {cumulative !== undefined && <strong className="report-series-cumulative" aria-label={`Сумма с начала раунда ${cumulative} очков`}>{cumulative}</strong>}
    </span>}
  </>;
}

import type { Shot } from './target.ts';
import { zoneColor } from './TargetBoard.tsx';
import './series-result.css';

/** The same compact contents in statistics and the active series picker. */
export function SeriesResult({ number, shots, summary, totalTestId, showHits }: {
  number: number; shots: readonly Shot[]; summary: string; totalTestId?: string; showHits: boolean;
}) {
  return <>
    <span className="report-series-summary">
      <span className="report-series-number" aria-label={`Серия ${number}`}>{number}</span>
      {summary && <strong data-testid={totalTestId}>{summary}</strong>}
    </span>
    {showHits && <span className="report-hits">
      {shots.length ? shots.map((shot, index) => <span key={index} className="report-hit" style={{
        backgroundColor: shot.points === 0 ? 'var(--raised)' : zoneColor(shot.points),
        color: shot.points === 0 ? 'var(--muted)' : shot.points === 3 || shot.points === 4 ? '#fff' : '#111811',
      }}>{shot.code}</span>) : <span className="series-result-empty">Нет попаданий</span>}
    </span>}
  </>;
}

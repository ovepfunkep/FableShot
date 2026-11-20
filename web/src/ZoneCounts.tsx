import { zoneColor } from './TargetBoard.tsx';
import './zone-counts.css';

export function ZoneCounts({ counts, testIdPrefix, showTotal = false }: {
  counts: readonly number[]; testIdPrefix: string; showTotal?: boolean;
}) {
  return <ul className="report-zone-legend" aria-label="Попадания по зонам">
    {counts.map((count, score) => ({ count, score })).reverse().filter(({ count }) => count > 0)
      .map(({ count, score }) => {
        const label = score === 0 ? 'M' : String(score);
        return <li key={score} data-testid={`${testIdPrefix}-${label}`}>
          <strong data-zone={score} style={{ color: zoneColor(score) }}>{label}</strong>: {count}
        </li>;
      })}
    {showTotal && <li className="zone-counts-total" data-testid={`${testIdPrefix}-total`}>
      <span>Попадания/промахи</span>
      <b>{counts.slice(1).reduce((total, count) => total + count, 0)}/{counts[0] ?? 0}</b>
    </li>}
  </ul>;
}

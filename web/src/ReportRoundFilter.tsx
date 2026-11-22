import './report-round-filter.css';

export function ReportRoundFilter({ rounds, value, onChange, label }: {
  rounds: readonly number[]; value: number | null; onChange: (round: number | null) => void; label: string;
}) {
  return <select className="report-scope-select" aria-label={label} value={value ?? ''}
    onChange={event => onChange(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))}>
    <option value="">Все раунды</option>
    {rounds.map(round => <option key={round} value={round}>Раунд {round}</option>)}
  </select>;
}

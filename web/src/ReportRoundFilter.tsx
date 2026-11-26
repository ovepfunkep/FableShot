import { ChoicePicker } from './ChoicePicker.tsx';

export function ReportRoundFilter({ rounds, value, onChange, label }: {
  rounds: readonly number[]; value: number | null; onChange: (round: number | null) => void; label: string;
}) {
  return <ChoicePicker label={label} value={value === null ? '' : String(value)}
    options={[{ value: '', label: 'Все раунды' }, ...rounds.map(round => ({ value: String(round), label: `Раунд ${round}` }))]}
    onChange={next => onChange(next === '' ? null : Number(next))} />;
}

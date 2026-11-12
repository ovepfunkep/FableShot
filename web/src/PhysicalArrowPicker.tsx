import { BottomSheet } from './ConditionsScreen.tsx';

export function PhysicalArrowPicker({ count, selected, used, error, onChoose, onClose }: {
  count: number; selected: number | undefined; used: ReadonlySet<number>; error: boolean;
  onChoose: (value: number | undefined) => void; onClose: () => void;
}) {
  const numbers = Array.from({ length: count }, (_, index) => index + 1);
  if (selected !== undefined && selected > count) numbers.push(selected);
  return <BottomSheet title="Номер стрелы" tag="physical-arrow-picker" onClose={onClose}>
    <div className="physical-arrow-grid" aria-label="Номера стрел">
      {numbers.map(number => <button type="button" key={number} className="physical-arrow-option"
        data-testid={`physical-arrow-quick-${number}`} aria-label={`Стрела №${number}`}
        aria-pressed={selected === number} disabled={used.has(number)}
        onClick={() => onChoose(selected === number ? undefined : number)}>{number}</button>)}
    </div>
    {error && <p role="alert" className="conditions-error">Номер не сохранён. Выбери его ещё раз или оставь попадание без номера.</p>}
  </BottomSheet>;
}

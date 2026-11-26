import { ChoicePicker } from './ChoicePicker.tsx';
import { DEFAULT_TRIPLE_ORDER } from './preferences.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import type { TargetSpot } from './target.ts';

export const tripleSpotNames = ['Верхняя', 'Средняя', 'Нижняя'] as const;

export function TripleTargetControls() {
  const { preferences, update, readable, error } = useTrainingPreferences();
  const order = preferences.tripleOrder ?? DEFAULT_TRIPLE_ORDER;
  return <section className="triple-settings" aria-label="Настройки светофора">
    <label className="triple-toggle">
      <input type="checkbox" checked={preferences.tripleAutoAdvance ?? false} disabled={!readable}
        onChange={event => void update({ ...preferences, tripleAutoAdvance: event.currentTarget.checked })} />
      Автопереход на «Светофоре»
    </label>
    <p className="report-metrics-muted">После отметки стрелы открывается следующее пятно.</p>
    <div className="triple-order">
      {order.map((spot, index) => <div key={index}><span>{index + 1}-я</span>
        <ChoicePicker value={String(spot)} disabled={!readable} label={`Позиция ${index + 1} в порядке мишеней`}
          onChange={value => {
            const chosen = Number(value) as TargetSpot;
            const next = [...order];
            next[order.indexOf(chosen)] = spot;
            next[index] = chosen;
            void update({ ...preferences, tripleOrder: next });
          }} options={tripleSpotNames.map((label, id) => ({ value: String(id), label }))} />
      </div>)}
    </div>
    {error && <p className="preferences-error" role="alert">{error}</p>}
  </section>;
}

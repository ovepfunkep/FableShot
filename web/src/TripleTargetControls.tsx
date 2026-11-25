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
      Переходить к следующей мишени
    </label>
    <div className="triple-order">
      {order.map((spot, index) => <label key={index}>{index + 1}-я
        <select className="report-scope-select" value={spot} disabled={!readable} aria-label={`Позиция ${index + 1} в порядке мишеней`}
          onChange={event => {
            const chosen = Number(event.currentTarget.value) as TargetSpot;
            const next = [...order];
            next[order.indexOf(chosen)] = spot;
            next[index] = chosen;
            void update({ ...preferences, tripleOrder: next });
          }}>
          {tripleSpotNames.map((name, id) => <option value={id} key={name}>{name}</option>)}
        </select>
      </label>)}
    </div>
    {error && <p className="preferences-error" role="alert">{error}</p>}
  </section>;
}

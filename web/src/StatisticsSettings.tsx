import { STATISTIC_SECTIONS, statisticVisible } from './statistics-visibility.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';

export function StatisticsSettings() {
  const { preferences, update, error } = useTrainingPreferences();
  const disabled = preferences.disabledStatistics ?? [];
  return <div className="statistics-settings">
    <button type="button" className="text-action" data-testid="statistics-enable-all" disabled={!!error || !disabled.length}
      onClick={() => update({ ...preferences, disabledStatistics: [] })}>Показывать всё</button>
    {STATISTIC_SECTIONS.map(section => <section className="statistics-settings-section" key={section.title}>
      <h2>{section.title}</h2>
      {section.items.map(([key, label]) => {
        const visible = statisticVisible(preferences, key);
        return <div className="preference-row" key={key}>
          <span className="preference-title">{label}</span>
          <button type="button" role="switch" aria-label={label} aria-checked={visible} className="preference-switch"
            data-testid={`statistic-${key}`} disabled={!!error} onClick={() => update({ ...preferences,
              disabledStatistics: visible ? [...disabled, key] : disabled.filter(item => item !== key),
            })}><span /></button>
        </div>;
      })}
    </section>)}
    {error && <p className="preferences-error" role="alert">{error}</p>}
  </div>;
}

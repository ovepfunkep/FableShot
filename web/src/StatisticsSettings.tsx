import { useRef, useState } from 'react';
import { REPORT_BLOCKS, reportBlockOrder, STATISTIC_SECTIONS, statisticVisible } from './statistics-visibility.ts';
import type { ReportBlock } from './statistics-visibility.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';

export function StatisticsSettings() {
  const { preferences, update, error } = useTrainingPreferences();
  const disabled = preferences.disabledStatistics ?? [];
  const order = reportBlockOrder(preferences);
  const drag = useRef<ReportBlock | null>(null);
  const [hovered, setHovered] = useState<ReportBlock | null>(null);
  function blockAt(x: number, y: number) {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-report-order]');
    return (target?.dataset.reportOrder as ReportBlock | undefined) ?? null;
  }
  function move(from: ReportBlock, to: ReportBlock) {
    if (from === to || error) return;
    const next = order.filter(id => id !== from);
    next.splice(order.indexOf(to), 0, from);
    update({ ...preferences, reportOrder: next });
  }
  return <div className="statistics-settings">
    <div className="settings-statistics-heading">
      <div><h2>Показатели и графики</h2><small>Отображение и очередность</small></div>
      <button type="button" className="text-action" data-testid="statistics-enable-all" disabled={!!error || !disabled.length}
        onClick={() => update({ ...preferences, disabledStatistics: [] })}>Показывать всё</button>
    </div>
    <details className="settings-panel report-order">
      <summary>Порядок блоков тренировки</summary>
      <ol>{order.map((id, index) => {
        const label = REPORT_BLOCKS.find(([key]) => key === id)![1];
        return <li key={id} data-over={hovered === id} data-report-order={id}>
          <button className="report-order-grip" type="button" aria-label={`Перетащить: ${label}`} disabled={!!error}
            onPointerDown={event => { drag.current = id; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={event => {
              if (!drag.current) return;
              setHovered(blockAt(event.clientX, event.clientY));
            }}
            onPointerUp={event => {
              const to = blockAt(event.clientX, event.clientY);
              if (drag.current && to) move(drag.current, to);
              drag.current = null;
              setHovered(null);
            }}
            onPointerCancel={() => { drag.current = null; setHovered(null); }}>⠿</button>
          <span>{label}</span>
          <button type="button" aria-label={`Выше: ${label}`} disabled={!!error || index === 0} onClick={() => move(id, order[index - 1])}>↑</button>
          <button type="button" aria-label={`Ниже: ${label}`} disabled={!!error || index === order.length - 1} onClick={() => move(id, order[index + 1])}>↓</button>
        </li>;
      })}</ol>
    </details>
    {STATISTIC_SECTIONS.map(section => <section className="statistics-settings-section" key={section.title}>
      <h3>{section.title}</h3>
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

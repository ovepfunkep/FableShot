import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from './ConditionsScreen.tsx';
import { Icon } from './TrainingChrome.tsx';
import type { PersonalRecordEvent } from './personal-record-events.ts';
import './personal-record-card.css';

function Trophy() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8" />
  </svg>;
}

export function PersonalRecordComparisonSheet({ record, onClose, availableSessionIds, onSession }: {
  record: PersonalRecordEvent;
  onClose: () => void;
  availableSessionIds?: ReadonlySet<string>;
  onSession?: (id: string) => void;
}) {
  const previousId = record.previousSessionId;
  const canOpen = previousId && previousId !== record.sessionId && (!availableSessionIds || availableSessionIds.has(previousId));
  return <BottomSheet title="Личный рекорд" tag="personal-record-details" onClose={onClose}>
    <div className="personal-record-details">
      <h3>{record.label}</h3>
      <dl className="personal-record-values" data-testid="personal-record-comparison">
        <div><dt>Было</dt><dd>{record.previousValue}</dd></div>
        <div><dt><span className="personal-record-values-arrow" aria-hidden="true">→</span>Стало</dt><dd>{record.value}</dd></div>
      </dl>
      <p>Сравнение на момент завершения тренировки</p>
      {canOpen && onSession && <button type="button" className="personal-record-link" data-testid="personal-record-previous-session"
        onClick={() => { onClose(); onSession(previousId); }}>
        Открыть прежнюю тренировку <Icon name="right" />
      </button>}
    </div>
  </BottomSheet>;
}

export function PersonalRecordCard({ records, availableSessionIds, onSession }: {
  records: readonly PersonalRecordEvent[];
  availableSessionIds?: ReadonlySet<string>;
  onSession?: (id: string) => void;
}) {
  const [openedId, setOpenedId] = useState<string | null>(null);
  const opened = records.find(record => record.id === openedId);
  if (!records.length) return null;
  return <section className="report-metrics-card personal-record-card" aria-label="Рекорды на момент завершения" data-testid="personal-record-report">
    <header className="report-metrics-heading"><Trophy /><h3>Рекорды на момент завершения</h3></header>
    <div className="personal-record-list">
      {records.map(record => <button type="button" className="personal-record-row" key={record.id}
        data-testid={`personal-record-${record.id}`} aria-haspopup="dialog" onClick={() => setOpenedId(record.id)}>
        <span><strong>{record.label}</strong><small>Было {record.previousValue} → Стало {record.value}</small></span>
        <Icon name="right" />
      </button>)}
    </div>
    {opened && <PersonalRecordComparisonSheet record={opened} onClose={() => setOpenedId(null)}
      availableSessionIds={availableSessionIds} onSession={onSession} />}
  </section>;
}

export function PersonalRecordNotice({ record, onNext, onShown, availableSessionIds, onSession }: {
  record: PersonalRecordEvent;
  onNext: () => void;
  onShown: () => void;
  availableSessionIds?: ReadonlySet<string>;
  onSession?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const notice = useRef<HTMLElement>(null);
  const pressed = useRef(false);
  const notifiedId = useRef<string | null>(null);
  const callbacks = useRef({ onNext, onShown });
  callbacks.current = { onNext, onShown };
  useEffect(() => {
    if (notifiedId.current === record.id) return;
    notifiedId.current = record.id;
    callbacks.current.onShown();
  }, [record.id]);
  useEffect(() => {
    if (expanded) return;
    let remaining = 2400;
    const timer = window.setInterval(() => {
      if (pressed.current || document.visibilityState !== 'visible' || !document.hasFocus() ||
        notice.current?.querySelector(':focus-visible')) return;
      remaining -= 100;
      if (remaining <= 0) {
        window.clearInterval(timer);
        callbacks.current.onNext();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [expanded, record.id]);
  return <>
    <aside className="personal-record-notice" aria-label="Личный рекорд" ref={notice} data-testid="personal-record-banner">
      <button type="button" className="personal-record-notice-main" aria-haspopup="dialog" aria-label={`Условия рекорда: ${record.label}`}
        onClick={() => setExpanded(true)}
        onPointerDown={event => { pressed.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { pressed.current = false; }}>
        <Trophy />
        <span className="personal-record-notice-text" aria-live="polite">
          <strong>Личный рекорд</strong>
          <small>{record.label}</small>
          <span className="personal-record-notice-values" data-testid="record-banner-values">
            <del>{record.previousValue}</del><span aria-hidden="true">→</span><b key={record.id}>{record.value}</b>
          </span>
        </span>
      </button>
      <button type="button" className="personal-record-notice-dismiss" aria-label="Скрыть рекорд"
        data-testid="record-banner-dismiss" onClick={onNext}><Icon name="close" /></button>
    </aside>
    {expanded && <PersonalRecordComparisonSheet record={record} onClose={onNext}
      availableSessionIds={availableSessionIds} onSession={onSession} />}
  </>;
}

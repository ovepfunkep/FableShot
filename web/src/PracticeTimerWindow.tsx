import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { displaySeconds, timerClock } from './timer.ts';
import type { TimerPhase, TimerSettings, TimerState } from './timer.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './practice-timer.css';

const phaseTitle = (phase: TimerPhase) => phase === 'Series' ? 'Серия' : 'Отдых';

function TimerIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 2h6m-3 0v3m6.5 1.5L20 5m-8 4v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="14" r="8" stroke="currentColor" strokeWidth="1.8" />
  </svg>;
}

function ClockCharacter({ value, index, testIds }: { value: string; index: number; testIds: boolean }) {
  const { preferences } = useTrainingPreferences();
  const previous = useRef(value);
  const element = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (!preferences.animations || value === ':' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.current?.animate([
      { transform: 'translateY(55%)', opacity: .35 },
      { transform: 'translateY(0)', opacity: 1 },
    ], { duration: 220, easing: 'ease-out' });
    return () => animation?.cancel();
  }, [value, preferences.animations]);

  return <span className={`timer-clock-cell${value === ':' ? ' timer-clock-colon' : ''}`}
    data-testid={testIds ? `timer-digit-${index}` : undefined} aria-hidden="true">
    <span ref={element} key={value} data-testid={testIds ? `timer-character-${index}` : undefined}>{value}</span>
  </span>;
}

function SlidingClock({ seconds, testIds = false }: { seconds: number; testIds?: boolean }) {
  const value = timerClock(seconds);
  return <span className="timer-clock" data-testid={testIds ? 'timer-remaining' : undefined} role="timer" aria-label={value}>
    {Array.from(value).map((character, index) => <ClockCharacter key={index} value={character} index={index} testIds={testIds} />)}
  </span>;
}

export function PracticeTimerBadge({ state, onOpen }: { state: TimerState; onOpen: () => void }) {
  const seconds = displaySeconds(state);
  return <button type="button" className={`practice-timer-badge${state.status === 'Running' ? ' is-running' : ''}`}
    data-testid="practice-timer-open" aria-label={`Таймер: ${phaseTitle(state.phase)}, ${timerClock(seconds)}`} onClick={onOpen}>
    <TimerIcon />
    {state.status !== 'Idle' && <SlidingClock seconds={seconds} />}
  </button>;
}

function durationValue(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : null;
}

export function PracticeTimerWindow({ state, settings, onToggle, onReset, onSelectPhase, onSave, onClose }: {
  state: TimerState;
  settings: TimerSettings;
  onToggle: () => void;
  onReset: () => void;
  onSelectPhase: (phase: TimerPhase) => void;
  onSave: (settings: TimerSettings) => boolean;
  onClose: () => void;
}) {
  const [series, setSeries] = useState(String(settings.seriesSeconds));
  const [rest, setRest] = useState(String(settings.restSeconds));
  const [nextPhase, setNextPhase] = useState<TimerPhase | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const drag = useRef<{ id: number; y: number } | null>(null);
  const ongoing = state.status === 'Running' || state.status === 'Paused';
  const validSeries = durationValue(series);
  const validRest = durationValue(rest);
  const changed = validSeries !== settings.seriesSeconds || validRest !== settings.restSeconds;
  const status = state.status === 'Idle' ? 'Готов к запуску'
    : state.status === 'Running' ? `Идёт отсчёт · ${phaseTitle(state.phase).toLocaleLowerCase('ru-RU')}`
      : state.status === 'Paused' ? 'На паузе' : 'Время вышло';
  const action = state.status === 'Running' ? 'Пауза' : state.status === 'Paused' ? 'Продолжить'
    : state.status === 'Finished' ? 'Ещё раз' : 'Запустить';

  useEffect(() => { setSeries(String(settings.seriesSeconds)); }, [settings.seriesSeconds]);
  useEffect(() => { setRest(String(settings.restSeconds)); }, [settings.restSeconds]);
  useLayoutEffect(() => { sheet.current?.showModal(); }, []);
  useLayoutEffect(() => { if (nextPhase) confirmation.current?.showModal(); }, [nextPhase]);
  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    drag.current = { id: event.pointerId, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (drag.current?.id !== event.pointerId) return;
    const distance = event.clientY - drag.current.y;
    drag.current = null;
    if (distance > 64) onClose();
  }

  function saveDurations() {
    if (validSeries === null || validRest === null || ongoing || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      if (!onSave({ seriesSeconds: validSeries, restSeconds: validRest })) setSaveError(true);
    } catch {
      setSaveError(true);
    } finally { setSaving(false); }
  }

  return <>
    <dialog ref={sheet} className="practice-timer-sheet" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="practice-timer-content" data-testid="practice-timer-window">
        <header onPointerDown={startDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; }}>
          <span className="practice-timer-handle" aria-hidden="true" />
          <h2 id={titleId}>Таймер</h2>
        </header>
        <div className="practice-timer-phases" role="group" aria-label="Режим таймера">
          {(['Series', 'Rest'] as const).map(phase => <button type="button" key={phase}
            className="timer-phase" data-testid={`timer-phase-${phase}`} aria-pressed={phase === state.phase} disabled={saving}
            onClick={() => { if (phase !== state.phase) { if (ongoing) setNextPhase(phase); else onSelectPhase(phase); } }}>
            {phaseTitle(phase)}
          </button>)}
        </div>
        <SlidingClock seconds={displaySeconds(state)} testIds />
        <p className="practice-timer-status" data-testid="timer-status">{status}</p>
        <div className="practice-timer-actions">
          <button type="button" className="primary" data-testid="timer-toggle" disabled={saving} onClick={onToggle}>{action}</button>
          <button type="button" className="timer-reset" data-testid="timer-reset" disabled={saving} onClick={onReset}>Сброс</button>
        </div>
        <p className="practice-timer-note">Отсчёт в фоне продолжается. Серии переключаешь сам.</p>
        <hr />
        <h3>Длительности</h3>
        <div className="practice-timer-durations">
          <label className={`timer-duration-field${validSeries === null ? ' invalid' : ''}`}>
            <span>Серия, сек</span>
            <input type="text" inputMode="numeric" maxLength={4} value={series} aria-label="Серия, сек"
              data-testid="timer-series-seconds" disabled={ongoing || saving} aria-invalid={validSeries === null}
              onChange={event => { setSeries(event.target.value.slice(0, 4)); setSaveError(false); }} />
          </label>
          <label className={`timer-duration-field${validRest === null ? ' invalid' : ''}`}>
            <span>Отдых, сек</span>
            <input type="text" inputMode="numeric" maxLength={4} value={rest} aria-label="Отдых, сек"
              data-testid="timer-rest-seconds" disabled={ongoing || saving} aria-invalid={validRest === null}
              onChange={event => { setRest(event.target.value.slice(0, 4)); setSaveError(false); }} />
          </label>
        </div>
        {(validSeries === null || validRest === null) && <p className="practice-timer-error" role="alert">От 1 до 3600 секунд</p>}
        {saveError && <p className="practice-timer-error" role="alert">Не удалось сохранить длительности. Попробуй ещё раз.</p>}
        <button type="button" className="timer-save" data-testid="timer-save-durations"
          disabled={ongoing || saving || validSeries === null || validRest === null || !changed} onClick={saveDurations}>
          {saving ? 'Сохранение…' : 'Сохранить длительности'}
        </button>
      </div>
    </dialog>
    {nextPhase && <dialog ref={confirmation} className="practice-timer-confirm" aria-labelledby={`${titleId}-confirm`}
      onCancel={event => { event.preventDefault(); setNextPhase(null); }}
      onClick={event => { if (event.target === event.currentTarget) setNextPhase(null); }}>
      <h2 id={`${titleId}-confirm`}>Сменить режим?</h2>
      <p>Текущий отсчёт будет сброшен. Новый запускается вручную.</p>
      <div className="practice-timer-confirm-actions">
        <button type="button" onClick={() => setNextPhase(null)}>Отмена</button>
        <button type="button" data-testid="timer-confirm-phase" onClick={() => { onSelectPhase(nextPhase); setNextPhase(null); }}>Сменить</button>
      </div>
    </dialog>}
  </>;
}

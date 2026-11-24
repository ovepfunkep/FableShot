import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { DEFAULT_PREPARATION_SECONDS, displaySeconds, timerClock } from './timer.ts';
import type { TimerPhase, TimerSettings, TimerState } from './timer.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './practice-timer.css';

const phaseTitle = (phase: TimerPhase) => phase === 'Preparation' ? 'Подготовка' : phase === 'Series' ? 'Стрельба' : 'Отдых';
const timerTone = (state: TimerState) => state.status === 'Finished' ? 'finished'
  : state.phase === 'Preparation' ? 'preparation' : state.phase === 'Series' ? 'series' : 'rest';

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
  return <button type="button" className="practice-timer-badge" data-timer-tone={timerTone(state)}
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

export function PracticeTimerWindow({ state, settings, onToggle, onAdvance, onReset, onSelectPhase, onSave, onClose }: {
  state: TimerState;
  settings: TimerSettings;
  onToggle: () => void;
  onAdvance: () => void;
  onReset: () => void;
  onSelectPhase: (phase: TimerPhase) => void;
  onSave: (settings: TimerSettings) => Promise<boolean>;
  onClose: () => void;
}) {
  const [series, setSeries] = useState(String(settings.seriesSeconds));
  const [rest, setRest] = useState(String(settings.restSeconds));
  const prepSeconds = settings.preparationSeconds ?? DEFAULT_PREPARATION_SECONDS;
  const [preparation, setPreparation] = useState(String(prepSeconds));
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
  const preparationValue = durationValue(preparation);
  const validPreparation = preparationValue !== null && preparationValue <= 120 ? preparationValue : null;
  const changed = validSeries !== settings.seriesSeconds || validRest !== settings.restSeconds || validPreparation !== prepSeconds;
  const status = state.status === 'Idle' ? 'Готов к запуску'
    : state.status === 'Running' ? `Идёт отсчёт · ${phaseTitle(state.phase).toLocaleLowerCase('ru-RU')}`
      : state.status === 'Paused' ? 'На паузе' : 'Время вышло';
  const action = state.status === 'Running' ? 'Пауза' : state.status === 'Paused' ? 'Продолжить'
    : state.status === 'Finished' ? 'Ещё раз' : 'Запустить';

  useEffect(() => { setSeries(String(settings.seriesSeconds)); }, [settings.seriesSeconds]);
  useEffect(() => { setRest(String(settings.restSeconds)); }, [settings.restSeconds]);
  useEffect(() => { setPreparation(String(prepSeconds)); }, [prepSeconds]);
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

  async function saveDurations() {
    if (validSeries === null || validRest === null || validPreparation === null || ongoing || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      if (!await onSave({ seriesSeconds: validSeries, restSeconds: validRest, preparationSeconds: validPreparation })) setSaveError(true);
    } catch {
      setSaveError(true);
    } finally { setSaving(false); }
  }

  return <>
    <dialog ref={sheet} className="practice-timer-sheet" data-expanded={state.status !== 'Idle' || undefined} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="practice-timer-content" data-testid="practice-timer-window">
        <header onPointerDown={startDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; }}>
          <span className="practice-timer-handle" aria-hidden="true" />
          <h2 id={titleId}>Таймер</h2>
          <button type="button" className="timer-close" onPointerDown={event => event.stopPropagation()} onClick={onClose} aria-label="Свернуть таймер">Свернуть</button>
        </header>
        <div className="practice-timer-phases" role="group" aria-label="Режим таймера">
          {(['Preparation', 'Series', 'Rest'] as const).map(phase => <button type="button" key={phase}
            className="timer-phase" data-testid={`timer-phase-${phase}`} aria-pressed={phase === state.phase} disabled={saving}
            onClick={() => { if (phase !== state.phase) { if (ongoing) setNextPhase(phase); else onSelectPhase(phase); } }}>
            {phaseTitle(phase)}
          </button>)}
        </div>
        <button type="button" className="practice-timer-face" data-timer-tone={timerTone(state)}
          aria-label={state.status === 'Running' ? 'Следующий этап таймера' : action}
          data-testid="timer-advance" onClick={onAdvance} disabled={saving}>
          <strong className="practice-timer-face-phase">{phaseTitle(state.phase)}</strong>
          <SlidingClock seconds={displaySeconds(state)} testIds />
          <span className="practice-timer-status" data-testid="timer-status">{status}</span>
        </button>
        <div className="practice-timer-actions">
          <button type="button" className="primary" data-testid="timer-toggle" disabled={saving} onClick={onToggle}>{action}</button>
          <button type="button" className="timer-reset" data-testid="timer-reset" disabled={saving} onClick={onReset}>Сброс</button>
        </div>
        <p className="practice-timer-note">2 сигнала — подготовка · 1 — стрельба · 3 — к мишеням</p>
        {!ongoing && state.status !== 'Finished' && <details className="timer-duration-settings">
          <summary data-testid="timer-durations-toggle">Длительности</summary>
        <div className="practice-timer-durations">
          <label className={`timer-duration-field${validPreparation === null ? ' invalid' : ''}`}>
            <span>Подготовка, сек</span>
            <input type="text" inputMode="numeric" maxLength={3} value={preparation} aria-label="Подготовка, сек"
              data-testid="timer-preparation-seconds" disabled={ongoing || saving} aria-invalid={validPreparation === null}
              onChange={event => { setPreparation(event.target.value.slice(0, 3)); setSaveError(false); }} />
          </label>
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
        {(validSeries === null || validRest === null || validPreparation === null) &&
          <p className="practice-timer-error" role="alert">Подготовка от 1 до 120 секунд, стрельба и отдых от 1 до 3600.</p>}
        {saveError && <p className="practice-timer-error" role="alert">Не удалось сохранить длительности. Попробуй ещё раз.</p>}
        <button type="button" className="timer-save" data-testid="timer-save-durations"
          disabled={ongoing || saving || validSeries === null || validRest === null || validPreparation === null || !changed} onClick={saveDurations}>
          {saving ? 'Сохранение…' : 'Сохранить длительности'}
        </button>
        </details>}
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

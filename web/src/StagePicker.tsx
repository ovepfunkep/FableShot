import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { currentSeries, roundShots } from './practice.ts';
import type { Practice } from './practice.ts';
import { summarize } from './target.ts';
import type { Shot } from './target.ts';
import { formatAverage } from './preferences.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import './stage-picker.css';

type PickerKind = 'round' | 'series';

type StagePickerProps = {
  kind: PickerKind;
  practice: Practice;
  roundId: number;
  seriesId: number;
  onChoose: (seriesId: number) => void;
  onClose: () => void;
  onNewRound: () => void;
  onDelete: (id: number) => void;
};

type Entry = {
  id: number;
  seriesId: number;
  number: number;
  shots: readonly Shot[];
  seriesCount: number;
  occupiedSeriesCount: number;
  selected: boolean;
};

type Confirmation = { type: 'new-round' } | { type: 'delete'; entry: Entry };

const historyKey = 'fableshotStagePicker';

function openModal(dialog: HTMLDialogElement | null) {
  dialog?.showModal();
  return () => dialog?.close();
}

function stageEntries(kind: PickerKind, practice: Practice, roundId: number, seriesId: number): Entry[] {
  if (kind === 'round') {
    const current = currentSeries(practice)?.round ?? practice.rounds.at(-1);
    return practice.rounds.flatMap((round, index) => {
      const last = round.series.at(-1);
      return last ? [{
        id: round.id,
        seriesId: last.id,
        number: index + 1,
        shots: roundShots(round),
        seriesCount: round.series.length,
        occupiedSeriesCount: round.series.filter(series => series.shots.length > 0).length,
        selected: round.id === current?.id,
      }] : [];
    });
  }
  return (practice.rounds.find(round => round.id === roundId)?.series ?? []).map((series, index) => ({
    id: series.id,
    seriesId: series.id,
    number: index + 1,
    shots: series.shots,
    seriesCount: 1,
    occupiedSeriesCount: Number(series.shots.length > 0),
    selected: series.id === seriesId,
  }));
}

export function StagePicker({ kind, practice, roundId, seriesId, onChoose, onClose, onNewRound, onDelete }: StagePickerProps) {
  const { preferences } = useTrainingPreferences();
  const titleId = useId();
  const confirmTitleId = useId();
  const sheet = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ id: number; y: number } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const latest = useRef({ onClose, confirmation });
  const isRound = kind === 'round';
  const entries = stageEntries(kind, practice, roundId, seriesId);
  const canStartRound = (currentSeries(practice)?.round.series ?? []).some(series => series.shots.length > 0);
  const roundNumber = practice.rounds.findIndex(round => round.id === roundId) + 1;

  useLayoutEffect(() => { latest.current = { onClose, confirmation }; }, [onClose, confirmation]);
  useLayoutEffect(() => openModal(sheet.current), []);
  useLayoutEffect(() => openModal(confirm.current), [confirmation]);

  useEffect(() => {
    // A same-URL history entry also catches Back in a WebView or an installed web app.
    function markOpen() {
      const previous = window.history.state;
      if (previous?.[historyKey] === titleId) return;
      const state = { ...previous, [historyKey]: titleId };
      if (previous?.[historyKey]) window.history.replaceState(state, '');
      else window.history.pushState(state, '');
    }
    function back() {
      if (window.history.state?.[historyKey] === titleId) return;
      if (latest.current.confirmation) {
        setConfirmation(null);
        markOpen();
      } else latest.current.onClose();
    }
    markOpen();
    window.addEventListener('popstate', back);
    return () => {
      window.removeEventListener('popstate', back);
      queueMicrotask(() => {
        if (!sheet.current?.isConnected && window.history.state?.[historyKey] === titleId) window.history.back();
      });
    };
  }, [titleId]);

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    drag.current = { id: event.pointerId, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    const start = drag.current;
    drag.current = null;
    if (start?.id === event.pointerId && event.clientY - start.y >= 60) onClose();
  }

  function finishConfirmation() {
    if (!confirmation) return;
    if (confirmation.type === 'new-round') onNewRound();
    else onDelete(confirmation.entry.id);
    onClose();
  }

  const confirmEntry = confirmation?.type === 'delete' ? confirmation.entry : null;
  const confirmTitle = confirmEntry
    ? (isRound ? `Удалить раунд ${confirmEntry.number}?` : 'Удалить серию?')
    : 'Начать новый раунд?';
  const confirmDescription = confirmEntry
    ? (isRound
      ? `${confirmEntry.seriesCount} серий · ${confirmEntry.shots.length} стрел. Попадания этих серий будут удалены. Тренировка останется.`
      : `${confirmEntry.shots.length} стрел. Попадания этой серии будут удалены.`)
    : 'Внесённые попадания останутся в текущем раунде. Пропущенные стрелы и серии не добавятся. Новый раунд начнётся с первой серии.';

  return <>
    <dialog ref={sheet} className="stage-picker" aria-labelledby={titleId} data-testid="stage-picker"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="stage-picker__content" data-testid={`training-${isRound ? 'rounds' : 'series'}-sheet`}>
        <header className="stage-picker__header" onPointerDown={startDrag} onPointerUp={endDrag}
          onPointerCancel={() => { drag.current = null; }}>
          <span className="stage-picker__handle" aria-hidden="true" />
          <h2 id={titleId}>{isRound ? 'Раунды тренировки' : `Серии · раунд ${roundNumber}`}</h2>
        </header>
        <ul className="stage-picker__list">
          {entries.map(entry => {
            const label = `${isRound ? 'Раунд' : 'Серия'} ${entry.number}`;
            const deleteLabel = `Удалить ${isRound ? 'раунд' : 'серию'} ${entry.number}`;
            const result = summarize(entry.shots);
            const average = formatAverage(result.average, preferences.averageHundredths);
            return <li key={entry.id} className={`stage-picker__card${entry.selected ? ' stage-picker__card--selected' : ''}`}>
              <button type="button" className="stage-picker__select"
                data-testid={`training-select-${kind}-${entry.number}`}
                onClick={() => { onChoose(entry.seriesId); onClose(); }}>
                <span className="stage-picker__headline">
                  <span className="stage-picker__name">{label}</span>
                  {entry.selected && <span className="stage-picker__current"
                    data-testid={`training-current-${kind}-${entry.number}`}>{isRound ? 'Текущий' : 'Текущая'}</span>}
                </span>
                {!preferences.hideScores && (!isRound || entry.shots.length > 0) && <span className="stage-picker__result"
                  data-testid={`training-${kind}-result-${entry.number}`}>
                  {result.points}/{result.maximum} очков · средний {average}
                </span>}
                <span className="stage-picker__volume" data-testid={`training-${kind}-volume-${entry.number}`}>
                  {isRound ? `${entry.occupiedSeriesCount} серий · ${entry.shots.length} стрел` : `Стрел: ${entry.shots.length}`}
                </span>
              </button>
              <button type="button" className="stage-picker__trash" aria-label={deleteLabel}
                data-testid={`remove-${kind}-${entry.number}`}
                onClick={() => setConfirmation({ type: 'delete', entry })}>
                <span className="stage-picker__bin" aria-hidden="true" />
              </button>
            </li>;
          })}
        </ul>
        {isRound && practice.savedAt === null && <div className="stage-picker__footer">
          <button type="button" className="primary stage-picker__new" data-testid="start-new-round"
            disabled={!canStartRound} onClick={() => setConfirmation({ type: 'new-round' })}>
            Начать новый раунд <span aria-hidden="true">+</span>
          </button>
        </div>}
      </div>
    </dialog>
    {confirmation && <dialog ref={confirm} className="stage-picker-confirm" aria-labelledby={confirmTitleId}
      onCancel={event => { event.preventDefault(); setConfirmation(null); }}
      onClick={event => { if (event.target === event.currentTarget) setConfirmation(null); }}>
      <div className="stage-picker-confirm__content">
        <h2 id={confirmTitleId}>{confirmTitle}</h2>
        <p>{confirmDescription}</p>
        <div className="stage-picker-confirm__actions">
          <button type="button" autoFocus onClick={() => setConfirmation(null)}>Отмена</button>
          <button type="button" data-testid={confirmEntry ? `confirm-remove-${kind}` : 'confirm-new-round'}
            onClick={finishConfirmation}>{confirmEntry ? 'Удалить' : 'Начать раунд'}</button>
        </div>
      </div>
    </dialog>}
  </>;
}

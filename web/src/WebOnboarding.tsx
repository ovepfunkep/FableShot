import { useEffect, useRef, useState } from 'react';
import { TargetBoard } from './TargetBoard.tsx';
import { DEFAULT_TARGET, scorePoint } from './target.ts';
import type { Shot } from './target.ts';
import { Icon } from './TrainingChrome.tsx';
import './web-onboarding.css';

type OnboardingActions = { onStart: () => void; onImport: () => void; onClose: () => void };

const tutorial = [
  { title: 'Поймай свою точку', hint: 'Удержи палец, уточни попадание в лупе и отпусти. Короткое касание тоже работает.' },
  { title: 'Ближе к точности', hint: 'Разведи два пальца или нажми «+». Масштаб меняется, стрелы не добавляются.' },
  { title: 'Поправь попадание', hint: 'Выбери номер стрелы, поставь новую точку и нажми «Готово». Последнее действие можно отменить.' },
] as const;
const miss: Shot = { point: null, points: 0, code: 'M' };
const examplePoint = { x: .08, y: .04 };
const exampleShot: Shot = { point: examplePoint, ...scorePoint(examplePoint, DEFAULT_TARGET) };

function Brand() {
  return <span className="web-onboard-brand">
    <img src={`${import.meta.env.BASE_URL}icons/fableshot-192.png`} width="36" height="36" alt="" />
    FableShot
  </span>;
}

function Welcome({ onStart, onImport, onClose, onExample }: OnboardingActions & { onExample: () => void }) {
  return <main className="web-onboard web-onboard-welcome" data-testid="onboarding-screen">
    <header className="web-onboard-header">
      <Brand />
      <button type="button" className="web-onboard-link" data-testid="onboard-skip" onClick={onClose}>Пропустить</button>
    </header>
    <div className="web-onboard-scene" aria-hidden="true">
      <div className="web-onboard-face"><i /><i /><i /></div>
    </div>
    <div className="web-onboard-copy">
      <h1>Каждая тренировка — шаг вперёд</h1>
      <p>Записывай попадания и следи за личным прогрессом.</p>
    </div>
    <div className="web-onboard-actions">
      <button type="button" className="primary" data-testid="onboard-start" onClick={onStart}>Начать тренировку</button>
      <button type="button" className="web-onboard-outline" data-testid="onboard-example" onClick={onExample}>Попробовать на примере</button>
      <button type="button" className="web-onboard-link" data-testid="onboard-import" onClick={onImport}>Перенести из MyTargets</button>
    </div>
    <p className="web-onboard-storage">Дневник хранится на устройстве. Историю можно сохранить в резервную копию.</p>
  </main>;
}

function TargetTutorial({ onStart, onClose }: Pick<OnboardingActions, 'onStart' | 'onClose'>) {
  const [step, setStep] = useState(0);
  const [history, setHistory] = useState<Shot[][]>([[]]);
  const [edit, setEdit] = useState<{ index: number; shot: Shot } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shots = history.at(-1)!;
  const display = edit ? shots.map((shot, index) => index === edit.index ? edit.shot : shot) : shots;
  const canMark = edit !== null || shots.length < 3;
  const instruction = tutorial[step];

  useEffect(() => { heading.current?.focus(); }, [step]);

  function mark(shot: Shot) {
    if (edit) setEdit({ ...edit, shot });
    else if (canMark) setHistory(previous => [...previous, [...previous.at(-1)!, shot]]);
  }

  function saveEdit() {
    if (!edit) return;
    if (edit.shot !== shots[edit.index]) setHistory(previous => [...previous, display]);
    setEdit(null);
  }

  function next() {
    if (step === 1 && !shots.length) setHistory(previous => [...previous, [exampleShot]]);
    setEdit(null);
    setStep(step + 1);
  }

  function replay() {
    setHistory([[]]);
    setEdit(null);
    setStep(0);
  }

  return <main className="web-onboard web-onboard-tutorial" data-testid="tutorial-screen">
    <header className="web-onboard-header">
      <span className="web-onboard-example-label">Пример · не сохраняется в историю</span>
      <button type="button" className="icon-button" aria-label="Выйти из примера" data-testid="tutorial-exit" onClick={onClose}><Icon name="close" /></button>
    </header>
    {instruction ? <>
      <div className="web-onboard-copy">
        <span className="web-onboard-step" data-testid="tutorial-step">Шаг {step + 1} из 3</span>
        <h1 ref={heading} tabIndex={-1}>{instruction.title}</h1>
        <p>{instruction.hint}</p>
      </div>
      <div className="web-onboard-board">
        <TargetBoard shots={display} inputEnabled={canMark} onShot={mark} selectedIndex={edit?.index ?? null} />
      </div>
      <div className="web-onboard-shots" role="group" aria-label="Стрелы примера">
        {Array.from({ length: 3 }, (_, index) => {
          const shot = display[index];
          return <button key={index} type="button" className="web-onboard-outline" disabled={!shot}
            aria-label={`Стрела ${index + 1}: ${shot?.code ?? 'не отмечена'}`} aria-pressed={edit?.index === index}
            data-testid={`tutorial-shot-${index}`} onClick={() => { if (shot && edit?.index !== index) setEdit({ index, shot: shots[index] }); }}>
            <span>№{index + 1}</span><strong>{shot?.code ?? '—'}</strong>
          </button>;
        })}
      </div>
      <div className="web-onboard-example-controls">
        <button type="button" className="web-onboard-outline" data-testid="tutorial-miss" aria-label="Отметить промах" disabled={!canMark} onClick={() => mark(miss)}>M</button>
        {edit ? <>
          <button type="button" className="web-onboard-outline" data-testid="tutorial-cancel" onClick={() => setEdit(null)}>Отмена</button>
          <button type="button" className="primary" data-testid="tutorial-save" onClick={saveEdit}>Готово</button>
        </> : <button type="button" className="web-onboard-outline" data-testid="tutorial-undo" disabled={history.length <= 1}
          onClick={() => setHistory(previous => previous.slice(0, -1))}><Icon name="undo" />Отменить</button>}
      </div>
      <button type="button" className="primary" data-testid="tutorial-next" disabled={edit !== null} onClick={next}>{step === 2 ? 'Завершить пример' : 'Дальше'}</button>
    </> : <>
      <div className="web-onboard-copy">
        <h1 ref={heading} tabIndex={-1}>Готово</h1>
        <p>Теперь можешь начать свою тренировку.</p>
      </div>
      <div className="web-onboard-actions">
        <button type="button" className="primary" data-testid="tutorial-start" onClick={onStart}>К своей тренировке</button>
        <button type="button" className="web-onboard-outline" data-testid="tutorial-replay" onClick={replay}>Повторить пример</button>
        <button type="button" className="web-onboard-link" data-testid="tutorial-home" onClick={onClose}>На Главную</button>
      </div>
    </>}
  </main>;
}

/** Welcome and practice example. The host owns first-open state and real routes. */
export function WebOnboarding(actions: OnboardingActions & { initialExample?: boolean }) {
  const [example, setExample] = useState(actions.initialExample ?? false);
  return example ? <TargetTutorial onStart={actions.onStart} onClose={actions.onClose} /> :
    <Welcome {...actions} onExample={() => setExample(true)} />;
}

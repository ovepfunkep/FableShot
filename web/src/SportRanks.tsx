import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { bowCategoryName } from './equipment.ts';
import { formatAverage } from './preferences.ts';
import { RANK_CATEGORIES, RANK_DOCUMENT, RANK_LABELS, RANK_REFERENCE, RANK_SOURCE } from './sport-ranks.ts';
import type { RankBow, RankCategory, RankEvaluation, RankGroup, StageRank } from './sport-ranks.ts';
import { getTargetProfile } from './target.ts';
import { ExerciseThresholdTable } from './ExerciseThresholdTable.tsx';
import './sport-ranks.css';

export function RankMedal() {
  return <svg className="rank-medal" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 3 3 7m9-7-3 7M9 3h6" /><circle cx="12" cy="15" r="5.5" /><path d="m10 15 1.5 1.5L14 14" />
  </svg>;
}

export function RankTag({ rank, onOpen, testId }: { rank: StageRank; onOpen?: () => void; testId?: string }) {
  const label = rank.label;
  const forecast = !rank.finalResult && rank.evaluation?.pace;
  const contents = <><strong>{forecast && <RankMedal />}{label ?? '—'}</strong><span>{rank.classLabel ?? 'Разряд'}</span></>;
  if (onOpen) return <button type="button" className="rank-tag" data-testid={testId} onClick={onOpen}
    aria-label={`${rank.scopeLabel} · ${forecast ? 'Прогноз ' : ''}${label ?? 'разряд'}`}>{contents}</button>;
  return rank.label ? <span className="rank-tag" data-testid={testId}>{contents}</span> : null;
}

function RankDialog({ title, testId, onClose, children }: {
  title: string; testId: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="rank-dialog" data-testid={testId} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="rank-dialog__body">
      <header className="rank-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label={`Закрыть · ${title}`} onClick={onClose}>×</button>
      </header>
      {children}
    </div>
  </dialog>;
}

function CategoryButtons({ category, onCategory, testId }: {
  category: RankCategory | null; onCategory: (category: RankCategory) => void; testId: string;
}) {
  return <div className="rank-filters" role="group" aria-label="Категория сравнения">
    {(['male', 'female'] as const).map(id => <button type="button" key={id} aria-pressed={category === id}
      data-testid={`${testId}-${id}`} onClick={() => onCategory(id)}>{RANK_CATEGORIES[id]}</button>)}
  </div>;
}

function RankSource() {
  return <div className="rank-source-links">
    <a href={RANK_SOURCE} target="_blank" rel="noreferrer">Источник ЕВСК</a>
    <a href={RANK_DOCUMENT} target="_blank" rel="noreferrer">Таблица XLS</a>
  </div>;
}

export function RankDetails({ rank, forecast, onClose, onOpenReference, onCategory }: {
  rank: StageRank; forecast?: RankEvaluation | null; onClose: () => void; onOpenReference: () => void; onCategory?: (category: RankCategory) => void;
}) {
  const [changingCategory, setChangingCategory] = useState(false);
  const { evaluation, conditions } = rank;
  return <RankDialog title={`${rank.scopeLabel} · нормативы`} testId="rank-details" onClose={onClose}>
    <div className="rank-detail">
      {evaluation ? <>
        <div className="rank-summary">
          <div className="rank-summary-level"><span>{rank.finalResult ? 'Результат упражнения' : 'Прогноз по среднему'}</span>
            <h3 data-testid="rank-headline"><RankMedal />{rank.label ?? '—'}</h3></div>
          <div className="rank-summary-average"><span>Средний балл</span><strong>{formatAverage(evaluation.entered ? evaluation.points / evaluation.entered : null, true)}</strong></div>
        </div>
        {forecast?.pace && <p>Темп {forecast.pace.label} · сетка на {forecast.exercise.arrows} стрел</p>}
        <dl className="rank-context">
          <div><dt>Лук</dt><dd>{bowCategoryName(evaluation.exercise.bow)}</dd></div>
          <div><dt>Дистанция</dt><dd>{evaluation.exercise.distance} м</dd></div>
          <div><dt>Упражнение</dt><dd>{evaluation.exercise.arrows} стрел</dd></div>
        </dl>
        <div className="rank-volume" data-testid="rank-progress"><strong>{evaluation.points} <small>очков</small></strong>
          <span>{evaluation.entered} из {evaluation.exercise.arrows} стрел</span>
          <progress value={Math.min(evaluation.entered, evaluation.exercise.arrows)} max={evaluation.exercise.arrows} aria-label="Объём упражнения" />
        </div>
        <ExerciseThresholdTable key={evaluation.exercise.id} evaluation={evaluation} finalResult={rank.finalResult}
          saved={rank.finalResult} showAverage showVolume={false} />
      </> : <p className="rank-reason" data-testid="rank-unavailable">{rank.reason}</p>}
      <div className="rank-detail-actions">
        {onCategory && rank.category !== null && !changingCategory &&
          <button type="button" className="rank-link" aria-label={`Изменить категорию · ${RANK_CATEGORIES[rank.category]}`}
            data-testid="rank-change-category" onClick={() => setChangingCategory(true)}>
            {RANK_CATEGORIES[rank.category]} <span aria-hidden="true">✎</span>
          </button>}
        <button type="button" className="rank-open-reference" data-testid="rank-open-reference" onClick={onOpenReference}>Вся сетка <span aria-hidden="true">›</span></button>
      </div>
      {onCategory && (rank.category === null || changingCategory) && <CategoryButtons category={rank.category} testId="rank-category"
        onCategory={category => { onCategory(category); setChangingCategory(false); }} />}
      <details className="rank-calculation">
        <summary data-testid="rank-help">Расчёт и источник</summary>
        {conditions && <p data-testid="rank-target-conditions">{conditions.targetDiameterMm / 10} см · {getTargetProfile(conditions.targetProfileId)?.title}</p>}
        {!rank.finalResult && evaluation?.projected != null && <p>Прогноз при сохранении среднего: {formatAverage(evaluation.projected, true)} очков.</p>}
        <p>Для официального разряда также учитываются возраст и условия соревнований.</p>
        <RankSource />
      </details>
    </div>
  </RankDialog>;
}

const groups = [['recurve', 'КЛ'], ['barebow', 'КЛб'], ['compound', 'БЛ'], ['3d', '3Д']] as const;

export function RankReference({ initialBow, initialCategory, onClose }: {
  initialBow?: RankBow | null; initialCategory?: RankCategory | null; onClose: () => void;
}) {
  const [group, setGroup] = useState<RankGroup>(initialBow ?? 'barebow');
  const [category, setCategory] = useState<RankCategory>(initialCategory ?? 'male');
  const scroll = useRef<HTMLDivElement>(null);
  return <RankDialog title="Разрядная сетка" testId="rank-reference" onClose={onClose}>
    <div className="rank-reference">
      <div className="rank-filters" role="group" aria-label="Дисциплина">
        {groups.map(([id, label]) => <button type="button" key={id} aria-pressed={group === id}
          data-testid={`rank-grid-bow-${id}`} onClick={() => { setGroup(id); if (scroll.current) scroll.current.scrollTop = 0; }}>{label}</button>)}
      </div>
      <CategoryButtons category={category} onCategory={setCategory} testId="rank-grid-category" />
      <div ref={scroll} className="rank-reference__scroll" data-testid="rank-grid-scroll" tabIndex={0} role="region" aria-label="Таблица нормативов">
        <table>
          <caption className="sr-only">Нормы в очках · {RANK_CATEGORIES[category]}</caption>
          <thead><tr><th scope="col">Дисциплина / упражнение</th>
            {RANK_LABELS.map(label => <th scope="col" key={label}>{label}</th>)}
          </tr></thead>
          <tbody>{RANK_REFERENCE.filter(row => row.group === group).map(row => <tr key={row.sourceRow} data-testid={`rank-grid-row-${row.sourceRow}`}>
            <th scope="row"><strong>{row.title}</strong>{row.volume && <span>{row.volume}</span>}{row.condition && <span>{row.condition}</span>}</th>
            {row[category].map((score, index) => <td key={RANK_LABELS[index]} data-testid={`rank-grid-cell-${row.sourceRow}-${index}`}>{score ?? '—'}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <RankSource />
    </div>
  </RankDialog>;
}

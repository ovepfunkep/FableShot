import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { bowCategoryName } from './equipment.ts';
import { formatAverage } from './preferences.ts';
import { RANK_CATEGORIES, RANK_DOCUMENT, RANK_LABELS, RANK_REFERENCE, RANK_SOURCE } from './sport-ranks.ts';
import type { RankBow, RankCategory, RankEvaluation, RankGroup, RankThreshold, StageRank } from './sport-ranks.ts';
import { getTargetProfile } from './target.ts';
import './sport-ranks.css';

export function RankTag({ rank, onOpen, testId }: { rank: StageRank; onOpen?: () => void; testId?: string }) {
  const contents = <><strong>{rank.label ?? '—'}</strong><span>{rank.classLabel ?? 'Разряд'}</span></>;
  if (onOpen) return <button type="button" className="rank-tag" data-testid={testId} onClick={onOpen}
    aria-label={`${rank.scopeLabel} · разряд${rank.label ? ` ${rank.label}` : ''}`}>{contents}</button>;
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

export function RankScale({ evaluation }: { evaluation: RankEvaluation }) {
  const [selected, setSelected] = useState<RankThreshold | null>(null);
  const { average, exercise, next, pace } = evaluation;
  const laneEnds: number[] = [];
  const labels = exercise.thresholds.map(threshold => {
    const position = threshold.score / exercise.arrows * 10;
    const center = Math.max(11, Math.min(89, position));
    const availableLane = laneEnds.findIndex(previous => center - previous >= 20);
    const lane = availableLane < 0 ? laneEnds.length : availableLane;
    laneEnds[lane] = center;
    return { threshold, lane, position, center };
  });

  return <div className="rank-scale">
    <p className="rank-scale__average">Средний <strong>{formatAverage(average, true)}</strong></p>
    <div className="rank-scale__bounds" aria-hidden="true"><span>0</span><span>10</span></div>
    <div className="rank-scale__plot" style={{ '--rank-lanes': laneEnds.length } as CSSProperties} data-testid="rank-scale"
      role="group" aria-label={`Шкала среднего от 0 до 10. Текущий средний ${formatAverage(average, true)}`}>
      <div className="rank-scale__track" aria-hidden="true" />
      {labels.map(({ threshold, position, lane, center }, index) => <div key={threshold.label}
        className={`rank-scale__threshold${threshold === next ? ' rank-scale__threshold--next' : threshold === pace ? ' rank-scale__threshold--pace' : ''}`}
        style={{ '--rank-position': `${position}%`, '--rank-center': `${center}%`, '--rank-lane': lane,
          '--rank-join-start': `${Math.min(position, center)}%`, '--rank-join-width': `${Math.abs(position - center)}%` } as CSSProperties}>
        <span className="rank-scale__tick" aria-hidden="true" />
        <span className="rank-scale__join" aria-hidden="true" />
        <button type="button" aria-pressed={selected?.label === threshold.label} data-testid={`rank-label-${index}`}
          onClick={() => setSelected(selected?.label === threshold.label ? null : threshold)}>{threshold.label}</button>
      </div>)}
      {average !== null && <span className="rank-scale__average-dot" style={{ left: `${average * 10}%` }} aria-hidden="true" />}
    </div>
    {selected && <p className="rank-scale__selection" data-testid="rank-threshold-detail">
      <strong>{selected.label}</strong> · {selected.score} очков за {exercise.arrows} стрел · средний {formatAverage(selected.score / exercise.arrows, true)}
    </p>}
  </div>;
}

function RankSource() {
  return <details className="rank-source">
    <summary data-testid="rank-help">О нормативах ЕВСК</summary>
    <p>Числовое сравнение по приложению № 34 к приказу Минспорта России от 10 марта 2026 г. № 201.
      Для официального присвоения учитываются также возраст и условия соревнований.</p>
    <a href={RANK_SOURCE} target="_blank" rel="noreferrer">Источник · Минспорт России</a>
  </details>;
}

export function RankDetails({ rank, onClose, onOpenReference, onCategory }: {
  rank: StageRank; onClose: () => void; onOpenReference: () => void; onCategory?: (category: RankCategory) => void;
}) {
  const [changingCategory, setChangingCategory] = useState(false);
  const { evaluation, conditions } = rank;
  const next = evaluation?.next;
  const remaining = evaluation?.remainingAverage;
  return <RankDialog title={`${rank.scopeLabel} · нормативы`} testId="rank-details" onClose={onClose}>
    <div className="rank-detail">
      {evaluation ? <>
        <h3 data-testid="rank-headline">{rank.finalResult ? 'По очкам' : 'Разряд'} · {rank.label ?? '—'}</h3>
        <p>{bowCategoryName(evaluation.exercise.bow)} · {evaluation.exercise.distance} м · {evaluation.exercise.arrows} стрел</p>
        {conditions && <p className="rank-muted" data-testid="rank-target-conditions">
          {conditions.targetDiameterMm / 10} см · {getTargetProfile(conditions.targetProfileId)?.title}
        </p>}
        <p data-testid="rank-progress">{evaluation.points} очков · {evaluation.entered} из {evaluation.exercise.arrows} стрел
          {!rank.finalResult && evaluation.projected !== null && ` · прогноз ${formatAverage(evaluation.projected, true)}`}</p>
        <RankScale key={evaluation.exercise.id} evaluation={evaluation} />
        {next && <div className="rank-next" data-testid="rank-next">
          <strong>Следующий рубеж · {next.label}</strong>
          <span>От {formatAverage(next.score / evaluation.exercise.arrows, true)} за стрелу · {next.score} очков</span>
          {rank.finalResult && <span>До рубежа {next.score - evaluation.points} очков</span>}
          {remaining != null && <span data-testid="rank-remaining">{remaining > 10 ? 'Рубеж недостижим на оставшихся стрелах'
            : `На оставшихся стрелах нужен средний ${formatAverage(remaining, true)}`}</span>}
        </div>}
      </> : <p className="rank-reason" data-testid="rank-unavailable">{rank.reason}</p>}
      {onCategory && (rank.category === null || changingCategory ? <CategoryButtons category={rank.category} testId="rank-category"
        onCategory={category => { onCategory(category); setChangingCategory(false); }} />
        : <button type="button" className="rank-link" data-testid="rank-change-category" onClick={() => setChangingCategory(true)}>
          Категория · {RANK_CATEGORIES[rank.category]} <span aria-hidden="true">✎</span>
        </button>)}
      <button type="button" className="rank-open-reference" data-testid="rank-open-reference" onClick={onOpenReference}>Вся разрядная сетка <span aria-hidden="true">›</span></button>
      <RankSource />
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
      <a href={RANK_DOCUMENT} target="_blank" rel="noreferrer">Полный документ ЕВСК · XLS</a>
    </div>
  </RankDialog>;
}

import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { summarize } from './target.ts';
import { scoreColor } from './score-appearance.ts';
import type { Shot } from './target.ts';
import { DEFAULT_SHOT_MOTION_STYLE, formatAverage } from './preferences.ts';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';
import { CleanSeriesEffects, ShotFace } from './ShotMotion.tsx';
import type { ShotMotionEvent } from './ShotMotion.tsx';

const paths = {
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
  group: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M16 4a3.5 3.5 0 0 1 0 7m2 2a5 5 0 0 1 4 5v2',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  calendar: 'M4 6h16v15H4zM8 3v6m8-6v6M4 11h16',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM9 2h6m-3 7v4l3 2m3-10 2-2',
  podium: 'M3 20V12h6V6h6v9h6v5H3Z',
  trophy: 'M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 0h8',
  help: 'M9 8a3 3 0 1 1 5 2.2c-1.2.7-2 1.2-2 2.8m0 4h.01',
  helpCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9 9a3 3 0 1 1 5 2.2c-1.2.7-2 1.2-2 2.8m0 3h.01',
  filter: 'M4 7h7m4 0h5M4 17h3m4 0h9m-9-12v4m-4 6v4',
  close: 'M5 5l14 14M19 5L5 19',
  back: 'M19 12H5m6-6-6 6 6 6',
  undo: 'M9 6l-5 5 5 5M4 11h10a5 5 0 0 1 5 5v2',
  delete: 'M4 6h16M9 6V3h6v3m3 0-1 15H7L6 6m4 4v7m4-7v7',
  download: 'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',
  stats: 'M3 3v18h18M6 16l5-6 4 3 6-8',
  left: 'm14 6-6 6 6 6',
  right: 'm10 6 6 6-6 6',
  up: 'm6 14 6-6 6 6',
  down: 'm6 10 6 6 6-6',
  settings: 'M9 2h6l.5 3 2 .9 2.7-1.1 2.4 5.1-2.6 1.6v2l2.6 1.6-2.4 5.1-2.7-1.1-2 .9-.5 3H9l-.5-3-2-.9-2.7 1.1-2.4-5.1L4 13.5v-2L1.4 9.9l2.4-5.1 2.7 1.1 2-.9L9 2M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  notes: 'M6 3h14v18H6zM3 7h5M3 12h5M3 17h5M11 7h5m-5 5h5m-5 5h3',
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={paths[name]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function ScoreTile({ label, number, shots, onOpen, tag, rank, emphasis }: {
  label: string; number: number | string; shots: readonly Shot[]; onOpen: () => void; tag: 'round' | 'series';
  rank?: ReactNode; emphasis?: number;
}) {
  const { preferences } = useTrainingPreferences();
  const result = summarize(shots);
  const score = `${result.points}/${result.maximum}`;
  const average = formatAverage(result.average, preferences.averageHundredths);
  return <div className="stage-tile-container"><button key={emphasis} type="button" className="stage-tile" data-new-round={emphasis !== undefined || undefined} data-testid={`training-${tag === 'round' ? 'rounds' : 'series'}-open`} onClick={onOpen}>
    <span className="tile-heading">{label} <strong>{number}</strong></span>
    {statisticVisible(preferences, 'result') && <span className="tile-score" data-testid={`${tag}-score`}
      aria-live={tag === 'series' ? 'polite' : undefined} aria-atomic={tag === 'series' ? true : undefined}>
      <ChangingScore text={score} />
    </span>}
    {statisticVisible(preferences, 'average') && <span className="tile-average">Ср. <ChangingScore text={average} /></span>}
  </button>{rank && <div className="stage-rank-slot">{rank}</div>}</div>;
}

function ChangingScore({ text }: { text: string }) {
  const previous = useRef(text);
  const digits = useRef<HTMLSpanElement>(null);
  const { preferences } = useTrainingPreferences();
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = text;
    if (!preferences.animations || before === text || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    digits.current?.querySelectorAll('span').forEach((cell, index) => {
      if (/\d/.test(text[index]) && text[index] !== before[index]) {
        cell.getAnimations().forEach(animation => animation.cancel());
        cell.animate([{ opacity: .55, transform: 'translateY(32%)' }, { opacity: 1, transform: 'none' }],
          { duration: 155, easing: 'ease-out' });
      }
    });
  }, [text, preferences.animations]);
  return <span ref={digits} className="changing-score">{Array.from(text, (character, index) => <span key={index}>{character}</span>)}</span>;
}

export function TrainingSummary({ roundNumber, seriesNumber, roundShots, seriesShots, onRound, onSeries, roundRank, seriesRank, roundEmphasis }: {
  roundNumber: number; seriesNumber: number | string; roundShots: readonly Shot[]; seriesShots: readonly Shot[];
  onRound: () => void; onSeries: () => void;
  roundRank?: ReactNode; seriesRank?: ReactNode; roundEmphasis?: number;
}) {
  const { preferences } = useTrainingPreferences();
  if (preferences.hideScores) return <section className="stage-summary stage-summary-hidden" aria-label="Этап тренировки">
    <button key={roundEmphasis} type="button" data-new-round={roundEmphasis !== undefined || undefined} data-testid="training-rounds-open" onClick={onRound}>Раунд {roundNumber}</button>
    <button type="button" data-testid="training-series-open" onClick={onSeries}>Серия {seriesNumber}</button>
  </section>;
  return <section className="stage-summary" aria-label="Результаты тренировки">
    <ScoreTile label="Раунд" number={roundNumber} shots={roundShots} onOpen={onRound} tag="round" rank={roundRank} emphasis={roundEmphasis} />
    <ScoreTile label="Серия" number={seriesNumber} shots={seriesShots} onOpen={onSeries} tag="series" rank={seriesRank} />
  </section>;
}

export function shotStripCapacity(shots: number, previousVolume: number) {
  const volume = Math.max(shots, previousVolume);
  return volume > 6 ? 12 : volume > 3 ? 6 : 3;
}

export function TrainingShotStrip({ shots, previousVolume, selected, entering, onPick, feedback, direction, removing }: {
  shots: readonly Shot[]; previousVolume: number; selected: number | null; entering: number | null;
  onPick: (index: number) => void;
  feedback?: ShotMotionEvent;
  direction?: 'previous' | 'next';
  removing?: number;
}) {
  const { preferences } = useTrainingPreferences();
  const strip = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  const capacity = shotStripCapacity(shots.length, previousVolume);
  const cleanSeries = feedback?.index === capacity - 1 && shots.length === capacity ? feedback.cleanSeries : undefined;
  const pageCount = Math.max(1, Math.ceil(shots.length / capacity));
  const scrollable = pageCount > 1;
  const focusedPage = Math.floor((selected ?? Math.max(0, shots.length - 1)) / capacity);

  function updateFade() {
    const list = strip.current;
    if (!list) return;
    const left = list.scrollLeft > 1;
    const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
    setFade(previous => previous.left === left && previous.right === right ? previous : { left, right });
  }

  useLayoutEffect(() => {
    const list = strip.current;
    if (!list) return;
    const align = () => { list.scrollLeft = focusedPage * list.clientWidth; updateFade(); };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(list);
    return () => observer.disconnect();
  }, [focusedPage, pageCount, capacity]);

  return <div className="training-hit-strip training-series-motion" data-direction={direction}>
    <div className="arrow-panel" data-testid="arrow-panel">
      <div ref={strip} className={`arrow-list${scrollable ? ' arrow-list-scroll' : ''}`} onScroll={updateFade}>
        {Array.from({ length: pageCount }, (_, page) => <ol key={page} className={`arrow-page arrow-page-${capacity}`}
          data-clean-series={page === 0 ? cleanSeries : undefined}
          aria-label={pageCount > 1 ? `Стрелы серии · ${page + 1}/${pageCount}` : 'Стрелы серии'}>
          {Array.from({ length: capacity }, (_, slot) => {
            const index = page * capacity + slot;
            const shot = shots[index];
            const active = index === selected || index === entering;
            const compact = capacity > 3;
            const background = shot && !preferences.hideScores ? scoreColor(shot.points) : undefined;
            const color = preferences.hideScores ? undefined : shot && (shot.points === 0 || (shot.points >= 3 && shot.points <= 4)) ? '#fff' : shot ? '#111811' : undefined;
            const effect = shot && !feedback?.cleanSeries && index === feedback?.index ? feedback : undefined;
            return <li key={index} data-shot-shifted={shot && removing !== undefined && index >= removing ? true : undefined}>
              <button type="button" className={`arrow-slot${compact ? ' compact' : ''}${active ? ' arrow-entering' : ''}${shot ? ' arrow-entered' : ''}`}
                data-testid={`shot-${index + 1}`} data-score-ten={shot?.points === 10 && !preferences.hideScores || undefined} disabled={!shot} aria-pressed={index === selected}
                aria-label={`Стрела ${index + 1}: ${shot ? preferences.hideScores ? 'отмечена' : shot.code : 'не отмечена'}${shot?.physicalArrowNumber ? `, физическая стрела №${shot.physicalArrowNumber}` : ''}`} onClick={() => onPick(index)}>
                <ShotFace key={effect?.id ?? 'static'} points={effect?.points} style={preferences.shotMotionStyle ?? DEFAULT_SHOT_MOTION_STYLE}
                  background={background} color={color}>
                  <span className="arrow-number" aria-hidden="true">{index + 1}</span>
                  <span className="arrow-score">{shot ? preferences.hideScores ? '✓' : shot.code : '—'}</span>
                  {shot?.physicalArrowNumber !== undefined && <small className="arrow-physical-number" aria-hidden="true">№{shot.physicalArrowNumber}</small>}
                </ShotFace>
              </button>
            </li>;
          })}
          {page === 0 && cleanSeries && <CleanSeriesEffects key={feedback?.id} as="li" landing={cleanSeries === 'jump'} />}
        </ol>)}
      </div>
      {scrollable && fade.left && <span className="arrow-fade fade-left" aria-hidden="true" />}
      {scrollable && fade.right && <span className="arrow-fade fade-right" aria-hidden="true" />}
    </div>
  </div>;
}

export function TrainingFooter({ mainText, mainEnabled, mainRef, newRound, missEnabled, undoEnabled, showPrevious,
  onMain, onMiss, onUndo, onPrevious, timerBadge, arrowNumberChoice, status }: {
  mainText: string; mainEnabled: boolean; mainRef: Ref<HTMLButtonElement>; missEnabled: boolean; undoEnabled: boolean;
  showPrevious: boolean; newRound: boolean; onPrevious?: () => void;
  onMain: () => void; onMiss: () => void; onUndo: () => void;
  timerBadge?: ReactNode; arrowNumberChoice?: ReactNode; status?: string;
}) {
  return <footer className="training-controls">
    {(status || arrowNumberChoice) && <div className="training-tools">
      {status && <span className="series-editor-status">{status}</span>}
      {arrowNumberChoice}
    </div>}
    <div className="training-actions">
      {timerBadge}
      <button type="button" className="miss" aria-label="Отметить промах" disabled={!missEnabled} onClick={onMiss}>M</button>
      <button type="button" className="icon-button" aria-label="Отменить" disabled={!undoEnabled} onClick={onUndo}><Icon name="undo" /></button>
      {showPrevious && <button type="button" className="icon-button" aria-label="Предыдущая серия"
        disabled={!onPrevious} onClick={onPrevious}><Icon name="left" /></button>}
      <button ref={mainRef} type="button" className="primary" data-testid="next-end" data-new-round={newRound || undefined}
        disabled={!mainEnabled} onClick={onMain}>{newRound && <Icon name="right" />}{mainText}</button>
    </div>
  </footer>;
}

import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Conditions } from './conditions.ts';
import { formatAverage } from './preferences.ts';
import type { DiaryEntry } from './persistence.ts';
import { getTargetProfile, summarize } from './target.ts';
import { Icon } from './TrainingChrome.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { statisticVisible } from './statistics-visibility.ts';
import { compactProgress } from './progress-scoring.ts';
import { timelineDate } from './progress-timeline.ts';
import './journal-shell.css';

const destinations = {
  home: 'Главная', history: 'История', progress: 'Прогресс', equipment: 'Снаряжение',
} as const;

export type JournalTab = keyof typeof destinations;

const paths = {
  home: 'M3 10l9-7 9 7M5 9v12h5v-6h4v6h5V9',
  history: 'M7 3h12v18H5V5m4 4h6m-6 4h6m-6 4h4',
  progress: 'M3 3v18h18M6 16l5-5 4 3 6-8',
  equipment: 'M6 2l6 3 3 4 1 3-1 3-3 4-6 3V2M3 12h19m-4-3 4 3-4 3',
  target: 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0ZM17 12a5 5 0 1 1-10 0 5 5 0 1 1 10 0ZM13 12a1 1 0 1 1-2 0 1 1 0 1 1 2 0Z',
  distance: 'M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4M3 4v2m18-2v2',
  arrow: 'M4 20 20 4m-7 0h7v7M4 15v5h5',
  calendar: 'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16m-11 4h2m3 0h2m-7 3h2',
  spark: 'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
  start: 'M4 20 20 4m-6 0h6v6M5 13v6h6m-3-9v6h6',
  edit: 'm4 16 12-12 4 4L8 20H4zm9-9 4 4',
};

function JournalGlyph({ name }: { name: keyof typeof paths }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={paths[name]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function JournalShell({ tab, onTab, onSettings, onProfile, displayName, children }: {
  tab: JournalTab;
  onTab: (tab: JournalTab) => void;
  onSettings?: () => void;
  onProfile?: () => void;
  displayName?: string;
  children: ReactNode;
}) {
  const content = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (content.current) content.current.scrollTop = 0; }, [tab]);
  return <div className="journal-shell">
    <header className="journal-topbar">
      <img src={`${import.meta.env.BASE_URL}icons/fableshot-192.png`} width="32" height="32" alt="" />
      <div className="journal-topbar-title">
        <h1>{tab === 'home' ? 'FableShot' : destinations[tab]}</h1>
        {tab === 'home' && <p>{displayName ? `Привет, ${displayName}` : 'Хорошего попадания'}</p>}
      </div>
      {onSettings && <button type="button" className="icon-button" data-testid="open-settings" aria-label="Настройки" onClick={onSettings}>
        <Icon name="settings" />
      </button>}
      {onProfile && <button type="button" className="icon-button" data-testid="open-profile" aria-label="Профиль" onClick={onProfile}>
        {displayName ? <strong>{Array.from(displayName)[0].toLocaleUpperCase('ru-RU')}</strong>
          : <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" /></svg>}
      </button>}
    </header>
    <main className="journal-content" ref={content}>{children}</main>
    <nav className="journal-navigation" aria-label="Разделы дневника">
      {(Object.keys(destinations) as JournalTab[]).map(id => <button type="button" key={id} onClick={() => onTab(id)}
        data-testid={`nav-${id}`} aria-current={tab === id ? 'page' : undefined}>
        <span className="journal-navigation-icon"><JournalGlyph name={id} /></span>
        <span>{destinations[id]}</span>
      </button>)}
    </nav>
  </div>;
}

function HomeConditions({ conditions }: { conditions: Conditions }) {
  const centimeters = (conditions.targetDiameterMm / 10).toLocaleString('ru-RU');
  const profile = getTargetProfile(conditions.targetProfileId)?.title.replace(/^(Indoor|\d+ см) · /u, '');
  const distance = `${conditions.distanceMeters.toLocaleString('ru-RU')} м`;
  const equipment = conditions.equipment;
  return <dl className="journal-home-conditions" data-testid="home-conditions-grid">
    <div><dt><JournalGlyph name="target" /><span className="sr-only">Мишень</span></dt><dd>{centimeters} см{profile && ` · ${profile}`}</dd></div>
    <div><dt><JournalGlyph name="distance" /><span className="sr-only">Дистанция</span></dt><dd>{distance}</dd></div>
    {equipment && <div><dt><JournalGlyph name="equipment" /><span className="sr-only">Комплект</span></dt><dd>{equipment.name}</dd></div>}
  </dl>;
}

const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'short' });
const fullDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' });

function PracticeTimeline({ recent, onOpen }: { recent: readonly DiaryEntry[]; onOpen: (id: string) => void }) {
  const { preferences } = useTrainingPreferences();
  const showResult = statisticVisible(preferences, 'result');
  const showAverage = statisticVisible(preferences, 'average');
  const showVolume = statisticVisible(preferences, 'volume');
  if (!showResult && !showAverage && !showVolume) return null;
  const today = new Intl.DateTimeFormat('sv-SE').format(new Date());
  const ordered = recent
    .flatMap(entry => {
      const localDate = timelineDate(entry);
      if (!localDate || localDate > today || entry.practice.savedAt === null ||
        !entry.practice.rounds.some(round => round.series.some(series => series.shots.length > 0))) return [];
      return [{ ...entry, localDate, date: new Date(`${localDate}T12:00:00`) }];
    })
    .sort((left, right) => right.localDate.localeCompare(left.localDate) ||
      Date.parse(right.startedAt) - Date.parse(left.startedAt) || right.id.localeCompare(left.id))
    .slice(0, 5).reverse();
  const monthName = (date: Date) => monthLabel.format(date).replace(/\.$/, '');
  const monthChanged = (index: number) => index > 0 && (
    ordered[index].date.getMonth() !== ordered[index - 1].date.getMonth() ||
    ordered[index].date.getFullYear() !== ordered[index - 1].date.getFullYear()
  );
  const hasTransition = ordered.some((_, index) => monthChanged(index));
  const chartStyle = {
    '--card-share': `${200 / (ordered.length + 1)}%`,
    '--card-gap': `${8 * (ordered.length - 1) / (ordered.length + 1)}px`,
  } as CSSProperties;
  const position = (index: number) => {
    const fraction = ordered.length > 1 ? index / (ordered.length - 1) : .5;
    return `calc(${fraction * 100}% + var(--timeline-card-width) * ${.5 - fraction})`;
  };
  return <section className="journal-home-card journal-home-practice" data-testid="home-week">
    <h2>Твоя недавняя практика <JournalGlyph name="spark" /></h2>
    {ordered.length === 0 ? <p data-testid="home-practice-empty">Пока нет завершённых тренировок со стрелами и известной датой.</p> :
      <ol className={`journal-timeline${ordered.length === 1 ? ' journal-timeline-single' : ''}`} style={chartStyle}
        data-testid="home-practice-horizontal" aria-label="Тренировки от старых к новым">
        {ordered.map((entry, index) => {
          const shots = entry.practice.rounds.flatMap(round => round.series.flatMap(series => series.shots));
          const result = summarize(shots);
          const score = `${result.points}/${result.maximum}`;
          const average = formatAverage(result.average, preferences.averageHundredths);
          const progress = statisticVisible(preferences, 'progress_score') ? compactProgress(entry.practice) : null;
          const description = [showResult && score, showAverage && `средний ${average}`,
            showVolume && `${shots.length} стрел`, progress && `прогресс ${progress}`].filter(Boolean).join(', ');
          return <li key={entry.id} className="journal-timeline-entry">
            {monthChanged(index) && <span className="journal-timeline-month" style={{ left: position(index - .5) }}>{monthName(entry.date)}</span>}
            <div className="journal-timeline-point" style={{ left: position(index) }}>
              <time dateTime={entry.localDate}>{entry.date.getDate()}{index === 0 && hasTransition && ` ${monthName(entry.date)}`}</time>
              <button type="button" data-testid="home-practice-session" onClick={() => onOpen(entry.id)}
                aria-label={`Открыть тренировку, ${fullDate.format(entry.date)}. ${description}`}>
                {showResult && <strong>{score}</strong>}
                {(showAverage || progress) && <span className="journal-timeline-secondary">
                  {showAverage && average}{progress && <em>{progress}</em>}
                </span>}
                {!showResult && !showAverage && showVolume && <strong>{shots.length} стр.</strong>}
              </button>
            </div>
          </li>;
        })}
      </ol>}
  </section>;
}

export function JournalHome({ active, paused, recent, practiceCount, arrowCount, conditions, needsEquipment, onStart, onConditions, onOpen }: {
  active: boolean;
  paused?: boolean;
  recent: readonly DiaryEntry[];
  practiceCount: number;
  arrowCount: number;
  conditions: Conditions;
  needsEquipment: boolean;
  onStart: () => void;
  onConditions: () => void;
  onOpen: (id: string) => void;
}) {
  const { preferences } = useTrainingPreferences();
  return <div className="journal-home" data-testid="home-screen">
    <section className="journal-home-hero" data-testid="home-hero">
      <p className="journal-home-eyebrow">{active ? 'В процессе' : 'Время для себя'}</p>
      <h2>{active ? 'Продолжим тренировку?' : 'Привычная тренировка'}</h2>
      <HomeConditions conditions={conditions} />
      <button type="button" className="primary journal-home-primary" data-testid="home-start-training" onClick={needsEquipment ? onConditions : onStart}>
        <JournalGlyph name="start" />{active ? 'Продолжить тренировку' : needsEquipment ? 'Выбрать снаряжение' : 'Начать'}
      </button>
      {(!active || paused) && <button type="button" className="journal-home-edit" data-testid="home-change-conditions" onClick={onConditions}>
        <JournalGlyph name="edit" />{paused ? 'Новая тренировка' : 'Изменить условия'}
      </button>}
    </section>
    {statisticVisible(preferences, 'volume') && <section className="journal-home-totals" data-testid="home-all-time-totals" aria-label="Всего за всё время">
      <div className="journal-home-card"><JournalGlyph name="target" /><span><strong>{arrowCount.toLocaleString('ru-RU')}</strong>Стрел</span></div>
      <div className="journal-home-card"><JournalGlyph name="calendar" /><span><strong>{practiceCount.toLocaleString('ru-RU')}</strong>Тренировок</span></div>
    </section>}
    <PracticeTimeline recent={recent} onOpen={onOpen} />
  </div>;
}

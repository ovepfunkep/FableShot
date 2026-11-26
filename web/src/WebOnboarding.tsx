import { ChoicePicker } from './ChoicePicker.tsx';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { TargetBoard } from './TargetBoard.tsx';
import { DEFAULT_CONDITIONS } from './conditions.ts';
import { ShotDistribution } from './ShotDistribution.tsx';
import { TrainingHitMap } from './TrainingHitMap.tsx';
import { DEFAULT_TARGET, scorePoint, summarize } from './target.ts';
import type { Shot } from './target.ts';
import { Icon } from './TrainingChrome.tsx';
import { useTrainingPreferences } from './TrainingPreferences.tsx';
import { formatAverage } from './preferences.ts';
import { WebThemeSettings } from './WebThemeSettings.tsx';
import { DEFAULT_THEME_STYLE } from './web-theme.ts';
import { RANK_CATEGORIES } from './sport-ranks.ts';
import type { RankCategory } from './sport-ranks.ts';
import { releasePush, releasePushSupported } from './release-push.ts';
import { autoBackupEnabled, driveBackupAvailable, setAutoBackup } from './drive-backup.ts';
import { scoreOutline } from './score-appearance.ts';
import './web-onboarding.css';

export type OnboardingChapter = 'welcome' | 'target' | 'report' | 'preferences';

type OnboardingActions = { onStart: () => void; onImport: () => void; onRestore: () => void; onClose: () => void; onEnableHundredths?: () => void; onOpenTargetGuide: () => void };

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

function Welcome({ onStart, onImport, onRestore, onClose, onExample, onPreferences }: OnboardingActions & {
  onExample: () => void; onPreferences: () => void;
}) {
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
      <button type="button" className="web-onboard-link" data-testid="onboard-open-preferences" onClick={onPreferences}>Быстрые настройки</button>
      <button type="button" className="web-onboard-link" data-testid="onboard-import" onClick={onImport}>Перенести из MyTargets</button>
      <button type="button" className="web-onboard-link" data-testid="onboard-restore" onClick={onRestore}>Восстановить из резервной копии</button>
    </div>
    <p className="web-onboard-storage">Дневник хранится на устройстве. Историю можно сохранить в резервную копию.</p>
  </main>;
}

function TargetTutorial({ onStart, onClose, onReport, onOpenTargetGuide }: Pick<OnboardingActions, 'onStart' | 'onClose' | 'onOpenTargetGuide'> & { onReport: () => void }) {
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
        <TargetBoard shots={display} inputEnabled={canMark} onShot={mark} selectedIndex={edit?.index ?? null} onOpenGuide={onOpenTargetGuide} />
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
        <p>Открой учебный отчёт, чтобы попробовать карту и распределение попаданий.</p>
      </div>
      <div className="web-onboard-actions">
        <button type="button" className="primary" data-testid="tutorial-open-report" onClick={onReport}>Посмотреть отчёт</button>
        <button type="button" className="web-onboard-outline" data-testid="tutorial-start" onClick={onStart}>К своей тренировке</button>
        <button type="button" className="web-onboard-outline" data-testid="tutorial-replay" onClick={replay}>Повторить пример</button>
        <button type="button" className="web-onboard-link" data-testid="tutorial-home" onClick={onClose}>На Главную</button>
      </div>
    </>}
  </main>;
}

const demoSeries = [[{ x: .04, y: .02 }, { x: .12, y: -.07 }, { x: -.15, y: .08 }],
  [{ x: .22, y: .06 }, { x: .07, y: -.05 }, { x: -.04, y: .05 }]].map((points, index) => ({
    id: index + 1, round: 1, number: index + 1, shots: points.map(point => ({ point, ...scorePoint(point, DEFAULT_TARGET) })),
  }));
const demoShots = demoSeries.flatMap(series => series.shots);
const demoCounts = Array.from({ length: 11 }, (_, score) => demoShots.filter(shot => shot.points === score).length);
const demoResult = summarize(demoShots);

function TutorialReport({ onStart, onClose, onBack }: Pick<OnboardingActions, 'onStart' | 'onClose'> & { onBack: () => void }) {
  const [display, setDisplay] = useState<'map' | 'distribution'>('map');
  return <main className="web-onboard web-onboard-tutorial" data-testid="tutorial-report">
    <header className="web-onboard-header">
      <span className="web-onboard-example-label">Пример · не сохраняется в историю</span>
      <button type="button" className="icon-button" aria-label="Выйти из примера" onClick={onClose}><Icon name="close" /></button>
    </header>
    <div className="web-onboard-copy">
      <h1>Отчёт тренировки</h1>
      <p>{display === 'map' ? 'Выбери серию, чтобы увидеть на мишени только её попадания.' : 'Нажми на оценку, чтобы увидеть число попаданий и их долю.'}</p>
    </div>
    <div className="web-onboard-report-modes" role="group" aria-label="Учебный отчёт">
      <button type="button" className="web-onboard-outline" aria-pressed={display === 'map'} onClick={() => setDisplay('map')}>Карта</button>
      <button type="button" className="web-onboard-outline" aria-pressed={display === 'distribution'} onClick={() => setDisplay('distribution')}>Распределение</button>
    </div>
    {display === 'map' ? <TrainingHitMap series={demoSeries} conditions={DEFAULT_CONDITIONS} /> :
      <section className="report-metrics-card web-onboard-report-distribution" aria-label="Распределение в примере">
        <p>Результат <strong>{demoResult.points}/{demoResult.maximum}</strong></p>
        <ShotDistribution counts={demoCounts} total={demoShots.length} view="mosaic" />
      </section>}
    <div className="web-onboard-actions">
      <button type="button" className="primary" data-testid="tutorial-report-start" onClick={onStart}>К своей тренировке</button>
      <button type="button" className="web-onboard-link" onClick={onBack}>К отметке попаданий</button>
    </div>
  </main>;
}

function QuickPreferences({ onDone, onBack, standalone, onEnableHundredths }: {
  onDone: () => void; onBack: () => void; standalone: boolean; onEnableHundredths?: () => void;
}) {
  const { preferences, update, readable, error } = useTrainingPreferences();
  const [themeStyle, setThemeStyle] = useState(preferences.themeStyle ?? DEFAULT_THEME_STYLE);
  const [hundredths, setHundredths] = useState(preferences.averageHundredths);
  const [inputNotices, setInputNotices] = useState(preferences.showAchievementsDuringInput !== false);
  const [rankCategory, setRankCategory] = useState<RankCategory | undefined>(preferences.rankCategory);
  const [saving, setSaving] = useState(false);
  const [savedUpdateNotices, setSavedUpdateNotices] = useState<boolean | null>(null);
  const [updateNotices, setUpdateNotices] = useState(true);
  const [noticeError, setNoticeError] = useState('');
  const [autoBackup, setBackup] = useState(() => driveBackupAvailable && autoBackupEnabled());
  const [colorTrainingBorders, setColorTrainingBorders] = useState(preferences.colorTrainingBorders !== false);
  const outline = scoreOutline([{ ...exampleShot, points: 8 }, { ...exampleShot, points: 9 }, { ...exampleShot, points: 10 }], colorTrainingBorders);
  useEffect(() => {
    if (!releasePushSupported()) return;
    let live = true;
    void releasePush.getStatus().then(status => {
      if (!live || !status.available) return;
      setSavedUpdateNotices(status.enabled);
      setUpdateNotices(status.enabled);
    }).catch(() => { if (live) setNoticeError('Не удалось проверить настройки уведомлений.'); });
    return () => { live = false; };
  }, []);
  async function save() {
    setSaving(true);
    setNoticeError('');
    if (driveBackupAvailable && autoBackup !== autoBackupEnabled()) {
      try { setAutoBackup(autoBackup); }
      catch {
        setNoticeError('Не удалось сохранить настройку автобэкапа. Попробуй ещё раз.');
        setSaving(false);
        return;
      }
    }
    if (savedUpdateNotices !== null && updateNotices !== savedUpdateNotices) {
      try {
        await releasePush.setEnabled({ enabled: updateNotices });
        setSavedUpdateNotices(updateNotices);
      }
      catch {
        setNoticeError('Не удалось сохранить настройку уведомлений. Попробуй ещё раз.');
        setSaving(false);
        return;
      }
    }
    const success = await update({ ...preferences, themeStyle, averageHundredths: hundredths, rankCategory,
      showAchievementsDuringInput: inputNotices, colorTrainingBorders, ...(standalone ? {} : { onboardingSeen: true }) });
    if (success) {
      if (hundredths && !preferences.averageHundredths) onEnableHundredths?.();
      onDone();
    }
    else setSaving(false);
  }
  return <main className="web-onboard web-onboard-preferences" data-testid="onboard-preferences">
    <header className="web-onboard-header">
      <button type="button" className="icon-button" aria-label="Назад" disabled={saving} onClick={onBack}><Icon name="back" /></button>
      <Brand />
    </header>
    <div className="web-onboard-copy"><h1>Быстрые настройки</h1></div>
    <WebThemeSettings value={{ themeStyle }} stylesOnly disabled={saving} onChange={patch => {
      if (patch.themeStyle) setThemeStyle(patch.themeStyle);
    }} />
    <section className="web-onboard-preference-sample" data-style={themeStyle} aria-label="Пример результата"
      data-score-outline={outline ? true : undefined} style={outline ? { '--score-outline': outline } as CSSProperties : undefined}>
      <div><span>Результат</span><strong>192/230</strong></div>
      <div><span>Средний</span><strong data-testid="onboard-average-example">{formatAverage(192 / 23, hundredths)}</strong></div>
    </section>
    <div className="web-onboard-option"><span>Категория нормативов</span>
      <ChoicePicker label="Категория нормативов" value={rankCategory ?? ''} disabled={saving}
        options={[{ value: '', label: 'Выбрать позже' }, ...Object.entries(RANK_CATEGORIES).map(([value, label]) => ({ value, label }))]}
        onChange={category => setRankCategory(category === 'male' || category === 'female' ? category : undefined)} />
    </div>
    <div className="web-onboard-preference-options">
      <button type="button" className="web-onboard-option" role="switch" aria-checked={colorTrainingBorders}
        disabled={saving} onClick={() => setColorTrainingBorders(!colorTrainingBorders)}>
        <span>Цветные обводки тренировок</span><span className="preference-switch" aria-hidden="true"><span /></span>
      </button>
      {savedUpdateNotices !== null ? <button type="button" role="switch" aria-checked={updateNotices} className="web-onboard-option"
        disabled={saving} onClick={() => setUpdateNotices(!updateNotices)}>
        <span>Уведомления об обновлениях</span><span className="preference-switch" aria-hidden="true"><span /></span>
      </button> : <div className="web-onboard-option">
        <span>Уведомления об обновлениях</span><small>В основном приложении Android</small>
      </div>}
      {driveBackupAvailable && <button type="button" role="switch" aria-checked={autoBackup} className="web-onboard-option"
        disabled={saving} onClick={() => setBackup(!autoBackup)}>
        <span>Автобэкап на Google Диск</span><span className="preference-switch" aria-hidden="true"><span /></span>
      </button>}
      <button type="button" role="switch" aria-checked={hundredths} className="web-onboard-option" disabled={saving}
        onClick={() => setHundredths(!hundredths)}>
        <span>Средний до сотых</span>
        <span className="preference-switch" aria-hidden="true"><span /></span>
      </button>
      <button type="button" role="switch" aria-checked={inputNotices} className="web-onboard-option" disabled={saving}
        onClick={() => setInputNotices(!inputNotices)}>
        <span>Достижения при отметке попаданий</span>
        <span className="preference-switch" aria-hidden="true"><span /></span>
      </button>
      <div className="web-onboard-notice-example">
        {inputNotices && preferences.showAchievementNotices !== false ?
          <span data-testid="onboard-achievement-example"><Icon name="trophy" /> Начало пути</span> :
          <small>{preferences.showAchievementNotices === false ? 'Показ достижений можно включить в «Движение и отклик».' : 'Достижения появятся после выхода из ввода.'}</small>}
      </div>
    </div>
    <aside className="web-onboard-settings-guide">
      <strong>Остальное в настройках</strong>
      <dl>
        <div><dt>Лупа и экран блокировки</dt><dd>Тренировка</dd></div>
        <div><dt>Анимации и вибрация</dt><dd>Движение и отклик</dd></div>
        <div><dt>Графики и их порядок</dt><dd>Статистика</dd></div>
      </dl>
    </aside>
    {error && <p className="preferences-error" role="alert">{error}</p>}
    {noticeError && <p className="preferences-error" role="alert">{noticeError}</p>}
    <div className="web-onboard-actions">
      <button type="button" className="primary" data-testid="onboard-save-preferences" disabled={saving || !readable} onClick={save}>
        {standalone ? 'Сохранить' : 'Сохранить и продолжить'}
      </button>
      {!standalone && <button type="button" className="web-onboard-link" data-testid="onboard-skip-preferences" disabled={saving}
        onClick={onDone}>Пропустить настройки</button>}
    </div>
  </main>;
}

export function WebOnboarding(actions: OnboardingActions & { initialChapter: OnboardingChapter; offerPreferences: boolean }) {
  const [chapter, setChapter] = useState(actions.initialChapter);
  const [previousChapter, setPreviousChapter] = useState<OnboardingChapter>('welcome');
  const [preferencesOnly, setPreferencesOnly] = useState(false);
  const standalone = actions.initialChapter === 'preferences' || preferencesOnly;
  const back = () => {
    if (actions.initialChapter === 'preferences') { actions.onClose(); return; }
    setPreferencesOnly(false);
    setChapter(previousChapter);
  };
  function start() {
    if (!actions.offerPreferences) { actions.onStart(); return; }
    setPreviousChapter(chapter);
    setChapter('preferences');
  }
  if (chapter === 'preferences') return <QuickPreferences standalone={standalone} onEnableHundredths={actions.onEnableHundredths}
    onDone={standalone ? back : actions.onStart} onBack={back} />;
  if (chapter === 'report') return <TutorialReport onStart={start} onClose={actions.onClose} onBack={() => setChapter('target')} />;
  if (chapter === 'target') return <TargetTutorial onStart={start} onClose={actions.onClose} onReport={() => setChapter('report')} onOpenTargetGuide={actions.onOpenTargetGuide} />;
  return <Welcome {...actions} onStart={start} onExample={() => setChapter('target')} onPreferences={() => {
    setPreviousChapter('welcome');
    setPreferencesOnly(true);
    setChapter('preferences');
  }} />;
}

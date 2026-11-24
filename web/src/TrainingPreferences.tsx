import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AIM_SPEED_SETTING, DEFAULT_PREFERENCES, LENS_ZOOM_SETTING, loadPreferences, RECENT_PRACTICE_LIMIT, savePreferences } from './preferences.ts';
import type { TrainingPreferences } from './preferences.ts';
import { useWebTheme } from './web-theme.ts';
import { Capacitor } from '@capacitor/core';
import { setTrainingWindowActive } from './native-training-window.ts';
import { supportsAppScale, useNativeAppScale } from './native-app-scale.ts';
import './training-preferences.css';

type PreferencesState = { preferences: TrainingPreferences; error: string; readable: boolean; update: (value: TrainingPreferences) => Promise<boolean> };
const PreferencesContext = createContext<PreferencesState | null>(null);

function initialPreferences() {
  try { return { value: loadPreferences(), error: '' }; }
  catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : 'Не удалось прочитать настройки.' }; }
}

export function TrainingPreferencesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialPreferences);
  const preferences = state.value ?? DEFAULT_PREFERENCES;
  const writes = useRef(Promise.resolve());
  useWebTheme(preferences);
  useNativeAppScale(preferences.useSystemScale === true);
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = preferences.animations ? 'on' : 'off';
  }, [preferences.animations]);
  function update(value: TrainingPreferences): Promise<boolean> {
    const keys = Object.keys({ ...preferences, ...value }) as (keyof TrainingPreferences)[];
    const patch = Object.fromEntries(keys.filter(key => preferences[key] !== value[key]).map(key => [key, value[key]]));
    const result = writes.current.then(async () => {
      try {
        const next = { ...loadPreferences(), ...patch };
        await savePreferences(next);
        setState({ value: next, error: '' });
        return true;
      } catch (cause) {
        setState(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'Не удалось сохранить настройки.' }));
        return false;
      }
    });
    writes.current = result.then(() => {});
    return result;
  }
  return <PreferencesContext.Provider value={{ preferences, update, readable: state.value !== null, error: state.error }}>{children}</PreferencesContext.Provider>;
}

export function useTrainingPreferences(): PreferencesState {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('TrainingPreferencesProvider is required');
  return value;
}

export function RecentPracticeLimitControl() {
  const { preferences, update, readable, error } = useTrainingPreferences();
  const { min, max } = RECENT_PRACTICE_LIMIT;
  const limit = preferences.recentPracticeLimit ?? min;
  const [draft, setDraft] = useState<string | null>(null);
  function commit(value: number) {
    setDraft(null);
    if (!Number.isFinite(value)) return;
    const next = Math.max(min, Math.min(max, Math.trunc(value)));
    if (next !== limit) update({ ...preferences, recentPracticeLimit: next });
  }
  return <div className="settings-panel recent-practice-limit">
    <div className="preference-row">
      <label className="preference-title" htmlFor="recent-practice-limit">Недавних тренировок на Главной</label>
      <div className="recent-practice-stepper">
        <button type="button" aria-label="Показывать на одну тренировку меньше" disabled={!readable || limit <= min}
          onClick={() => commit(limit - 1)}>−</button>
        <input id="recent-practice-limit" type="number" inputMode="numeric" min={min} max={max}
          disabled={!readable} value={draft ?? limit} onChange={event => setDraft(event.currentTarget.value)}
          onBlur={event => commit(event.currentTarget.valueAsNumber)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <button type="button" aria-label="Показывать на одну тренировку больше" disabled={!readable || limit >= max}
          onClick={() => commit(limit + 1)}>+</button>
      </div>
    </div>
    <small>Более ранние тренировки видны при прокрутке шкалы.</small>
    {error && <p className="preferences-error" role="alert">{error}</p>}
  </div>;
}

const switches = [
  { key: 'colorTrainingBorders', title: 'Цветные обводки тренировок', tag: 'setting-color-training-borders',
    hint: 'Цвета обводки отражают доли попаданий по зонам.' },
  { key: 'maximumSpread', title: 'Максимальный разброс', tag: 'setting-maximum-spread',
    hint: 'Показывает расстояние между двумя самыми далёкими попаданиями. При выключении отображается разброс RMS — среднеквадратичное расстояние от попаданий до центра группы.' },
  { key: 'showAchievementsDuringInput', title: 'Достижения во время ввода', tag: 'setting-achievements-during-input',
    hint: 'Показывает всплывающие достижения при отметке попаданий и редактировании серии. При отключении уведомления появятся после выхода из ввода. Достижения сохраняются в профиле и статистике.' },
  { key: 'realArrowDiameter', title: 'Реальный диаметр стрел', tag: 'setting-real-arrow-diameter', subtitle: 'Если указан диаметр стрелы в снаряжении',
    hint: 'Показывает отметку в масштабе мишени и приближения. Для выбора стрелы используйте нижнюю панель попаданий.' },
  { key: 'hideScores', title: 'Скрывать очки', tag: 'setting-hide-scores', hint: 'Для интриги и большего места под мишень: убирает оценки стрел, суммы и средние вместе с подписями. Номера стрел, лупа и правка остаются. Результаты можно открыть в статистике. Попадания сохраняются как обычно.' },
  { key: 'averageHundredths', title: 'Средний до сотых', tag: 'setting-average-hundredths', hint: 'Показывает средний балл с двумя знаками после запятой в тренировке, списках серий и статистике.' },
  { key: 'animations', title: 'Анимации', tag: 'setting-animations', hint: 'Плавные изменения цифр и подсветка активной стрелы. Системная настройка уменьшения движения также учитывается.' },
  { key: 'celebrationEffects', title: 'Праздничные эффекты', tag: 'setting-celebration-effects',
    hint: 'Движение при чистой серии и важных результатах. Сами результаты, записи и обычные переходы доступны в любом положении переключателя.' },
  { key: 'haptics', title: 'Вибрация', tag: 'setting-haptics', hint: 'Короткий отклик после записи выстрела и по окончании таймера. Доступность зависит от устройства.' },
  { key: 'keepAwake', title: 'Не гасить экран', tag: 'setting-keep-awake', hint: 'Поддерживает экран включённым во время активной тренировки. Энергосбережение и ручная блокировка управляются телефоном.' },
  { key: 'trainingOnLockScreen', title: 'Тренировка на экране блокировки', tag: 'setting-training-lock-screen', hint: 'После ручной блокировки можно вернуться к активной тренировке без отпечатка. Остальные приложения остаются защищены блокировкой телефона. Работает только в Android-приложении.' },
  { key: 'useSystemScale', title: 'Системный масштаб', tag: 'setting-system-scale', hint: 'Учитывает размер текста и интерфейса Android. При большом масштабе на экране помещается меньше данных.' },
] as const;

export function LensControls({ preview }: { preview?: ReactNode }) {
  const { preferences, update, readable, error } = useTrainingPreferences();
  const value = preferences.aimSpeedPercent ?? AIM_SPEED_SETTING.default;
  const zoom = preferences.lensZoomPercent ?? LENS_ZOOM_SETTING.default;
  const id = useId();
  return <div className="aim-speed-control">
    <div className="preference-row"><label className="preference-title" htmlFor={`${id}-speed`}>Скорость наведения в лупе</label>
      <output htmlFor={`${id}-speed`}>{value}%</output></div>
    <input id={`${id}-speed`} data-testid="setting-aim-speed" type="range" min={AIM_SPEED_SETTING.min} max={AIM_SPEED_SETTING.max} step="5"
      value={value} disabled={!readable} onChange={event => update({ ...preferences, aimSpeedPercent: Number(event.currentTarget.value) })} />
    <div className="preference-row"><label className="preference-title" htmlFor={`${id}-zoom`}>Увеличение лупы</label>
      <output htmlFor={`${id}-zoom`}>{(zoom / 100).toLocaleString('ru-RU')}×</output></div>
    <input id={`${id}-zoom`} data-testid="setting-lens-zoom" type="range" min={LENS_ZOOM_SETTING.min} max={LENS_ZOOM_SETTING.max} step="25"
      value={zoom} disabled={!readable} onChange={event => update({ ...preferences, lensZoomPercent: Number(event.currentTarget.value) })} />
    {preview}
    <details><summary>Как перемещать мишень</summary><p>Коснись мишени дважды и на втором касании веди палец. Отпусти — перемещение закончится. Двумя пальцами можно менять масштаб.</p></details>
    {error && <p className="preferences-error" role="alert">{error}</p>}
  </div>;
}

export function TrainingPreferenceControls({ keys, onEnableHundredths }: {
  keys?: readonly (typeof switches)[number]['key'][]; onEnableHundredths?: () => void;
} = {}) {
  const { preferences, update, error } = useTrainingPreferences();
  const [help, setHelp] = useState<(typeof switches)[number] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { if (help) dialog.current?.showModal(); }, [help]);
  return <section className="training-preferences" aria-label="Параметры отображения">
    {switches.filter(item => (!keys || keys.includes(item.key)) &&
      (item.key !== 'trainingOnLockScreen' || Capacitor.getPlatform() === 'android') &&
      (item.key !== 'useSystemScale' || (keys?.includes(item.key) && supportsAppScale())) &&
      (!['realArrowDiameter', 'maximumSpread', 'colorTrainingBorders'].includes(item.key) || keys?.includes(item.key))).map(item => {
      const checked = preferences[item.key] ?? !['useSystemScale', 'realArrowDiameter', 'maximumSpread', 'colorTrainingBorders'].includes(item.key);
      return <div key={item.key} className="preference-row preference-row--with-help">
        <span className="preference-title">{item.title}
          {'subtitle' in item && <small className="preference-subtitle">{item.subtitle}</small>}
        </span>
        <button type="button" className="preference-help" aria-label={`О настройке «${item.title}»`} onClick={() => setHelp(item)}>?</button>
        <button type="button" role="switch" className="preference-switch" aria-label={item.title} aria-checked={checked}
          data-testid={item.tag} disabled={!!error} onClick={async () => {
            if (await update({ ...preferences, [item.key]: !checked }) && item.key === 'averageHundredths' && !checked) onEnableHundredths?.();
          }}><span /></button>
      </div>;
    })}
    {error && <p className="preferences-error" role="alert">{error}</p>}
    {help && <dialog ref={dialog} className="preferences-help-dialog" aria-label={help.title}
      onCancel={event => { event.preventDefault(); setHelp(null); }} onClick={event => { if (event.target === event.currentTarget) setHelp(null); }}>
      <h2>{help.title}</h2><p>{help.hint}</p>
    </dialog>}
  </section>;
}

export function useKeepScreenOn(active: boolean) {
  const { preferences } = useTrainingPreferences();
  const [nativeError, setNativeError] = useState('');
  useEffect(() => {
    let current = true;
    setNativeError('');
    void setTrainingWindowActive(active && preferences.trainingOnLockScreen !== false).catch(cause => {
      if (current) setNativeError(cause instanceof Error ? cause.message : 'Не удалось настроить тренировку на экране блокировки.');
    });
    return () => {
      current = false;
      void setTrainingWindowActive(false).catch(cause => console.warn('FableShot: не удалось закрыть тренировку поверх блокировки.', cause));
    };
  }, [active, preferences.trainingOnLockScreen]);
  useEffect(() => {
    if (!active || !preferences.keepAwake || !navigator.wakeLock) return;
    let stopped = false;
    let lock: WakeLockSentinel | null = null;
    let pending = false;
    async function request() {
      if (stopped || pending || lock || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const acquired = await navigator.wakeLock.request('screen');
        if (stopped) await acquired.release();
        else { lock = acquired; acquired.addEventListener('release', () => { if (lock === acquired) lock = null; }, { once: true }); }
      } catch (cause) {
        console.warn('FableShot: телефон не разрешил поддерживать экран включённым.', cause);
      } finally { pending = false; }
    }
    void request();
    document.addEventListener('visibilitychange', request);
    return () => { stopped = true; document.removeEventListener('visibilitychange', request); void lock?.release(); };
  }, [active, preferences.keepAwake]);
  return nativeError;
}

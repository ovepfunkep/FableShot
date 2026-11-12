import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from './preferences.ts';
import type { TrainingPreferences } from './preferences.ts';
import { useWebTheme } from './web-theme.ts';
import { Capacitor } from '@capacitor/core';
import { setTrainingWindowActive } from './native-training-window.ts';
import { supportsAppScale, useNativeAppScale } from './native-app-scale.ts';
import './training-preferences.css';

type PreferencesState = { preferences: TrainingPreferences; error: string; readable: boolean; update: (value: TrainingPreferences) => boolean };
const PreferencesContext = createContext<PreferencesState | null>(null);

function initialPreferences() {
  try { return { value: loadPreferences(), error: '' }; }
  catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : 'Не удалось прочитать настройки.' }; }
}

export function TrainingPreferencesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialPreferences);
  const preferences = state.value ?? DEFAULT_PREFERENCES;
  useWebTheme(preferences);
  useNativeAppScale(preferences.useSystemScale === true);
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = preferences.animations ? 'on' : 'off';
  }, [preferences.animations]);
  function update(value: TrainingPreferences) {
    try { savePreferences(value); setState({ value, error: '' }); return true; }
    catch (cause) { setState(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'Не удалось сохранить настройки.' })); }
    return false;
  }
  return <PreferencesContext.Provider value={{ preferences, update, readable: state.value !== null, error: state.error }}>{children}</PreferencesContext.Provider>;
}

export function useTrainingPreferences(): PreferencesState {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('TrainingPreferencesProvider is required');
  return value;
}

const switches = [
  { key: 'hideScores', title: 'Скрывать очки', tag: 'setting-hide-scores', hint: 'Для интриги и большего места под мишень: убирает оценки стрел, суммы и средние вместе с подписями. Номера стрел, лупа и правка остаются. Результаты можно открыть в статистике. Попадания сохраняются как обычно.' },
  { key: 'averageHundredths', title: 'Средний до сотых', tag: 'setting-average-hundredths', hint: 'Показывает средний балл с двумя знаками после запятой в тренировке, списках серий и статистике.' },
  { key: 'animations', title: 'Анимации', tag: 'setting-animations', hint: 'Плавные изменения цифр и подсветка активной стрелы. Системная настройка уменьшения движения также учитывается.' },
  { key: 'haptics', title: 'Вибрация', tag: 'setting-haptics', hint: 'Короткий отклик после записи выстрела и по окончании таймера. Доступность зависит от устройства.' },
  { key: 'keepAwake', title: 'Не гасить экран', tag: 'setting-keep-awake', hint: 'Поддерживает экран включённым во время активной тренировки. Энергосбережение и ручная блокировка управляются телефоном.' },
  { key: 'trainingOnLockScreen', title: 'Тренировка на экране блокировки', tag: 'setting-training-lock-screen', hint: 'После ручной блокировки можно вернуться к активной тренировке без отпечатка. Остальные приложения остаются защищены блокировкой телефона. Работает только в Android-приложении.' },
  { key: 'useSystemScale', title: 'Системный масштаб', tag: 'setting-system-scale', hint: 'Учитывает размер текста и интерфейса Android. При большом масштабе на экране помещается меньше данных.' },
] as const;

export function TrainingPreferenceControls({ keys }: { keys?: readonly (typeof switches)[number]['key'][] } = {}) {
  const { preferences, update, error } = useTrainingPreferences();
  const [help, setHelp] = useState<(typeof switches)[number] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { if (help) dialog.current?.showModal(); }, [help]);
  return <section className="training-preferences" aria-label="Параметры отображения">
    {switches.filter(item => (!keys || keys.includes(item.key)) &&
      (item.key !== 'trainingOnLockScreen' || Capacitor.getPlatform() === 'android') &&
      (item.key !== 'useSystemScale' || (keys?.includes(item.key) && supportsAppScale()))).map(item => {
      const checked = preferences[item.key] ?? (item.key !== 'useSystemScale');
      return <div key={item.key} className="preference-row">
        <span className="preference-title">{item.title}
          <span className="preference-help-anchor">{'\u00a0'}<button type="button" className="preference-help" aria-label={`О настройке «${item.title}»`} onClick={() => setHelp(item)}>?</button></span>
        </span>
        <button type="button" role="switch" className="preference-switch" aria-label={item.title} aria-checked={checked}
          data-testid={item.tag} disabled={!!error} onClick={() => update({ ...preferences, [item.key]: !checked })}><span /></button>
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

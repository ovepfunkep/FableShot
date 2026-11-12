import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_TECHNIQUE_SETTINGS, loadTechniqueSettings, saveTechniqueSettings, TECHNIQUE_SETTINGS_STORAGE_KEY,
} from './technique-settings.ts';
import type { TechniqueDisplaySettings } from './technique-settings.ts';
import './technique-settings.css';

type SettingsState = {
  settings: TechniqueDisplaySettings;
  error: string;
  canUpdate: boolean;
  update: (settings: TechniqueDisplaySettings) => boolean;
  retry: () => void;
};
const SettingsContext = createContext<SettingsState | null>(null);

function readSettings(): { value: TechniqueDisplaySettings | null; error: string } {
  try { return { value: loadTechniqueSettings(), error: '' }; }
  catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : 'Не удалось прочитать настройки показа техники.' }; }
}

export function TechniqueSettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readSettings);
  const current = useRef(state.value);
  function retry() {
    const next = readSettings();
    current.current = next.value;
    setState(next);
  }
  useEffect(() => {
    function changed(event: StorageEvent) {
      if (event.key === TECHNIQUE_SETTINGS_STORAGE_KEY || event.key === null) retry();
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  function update(settings: TechniqueDisplaySettings): boolean {
    if (!current.current) return false;
    try {
      saveTechniqueSettings(settings, current.current);
      current.current = { ...settings };
      setState({ value: current.current, error: '' });
      return true;
    } catch (cause) {
      setState(previous => ({ ...previous, error: cause instanceof Error ? cause.message : 'Не удалось сохранить настройки показа техники.' }));
      return false;
    }
  }
  return <SettingsContext.Provider value={{ settings: state.value ?? DEFAULT_TECHNIQUE_SETTINGS, error: state.error,
    canUpdate: state.value !== null, update, retry }}>{children}</SettingsContext.Provider>;
}

export function useTechniqueSettings(): SettingsState {
  const state = useContext(SettingsContext);
  if (!state) throw new Error('TechniqueSettingsProvider is required');
  return state;
}

const controls = [
  { key: 'techniqueFocus', title: 'Фокус в памятке', testId: 'setting-technique-focus' },
  { key: 'techniqueReflection', title: 'Рефлексия в разборе', testId: 'setting-technique-reflection' },
] as const;

export function TechniqueDisplayControls() {
  const { settings, error, canUpdate, update, retry } = useTechniqueSettings();
  return <section className="technique-display-settings" aria-labelledby="technique-display-title">
    <h3 id="technique-display-title">Показ техники</h3>
    {controls.map(control => <label className="technique-display-row" key={control.key}>
      <input type="checkbox" checked={settings[control.key]} disabled={!canUpdate} data-testid={control.testId}
        onChange={event => update({ ...settings, [control.key]: event.target.checked })} />
      <span>{control.title}</span>
    </label>)}
    {error && <div className="technique-display-error" role="alert"><p>{error}</p>
      <button type="button" onClick={retry}>Повторить чтение</button>
    </div>}
  </section>;
}

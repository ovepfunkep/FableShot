import { useId } from 'react';
import { DEFAULT_THEME_MODE, DEFAULT_THEME_STYLE, THEME_MODES, THEME_STYLES } from './web-theme.ts';
import type { ThemeMode, ThemePreferences, ThemeStyle } from './web-theme.ts';
import './web-theme.css';

const styleLabels: Record<ThemeStyle, string> = { sport: 'Спорт', pop: 'Поп', minimal: 'Минимал' };
const modeLabels: Record<ThemeMode, string> = { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' };

export function WebThemeSettings({ value, onChange, disabled = false }: {
  value: ThemePreferences;
  onChange: (patch: ThemePreferences) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const { themeStyle = DEFAULT_THEME_STYLE, themeMode = DEFAULT_THEME_MODE } = value;
  return <section className="web-theme-settings" aria-label="Оформление" data-testid="web-theme-settings">
    <fieldset disabled={disabled}>
      <legend>Твой стиль</legend>
      <div className="web-theme-styles">
        {THEME_STYLES.map(style => <label className="web-theme-style" key={style}>
          <input type="radio" name={`${id}-style`} value={style} checked={themeStyle === style}
            data-testid={`style-${style}`} onChange={() => onChange({ themeStyle: style })} />
          <span className="web-theme-swatch" data-swatch={style} aria-hidden="true" />
          <span>{styleLabels[style]}</span>
        </label>)}
      </div>
    </fieldset>
    <fieldset disabled={disabled}>
      <legend>Тема</legend>
      <div className="web-theme-modes">
        {THEME_MODES.map(mode => <label className="web-theme-mode" key={mode}>
          <input type="radio" name={`${id}-mode`} value={mode} checked={themeMode === mode}
            data-testid={`appearance-${mode}`} onChange={() => onChange({ themeMode: mode })} />
          <span>{modeLabels[mode]}</span>
        </label>)}
      </div>
    </fieldset>
  </section>;
}

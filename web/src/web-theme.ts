import { useLayoutEffect } from 'react';

export const THEME_STYLES = ['sport', 'pop', 'minimal'] as const;
export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeStyle = typeof THEME_STYLES[number];
export type ThemeMode = typeof THEME_MODES[number];
export type ThemePreferences = { themeStyle?: ThemeStyle; themeMode?: ThemeMode };
export const DEFAULT_THEME_STYLE: ThemeStyle = 'sport';
export const DEFAULT_THEME_MODE: ThemeMode = 'system';

export function isThemeStyle(value: unknown): value is ThemeStyle {
  return THEME_STYLES.some(style => style === value);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.some(mode => mode === value);
}

/** Apply the active palette before painting and follow OS changes in System mode. */
export function useWebTheme({ themeStyle = DEFAULT_THEME_STYLE, themeMode = DEFAULT_THEME_MODE }: ThemePreferences) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousColor = meta?.content;
    const system = themeMode === 'system' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;

    function apply() {
      root.dataset.themeStyle = themeStyle;
      root.dataset.themeMode = themeMode;
      root.dataset.themeAppearance = themeMode === 'system' ? system?.matches ? 'dark' : 'light' : themeMode;
      const background = getComputedStyle(root).getPropertyValue('--app-bg').trim();
      if (meta && background) meta.content = background;
    }

    apply();
    system?.addEventListener('change', apply);
    return () => {
      system?.removeEventListener('change', apply);
      delete root.dataset.themeStyle;
      delete root.dataset.themeMode;
      delete root.dataset.themeAppearance;
      if (meta && previousColor !== undefined) meta.content = previousColor;
    };
  }, [themeStyle, themeMode]);
}

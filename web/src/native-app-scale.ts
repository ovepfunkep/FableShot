import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { useLayoutEffect } from 'react';

const bridge = registerPlugin<{
  apply(options: { followSystem: boolean }): Promise<{ layoutZoom: number }>;
  addListener(event: 'configurationChanged', listener: () => void): Promise<PluginListenerHandle>;
}>('AppScale');

export function supportsAppScale() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('AppScale');
}

export function useNativeAppScale(followSystem: boolean) {
  useLayoutEffect(() => {
    if (!supportsAppScale()) return;
    const root = document.documentElement;
    let revision = 0;
    let active = true;
    let listener: PluginListenerHandle | undefined;
    function apply() {
      const request = ++revision;
      void bridge.apply({ followSystem }).then(({ layoutZoom }) => {
        if (!active || request !== revision || !Number.isFinite(layoutZoom) || layoutZoom <= 0) return;
        root.style.setProperty('--app-scale', String(layoutZoom));
      }).catch(error => console.warn('FableShot: не удалось применить системный масштаб.', error));
    }
    apply();
    const onVisible = () => { if (document.visibilityState === 'visible') apply(); };
    document.addEventListener('visibilitychange', onVisible);
    void bridge.addListener('configurationChanged', apply).then(handle => {
      if (active) listener = handle;
      else void handle.remove();
    }).catch(error => console.warn('FableShot: не удалось отслеживать системный масштаб.', error));
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      void listener?.remove();
    };
  }, [followSystem]);
}

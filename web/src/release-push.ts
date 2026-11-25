import { Capacitor, registerPlugin } from '@capacitor/core';

export type ReleasePushStatus = { available: boolean; enabled: boolean; allowed: boolean; canRequestPermission?: boolean };

export const releasePush = registerPlugin<{
  getStatus(): Promise<ReleasePushStatus>;
  setEnabled(options: { enabled: boolean }): Promise<ReleasePushStatus>;
  openSystemSettings(): Promise<void>;
  pendingRelease(): Promise<{ code: number }>;
  acknowledge(options: { code: number }): Promise<void>;
}>('ReleasePush');

export const releasePushSupported = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('ReleasePush');

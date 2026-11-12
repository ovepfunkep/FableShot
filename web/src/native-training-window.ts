import { Capacitor, registerPlugin } from '@capacitor/core';

interface TrainingWindowPlugin {
  setActive(options: { active: boolean }): Promise<void>;
  longPressFeedback(): Promise<void>;
}

const trainingWindow = registerPlugin<TrainingWindowPlugin>('TrainingWindow');

/** Optional feedback should never interrupt the timer or a saved shot. */
export function performTrainingHaptic(): void {
  if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('TrainingWindow')) {
    void trainingWindow.longPressFeedback().catch(error => console.warn('Не удалось включить вибрацию тренировки.', error));
    return;
  }
  navigator.vibrate?.(80);
}

/** Show only an enabled active Android training over the lock screen. The caller owns errors and cleanup. */
export async function setTrainingWindowActive(active: boolean): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  if (!Capacitor.isPluginAvailable('TrainingWindow')) {
    throw new Error('Показ тренировки на экране блокировки недоступен. Обновите тестовое приложение.');
  }
  await trainingWindow.setActive({ active });
}

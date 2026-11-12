import { Capacitor, registerPlugin } from '@capacitor/core';
import type { TimerPhase } from './timer.ts';

const native = registerPlugin<{
  schedule(options: { phase: TimerPhase; remainingMillis: number }): Promise<void>;
  cancel(): Promise<void>;
}>('PracticeTimerSound');

export function createTimerSound() {
  let audio: AudioContext | undefined;
  let tones: OscillatorNode[] = [];
  let sequence = 0;
  let nativeScheduled = false;

  function cancel() {
    sequence++;
    for (const tone of tones) {
      try { tone.stop(); } catch { /* Already ended. */ }
      tone.disconnect();
    }
    tones = [];
    if (nativeScheduled) {
      nativeScheduled = false;
      void native.cancel().catch(error => console.warn('Не удалось отменить сигнал таймера.', error));
    }
  }

  function schedule(phase: TimerPhase, deadline: number) {
    cancel();
    if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('PracticeTimerSound')) {
      nativeScheduled = true;
      void native.schedule({ phase, remainingMillis: Math.max(0, deadline - Date.now()) })
        .catch(error => console.warn('Не удалось запланировать сигнал таймера.', error));
      return;
    }
    const ticket = sequence;
    try {
      const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      const context = audio ??= new Audio();
      // This is called directly by the start/resume gesture.
      const ready = context.state === 'running' ? Promise.resolve() : context.resume();
      void ready.then(() => {
        const remaining = deadline - Date.now();
        if (ticket !== sequence || remaining < -1000) return;
        const start = context.currentTime + Math.max(0, remaining) / 1000;
        const pattern = phase === 'Series' ? [{ offset: 0, hz: 880, seconds: .48 }]
          : [{ offset: 0, hz: 540, seconds: .16 }, { offset: .27, hz: 680, seconds: .2 }];
        for (const { offset, hz, seconds } of pattern) {
          const at = start + offset;
          const tone = context.createOscillator(), gain = context.createGain();
          tone.frequency.value = hz;
          tone.connect(gain); gain.connect(context.destination);
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(.5, at + .015);
          gain.gain.setValueAtTime(.5, at + seconds - .035);
          gain.gain.linearRampToValueAtTime(0, at + seconds);
          tone.onended = () => { tone.disconnect(); gain.disconnect(); };
          tone.start(at); tone.stop(at + seconds);
          tones.push(tone);
        }
      }).catch(error => console.warn('Не удалось включить звук таймера.', error));
    } catch (error) { console.warn('Не удалось открыть звук таймера.', error); }
  }

  return { cancel, schedule, dispose() { cancel(); void audio?.close().catch(() => {}); audio = undefined; } };
}

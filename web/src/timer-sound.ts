import { Capacitor, registerPlugin } from '@capacitor/core';
const native = registerPlugin<{
  schedule(options: { signals: { delay: number; count: number }[] }): Promise<void>;
  cancel(): Promise<void>;
}>('PracticeTimerSound');

const HONK_MS = 1000;
const HONK_STEP_MS = 1500;

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

  function schedule(signals: readonly { at: number; count: number }[]) {
    cancel();
    let nextStart = 0;
    // Very short phases can become due before the previous sound has finished.
    const phrases = signals.map(({ at, count }) => {
      const start = Math.max(at, nextStart);
      nextStart = start + count * HONK_STEP_MS;
      return { at: start, count };
    });
    if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('PracticeTimerSound')) {
      nativeScheduled = true;
      const now = Date.now();
      void native.schedule({ signals: phrases.map(({ at, count }) => ({ delay: Math.max(0, at - now), count })) })
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
        if (ticket !== sequence) return;
        const now = Date.now();
        for (const signal of phrases.filter(signal => signal.at >= now - 1000)) {
          const start = context.currentTime + Math.max(0, signal.at - now) / 1000;
          for (let index = 0; index < signal.count; index++) {
            const at = start + index * HONK_STEP_MS / 1000, seconds = HONK_MS / 1000;
            const tone = context.createOscillator(), gain = context.createGain();
            tone.type = 'sawtooth';
            tone.frequency.value = 330;
            tone.connect(gain); gain.connect(context.destination);
            gain.gain.setValueAtTime(0, at);
            gain.gain.linearRampToValueAtTime(.9, at + .02);
            gain.gain.setValueAtTime(.9, at + seconds - .06);
            gain.gain.linearRampToValueAtTime(0, at + seconds);
            tone.onended = () => { tone.disconnect(); gain.disconnect(); };
            tone.start(at); tone.stop(at + seconds);
            tones.push(tone);
          }
        }
      }).catch(error => console.warn('Не удалось включить звук таймера.', error));
    } catch (error) { console.warn('Не удалось открыть звук таймера.', error); }
  }

  return { cancel, schedule, dispose() { cancel(); void audio?.close().catch(() => {}); audio = undefined; } };
}

package app.fableshot.android.webpilot;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "PracticeTimerSound")
public class PracticeTimerSoundPlugin extends Plugin {
    private static final int HONK_MS = 1000;
    private static final int HONK_STEP_MS = 1500;
    private static final int SAMPLE_RATE = 22_050;
    private final Handler commands = new Handler(Looper.getMainLooper());
    private final Handler signals = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private AudioTrack horn;
    private boolean destroyed;

    @PluginMethod
    public void schedule(PluginCall call) {
        JSONArray schedule = call.getArray("signals");
        if (schedule == null || schedule.length() > 3) {
            call.reject("Некорректное время сигнала.");
            return;
        }
        int[] delays = new int[schedule.length()];
        int[] counts = new int[schedule.length()];
        int last = 0;
        for (int i = 0; i < schedule.length(); i++) {
            JSONObject signal = schedule.optJSONObject(i);
            int delay = signal == null ? -1 : signal.optInt("delay", -1);
            int count = signal == null ? 0 : signal.optInt("count", 0);
            if (delay < 0 || delay > 3_726_000 || count < 1 || count > 3) {
                call.reject("Некорректное время сигнала.");
                return;
            }
            delays[i] = delay;
            counts[i] = count;
            last = Math.max(last, delay + (count - 1) * HONK_STEP_MS + HONK_MS);
        }
        int lastDelay = last;
        commands.post(() -> {
            if (destroyed) { call.reject("Тренировка закрыта."); return; }
            clear();
            if (delays.length == 0) { call.resolve(); return; }
            try {
                PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FableShot:PracticeTimer");
                wakeLock.acquire(lastDelay + 1000L);
                horn = createHorn();
                for (int i = 0; i < delays.length; i++) {
                    for (int beep = 0; beep < counts[i]; beep++) {
                        signals.postDelayed(this::play, delays[i] + (long) HONK_STEP_MS * beep);
                    }
                }
                signals.postDelayed(this::clear, lastDelay + 250L);
                call.resolve();
            } catch (RuntimeException error) {
                clear();
                call.reject("Не удалось подготовить сигнал таймера.", "TIMER_SOUND", error);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        commands.post(() -> { clear(); call.resolve(); });
    }

    private void play() {
        try {
            if (horn == null) return;
            horn.stop();
            if (horn.reloadStaticData() != AudioTrack.SUCCESS) throw new IllegalStateException("Cannot rewind timer horn");
            horn.play();
        } catch (RuntimeException error) {
            Log.w("FableShotTimer", "Timer audio unavailable", error);
            clear();
        }
    }

    private AudioTrack createHorn() {
        short[] samples = new short[SAMPLE_RATE * HONK_MS / 1000];
        for (int i = 0; i < samples.length; i++) {
            double time = (double) i / SAMPLE_RATE;
            double phase = 2 * Math.PI * 330 * time;
            double envelope = Math.min(1, Math.min(time / .02, (1 - time) / .06));
            double sample = 0;
            for (int harmonic = 1; harmonic <= 16; harmonic++) {
                sample += (harmonic % 2 == 1 ? 1 : -1) * Math.sin(phase * harmonic) / harmonic;
            }
            samples[i] = (short) (Short.MAX_VALUE * .53 * sample * envelope);
        }
        AudioTrack track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(samples.length * Short.BYTES)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build();
        if (track.write(samples, 0, samples.length) != samples.length) {
            track.release();
            throw new IllegalStateException("Cannot load timer horn");
        }
        return track;
    }

    private void clear() {
        signals.removeCallbacksAndMessages(null);
        if (horn != null) { horn.release(); horn = null; }
        if (wakeLock != null) {
            if (wakeLock.isHeld()) wakeLock.release();
            wakeLock = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        clear();
    }
}

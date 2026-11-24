package app.fableshot.android.webpilot;

import android.content.Context;
import android.media.AudioManager;
import android.media.ToneGenerator;
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
    private final Handler commands = new Handler(Looper.getMainLooper());
    private final Handler signals = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private ToneGenerator tone;
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
            if (delay < 0 || delay > 3_720_000 || count < 1 || count > 3) {
                call.reject("Некорректное время сигнала.");
                return;
            }
            delays[i] = delay;
            counts[i] = count;
            last = Math.max(last, delay);
        }
        int lastDelay = last;
        commands.post(() -> {
            if (destroyed) { call.reject("Тренировка закрыта."); return; }
            clear();
            if (delays.length == 0) { call.resolve(); return; }
            try {
                PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FableShot:PracticeTimer");
                wakeLock.acquire(lastDelay + 2500L);
                for (int i = 0; i < delays.length; i++) {
                    for (int beep = 0; beep < counts[i]; beep++) {
                        signals.postDelayed(this::play, delays[i] + 450L * beep);
                    }
                }
                signals.postDelayed(this::clear, lastDelay + 1400L);
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
            if (tone == null) tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 100);
            tone.startTone(ToneGenerator.TONE_DTMF_9, 300);
        } catch (RuntimeException error) {
            Log.w("FableShotTimer", "Timer audio unavailable", error);
            clear();
        }
    }

    private void clear() {
        signals.removeCallbacksAndMessages(null);
        if (tone != null) { tone.release(); tone = null; }
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

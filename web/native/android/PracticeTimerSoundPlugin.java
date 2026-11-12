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

@CapacitorPlugin(name = "PracticeTimerSound")
public class PracticeTimerSoundPlugin extends Plugin {
    private final Handler commands = new Handler(Looper.getMainLooper());
    private final Handler signals = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private ToneGenerator tone;
    private boolean destroyed;

    @PluginMethod
    public void schedule(PluginCall call) {
        String phase = call.getString("phase");
        Integer delay = call.getInt("remainingMillis");
        if ((!"Series".equals(phase) && !"Rest".equals(phase)) ||
            delay == null || delay < 0 || delay > 3_600_000) {
            call.reject("Некорректное время сигнала.");
            return;
        }
        commands.post(() -> {
            if (destroyed) { call.reject("Тренировка закрыта."); return; }
            clear();
            try {
                PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FableShot:PracticeTimer");
                wakeLock.acquire(delay + 1500L);
                signals.postDelayed(() -> play("Series".equals(phase)), delay);
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

    private void play(boolean series) {
        try {
            tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 90);
            tone.startTone(series ? ToneGenerator.TONE_DTMF_9 : ToneGenerator.TONE_DTMF_1, series ? 480 : 160);
            if (!series) signals.postDelayed(() -> {
                if (tone != null) tone.startTone(ToneGenerator.TONE_DTMF_3, 200);
            }, 270);
            signals.postDelayed(this::clear, 550);
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

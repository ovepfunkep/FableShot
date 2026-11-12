package app.fableshot.android.webpilot;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentExportPlugin.class);
        registerPlugin(TrainingWindowPlugin.class);
        super.onCreate(savedInstanceState);
        showTrainingWhenLocked(this, false);
    }

    @Override
    public void onDestroy() {
        showTrainingWhenLocked(this, false);
        super.onDestroy();
    }

    /** Match native TrainingLockScreen: cover the keyguard without dismissing it or waking the display. */
    @SuppressWarnings("deprecation")
    private static void showTrainingWhenLocked(Activity activity, boolean active) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            activity.setShowWhenLocked(active);
        } else if (active) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        } else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        }
    }

    // This registered class travels with MainActivity in the existing shell build.
    @CapacitorPlugin(name = "TrainingWindow")
    public static class TrainingWindowPlugin extends Plugin {
        @PluginMethod
        public void longPressFeedback(PluginCall call) {
            Activity activity = getActivity();
            if (activity == null) {
                call.resolve();
                return;
            }
            activity.runOnUiThread(() -> {
                if (!activity.isDestroyed()) {
                    activity.getWindow().getDecorView().performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                }
                call.resolve();
            });
        }

        @PluginMethod
        public void setActive(PluginCall call) {
            Boolean active = call.getBoolean("active");
            if (active == null) {
                call.reject("Не указано состояние окна тренировки.", "TRAINING_WINDOW_INVALID_STATE");
                return;
            }
            Activity activity = getActivity();
            if (activity == null) {
                call.reject("Окно приложения недоступно.", "TRAINING_WINDOW_UNAVAILABLE");
                return;
            }
            activity.runOnUiThread(() -> {
                if (activity.isDestroyed()) {
                    call.reject("Окно приложения уже закрыто.", "TRAINING_WINDOW_UNAVAILABLE");
                    return;
                }
                try {
                    showTrainingWhenLocked(activity, active);
                    call.resolve();
                } catch (Exception error) {
                    call.reject("Не удалось изменить показ тренировки на экране блокировки.", "TRAINING_WINDOW_FAILED", error);
                }
            });
        }
    }
}

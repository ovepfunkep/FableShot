package app.fableshot.android.webpilot;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentExportPlugin.class);
        registerPlugin(AndroidUpdatesPlugin.class);
        registerPlugin(PracticeTimerSoundPlugin.class);
        registerPlugin(TrainingWindowPlugin.class);
        super.onCreate(savedInstanceState);
        showTrainingWhenLocked(this, false);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            private boolean awaitingResponse;

            @Override
            public void handleOnBackPressed() {
                if (awaitingResponse || getBridge() == null) return;
                awaitingResponse = true;
                getBridge().getWebView().evaluateJavascript("window.fableShotBack?.()", handled -> {
                    awaitingResponse = false;
                    if ("false".equals(handled) && !isFinishing() && !isDestroyed()) {
                        // Only the ready Home screen returns false.
                        setEnabled(false);
                        try {
                            getOnBackPressedDispatcher().onBackPressed();
                        } finally {
                            setEnabled(true);
                        }
                    }
                });
            }
        });
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

    @CapacitorPlugin(name = "AndroidUpdates")
    public static class AndroidUpdatesPlugin extends Plugin {
        private boolean production() {
            return "app.fableshot.android.react".equals(getContext().getPackageName());
        }

        @SuppressWarnings("deprecation")
        @PluginMethod
        public void installedVersion(PluginCall call) {
            try {
                PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
                long code = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
                call.resolve(new JSObject().put("production", production()).put("code", code));
            } catch (Exception error) {
                call.reject("Не удалось прочитать версию Android.", "VERSION_UNAVAILABLE", error);
            }
        }

        @PluginMethod
        public void openDownload(PluginCall call) {
            String url = call.getString("url");
            if (!production() || url == null || !url.matches("https://github\\.com/ovepfunkep/FableShot/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+/FableShot-android-[1-9][0-9]*\\.apk")) {
                call.reject("Некорректная ссылка на обновление.");
                return;
            }
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    call.resolve();
                } catch (RuntimeException error) {
                    call.reject("Не удалось открыть загрузку APK.", "DOWNLOAD_UNAVAILABLE", error);
                }
            });
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

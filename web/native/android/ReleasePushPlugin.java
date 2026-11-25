package app.fableshot.android.webpilot;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

@CapacitorPlugin(name = "ReleasePush", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class ReleasePushPlugin extends Plugin {
    private static final String CHANNEL = "fableshot_updates";
    private static final String LAUNCH_CODE = "app.fableshot.releasePush.versionCode";
    private static final String ENABLED = "enabled";
    private static final String TOPIC_REQUESTED = "topic-requested";
    private static final String SHOWN = "shown";
    private static final String PENDING = "pending";
    private static final int NOTICE_ID = 1;
    private static final int MAX_VERSION_CODE = 2_100_000_000;
    private Boolean requestedSubscription;

    private static SharedPreferences store(Context context) {
        return context.getSharedPreferences("release-push", Context.MODE_PRIVATE);
    }

    private static boolean enabled(Context context) { return store(context).getBoolean(ENABLED, true); }

    private static String topic(Context context) {
        return "app.fableshot.android.react".equals(context.getPackageName())
                ? "fableshot_stable_updates" : "fableshot_test_updates";
    }

    private static NotificationManager notifications(Context context) {
        return context.getSystemService(NotificationManager.class);
    }

    private static boolean allowed(Context context) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager manager = notifications(context);
        if (!manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private boolean available() {
        return !FirebaseApp.getApps(getContext()).isEmpty() && GoogleApiAvailability.getInstance()
                .isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS;
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            notifications(context).createNotificationChannel(new NotificationChannel(CHANNEL, "Обновления FableShot",
                    NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    private JSObject status() {
        return new JSObject().put("available", available()).put("enabled", enabled(getContext()))
                .put("allowed", allowed(getContext())).put("canRequestPermission", canRequestPermission());
    }

    private boolean canRequestPermission() {
        if (Build.VERSION.SDK_INT < 33) return false;
        PermissionState permission = getPermissionState("notifications");
        return permission == PermissionState.PROMPT || permission == PermissionState.PROMPT_WITH_RATIONALE;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        synchronizeSubscription();
        call.resolve(status());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null || enabled && !available()) { call.reject("Уведомления недоступны на этом устройстве."); return; }
        Context context = getContext();
        SharedPreferences.Editor choice = store(context).edit().putBoolean(ENABLED, enabled);
        if (!enabled) {
            notifications(context).cancel(NOTICE_ID);
            choice.remove(PENDING);
        }
        choice.apply();
        if (enabled && canRequestPermission()) {
            requestPermissionForAlias("notifications", call, "permissionResult");
        } else permissionResult(call);
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        synchronizeSubscription();
        call.resolve(status());
    }

    private void synchronizeSubscription() {
        if (!available()) return;
        Context context = getContext();
        SharedPreferences preferences = store(context);
        boolean subscribe = enabled(context) && allowed(context);
        if (requestedSubscription != null && requestedSubscription == subscribe) return;
        if (!subscribe && !preferences.getBoolean(TOPIC_REQUESTED, preferences.contains(ENABLED))) return;
        requestedSubscription = subscribe;
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        if (subscribe) {
            ensureChannel(context);
            preferences.edit().putBoolean(TOPIC_REQUESTED, true).apply();
        }
        messaging.setAutoInitEnabled(subscribe);
        (subscribe ? messaging.subscribeToTopic(topic(context)) : messaging.unsubscribeFromTopic(topic(context)))
                .addOnSuccessListener(ignored -> {
                    if (!subscribe && requestedSubscription == Boolean.FALSE) preferences.edit().putBoolean(TOPIC_REQUESTED, false).apply();
                })
                .addOnFailureListener(error -> {
                    if (requestedSubscription != null && requestedSubscription == subscribe) requestedSubscription = null;
                    Log.w("FableShotPush", "Could not update the release topic subscription");
                });
    }

    @PluginMethod
    public void openSystemSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) { call.unimplemented(); return; }
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        getActivity().startActivity(intent);
        call.resolve();
    }

    @Override
    public void load() {
        capture(getActivity().getIntent());
        synchronizeSubscription();
    }

    @Override
    protected void handleOnResume() { synchronizeSubscription(); }

    @Override
    protected void handleOnNewIntent(Intent intent) { capture(intent); }

    private void capture(Intent intent) {
        if (intent == null) return;
        int code = intent.getIntExtra(LAUNCH_CODE, 0);
        intent.removeExtra(LAUNCH_CODE);
        SharedPreferences preferences = store(getContext());
        if (!enabled(getContext()) || code <= 0 || code > MAX_VERSION_CODE) return;
        preferences.edit().putInt(PENDING, Math.max(code, preferences.getInt(PENDING, 0))).apply();
        getBridge().triggerWindowJSEvent("fableshot-release-push");
    }

    @PluginMethod
    public void pendingRelease(PluginCall call) { call.resolve(new JSObject().put("code", store(getContext()).getInt(PENDING, 0))); }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        Integer code = call.getInt("code");
        SharedPreferences preferences = store(getContext());
        if (code != null && preferences.getInt(PENDING, 0) == code) preferences.edit().remove(PENDING).apply();
        call.resolve();
    }

    public static final class MessageService extends FirebaseMessagingService {
        @Override
        public void onMessageReceived(RemoteMessage message) {
            SharedPreferences preferences = store(this);
            if (!enabled(this) || !allowed(this) || !"release".equals(message.getData().get("type"))) return;
            String version = message.getData().get("version");
            String rawCode = message.getData().get("versionCode");
            if (version == null || !version.matches("[0-9]{1,8}\\.[0-9]{1,8}\\.[0-9]{1,8}") ||
                    rawCode == null || !rawCode.matches("[1-9][0-9]{0,9}")) return;
            long code = Long.parseLong(rawCode);
            if (code > MAX_VERSION_CODE || code <= preferences.getInt(SHOWN, 0) || code <= installedCode()) return;

            ensureChannel(this);
            Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .putExtra(LAUNCH_CODE, (int) code);
            PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder notice = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
            int icon = getResources().getIdentifier("fableshot_update_notification", "drawable", getPackageName());
            String title = noticeText(message.getData().get("title"), 80, "Доступен FableShot " + version);
            String body = noticeText(message.getData().get("body"), 120, "Доступно обновление!");
            notifications(this).notify(NOTICE_ID, notice.setSmallIcon(icon == 0 ? android.R.drawable.stat_sys_download_done : icon)
                    .setContentTitle(title).setContentText(body)
                    .setContentIntent(tap).setAutoCancel(true).build());
            preferences.edit().putInt(SHOWN, (int) code).apply();
        }

        private static String noticeText(String value, int maxLength, String fallback) {
            if (value == null || value.length() > maxLength || value.chars().anyMatch(Character::isISOControl)) return fallback;
            String trimmed = value.trim();
            return trimmed.isEmpty() ? fallback : trimmed;
        }

        @SuppressWarnings("deprecation")
        private long installedCode() {
            try {
                PackageInfo installed = getPackageManager().getPackageInfo(getPackageName(), 0);
                return Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
            } catch (PackageManager.NameNotFoundException error) { return Long.MAX_VALUE; }
        }
    }
}

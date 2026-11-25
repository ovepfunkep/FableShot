package app.fableshot.android.webpilot;

import android.app.Activity;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;

@CapacitorPlugin(name = "DriveAuthorization")
public class DriveAuthorizationPlugin extends Plugin {
    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    private ActivityResultLauncher<IntentSenderRequest> consent;
    private PluginCall pending;

    @Override
    public void load() {
        consent = getBridge().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(),
            this::driveAuthorizationResult);
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive"));
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(DRIVE_SCOPE))).build();
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            if (pending != null) {
                call.reject("Разрешение Google Диска уже запрашивается.");
                return;
            }
            pending = call;
            Identity.getAuthorizationClient(activity).authorize(request)
            .addOnSuccessListener(result -> {
                if (!result.hasResolution()) {
                    pending = null;
                    finish(call, result);
                } else if (!interactive) {
                    pending = null;
                    call.resolve();
                } else if (result.getPendingIntent() != null) {
                    consent.launch(new IntentSenderRequest.Builder(result.getPendingIntent()).build());
                } else {
                    pending = null;
                    call.reject("Не удалось открыть разрешения Google Диска.");
                }
            })
            .addOnFailureListener(error -> {
                pending = null;
                call.reject("Не удалось подключить Google Диск. Проверь аккаунт Google и доступ к сети.");
            });
        });
    }

    private void driveAuthorizationResult(ActivityResult activityResult) {
        PluginCall call = pending;
        pending = null;
        if (call == null) return;
        if (activityResult.getResultCode() != Activity.RESULT_OK || activityResult.getData() == null) {
            call.reject("Подключение Google Диска не завершено.");
            return;
        }
        try {
            finish(call, Identity.getAuthorizationClient(getActivity())
                .getAuthorizationResultFromIntent(activityResult.getData()));
        } catch (ApiException error) {
            call.reject("Google не выдал доступ к резервным копиям.");
        }
    }

    private void finish(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty() || !result.getGrantedScopes().contains(DRIVE_SCOPE)) {
            call.reject("Google не выдал доступ к резервным копиям.");
            return;
        }
        call.resolve(new JSObject().put("token", token));
    }
}

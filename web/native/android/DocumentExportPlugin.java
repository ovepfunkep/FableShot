package app.fableshot.android.webpilot;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "DocumentExport")
public class DocumentExportPlugin extends Plugin {
    private static final String TAG = "FableShotExport";
    private static final int MAX_BYTES = 12 * 1024 * 1024;
    private static final Pattern UNSAFE_NAME = Pattern.compile("[<>:\"/\\\\|?*\\x00-\\x1f\\x7f-\\x9f]");
    private final AtomicBoolean exporting = new AtomicBoolean(false);

    @PluginMethod
    public void exportDocument(PluginCall call) {
        if (!exporting.compareAndSet(false, true)) {
            call.reject("Дождись окончания сохранения файла.", "EXPORT_BUSY");
            return;
        }
        try {
            validateMetadata(call);
            String encoded = call.getString("dataBase64");
            if (encoded == null || encoded.isEmpty() || encoded.length() > ((MAX_BYTES + 2) / 3) * 4 ||
                encoded.length() % 4 != 0 || !encoded.matches("[A-Za-z0-9+/]*={0,2}")) {
                throw new IllegalArgumentException("Некорректные данные файла.");
            }
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > MAX_BYTES) {
                throw new IllegalArgumentException("Файл должен содержать от 1 байта до 12 МБ.");
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveToDownloads(call, bytes);
            } else {
                selectDestination(call, bytes);
            }
        } catch (Exception error) {
            exporting.set(false);
            call.reject("Не удалось сохранить файл: " + error.getMessage(), "EXPORT_FAILED", error);
        }
    }

    private void validateMetadata(PluginCall call) {
        String name = call.getString("name");
        String mime = call.getString("mimeType");
        String extension;
        if ("application/pdf".equals(mime)) extension = ".pdf";
        else if ("application/json".equals(mime)) extension = ".json";
        else if ("text/plain".equals(mime)) extension = ".txt";
        else if ("text/csv".equals(mime)) extension = ".csv";
        else if ("image/png".equals(mime)) extension = ".png";
        else if ("application/zip".equals(mime)) extension = ".zip";
        else throw new IllegalArgumentException("Неподдерживаемый формат файла.");
        if (name == null || name.length() > 160 || !name.equals(name.trim()) ||
            name.length() <= extension.length() ||
            !name.toLowerCase(Locale.ROOT).endsWith(extension) ||
            UNSAFE_NAME.matcher(name).find()) {
            throw new IllegalArgumentException("Некорректное имя файла.");
        }
    }

    private void saveToDownloads(PluginCall call, byte[] bytes) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, call.getString("name"));
        values.put(MediaStore.MediaColumns.MIME_TYPE, call.getString("mimeType"));
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("Не удалось создать файл в «Загрузках».");
        try {
            try (OutputStream output = resolver.openOutputStream(uri, "w")) {
                if (output == null) throw new IOException("Не удалось открыть файл для записи.");
                output.write(bytes);
                output.flush();
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(uri, values, null, null) != 1) {
                throw new IOException("Не удалось завершить сохранение файла.");
            }
        } catch (IOException | RuntimeException error) {
            removeIncomplete(uri, error);
            throw error;
        }
        finishSaved(call, uri);
    }

    private void selectDestination(PluginCall call, byte[] bytes) throws IOException {
        String token = UUID.randomUUID().toString();
        File file = stagedFile(token);
        try {
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(bytes);
            }
        } catch (IOException error) {
            removeStaged(file);
            throw error;
        }
        // Capacitor persists call options in Activity state. Keep 12 MB payloads out of its Bundle.
        call.getData().remove("dataBase64");
        call.getData().put("exportToken", token);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(call.getString("mimeType"))
            .putExtra(Intent.EXTRA_TITLE, call.getString("name"));
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "destinationSelected");
            } catch (RuntimeException error) {
                removeStaged(file);
                exporting.set(false);
                call.reject("Не удалось открыть выбор файла.", "EXPORT_FAILED", error);
            }
        });
    }

    @ActivityCallback
    private void destinationSelected(PluginCall call, ActivityResult result) {
        if (call == null) {
            exporting.set(false);
            Log.w(TAG, "Document picker returned without a saved call.");
            return;
        }
        // Document providers may block on I/O; Activity callbacks run on the UI thread.
        getBridge().execute(() -> writeSelectedDestination(call, result));
    }

    private void writeSelectedDestination(PluginCall call, ActivityResult result) {
        File staged = null;
        Uri uri = null;
        try {
            staged = stagedFile(call.getString("exportToken"));
            if (result.getResultCode() == Activity.RESULT_CANCELED) {
                exporting.set(false);
                call.resolve(new JSObject().put("saved", false).put("opened", false));
                return;
            }
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null ||
                result.getData().getData() == null) {
                throw new IOException("Выбор файла не завершён.");
            }
            uri = result.getData().getData();
            validateMetadata(call);
            if (!staged.isFile() || staged.length() == 0 || staged.length() > MAX_BYTES) {
                throw new IOException("Временный файл недоступен. Повтори экспорт.");
            }
            try (FileInputStream input = new FileInputStream(staged);
                 OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new IOException("Не удалось открыть файл для записи.");
                byte[] buffer = new byte[16 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            }
            finishSaved(call, uri);
        } catch (Exception error) {
            if (uri != null) removeIncomplete(uri, error);
            exporting.set(false);
            call.reject("Не удалось сохранить файл: " + error.getMessage(), "EXPORT_FAILED", error);
        } finally {
            if (staged != null) removeStaged(staged);
        }
    }

    private File stagedFile(String token) throws IOException {
        if (token == null || !token.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) {
            throw new IOException("Некорректный временный файл.");
        }
        return new File(getContext().getCacheDir(), "fableshot-export-" + token + ".bin");
    }

    private void removeStaged(File file) {
        if (file.exists() && !file.delete()) Log.w(TAG, "Could not remove staged export from app cache.");
    }

    private void removeIncomplete(Uri uri, Exception failure) {
        try {
            if (getContext().getContentResolver().delete(uri, null, null) < 1) {
                failure.addSuppressed(new IOException("Не удалось удалить незавершённый файл."));
            }
        } catch (RuntimeException cleanupError) {
            failure.addSuppressed(cleanupError);
        }
    }

    private void finishSaved(PluginCall call, Uri uri) {
        getActivity().runOnUiThread(() -> {
            boolean opened = false;
            Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, call.getString("mimeType"))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            view.setClipData(ClipData.newRawUri(call.getString("name"), uri));
            if (Boolean.TRUE.equals(call.getBoolean("share", false))) {
                Intent send = new Intent(Intent.ACTION_SEND)
                    .setType(call.getString("mimeType"))
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newRawUri(call.getString("name"), uri));
                view = Intent.createChooser(send, "Поделиться тренировкой")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            try {
                // Starting directly also works when Android package visibility hides installed viewers.
                getActivity().startActivity(view);
                opened = true;
            } catch (RuntimeException error) {
                Log.w(TAG, "File saved; no available viewer could open it.", error);
            } finally {
                exporting.set(false);
            }
            call.resolve(new JSObject().put("saved", true).put("opened", opened));
        });
    }
}

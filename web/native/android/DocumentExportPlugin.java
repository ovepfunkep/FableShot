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
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Locale;
import java.util.ArrayList;
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
    public void shareDocuments(PluginCall call) {
        if (!exporting.compareAndSet(false, true)) {
            call.reject("Дождись открытия меню отправки.", "EXPORT_BUSY");
            return;
        }
        getBridge().execute(() -> {
            File directory = null;
            try {
                JSONArray files = call.getArray("files");
                if (files == null || files.length() < 1 || files.length() > 100) throw new IOException("Нет файлов для отправки.");
                File root = new File(getContext().getCacheDir(), "shared-reports");
                if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Не удалось подготовить файл.");
                File[] previous = root.listFiles();
                if (previous != null) for (File old : previous) {
                    if (old.isDirectory() && old.lastModified() < System.currentTimeMillis() - 86400000L) removeShareDirectory(old);
                }
                directory = new File(root, UUID.randomUUID().toString());
                if (!directory.mkdir()) throw new IOException("Не удалось подготовить файл.");
                ArrayList<Uri> uris = new ArrayList<>();
                String mime = null;
                int total = 0;
                for (int index = 0; index < files.length(); index++) {
                    JSONObject file = files.getJSONObject(index);
                    String type = file.getString("mimeType"), name = file.getString("name"), encoded = file.getString("dataBase64");
                    String extension = "image/png".equals(type) ? ".png" : "application/pdf".equals(type) ? ".pdf" : null;
                    if (extension == null || name.length() > 160 || name.length() <= extension.length() ||
                        !name.equals(name.trim()) || !name.toLowerCase(Locale.ROOT).endsWith(extension) || UNSAFE_NAME.matcher(name).find() ||
                        encoded.length() > ((MAX_BYTES + 2) / 3) * 4 || encoded.length() % 4 != 0 || !encoded.matches("[A-Za-z0-9+/]*={0,2}")) {
                        throw new IOException("Некорректный файл отчёта.");
                    }
                    if (mime != null && !mime.equals(type)) throw new IOException("Выбери один формат отчёта.");
                    mime = type;
                    byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
                    total += bytes.length;
                    if (bytes.length == 0 || bytes.length > MAX_BYTES || total > 76 * 1024 * 1024) throw new IOException("Отчёт слишком большой для отправки.");
                    File target = new File(directory, name);
                    if (target.exists()) throw new IOException("Повторяющееся имя файла.");
                    try (FileOutputStream output = new FileOutputStream(target)) { output.write(bytes); }
                    uris.add(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", target));
                }
                Intent send = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE)
                    .setType(mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (uris.size() == 1) send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
                else send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                ClipData clip = ClipData.newRawUri("FableShot", uris.get(0));
                for (int index = 1; index < uris.size(); index++) clip.addItem(new ClipData.Item(uris.get(index)));
                send.setClipData(clip);
                File staged = directory;
                getActivity().runOnUiThread(() -> {
                    try {
                        getActivity().startActivity(Intent.createChooser(send, "Поделиться тренировкой").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                        call.resolve(new JSObject().put("opened", true));
                    } catch (RuntimeException error) {
                        removeShareDirectory(staged);
                        call.reject("Не удалось открыть отправку отчёта.", "SHARE_FAILED", error);
                    } finally { exporting.set(false); }
                });
            } catch (Exception error) {
                if (directory != null) removeShareDirectory(directory);
                exporting.set(false);
                call.reject("Не удалось подготовить отправку: " + error.getMessage(), "SHARE_FAILED", error);
            }
        });
    }

    private void removeShareDirectory(File directory) {
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) removeStaged(file);
        removeStaged(directory);
    }
    private final AtomicBoolean importing = new AtomicBoolean(false);

    @PluginMethod
    public void pickArchive(PluginCall call) {
        if (!importing.compareAndSet(false, true)) {
            call.reject("Выбор архива уже открыт.", "IMPORT_BUSY");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        getActivity().runOnUiThread(() -> {
            try { startActivityForResult(call, intent, "archiveSelected"); }
            catch (RuntimeException error) {
                importing.set(false);
                call.reject("Не удалось открыть выбор архива.", "IMPORT_FAILED", error);
            }
        });
    }

    @ActivityCallback
    private void archiveSelected(PluginCall call, ActivityResult result) {
        if (call == null) { importing.set(false); return; }
        getBridge().execute(() -> {
            try {
                if (result.getResultCode() == Activity.RESULT_CANCELED) {
                    call.resolve(new JSObject().put("cancelled", true));
                    return;
                }
                Uri uri = result.getData() == null ? null : result.getData().getData();
                if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
                    throw new IOException("Выбор файла не завершён.");
                }
                // Provider SIZE may be zero for a complete file. Read the granted stream,
                // enforcing the limit on actual bytes rather than trusting metadata.
                final int limit = 76 * 1024 * 1024;
                try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                     ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new IOException("Не удалось открыть архив.");
                    byte[] buffer = new byte[16 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (count > limit - output.size()) throw new IOException("Архив должен быть не больше 76 МБ.");
                        output.write(buffer, 0, count);
                    }
                    if (output.size() == 0) throw new IOException("Выбранный архив пуст. Сохрани его на телефон и выбери повторно.");
                    call.resolve(new JSObject().put("cancelled", false).put("bytes", output.size())
                        .put("dataBase64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)));
                }
            } catch (Exception error) {
                call.reject("Не удалось прочитать архив: " + error.getMessage(), "IMPORT_FAILED", error);
            } finally { importing.set(false); }
        });
    }

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

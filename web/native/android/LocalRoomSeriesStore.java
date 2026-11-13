package app.fableshot.android.webpilot;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import org.json.JSONException;
import org.json.JSONObject;

final class LocalRoomSeriesStore extends SQLiteOpenHelper {
    private final String roomId;
    private boolean closed;
    private volatile int acceptedSeries;

    int acceptedSeries() { return acceptedSeries; }

    LocalRoomSeriesStore(Context context, byte[] roomSecret) {
        super(context.getApplicationContext(), "fableshot-local-room-series.db", null, 1);
        roomId = fingerprint(roomSecret);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE series (room TEXT, entry TEXT, id INTEGER, ordinal INTEGER, revision INTEGER, payload TEXT, "
            + "PRIMARY KEY (room, entry, id), UNIQUE (room, entry, ordinal))");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unknown room database version");
    }

    synchronized byte[] receive(byte[] frame) throws IOException {
        if (closed) throw new IOException("Room is closed");
        try {
            JSONObject request = new JSONObject(new String(frame, StandardCharsets.UTF_8));
            if (request.length() == 1 && "snapshot".equals(request.optString("action"))) {
                return snapshot().toString().getBytes(StandardCharsets.UTF_8);
            }
            String payload = request.getString("payload");
            byte[] publicKey = Base64.decode(request.getString("publicKey"), Base64.DEFAULT);
            byte[] signature = Base64.decode(request.getString("signature"), Base64.DEFAULT);
            if (publicKey.length > 128 || signature.length < 8 || signature.length > 72) throw new IOException("Invalid series signature");
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(publicKey)));
            verifier.update(payload.getBytes(StandardCharsets.UTF_8));
            if (!verifier.verify(signature)) throw new IOException("Invalid series signature");
            JSONObject end = new JSONObject(payload);
            if (end.length() != 6) throw new IOException("Unexpected series fields");
            String entryId = fingerprint(publicKey);
            if (!roomId.equals(end.getString("roomId")) || !entryId.equals(end.getString("entryId"))) {
                throw new IOException("Invalid room or entry");
            }
            long endId = positive(end, "endId");
            long ordinal = positive(end, "ordinal");
            long revision = positive(end, "revision");
            JSONObject result = end.isNull("result") ? null : end.getJSONObject("result");
            if (!end.has("result")) throw new IOException("Missing series result");
            if (result != null) validateResult(result);

            return receipt(endId, persist(entryId, endId, ordinal, revision, payload));
        } catch (JSONException | GeneralSecurityException | IllegalArgumentException | SQLiteException error) {
            throw new IOException("Invalid series operation", error);
        }
    }

    synchronized JSONObject snapshot() throws JSONException, IOException {
        if (closed) throw new IOException("Room is closed");
        org.json.JSONArray series = new org.json.JSONArray();
        try (Cursor rows = getReadableDatabase().query("series", new String[] {"payload"}, "room = ?",
                new String[] {roomId}, null, null, "entry, ordinal")) {
            while (rows.moveToNext()) {
                JSONObject end = new JSONObject(rows.getString(0));
                JSONObject result = end.optJSONObject("result");
                if (result != null) {
                    String scores = result.getString("scores");
                    int points = 0;
                    for (int i = 0; i < scores.length(); i++) {
                        char score = scores.charAt(i);
                        points += score == 'X' || score == 'T' ? 10 : score - '0';
                    }
                    end.put("result", new JSONObject().put("points", points).put("arrows", scores.length())
                        .put("bowCategory", result.get("bowCategory")));
                }
                series.put(end);
            }
        }
        return new JSONObject().put("series", series);
    }

    @Override public synchronized void close() {
        closed = true;
        super.close();
    }

    private long persist(String entryId, long endId, long ordinal, long revision, String payload) throws IOException {
        SQLiteDatabase db = getWritableDatabase();
        String filter = "room = ? AND entry = ? AND id = ?";
        String[] key = {roomId, entryId, Long.toString(endId)};
        db.beginTransaction();
        boolean added = false;
        try (Cursor rows = db.query("series", new String[] {"ordinal", "revision", "payload"}, filter, key, null, null, null)) {
            boolean existing = rows.moveToFirst();
            if (existing) {
                long accepted = rows.getLong(1);
                if (rows.getLong(0) != ordinal || accepted == revision && !rows.getString(2).equals(payload)) {
                    throw new IOException("Conflicting series revision");
                }
                if (accepted >= revision) {
                    db.setTransactionSuccessful();
                    return accepted;
                }
            }
            ContentValues values = new ContentValues();
            values.put("room", roomId);
            values.put("entry", entryId);
            values.put("id", endId);
            values.put("ordinal", ordinal);
            values.put("revision", revision);
            values.put("payload", payload);
            if (existing) db.update("series", values, filter, key);
            else db.insertOrThrow("series", null, values);
            db.setTransactionSuccessful();
            added = !existing;
            return revision;
        } finally {
            db.endTransaction();
            if (added) acceptedSeries++;
        }
    }

    private static void validateResult(JSONObject result) throws JSONException, IOException {
        if (result.length() != 5) throw new IOException("Unexpected result fields");
        String scores = result.getString("scores");
        String profile = result.getString("targetProfileId");
        String codes;
        switch (profile) {
            case "practice-full-10-v1":
            case "wa-indoor-outer-v1":
            case "wa-indoor-inner-v1": codes = "0-9T"; break;
            case "wa-outdoor-full-v1": codes = "0-9TX"; break;
            case "wa-outdoor-six-v1": codes = "05-9TX"; break;
            case "wa-indoor-five-outer-v1":
            case "wa-indoor-five-inner-v1": codes = "06-9T"; break;
            default: throw new IOException("Unknown target profile");
        }
        double distance = number(result, "distanceMeters");
        double diameter = number(result, "targetDiameterMm");
        if (scores.isEmpty() || scores.length() > 1_000_000 || !scores.matches("[" + codes + "]+") ||
            !Double.isFinite(distance) || distance <= 0 || !validDiameter(profile, diameter) ||
            !result.has("bowCategory") || !result.isNull("bowCategory") &&
                !result.getString("bowCategory").matches("barebow|recurve|compound|traditional|longbow|other")) {
            throw new IOException("Invalid series result");
        }
    }

    private static boolean validDiameter(String profile, double diameter) {
        switch (profile) {
            case "practice-full-10-v1": return diameter > 0 && diameter <= 10_000 && diameter == Math.rint(diameter);
            case "wa-outdoor-full-v1": return diameter == 800 || diameter == 1220;
            case "wa-outdoor-six-v1": return diameter == 800 || diameter == 400;
            case "wa-indoor-outer-v1":
            case "wa-indoor-inner-v1": return diameter == 400 || diameter == 600;
            default: return diameter == 400 || diameter == 600 || diameter == 1220;
        }
    }

    private static double number(JSONObject value, String key) throws JSONException, IOException {
        Object field = value.get(key);
        if (!(field instanceof Number)) throw new IOException("Invalid " + key);
        return ((Number) field).doubleValue();
    }

    private static long positive(JSONObject value, String key) throws JSONException, IOException {
        Object raw = value.get(key);
        if (!(raw instanceof Integer || raw instanceof Long)) throw new IOException("Invalid " + key);
        long number = ((Number) raw).longValue();
        if (number <= 0 || number > 9_007_199_254_740_991L) throw new IOException("Invalid " + key);
        return number;
    }

    private static byte[] receipt(long endId, long revision) {
        return ("{\"endId\":" + endId + ",\"revision\":" + revision + "}").getBytes(StandardCharsets.UTF_8);
    }

    private static String fingerprint(byte[] value) {
        try {
            StringBuilder hex = new StringBuilder(64);
            for (byte item : MessageDigest.getInstance("SHA-256").digest(value)) {
                hex.append(Character.forDigit((item >> 4) & 15, 16)).append(Character.forDigit(item & 15, 16));
            }
            return hex.toString();
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }
}

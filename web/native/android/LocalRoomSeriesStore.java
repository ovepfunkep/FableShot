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
    private final String roomName;
    private boolean closed;
    private volatile int acceptedSeries;

    int acceptedSeries() { return acceptedSeries; }

    synchronized void loadAcceptedCount() {
        try (Cursor rows = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM series WHERE room = ?", new String[] {roomId})) {
            if (rows.moveToFirst()) acceptedSeries = rows.getInt(0);
        }
    }

    LocalRoomSeriesStore(Context context, byte[] roomSecret, String roomName) {
        super(context.getApplicationContext(), "fableshot-local-room-series.db", null, 2);
        roomId = fingerprint(roomSecret);
        this.roomName = roomName;
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE series (room TEXT, entry TEXT, id INTEGER, ordinal INTEGER, revision INTEGER, payload TEXT, "
            + "PRIMARY KEY (room, entry, id), UNIQUE (room, entry, ordinal))");
        createParticipants(db);
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion == 1 && newVersion == 2) createParticipants(db);
        else throw new IllegalStateException("Unknown room database version");
    }

    private static void createParticipants(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE participants (room TEXT NOT NULL, entry TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (room, entry))");
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
            if (end.has("displayName")) {
                Object name = end.get("displayName");
                if (!(name instanceof String) || ((String) name).trim().isEmpty() || ((String) name).length() > 60) {
                    throw new IOException("Invalid display name");
                }
            }
            String entryId = fingerprint(publicKey);
            if (!roomId.equals(end.getString("roomId")) || !entryId.equals(end.getString("entryId"))) {
                throw new IOException("Invalid room or entry");
            }
            if ("join".equals(end.optString("action"))) {
                if (end.length() != (end.has("displayName") ? 5 : 4)) throw new IOException("Invalid participant fields");
                Object bow = end.get("bowCategory");
                if (bow != JSONObject.NULL && (!(bow instanceof String) || !((String) bow).matches("barebow|recurve|compound|traditional|longbow|other"))) {
                    throw new IOException("Invalid bow category");
                }
                JSONObject participant = new JSONObject().put("entryId", entryId).put("bowCategory", bow);
                if (end.has("displayName")) participant.put("displayName", end.getString("displayName"));
                ContentValues values = new ContentValues();
                values.put("room", roomId);
                values.put("entry", entryId);
                values.put("payload", participant.toString());
                if (getWritableDatabase().insertWithOnConflict("participants", null, values, SQLiteDatabase.CONFLICT_REPLACE) == -1) {
                    throw new IOException("Could not save participant");
                }
                return new JSONObject().put("joined", entryId).toString().getBytes(StandardCharsets.UTF_8);
            }
            if (end.length() != (end.has("displayName") ? 7 : 6)) throw new IOException("Unexpected series fields");
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
                    JSONObject projected = new JSONObject().put("points", points).put("arrows", scores.length())
                        .put("bowCategory", result.get("bowCategory"))
                        .put("conditions", new JSONObject().put("distanceMeters", result.get("distanceMeters"))
                            .put("targetProfileId", result.get("targetProfileId")).put("targetDiameterMm", result.get("targetDiameterMm")));
                    if (result.has("spread")) projected.put("spread", result.getJSONObject("spread"))
                        .put("hits", scores.replace("0", "").length());
                    if (result.has("progressBase")) projected.put("progressBase", result.getJSONObject("progressBase"));
                    end.put("result", projected);
                }
                series.put(end);
            }
        }
        org.json.JSONArray participants = new org.json.JSONArray();
        try (Cursor rows = getReadableDatabase().query("participants", new String[] {"payload"}, "room = ?",
                new String[] {roomId}, null, null, "entry")) {
            while (rows.moveToNext()) participants.put(new JSONObject(rows.getString(0)));
        }
        return new JSONObject().put("roomName", roomName).put("cg3", true).put("pg1", true).put("series", series).put("participants", participants);
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
        if (result.length() != 5 + (result.has("spread") ? 1 : 0) + (result.has("progressBase") ? 1 : 0)) throw new IOException("Unexpected result fields");
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
        if (result.has("spread")) {
            JSONObject spread = result.getJSONObject("spread");
            double positions = number(spread, "positions");
            double squaredDistance = number(spread, "squaredDistance");
            if (spread.length() != 3 || !(spread.get("complete") instanceof Boolean) ||
                positions < 0 || positions > scores.replace("0", "").length() || positions != Math.rint(positions) ||
                !Double.isFinite(squaredDistance) || squaredDistance < 0 || squaredDistance > positions * 2 ||
                (positions < 2 && squaredDistance != 0)) throw new IOException("Invalid series spread");
        }
        if (result.has("progressBase")) {
            JSONObject base = result.getJSONObject("progressBase");
            double sessions = number(base, "sessions");
            double arrows = number(base, "arrows");
            double points = number(base, "points");
            if (base.length() != 3 || sessions < 0 || sessions > 5 || sessions != Math.rint(sessions) ||
                arrows < sessions * 12 || arrows > 900_719_925_474_099L || arrows != Math.rint(arrows) ||
                points < 0 || points > arrows * 10 || points != Math.rint(points) || (sessions == 0 && arrows != 0)) {
                throw new IOException("Invalid progress baseline");
            }
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

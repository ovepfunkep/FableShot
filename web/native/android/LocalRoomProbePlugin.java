package app.fableshot.android.webpilot;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "LocalRoomProbe")
public class LocalRoomProbePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private LocalRoomProbe room;
    private LocalRoomSeriesStore store;
    private volatile String invitation;

    @PluginMethod
    public void addresses(PluginCall call) {
        JSArray addresses = new JSArray();
        try {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isVirtual()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (isLocalV4(address)) addresses.put(address.getHostAddress());
                }
            }
            call.resolve(new JSObject().put("addresses", addresses));
        } catch (IOException error) {
            call.reject("Не удалось получить адреса телефона.");
        }
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        if (room != null) {
            status(call);
            return;
        }
        try {
            InetAddress address = parseAddress(call.getString("address"));
            if (NetworkInterface.getByInetAddress(address) == null) throw new IOException("Address is no longer assigned");
            byte[] secret = LocalRoomProbe.randomBytes(24);
            LocalRoomSeriesStore createdStore = new LocalRoomSeriesStore(getContext(), secret);
            boolean preview = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            LocalRoomProbe created = new LocalRoomProbe(address, secret, createdStore::receive, preview);
            store = createdStore;
            room = created;
            invitation = "FS1:" + address.getHostAddress() + ":" + created.port() + ":"
                + Base64.encodeToString(secret, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            new Thread(created::serve, "fableshot-room-probe").start();
            status(call);
        } catch (IOException error) {
            call.reject("Не удалось открыть комнату. Проверьте адрес точки доступа.");
        }
    }

    @PluginMethod
    public void publish(PluginCall call) {
        exchange(call, false);
    }

    @PluginMethod
    public void snapshot(PluginCall call) {
        exchange(call, true);
    }

    private void exchange(PluginCall call, boolean snapshot) {
        worker.execute(() -> {
            String value = call.getString("invitation", "");
            if (!value.matches("FS1:[0-9.]{7,15}:[1-9][0-9]{0,4}:[A-Za-z0-9_-]{32}")) {
                call.reject("Приглашение в комнату недоступно.");
                return;
            }
            String[] fields = value.split(":");
            int port = Integer.parseInt(fields[2]);
            try (Socket socket = value.equals(invitation) ? new Socket() : wifiSocket()) {
                if (port > 65535) throw new IOException("Invalid port");
                JSObject frame = snapshot ? new JSObject().put("action", "snapshot") : new JSObject()
                    .put("payload", call.getString("payload", ""))
                    .put("publicKey", call.getString("publicKey", "")).put("signature", call.getString("signature", ""));
                byte[] request = frame.toString().getBytes(StandardCharsets.UTF_8);
                byte[] reply = LocalRoomProbe.exchange(socket, parseAddress(fields[1]), port, Base64.decode(fields[3], Base64.URL_SAFE), request);
                call.resolve(new JSObject(new String(reply, StandardCharsets.UTF_8)));
            } catch (IOException | org.json.JSONException error) {
                call.reject(snapshot ? "Комната недоступна. Проверьте Wi-Fi." : "Комната не подтвердила сохранение. Серия осталась в очереди.");
            }
        });
    }

    @PluginMethod
    public synchronized void status(PluginCall call) {
        call.resolve(room == null ? new JSObject() : new JSObject().put("invitation", invitation).put("checks", room.checks())
            .put("acceptedSeries", store.acceptedSeries()));
    }

    @PluginMethod
    public synchronized void stop(PluginCall call) {
        closeRoom();
        call.resolve();
    }

    @PluginMethod
    public void check(PluginCall call) {
        worker.execute(() -> {
            String value = call.getString("invitation", "");
            if (!value.matches("FS1:[0-9.]{7,15}:[1-9][0-9]{0,4}:[A-Za-z0-9_-]{32}")) {
                call.reject("Нужен код приглашения из комнаты FableShot.");
                return;
            }
            String[] fields = value.split(":");
            int port = Integer.parseInt(fields[2]);
            InetAddress address;
            try {
                address = parseAddress(fields[1]);
                if (port > 65535) throw new IOException("Invalid port");
            } catch (IOException error) {
                call.reject("В приглашении указан неверный адрес комнаты.");
                return;
            }
            long started = android.os.SystemClock.elapsedRealtime();
            try (Socket socket = wifiSocket()) {
                LocalRoomProbe.check(socket, address, port, Base64.decode(fields[3], Base64.URL_SAFE));
                call.resolve(new JSObject().put("milliseconds", android.os.SystemClock.elapsedRealtime() - started));
            } catch (IOException error) {
                call.reject("Нет ответа от комнаты. Проверьте Wi-Fi и повторите с актуальным приглашением.");
            }
        });
    }

    @SuppressWarnings("deprecation")
    private Socket wifiSocket() throws IOException {
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                return network.getSocketFactory().createSocket();
            }
        }
        throw new IOException("Wi-Fi is disconnected");
    }

    private static InetAddress parseAddress(String value) throws IOException {
        if (value == null || !value.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}")) throw new IOException("Invalid IPv4");
        String[] octets = value.split("\\.");
        byte[] bytes = new byte[4];
        for (int index = 0; index < bytes.length; index++) {
            int octet = Integer.parseInt(octets[index]);
            if (octet > 255) throw new IOException("Invalid octet");
            bytes[index] = (byte) octet;
        }
        InetAddress address = InetAddress.getByAddress(bytes);
        if (!isLocalV4(address)) throw new IOException("Expected private IPv4");
        return address;
    }

    private static boolean isLocalV4(InetAddress address) {
        return address.getAddress().length == 4 && address.isSiteLocalAddress();
    }

    private synchronized void closeRoom() {
        if (room != null) room.close();
        if (store != null) store.close();
        room = null;
        store = null;
        invitation = null;
    }

    @Override protected void handleOnDestroy() {
        closeRoom();
        worker.shutdownNow();
    }
}

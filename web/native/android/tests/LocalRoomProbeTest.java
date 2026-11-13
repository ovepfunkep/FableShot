package app.fableshot.android.webpilot;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class LocalRoomProbeTest {
    public static void main(String[] args) throws Exception {
        InetAddress loopback = InetAddress.getLoopbackAddress();
        byte[] secret = LocalRoomProbe.randomBytes(24);
        int port;
        try (LocalRoomProbe room = new LocalRoomProbe(loopback, secret)) {
            port = room.port();
            Thread listener = new Thread(room::serve);
            listener.start();
            try {
                connect(loopback, port, secret);
                try {
                    connect(loopback, port, LocalRoomProbe.randomBytes(24));
                    throw new AssertionError("The room accepted a different invitation");
                } catch (IOException expected) {
                    if (room.checks() != 1) throw new AssertionError("Rejected check was counted");
                }
                connect(loopback, port, secret);
                if (room.checks() != 2) throw new AssertionError("Reconnect was not counted");
                checkBrowser(loopback, port, secret, "https://ovepfunkep.github.io", true);
                checkBrowser(loopback, port, secret, "https://example.org", false);
                if (room.checks() != 3) throw new AssertionError("Unexpected browser check count");
            } finally {
                room.close();
                listener.join(3000);
                if (listener.isAlive()) throw new AssertionError("Listener did not stop");
            }
        }
        try {
            connect(loopback, port, secret);
            throw new AssertionError("Closed room still accepts connections");
        } catch (IOException expected) {
            System.out.println("Room probe: exchange, wrong invitation, reconnect, and close passed.");
        }
        try (LocalRoomProbe restored = new LocalRoomProbe(loopback, secret, null, false, port)) {
            Thread listener = new Thread(restored::serve);
            listener.start();
            try {
                connect(loopback, port, secret);
                if (restored.checks() != 1) throw new AssertionError("Previous invitation did not work after restart");
            } finally {
                restored.close();
                listener.join(3000);
            }
        }
        try (LocalRoomProbe room = new LocalRoomProbe(loopback, secret, request -> request)) {
            Thread listener = new Thread(room::serve);
            listener.start();
            try (Socket socket = new Socket()) {
                byte[] message = "group series".getBytes(StandardCharsets.UTF_8);
                byte[] received = LocalRoomProbe.exchange(socket, loopback, room.port(), secret, message);
                if (!java.util.Arrays.equals(received, message)) throw new AssertionError("Wrong encrypted exchange reply");
                checkBrowserSeries(loopback, room.port(), secret, message);
            } finally {
                room.close();
                listener.join(3000);
            }
        }
    }

    private static void checkBrowserSeries(InetAddress address, int port, byte[] secret, byte[] message) throws Exception {
        byte[] nonce = LocalRoomProbe.randomBytes(16);
        Mac hmac = Mac.getInstance("HmacSHA256");
        hmac.init(new SecretKeySpec(secret, "HmacSHA256"));
        hmac.update(new byte[] {1, 8});
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(hmac.doFinal(nonce), "AES"), new GCMParameterSpec(128, nonce, 0, 12));
        byte[] request = cipher.doFinal(message);
        try (Socket socket = new Socket(address, port)) {
            socket.setSoTimeout(3000);
            String header = "POST /room/" + HexFormat.of().formatHex(nonce) + " HTTP/1.1\r\nOrigin: https://ovepfunkep.github.io"
                + "\r\nContent-Type: text/plain\r\nContent-Length: " + request.length + "\r\n\r\n";
            socket.getOutputStream().write(header.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().write(request);
            byte[] reply = socket.getInputStream().readAllBytes();
            String response = new String(reply, StandardCharsets.ISO_8859_1);
            if (!response.startsWith("HTTP/1.1 200")) throw new AssertionError(response);
            int start = response.indexOf("\r\n\r\n") + 4;
            hmac.update(new byte[] {1, 9});
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(hmac.doFinal(nonce), "AES"), new GCMParameterSpec(128, reply, start, 12));
            byte[] received = cipher.doFinal(reply, start + 12, reply.length - start - 12);
            if (!java.util.Arrays.equals(message, received)) throw new AssertionError("Wrong encrypted HTTP reply");
        }
    }

    private static void checkBrowser(InetAddress address, int port, byte[] secret, String origin, boolean allowed) throws Exception {
        HexFormat hex = HexFormat.of();
        byte[] nonce = LocalRoomProbe.randomBytes(16);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        mac.update(new byte[] {1, 4});
        String proof = hex.formatHex(mac.doFinal(nonce));
        try (Socket socket = new Socket(address, port)) {
            socket.setSoTimeout(3000);
            String request = "GET /probe/" + hex.formatHex(nonce) + "/" + proof + " HTTP/1.1\r\nOrigin: " + origin + "\r\n\r\n";
            socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
            String response = new String(socket.getInputStream().readAllBytes(), StandardCharsets.US_ASCII);
            mac.update(new byte[] {1, 5});
            String expected = hex.formatHex(mac.doFinal(nonce));
            if (allowed && (!response.startsWith("HTTP/1.1 200") || !response.endsWith(expected))) {
                throw new AssertionError("Browser exchange did not authenticate the response");
            }
            if (!allowed && !response.startsWith("HTTP/1.1 403")) throw new AssertionError("Foreign origin was accepted");
        }
    }

    private static void connect(InetAddress address, int port, byte[] secret) throws IOException {
        try (Socket socket = new Socket()) {
            LocalRoomProbe.check(socket, address, port, secret);
        }
    }
}

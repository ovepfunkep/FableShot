package app.fableshot.android.webpilot;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Connectivity check with a fixed-size exchange and no diary data. */
final class LocalRoomProbe implements AutoCloseable {
    private static final int VERSION = 1;
    private static final int TIMEOUT_MS = 2000;
    private static final int NONCE_BYTES = 16;
    private static final int MAC_BYTES = 32;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String WEB_ORIGIN = "https://ovepfunkep.github.io";
    private static final Pattern WEB_REQUEST = Pattern.compile("GET /probe/([0-9a-f]{32})/([0-9a-f]{64}) HTTP/1\\.[01]");

    private final ServerSocket server;
    private final byte[] secret;
    private final AtomicInteger checks = new AtomicInteger();

    LocalRoomProbe(InetAddress address, byte[] secret) throws IOException {
        this.secret = secret.clone();
        server = new ServerSocket(0, 16, address);
    }

    int port() { return server.getLocalPort(); }
    int checks() { return checks.get(); }

    void serve() {
        while (!server.isClosed()) {
            Socket accepted;
            try {
                accepted = server.accept();
            } catch (IOException error) {
                close();
                return;
            }
            try (Socket socket = accepted) {
                socket.setSoTimeout(TIMEOUT_MS);
                DataInputStream in = new DataInputStream(socket.getInputStream());
                DataOutputStream out = new DataOutputStream(socket.getOutputStream());
                int marker = in.readUnsignedByte();
                if (marker == 'G') {
                    serveBrowser(in, out);
                    continue;
                }
                if (marker != VERSION) continue;
                byte[] clientNonce = read(in, NONCE_BYTES);
                byte[] serverNonce = randomBytes(NONCE_BYTES);
                out.write(serverNonce);
                out.write(proof(secret, 1, clientNonce, serverNonce));
                if (!MessageDigest.isEqual(proof(secret, 2, clientNonce, serverNonce), read(in, MAC_BYTES))) continue;
                checks.incrementAndGet();
                out.write(proof(secret, 3, clientNonce, serverNonce));
            } catch (IOException ignored) {
                // An interrupted or invalid request only ends this connection.
            }
        }
    }

    private void serveBrowser(DataInputStream in, DataOutputStream out) throws IOException {
        StringBuilder headers = new StringBuilder("G");
        long deadline = System.nanoTime() + TIMEOUT_MS * 1_000_000L;
        while (headers.length() < 4096 && System.nanoTime() < deadline) {
            int next = in.read();
            if (next < 0) return;
            headers.append((char) next);
            int length = headers.length();
            if (length >= 4 && headers.substring(length - 4).equals("\r\n\r\n")) break;
        }
        if (!headers.toString().endsWith("\r\n\r\n")) return;
        String[] lines = headers.toString().split("\r\n");
        Matcher request = WEB_REQUEST.matcher(lines[0]);
        boolean allowed = false;
        for (String line : lines) {
            if (line.regionMatches(true, 0, "Origin:", 0, 7) && line.substring(7).trim().equals(WEB_ORIGIN)) allowed = true;
        }
        String body = "";
        if (allowed && request.matches()) {
            byte[] nonce = decodeHex(request.group(1));
            if (MessageDigest.isEqual(proof(secret, 4, nonce, new byte[0]), decodeHex(request.group(2)))) {
                body = encodeHex(proof(secret, 5, nonce, new byte[0]));
                checks.incrementAndGet();
            }
        }
        String status = body.isEmpty() ? "403 Forbidden" : "200 OK";
        out.write(("HTTP/1.1 " + status + "\r\nAccess-Control-Allow-Origin: " + WEB_ORIGIN
            + "\r\nCache-Control: no-store\r\nContent-Type: text/plain\r\nContent-Length: " + body.length()
            + "\r\nConnection: close\r\n\r\n" + body).getBytes(StandardCharsets.US_ASCII));
    }

    private static byte[] decodeHex(String value) {
        byte[] bytes = new byte[value.length() / 2];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16);
        return bytes;
    }

    private static String encodeHex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(Character.forDigit((item >> 4) & 15, 16)).append(Character.forDigit(item & 15, 16));
        return value.toString();
    }

    static void check(Socket socket, InetAddress address, int port, byte[] secret) throws IOException {
        socket.connect(new InetSocketAddress(address, port), TIMEOUT_MS);
        socket.setSoTimeout(TIMEOUT_MS);
        DataOutputStream out = new DataOutputStream(socket.getOutputStream());
        DataInputStream in = new DataInputStream(socket.getInputStream());
        byte[] clientNonce = randomBytes(NONCE_BYTES);
        out.writeByte(VERSION);
        out.write(clientNonce);
        byte[] serverNonce = read(in, NONCE_BYTES);
        if (!MessageDigest.isEqual(proof(secret, 1, clientNonce, serverNonce), read(in, MAC_BYTES))) {
            throw new IOException("Invalid server proof");
        }
        out.write(proof(secret, 2, clientNonce, serverNonce));
        if (!MessageDigest.isEqual(proof(secret, 3, clientNonce, serverNonce), read(in, MAC_BYTES))) {
            throw new IOException("Invalid confirmation");
        }
    }

    static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    private static byte[] read(DataInputStream in, int length) throws IOException {
        byte[] bytes = new byte[length];
        in.readFully(bytes);
        return bytes;
    }

    private static byte[] proof(byte[] secret, int step, byte[] clientNonce, byte[] serverNonce) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            mac.update((byte) VERSION);
            mac.update((byte) step);
            mac.update(clientNonce);
            return mac.doFinal(serverNonce);
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("HmacSHA256 unavailable", error);
        }
    }

    @Override public void close() {
        try {
            server.close();
        } catch (IOException ignored) {
            // The listener is no longer usable.
        }
    }
}

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
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
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
    private static final Pattern WEB_ROOM = Pattern.compile("POST /room/([0-9a-f]{32}) HTTP/1\\.[01]");

    private final ServerSocket server;
    private final byte[] secret;
    private final AtomicInteger checks = new AtomicInteger();
    private final SeriesReceiver receiver;
    private final boolean allowPreviewOrigin;

    interface SeriesReceiver { byte[] receive(byte[] request) throws IOException; }

    LocalRoomProbe(InetAddress address, byte[] secret) throws IOException {
        this(address, secret, null);
    }

    LocalRoomProbe(InetAddress address, byte[] secret, SeriesReceiver receiver) throws IOException {
        this(address, secret, receiver, false);
    }

    LocalRoomProbe(InetAddress address, byte[] secret, SeriesReceiver receiver, boolean allowPreviewOrigin) throws IOException {
        this.secret = secret.clone();
        this.receiver = receiver;
        this.allowPreviewOrigin = allowPreviewOrigin;
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
                if (marker == 'G' || marker == 'P') {
                    serveBrowser(in, out, marker);
                    continue;
                }
                if (marker != VERSION && (marker != 2 || receiver == null)) continue;
                byte[] clientNonce = read(in, NONCE_BYTES);
                byte[] serverNonce = randomBytes(NONCE_BYTES);
                out.write(serverNonce);
                out.write(proof(secret, 1, clientNonce, serverNonce));
                if (!MessageDigest.isEqual(proof(secret, 2, clientNonce, serverNonce), read(in, MAC_BYTES))) continue;
                if (marker == 2) {
                    byte[] request = protect(Cipher.DECRYPT_MODE, secret, clientNonce, serverNonce, readFrame(in, 1_020_000));
                    byte[] reply = receiver.receive(request);
                    byte[] encrypted = protect(Cipher.ENCRYPT_MODE, secret, clientNonce, serverNonce, reply, 7);
                    out.writeInt(encrypted.length);
                    out.write(encrypted);
                    continue;
                }
                checks.incrementAndGet();
                out.write(proof(secret, 3, clientNonce, serverNonce));
            } catch (IOException ignored) {
                // An interrupted or invalid request only ends this connection.
            }
        }
    }

    private void serveBrowser(DataInputStream in, DataOutputStream out, int marker) throws IOException {
        StringBuilder headers = new StringBuilder().append((char) marker);
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
        Matcher roomRequest = WEB_ROOM.matcher(lines[0]);
        String origin = null;
        int length = 0;
        for (String line : lines) {
            if (line.regionMatches(true, 0, "Origin:", 0, 7)) {
                if (origin != null) return;
                origin = line.substring(7).trim();
            }
            if (line.regionMatches(true, 0, "Content-Length:", 0, 15)) {
                String value = line.substring(15).trim();
                if (!value.matches("[1-9][0-9]{0,6}")) return;
                length = Integer.parseInt(value);
            }
        }
        boolean allowed = WEB_ORIGIN.equals(origin) || allowPreviewOrigin && "http://localhost:4173".equals(origin);
        byte[] body = new byte[0];
        if (allowed && receiver != null && roomRequest.matches() && length > 0 && length <= 1_020_000) {
            byte[] nonce = decodeHex(roomRequest.group(1));
            try {
                byte[] encrypted = read(in, length);
                byte[] reply = receiver.receive(protect(Cipher.DECRYPT_MODE, secret, nonce, nonce, encrypted, 8, new byte[0]));
                byte[] iv = randomBytes(12);
                byte[] encryptedReply = protect(Cipher.ENCRYPT_MODE, secret, nonce, iv, reply, 9, new byte[0]);
                byte[] packet = new byte[iv.length + encryptedReply.length];
                System.arraycopy(iv, 0, packet, 0, iv.length);
                System.arraycopy(encryptedReply, 0, packet, iv.length, encryptedReply.length);
                body = packet;
            } catch (IOException | IllegalArgumentException invalid) {
                // Invalid requests receive no data or successful receipt.
            }
        }
        if (allowed && request.matches()) {
            byte[] nonce = decodeHex(request.group(1));
            if (MessageDigest.isEqual(proof(secret, 4, nonce, new byte[0]), decodeHex(request.group(2)))) {
                body = encodeHex(proof(secret, 5, nonce, new byte[0])).getBytes(StandardCharsets.US_ASCII);
                checks.incrementAndGet();
            }
        }
        String status = body.length == 0 ? "403 Forbidden" : "200 OK";
        out.write(("HTTP/1.1 " + status + (allowed ? "\r\nAccess-Control-Allow-Origin: " + origin : "") + "\r\nVary: Origin"
            + "\r\nCache-Control: no-store\r\nContent-Type: " + (marker == 'G' ? "text/plain" : "application/octet-stream")
            + "\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        out.write(body);
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
        exchange(socket, address, port, secret, null);
    }

    static byte[] exchange(Socket socket, InetAddress address, int port, byte[] secret, byte[] request) throws IOException {
        socket.connect(new InetSocketAddress(address, port), TIMEOUT_MS);
        socket.setSoTimeout(TIMEOUT_MS);
        DataOutputStream out = new DataOutputStream(socket.getOutputStream());
        DataInputStream in = new DataInputStream(socket.getInputStream());
        byte[] clientNonce = randomBytes(NONCE_BYTES);
        out.writeByte(request == null ? VERSION : 2);
        out.write(clientNonce);
        byte[] serverNonce = read(in, NONCE_BYTES);
        if (!MessageDigest.isEqual(proof(secret, 1, clientNonce, serverNonce), read(in, MAC_BYTES))) {
            throw new IOException("Invalid server proof");
        }
        out.write(proof(secret, 2, clientNonce, serverNonce));
        if (request != null) {
            byte[] encrypted = protect(Cipher.ENCRYPT_MODE, secret, clientNonce, serverNonce, request);
            out.writeInt(encrypted.length);
            out.write(encrypted);
            return protect(Cipher.DECRYPT_MODE, secret, clientNonce, serverNonce, readFrame(in, 4_000_000), 7);
        }
        if (!MessageDigest.isEqual(proof(secret, 3, clientNonce, serverNonce), read(in, MAC_BYTES))) {
            throw new IOException("Invalid confirmation");
        }
        return null;
    }

    private static byte[] readFrame(DataInputStream in, int limit) throws IOException {
        int size = in.readInt();
        if (size < 1 || size > limit) throw new IOException("Invalid frame size");
        return read(in, size);
    }

    private static byte[] protect(int mode, byte[] secret, byte[] clientNonce, byte[] serverNonce, byte[] frame) throws IOException {
        return protect(mode, secret, clientNonce, serverNonce, frame, 6);
    }

    private static byte[] protect(int mode, byte[] secret, byte[] clientNonce, byte[] serverNonce, byte[] frame, int direction) throws IOException {
        return protect(mode, secret, clientNonce, serverNonce, frame, direction, serverNonce);
    }

    private static byte[] protect(int mode, byte[] secret, byte[] clientNonce, byte[] iv, byte[] frame, int direction, byte[] context) throws IOException {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(mode, new SecretKeySpec(proof(secret, direction, clientNonce, context), "AES"),
                new GCMParameterSpec(128, iv, 0, 12));
            return cipher.doFinal(frame);
        } catch (GeneralSecurityException error) {
            throw new IOException("Series frame could not be authenticated", error);
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

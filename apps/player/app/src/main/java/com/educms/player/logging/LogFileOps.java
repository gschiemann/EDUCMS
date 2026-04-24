package com.educms.player.logging;

import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * File-IO helpers for PlayerLogger, written in Java.
 *
 * Why Java: every Kotlin attempt at rotation / real readRecent tripped
 * the 1.9.24 compiler in a way the unauth'd CI wouldn't surface
 * (confirmed by bisect across 5 iterations — see the git log around
 * commits 3d37c84 → 707a7ef → 598aca1). Java is a first-class
 * citizen alongside Kotlin in Android projects; moving the file
 * operations into a Java class sidesteps the issue entirely without
 * changing the app's architecture.
 *
 * The Kotlin PlayerLogger still:
 *   - owns the logcat forwarding (when()s, Log.d/i/w/e calls)
 *   - owns the init(Context) + logDir caching
 *   - calls into this class for every file write / read / upload
 *
 * All methods are static and defensive — they never throw to the
 * caller. If disk is full, network unreachable, etc., they log to
 * android.util.Log and return gracefully so playback is never
 * impacted.
 */
public final class LogFileOps {
    private static final String TAG = "PlayerLogger";
    private static final String LOG_FILE = "player.log";
    private static final String ROTATED_FILE = "player.1.log";
    private static final long MAX_BYTES = 1_048_576L; // 1 MB

    private static final Object LOCK = new Object();

    private LogFileOps() {}

    /**
     * Append one log line to player.log (UTF-8). If the file crosses
     * MAX_BYTES, move it to player.1.log and start fresh. Previous
     * rotation file (if any) is dropped.
     */
    public static void append(File dir, String line) {
        if (dir == null || line == null) return;
        synchronized (LOCK) {
            try {
                File active = new File(dir, LOG_FILE);
                try (OutputStream out = new FileOutputStream(active, true);
                     Writer w = new OutputStreamWriter(out, StandardCharsets.UTF_8)) {
                    w.write(line);
                }
                if (active.length() >= MAX_BYTES) {
                    rotate(dir);
                }
            } catch (IOException ex) {
                Log.e(TAG, "append failed: " + ex.getMessage());
            }
        }
    }

    /**
     * Drop the old rotated file, rename the active file to rotated.
     * Caller MUST hold LOCK (we do, from append).
     */
    private static void rotate(File dir) {
        try {
            File rotated = new File(dir, ROTATED_FILE);
            if (rotated.exists()) {
                if (!rotated.delete()) {
                    Log.w(TAG, "rotate: could not delete old " + ROTATED_FILE);
                }
            }
            File active = new File(dir, LOG_FILE);
            if (active.exists()) {
                if (!active.renameTo(rotated)) {
                    Log.w(TAG, "rotate: renameTo failed");
                }
            }
        } catch (Exception ex) {
            Log.w(TAG, "rotate error: " + ex.getMessage());
        }
    }

    /**
     * Return the last `maxLines` log lines, oldest first. Reads both
     * rotated + active file so the trace is chronological (rotated is
     * older, active is newer).
     */
    public static String readRecent(File dir, int maxLines) {
        if (dir == null) return "(logger not initialised)";
        synchronized (LOCK) {
            try {
                List<String> lines = new ArrayList<>();
                File rotated = new File(dir, ROTATED_FILE);
                if (rotated.exists()) {
                    readAllLinesInto(rotated, lines);
                }
                File active = new File(dir, LOG_FILE);
                if (active.exists()) {
                    readAllLinesInto(active, lines);
                }
                if (lines.isEmpty()) return "(no log file yet)";
                int start = Math.max(0, lines.size() - maxLines);
                StringBuilder sb = new StringBuilder();
                for (int i = start; i < lines.size(); i++) {
                    sb.append(lines.get(i));
                    if (i < lines.size() - 1) sb.append('\n');
                }
                return sb.toString();
            } catch (IOException ex) {
                return "(readRecent failed: " + ex.getMessage() + ")";
            }
        }
    }

    private static void readAllLinesInto(File f, List<String> out) throws IOException {
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                out.add(line);
            }
        }
    }

    /**
     * POST the tail of the log file to the API. Runs on a short-lived
     * daemon thread — caller doesn't block. Body is limited to
     * MAX_UPLOAD_BYTES; the newest part of the trace is kept.
     *
     * Non-fatal on failure; logs outcome via android.util.Log and
     * returns immediately.
     *
     * @param apiRoot e.g. "https://api.example.com"
     * @param path    e.g. "/api/v1/player-logs/<screenId>"
     * @param authBearer device JWT for Authorization; null to skip
     */
    public static void uploadAsync(final File dir, final String apiRoot,
                                    final String path, final String authBearer) {
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String body = readRecent(dir, 2000);
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    final int MAX_UPLOAD_BYTES = 512_000;
                    if (bytes.length > MAX_UPLOAD_BYTES) {
                        // Keep the TAIL so we see the most-recent activity.
                        int offset = bytes.length - MAX_UPLOAD_BYTES;
                        byte[] trimmed = new byte[MAX_UPLOAD_BYTES];
                        System.arraycopy(bytes, offset, trimmed, 0, MAX_UPLOAD_BYTES);
                        bytes = trimmed;
                    }
                    String cleanApi = apiRoot == null ? "" : apiRoot.replaceAll("/+$", "");
                    URL url = new URL(cleanApi + path);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    try {
                        conn.setRequestMethod("POST");
                        conn.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
                        conn.setRequestProperty("Content-Length", String.valueOf(bytes.length));
                        if (authBearer != null && !authBearer.isEmpty()) {
                            conn.setRequestProperty("Authorization", "Bearer " + authBearer);
                        }
                        conn.setConnectTimeout(10_000);
                        conn.setReadTimeout(15_000);
                        conn.setDoOutput(true);
                        try (OutputStream out = conn.getOutputStream()) {
                            out.write(bytes);
                        }
                        int code = conn.getResponseCode();
                        if (code >= 200 && code < 300) {
                            Log.i(TAG, "uploadRecent: HTTP " + code + " (" + bytes.length + "B sent)");
                        } else {
                            Log.w(TAG, "uploadRecent: server HTTP " + code);
                        }
                    } finally {
                        try { conn.disconnect(); } catch (Exception ignored) {}
                    }
                } catch (Exception ex) {
                    Log.w(TAG, "uploadRecent failed: " + (ex.getMessage() == null ? "unknown" : ex.getMessage()));
                }
            }
        }, "PlayerLogger-upload");
        t.setDaemon(true);
        t.start();
    }
}

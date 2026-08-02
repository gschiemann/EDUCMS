package com.educms.player.serial

import android.util.Base64
import android.webkit.WebView
import com.educms.player.logging.PlayerLogger
import java.io.FileInputStream
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * VenueOS Sports Sprint 13 Phase 2 — native RS232 reader for the
 * Goodview ECBox3576 (and any Android box with a real /dev/ttyS*
 * tty exposed off a hardware UART).
 *
 * Replaces the Beelink-mini-PC + USB-RS232-dongle setup with a
 * single industrial box that:
 *   1. Reads the CTS Gen 6 console's RS232 output directly from a
 *      Phoenix terminal block (no USB adapter).
 *   2. Hosts our Player APK on Chrome WebView (renders the ribbon
 *      template, fires cinematic celebrations, pushes HDMI to the
 *      NovaStar VX400 Pro processor).
 *   3. Bridges parsed game state through the WebView's existing
 *      `@JavascriptInterface` surface so the web layer (CtsBridge.tsx
 *      + CtsParser) treats native serial identically to Web Serial.
 *
 * ============================================================
 * V1 implementation — file-IO + shell-out config
 * ============================================================
 *
 * The Android serial port world has two camps:
 *
 *   A. JNI + termios   — open() + tcsetattr() to configure baud /
 *                        parity / data bits + read() loop. The
 *                        de-facto "android-serialport-api" pattern
 *                        (Cedric Priscal, 2009; MIT). Requires NDK
 *                        + native .so files per ABI.
 *   B. exec stty       — Runtime.exec(["/system/bin/stty","-F",
 *                        "/dev/ttyS1","9600","cs8","parenb","-parodd",
 *                        "-cstopb"]) + open the tty as a FileInputStream.
 *                        Pure Java; needs busybox / toybox on the device
 *                        (every modern Android ships toybox). ARGV ARRAY
 *                        ONLY — never a `sh -c` command string; see the
 *                        AND-003 note on runStty().
 *
 * We use (B) for Phase 1. Simpler to ship, no NDK churn, and the
 * stty command is available on every Android 7+ build that ships
 * toybox (Goodview included). If a deploy ever lacks toybox we'll
 * drop in (A) as a fallback.
 *
 * ============================================================
 * Permission model
 * ============================================================
 *
 * /dev/ttyS* is typically root:dialout 0660 — our app uid (u0_aXX)
 * can't open it directly. THREE viable paths:
 *
 *   1. Device Owner provisioning — our Manager APK is already
 *      provisioned as device owner for OTA self-install. Device
 *      Owner can su -c "chmod 0666 /dev/ttyS*" on every boot.
 *      Cleanest for production fleets.
 *   2. Goodview kernel patch — ask Goodview to relax permissions on
 *      the Phoenix-terminal tty devices to 0666 in their image.
 *      Best for a Goodview-blessed SKU.
 *   3. Vendor SDK (`com.goodview.serial.*`) — if Goodview ships an
 *      AIDL service that exposes the RS232 ports to non-root apps,
 *      swap (B)'s file IO for their API in this class. Same JS
 *      surface either way.
 *
 * The first-time `connect()` call probes for read access and returns
 * a structured error so the operator sees "permission denied — apply
 * Device Owner provisioning or ask your reseller for a permissions
 * patch" rather than a stack trace.
 *
 * ============================================================
 * Bytes → WebView path
 * ============================================================
 *
 * Native reader → 4KB read buffer → base64-encode → invoke
 * `window.__ctsSerialBytes('<base64>')` via WebView.evaluateJavascript.
 * Web layer in CtsBridge.tsx registers that global; the existing
 * CtsParser in @cms/scoreboard-cts handles the rest (decode, emit
 * snapshots, POST to /game-state, etc.).
 *
 * Base64 is required because @JavascriptInterface can't pass a Java
 * byte[] to JS directly — strings only. Base64 inflates 33% but at
 * 9600 baud × 8 data bits × 1 stop = ~960 bytes/sec the encoder is
 * trivially cheap (~1280 bytes/sec encoded; the JS layer handles
 * decode in <0.1ms per chunk).
 */
class SerialPortBridge(
    private val getWebView: () -> WebView?,
) {
    private val tag = "CtsSerial"
    private val running = AtomicBoolean(false)
    @Volatile private var stream: FileInputStream? = null
    @Volatile private var devicePath: String = ""
    @Volatile private var bytesRead: Long = 0L
    @Volatile private var lastByteAtMs: Long = 0L
    @Volatile private var lastError: String? = null

    /**
     * Build-time / runtime gate. Returns true if the APK build was
     * compiled with native-serial support AND the device has a tty
     * we can plausibly read. The web layer calls this on mount to
     * pick the native path over Web Serial.
     *
     * For Phase 1 we return true unconditionally — the apk SHIPS with
     * the bridge available; whether the operator wires it up is a
     * separate decision (connect() call). A future build-flag could
     * gate this off for non-ECBox SKUs that should always use Web
     * Serial.
     */
    fun isAvailable(): Boolean = true

    /**
     * Open + start reading. Idempotent: a second connect() while
     * already running is a no-op (returns the current state JSON).
     * Returns a JSON string the web layer parses:
     *   {ok:true,  devicePath, baudRate, ...}    on success
     *   {ok:false, code, message}                on failure
     */
    @Synchronized
    fun connect(
        devicePath: String,
        baudRate: Int,
        dataBits: Int,
        stopBits: Int,
        parity: String,
    ): String {
        if (running.get()) {
            return jsonOk(this.devicePath, baudRate, dataBits, stopBits, parity, "already_open")
        }

        // ⚠️ SECURITY (AND-003, 2026-08-01) — `devicePath` is ATTACKER-
        // CONTROLLED. The @JavascriptInterface that reaches this method is
        // attached to the main player WebView and is therefore callable
        // from EVERY frame it loads, including the operator-authored and
        // third-party HTML the player mounts in iframes. The old comment
        // here claimed the bridge was "only exposed to our trusted player
        // web origin" — that was never true (see AND-002).
        //
        // The old check was `startsWith("/dev/tty")` and the value was
        // then INTERPOLATED INTO A SHELL LINE (`sh -c "stty -F $path …"`),
        // so `/dev/tty;id>/data/…` executed arbitrary commands as our app
        // uid straight from JavaScript.
        //
        // Now: a strict literal allowlist (see DEVICE_PATH_RE) applied to
        // BOTH the raw input and its canonical path, so `..` traversal and
        // a symlink pointing somewhere else are both refused — and no
        // shell is used at all (see runStty).
        val canonicalPath = canonicalDevicePath(devicePath)
        if (canonicalPath == null) {
            lastError = "Invalid device path (allowed: /dev/ttyS<n>, /dev/ttyUSB<n>, /dev/ttyACM<n>)"
            PlayerLogger.w(tag, "REFUSED serial connect — device path failed the allowlist")
            return jsonError("invalid_path", lastError!!)
        }

        // Configure the tty via stty. Most CTS Gen 6 consoles speak
        // 9600 8-E-1 (8 data bits, EVEN parity, 1 stop bit) on a 1/4"
        // mono jack. The caller passes those defaults from the web
        // layer; we exec the stty binary directly (argv array, NO shell)
        // so we don't have to bind termios via JNI.
        //
        // stty flags:
        //   <baudrate>    — set baud rate (9600/19200/etc.)
        //   cs7|cs8       — 7 or 8 data bits
        //   -parenb       — no parity
        //   parenb        — parity enabled
        //   parodd        — odd parity (parenb without parodd = even)
        //   cstopb        — 2 stop bits
        //   -cstopb       — 1 stop bit
        //   raw           — no line discipline (we want the bytes
        //                   straight through, not cooked)
        //   -echo         — don't echo input back
        //
        // Every token below is generated by US from typed parameters —
        // `baudRate` is an Int (JS cannot smuggle a metacharacter through
        // an Int @JavascriptInterface parameter) and `parity` only selects
        // between fixed literals. Combined with the device-path allowlist
        // above, nothing attacker-controlled reaches the argv.
        val sttyFlags = ArrayList<String>()
        sttyFlags.add(baudRate.toString())
        sttyFlags.add(if (dataBits == 7) "cs7" else "cs8")
        when (parity.lowercase()) {
            "even" -> { sttyFlags.add("parenb"); sttyFlags.add("-parodd") }
            "odd" -> { sttyFlags.add("parenb"); sttyFlags.add("parodd") }
            else -> sttyFlags.add("-parenb")
        }
        sttyFlags.add(if (stopBits == 2) "cstopb" else "-cstopb")
        sttyFlags.add("raw")
        sttyFlags.add("-echo")

        val sttyResult = runStty(canonicalPath, sttyFlags)
        if (!sttyResult.ok) {
            lastError = "stty failed: ${sttyResult.message}"
            PlayerLogger.w(tag, lastError!!)
            return jsonError("stty_failed", lastError!!)
        }

        // Open the tty for reading. /dev/ttyS* is usually root:dialout
        // 0660 — if we can't read it, return a structured error so the
        // operator sees a useful message (vs an SElinux EPERM mystery).
        val fis: FileInputStream = try {
            FileInputStream(canonicalPath)
        } catch (e: IOException) {
            lastError = "open() failed: ${e.message}"
            PlayerLogger.w(tag, "$lastError — Try Device Owner provisioning OR ask reseller for permissions patch")
            return jsonError("open_failed", lastError!!)
        } catch (e: SecurityException) {
            lastError = "open() denied: ${e.message}"
            PlayerLogger.w(tag, lastError!!)
            return jsonError("permission_denied", lastError!!)
        }

        this.stream = fis
        this.devicePath = canonicalPath
        this.bytesRead = 0L
        this.lastByteAtMs = 0L
        this.lastError = null
        running.set(true)
        PlayerLogger.i(tag, "Opened $canonicalPath @ ${baudRate}-${dataBits}-${parity}-${stopBits}")

        // Spin up the read loop. Single daemon thread per port; we
        // never expect multiple consoles per box for v1. If we ever do
        // (multi-sport venue with parallel CTS + Daktronics consoles)
        // we'll instance one bridge per port.
        thread(name = "CtsSerialReader", isDaemon = true) { readLoop() }

        return jsonOk(canonicalPath, baudRate, dataBits, stopBits, parity, "opened")
    }

    /**
     * AND-003 — device-path allowlist.
     *
     * Returns the canonical path when [raw] names a real serial tty we are
     * willing to open, or null otherwise. Both the raw string AND its
     * canonical form must match [DEVICE_PATH_RE], so neither `..`
     * traversal (`/dev/tty../../etc/passwd`) nor a symlink planted at an
     * allowlisted name can redirect us somewhere else.
     */
    private fun canonicalDevicePath(raw: String?): String? {
        if (raw == null) return null
        val trimmed = raw.trim()
        if (!DEVICE_PATH_RE.matches(trimmed)) return null
        val canonical = try {
            java.io.File(trimmed).canonicalPath
        } catch (_: Exception) {
            return null
        }
        if (!DEVICE_PATH_RE.matches(canonical)) return null
        return canonical
    }

    /**
     * Stop the read loop + close the tty. Idempotent.
     */
    @Synchronized
    fun disconnect(): String {
        if (!running.get()) return jsonOk(devicePath, 0, 0, 0, "n/a", "already_closed")
        running.set(false)
        try { stream?.close() } catch (_: IOException) { /* ignore */ }
        stream = null
        PlayerLogger.i(tag, "Closed $devicePath")
        return jsonOk(devicePath, 0, 0, 0, "n/a", "closed")
    }

    /**
     * Read live status — for the kiosk info overlay + ops dashboard.
     * Returns JSON: {open, devicePath, bytesRead, lastByteAt, lastError}.
     */
    fun status(): String {
        val sb = StringBuilder()
        sb.append("{\"open\":").append(running.get())
        sb.append(",\"devicePath\":\"").append(jsonEscape(devicePath)).append('"')
        sb.append(",\"bytesRead\":").append(bytesRead)
        sb.append(",\"lastByteAt\":").append(lastByteAtMs)
        if (lastError != null) {
            sb.append(",\"lastError\":\"").append(jsonEscape(lastError!!)).append('"')
        }
        sb.append('}')
        return sb.toString()
    }

    // ─── Read loop ─────────────────────────────────────────────

    private fun readLoop() {
        val buf = ByteArray(BUF_SIZE)
        val fis = stream ?: return
        while (running.get()) {
            val n: Int = try {
                fis.read(buf)
            } catch (e: IOException) {
                lastError = "read() error: ${e.message}"
                PlayerLogger.w(tag, lastError!!)
                running.set(false)
                break
            }
            if (n < 0) {
                // EOF — kernel closed the tty (cable yanked, USB hot-
                // unplugged, etc.). Loop exits; web layer's auto-
                // reconnect will trigger a new connect() call.
                PlayerLogger.i(tag, "EOF on $devicePath")
                running.set(false)
                break
            }
            if (n == 0) continue
            bytesRead += n
            lastByteAtMs = System.currentTimeMillis()
            // Hand the chunk to the web layer. base64 encode because
            // @JavascriptInterface can't pass byte arrays.
            val b64 = Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
            postBytesToWebView(b64)
        }
        // Best-effort close on exit.
        try { fis.close() } catch (_: IOException) { /* ignore */ }
        stream = null
    }

    /**
     * Marshal the bytes back to JS via the WebView. Has to run on the
     * UI thread because WebView APIs are not thread-safe.
     */
    private fun postBytesToWebView(base64: String) {
        val wv = getWebView() ?: return
        wv.post {
            // Single string literal; base64 has no quotes / backslashes
            // so we don't need to escape further. The JS layer's
            // `window.__ctsSerialBytes` is registered by CtsBridge.tsx
            // on mount; if it isn't present (e.g. operator opened a
            // non-CTS page), the call is a harmless no-op.
            wv.evaluateJavascript(
                "if(window.__ctsSerialBytes)window.__ctsSerialBytes('$base64');",
                null,
            )
        }
    }

    // ─── stty exec (argv only — never a shell) ──────────────────

    /**
     * Run `stty -F <devicePath> <flags…>`.
     *
     * ⚠️ SECURITY (AND-003) — NO SHELL. The previous implementation built
     * a `/system/bin/sh -c "stty -F $devicePath $flags"` command STRING,
     * which turned the JS-supplied device path into arbitrary command
     * execution as our app uid. We now exec an ARGUMENT ARRAY: there is no
     * shell to parse metacharacters, so even if the allowlist above ever
     * regressed, `;`, `|`, `$(…)` and friends would be passed to stty as
     * literal argv entries instead of being interpreted.
     *
     * Two argv forms are attempted, both shell-free:
     *   1. `/system/bin/stty …`         — the toybox symlink present on
     *                                     essentially every Android 8+ build.
     *   2. `/system/bin/toybox stty …`  — the multicall binary itself, for
     *                                     images that ship toybox without
     *                                     the individual symlinks (some
     *                                     Android 7 / stripped OEM ROMs).
     *
     * Do NOT "simplify" this back to `sh -c` with an interpolated string.
     */
    private fun runStty(devicePath: String, flags: List<String>): SttyResult {
        val direct = ArrayList<String>()
        direct.add("/system/bin/stty")
        direct.add("-F")
        direct.add(devicePath)
        direct.addAll(flags)

        val viaToybox = ArrayList<String>()
        viaToybox.add("/system/bin/toybox")
        viaToybox.add("stty")
        viaToybox.add("-F")
        viaToybox.add(devicePath)
        viaToybox.addAll(flags)

        val first = execArgv(direct)
        if (first.ok) return first
        val second = execArgv(viaToybox)
        if (second.ok) return second
        return SttyResult(false, "${first.message}; toybox: ${second.message}")
    }

    private fun execArgv(argv: List<String>): SttyResult {
        return try {
            val proc = Runtime.getRuntime().exec(argv.toTypedArray())
            val finished = proc.waitFor()
            val stderr = proc.errorStream.bufferedReader().readText().trim()
            if (finished == 0) {
                SttyResult(true, "ok")
            } else {
                SttyResult(false, "exit=$finished${if (stderr.isNotEmpty()) " · $stderr" else ""}")
            }
        } catch (e: Exception) {
            SttyResult(false, "exec failed: ${e.message}")
        }
    }

    private data class SttyResult(val ok: Boolean, val message: String)

    // ─── JSON helpers ───────────────────────────────────────────
    // Tiny hand-rolled JSON — avoiding a dependency for a 3-field
    // response. Quote-escape carefully so a device path with a "
    // can't break the response (defensive — paths never have quotes).

    private fun jsonOk(
        devicePath: String,
        baudRate: Int,
        dataBits: Int,
        stopBits: Int,
        parity: String,
        state: String,
    ): String {
        return "{\"ok\":true,\"state\":\"${jsonEscape(state)}\"" +
            ",\"devicePath\":\"${jsonEscape(devicePath)}\"" +
            ",\"baudRate\":$baudRate,\"dataBits\":$dataBits" +
            ",\"stopBits\":$stopBits,\"parity\":\"${jsonEscape(parity)}\"}"
    }

    private fun jsonError(code: String, message: String): String {
        return "{\"ok\":false,\"code\":\"${jsonEscape(code)}\",\"message\":\"${jsonEscape(message)}\"}"
    }

    private fun jsonEscape(s: String): String {
        // Minimal escape for the fields we control. Belt-and-suspenders.
        val sb = StringBuilder()
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    companion object {
        /**
         * AND-003 — the ONLY device paths this bridge will ever open.
         * Anchored, literal, numeric suffix only. Do not loosen this to a
         * prefix/`startsWith` test: the value arrives from JavaScript.
         */
        private val DEVICE_PATH_RE = Regex("^/dev/tty(S|USB|ACM)[0-9]{1,3}\$")

        // 4KB chunks. CTS Gen 6 sends ~10 modules/sec × ~6 bytes each
        // = ~60 bytes/sec. A 4KB buffer is overkill but cheap; the
        // FileInputStream.read() call blocks until data arrives so
        // we're not burning CPU on idle.
        private const val BUF_SIZE = 4096
    }
}

/** Quiet wrapper for callers that want a no-arg disconnect helper. */
fun SerialPortBridge.safeClose(): String {
    return try { disconnect() } catch (_: Throwable) { "{\"ok\":false,\"code\":\"close_failed\"}" }
}

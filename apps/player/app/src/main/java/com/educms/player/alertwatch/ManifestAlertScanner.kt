package com.educms.player.alertwatch

import java.io.InputStream
import java.io.InterruptedIOException

/**
 * ONE FACT OUT OF A MANIFEST, WITHOUT BUILDING THE MANIFEST (2026-10-05,
 * player 1.1.22 — the pure reader behind [NativeAlertWatchPolicy]).
 *
 * The native alert watch asks a screen's own manifest one question: "is an
 * emergency alert active for this screen?". A manifest can be several
 * hundred kilobytes of playlists, templates and zone configs, and the watch
 * asks on a box whose panel is off — so this reads the body as a STREAM,
 * keeps nothing but a nesting depth and one short key, and stops the moment
 * the answer is ALERT. No org.json object graph, no android.*, no clock.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE PREDICATE — the page's, read in the "be visible" direction
 * ─────────────────────────────────────────────────────────────────────
 * `apps/web/src/app/player/page.tsx`, `applyManifest`, "EMERGENCY FIRST":
 *
 *   • top-level `isEmergency === true` (what the API emits today), else
 *   • the legacy nested envelope: a top-level `emergency` / `override`
 *     OBJECT with `active === true`, `status === "ACTIVE"`, or a truthy
 *     `type`.
 *
 * This is a SUPERSET of that rule in exactly two shapes the server never
 * emits: a duplicated key (the page's JSON.parse keeps the last one; we
 * answer ALERT if ANY says so) and both envelopes present (the page reads
 * only the first truthy one; we read both). Every ambiguity resolves toward
 * the alert, because the watch can only ever RAISE: a wrong ALERT wakes a
 * panel, a wrong NO_ALERT leaves a lockdown on a dark screen.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT IS *NOT* AN ANSWER
 * ─────────────────────────────────────────────────────────────────────
 * [ManifestScan.NO_ALERT] is only ever returned for a COMPLETE, well-formed
 * JSON object: a body cut off mid-transfer, a captive portal's HTML and a
 * proxy's error page are all [ManifestScan.MALFORMED], which the policy
 * reads as "unknown" — never as an all-clear. ALERT, by contrast, is
 * returned at first sight: `{"screenId":…,"isEmergency":true` followed by a
 * dropped connection is still the server saying there is an alert.
 */
enum class ManifestScan {
    /** The body states an active alert. */
    ALERT,

    /** A complete, well-formed manifest object that states no alert. */
    NO_ALERT,

    /** Not a complete JSON object: truncated, garbled, or not JSON at all. */
    MALFORMED,

    /** Bigger than the cap before the answer was known. */
    TOO_LARGE,
}

object ManifestAlertScanner {

    /**
     * Read [body] and answer. Never returns more than it proved; an
     * `IOException` from the stream itself (timeout, reset, the deadline in
     * [DeadlineInputStream]) is the caller's — it is a failed poll, not a
     * manifest.
     *
     * @param maxBytes the most bytes this will consume before giving up with
     *        [ManifestScan.TOO_LARGE].
     */
    fun scan(body: InputStream, maxBytes: Long): ManifestScan {
        val json = JsonScan(body, maxBytes)
        return try {
            scanTopLevel(json)
        } catch (_: JsonScan.Malformed) {
            ManifestScan.MALFORMED
        } catch (_: JsonScan.TooLarge) {
            ManifestScan.TOO_LARGE
        }
    }

    private fun scanTopLevel(json: JsonScan): ManifestScan {
        if (json.firstToken() != JsonScan.LBRACE) return ManifestScan.MALFORMED
        var b = json.nextToken()
        if (b != JsonScan.RBRACE) {
            while (true) {
                if (b != JsonScan.QUOTE) return ManifestScan.MALFORMED
                val key = json.string(KEY_KEEP)
                if (json.nextToken() != JsonScan.COLON) return ManifestScan.MALFORMED
                val v = json.nextToken()
                when (key) {
                    // The flat field the API emits. Only the JSON literal
                    // `true` counts — the page tests `=== true`, so the
                    // string "true" and the number 1 are not an alert.
                    "isEmergency" ->
                        if (v == 't'.code) {
                            json.literal("rue")
                            return ManifestScan.ALERT
                        } else {
                            json.skipValue(v, depth = 1)
                        }
                    // The legacy envelope the page still accepts.
                    "emergency", "override" ->
                        if (v == JsonScan.LBRACE) {
                            if (envelopeSaysAlert(json)) return ManifestScan.ALERT
                        } else {
                            json.skipValue(v, depth = 1)
                        }
                    else -> json.skipValue(v, depth = 1)
                }
                val sep = json.nextToken()
                if (sep == JsonScan.RBRACE) break
                if (sep != JsonScan.COMMA) return ManifestScan.MALFORMED
                b = json.nextToken()
            }
        }
        // Anything but whitespace after the closing brace is not a manifest
        // (the page's `response.json()` would throw on it too).
        if (json.nextToken() != JsonScan.END) return ManifestScan.MALFORMED
        return ManifestScan.NO_ALERT
    }

    /**
     * The legacy `emergency` / `override` object, its `{` already consumed.
     * Returns true at the first member that makes it an alert; a false
     * return means the whole object was read and none did.
     */
    private fun envelopeSaysAlert(json: JsonScan): Boolean {
        var b = json.nextToken()
        if (b == JsonScan.RBRACE) return false
        while (true) {
            if (b != JsonScan.QUOTE) throw JsonScan.Malformed("expected a member name")
            val key = json.string(KEY_KEEP)
            if (json.nextToken() != JsonScan.COLON) throw JsonScan.Malformed("expected ':'")
            val v = json.nextToken()
            val alert = when (key) {
                "active" ->
                    if (v == 't'.code) {
                        json.literal("rue")
                        true
                    } else {
                        json.skipValue(v, depth = 2)
                        false
                    }
                "status" ->
                    if (v == JsonScan.QUOTE) {
                        json.string(KEY_KEEP) == "ACTIVE"
                    } else {
                        json.skipValue(v, depth = 2)
                        false
                    }
                // JavaScript truthiness, which is what the page applies.
                "type" -> truthy(json, v)
                else -> {
                    json.skipValue(v, depth = 2)
                    false
                }
            }
            if (alert) return true
            val sep = json.nextToken()
            if (sep == JsonScan.RBRACE) return false
            if (sep != JsonScan.COMMA) throw JsonScan.Malformed("expected ',' or '}'")
            b = json.nextToken()
        }
    }

    /** Is the value starting at [first] truthy in JavaScript? Consumes it. */
    private fun truthy(json: JsonScan, first: Int): Boolean = when (first) {
        JsonScan.QUOTE -> {
            json.string(0)
            json.lastStringLength > 0
        }
        't'.code -> {
            json.literal("rue")
            true
        }
        'f'.code -> {
            json.literal("alse")
            false
        }
        'n'.code -> {
            json.literal("ull")
            false
        }
        JsonScan.LBRACE, JsonScan.LBRACKET -> {
            json.skipValue(first, depth = 2)
            true
        }
        else -> json.number(first)
    }

    /** Longest key this file compares against is `isEmergency` (11). */
    private const val KEY_KEEP = 16
}

/**
 * The few JSON primitives the alert watch needs, over a byte stream.
 *
 * Bytes, not characters: every structural character of JSON is ASCII, and a
 * multi-byte UTF-8 sequence is made only of bytes ≥ 0x80, so a quote or a
 * backslash seen here is always a real one. A non-ASCII byte inside a kept
 * string becomes U+FFFD — it can never make a string equal to one of the
 * ASCII names this package looks for, and never makes a string empty.
 *
 * Strict where it is cheap (member/element separators, string escapes,
 * literals, nesting depth, nothing after the document) because the caller
 * treats "well-formed and silent" as NO ALERT; a number's digits are the one
 * thing only loosely checked.
 */
internal class JsonScan(private val input: InputStream, private val maxBytes: Long) {

    /** Control flow only — no stack trace is ever read. */
    class Malformed(why: String) : Exception(why) {
        override fun fillInStackTrace(): Throwable = this
    }

    class TooLarge : Exception("larger than the byte cap") {
        override fun fillInStackTrace(): Throwable = this
    }

    private val buf = ByteArray(BUFFER_BYTES)
    private var pos = 0
    private var end = 0
    private var eof = false

    /** Bytes consumed so far. */
    var consumed: Long = 0L
        private set

    /** Length of the string [string] read last (one count per byte of a non-ASCII char). */
    var lastStringLength: Int = 0
        private set

    private fun fill(): Boolean {
        if (pos < end) return true
        if (eof) return false
        var n = input.read(buf, 0, buf.size)
        if (n == 0) {
            // A stream may not answer 0 for a non-empty read. One that does
            // must not be able to spin this loop: ask for a single byte, which
            // blocks until there is one or the stream ends.
            val one = input.read()
            if (one < 0) {
                n = -1
            } else {
                buf[0] = one.toByte()
                n = 1
            }
        }
        if (n < 0) {
            eof = true
            return false
        }
        pos = 0
        end = n
        return true
    }

    /** The next byte (0‥255), consumed; [END] at the end of the body. */
    fun next(): Int {
        if (!fill()) return END
        consumed += 1
        if (consumed > maxBytes) throw TooLarge()
        return buf[pos++].toInt() and 0xFF
    }

    /** The next byte without consuming it; [END] at the end of the body. */
    fun peek(): Int = if (fill()) buf[pos].toInt() and 0xFF else END

    /** Skip JSON whitespace; the first byte after it (consumed), or [END]. */
    fun nextToken(): Int {
        while (true) {
            val b = next()
            if (b != SPACE && b != TAB && b != LF && b != CR) return b
        }
    }

    /**
     * [nextToken] for the very start of a document: also steps over a UTF-8
     * byte-order mark, which the page's `response.json()` tolerates.
     */
    fun firstToken(): Int {
        val b = nextToken()
        if (b != 0xEF) return b
        if (next() != 0xBB || next() != 0xBF) throw Malformed("stray bytes before the document")
        return nextToken()
    }

    /**
     * A string whose opening quote has been consumed.
     *
     * @param keep return the text when it is at most this many characters;
     *        a longer string (or `keep == 0`) is consumed and answers null.
     */
    fun string(keep: Int): String? {
        val sb = if (keep > 0) StringBuilder(keep) else null
        var length = 0
        while (true) {
            val b = next()
            val ch: Char = when {
                b == END -> throw Malformed("unterminated string")
                b == QUOTE -> {
                    lastStringLength = length
                    return if (sb != null && length <= keep) sb.toString() else null
                }
                b == BACKSLASH -> escape()
                b < 0x20 -> throw Malformed("raw control character in a string")
                b < 0x80 -> b.toChar()
                else -> REPLACEMENT
            }
            if (length < Int.MAX_VALUE) length += 1
            if (sb != null && length <= keep) sb.append(ch)
        }
    }

    private fun escape(): Char = when (val e = next()) {
        QUOTE -> '"'
        BACKSLASH -> '\\'
        '/'.code -> '/'
        'b'.code -> '\b'
        'f'.code -> '\u000C'
        'n'.code -> '\n'
        'r'.code -> '\r'
        't'.code -> '\t'
        'u'.code -> {
            var v = 0
            repeat(4) { v = v * 16 + hex(next()) }
            v.toChar()
        }
        else -> throw Malformed("bad escape (${if (e == END) "end of body" else "byte $e"})")
    }

    private fun hex(b: Int): Int = when (b) {
        in '0'.code..'9'.code -> b - '0'.code
        in 'a'.code..'f'.code -> b - 'a'.code + 10
        in 'A'.code..'F'.code -> b - 'A'.code + 10
        else -> throw Malformed("bad \\u escape")
    }

    /** The rest of a literal whose first letter has been consumed (`rue`, `alse`, `ull`). */
    fun literal(rest: String) {
        for (c in rest) if (next() != c.code) throw Malformed("bad literal")
        // `true` followed by more letters or digits is not the literal `true`.
        val after = peek()
        val delimited = after == END || after == COMMA || after == RBRACE || after == RBRACKET ||
            after == SPACE || after == TAB || after == LF || after == CR
        if (!delimited) throw Malformed("bad literal")
    }

    /**
     * A number whose first byte ([first]) has been consumed.
     *
     * @return whether it is non-zero — JavaScript truthiness, for the legacy
     *         envelope's `type`. Judged on the digits before any exponent, so
     *         `0e9` is zero and `0.001` is not.
     */
    fun number(first: Int): Boolean {
        if (first != MINUS && first !in DIGIT_0..DIGIT_9) {
            throw Malformed("unexpected byte where a value should start")
        }
        var digits = if (first == MINUS) 0 else 1
        var nonZero = first in DIGIT_1..DIGIT_9
        var inExponent = false
        while (true) {
            val b = peek()
            when {
                b in DIGIT_0..DIGIT_9 -> {
                    digits += 1
                    if (!inExponent && b != DIGIT_0) nonZero = true
                }
                b == 'e'.code || b == 'E'.code -> inExponent = true
                b == '.'.code || b == '+'.code || b == MINUS -> Unit
                else -> break
            }
            next()
        }
        if (digits == 0) throw Malformed("a sign with no digits")
        return nonZero
    }

    /** Consume the value that starts with [first], whatever it is. */
    fun skipValue(first: Int, depth: Int) {
        when (first) {
            LBRACE -> skipObject(depth + 1)
            LBRACKET -> skipArray(depth + 1)
            QUOTE -> string(0)
            't'.code -> literal("rue")
            'f'.code -> literal("alse")
            'n'.code -> literal("ull")
            else -> number(first)
        }
    }

    private fun skipObject(depth: Int) {
        if (depth > MAX_DEPTH) throw Malformed("nested deeper than $MAX_DEPTH")
        var b = nextToken()
        if (b == RBRACE) return
        while (true) {
            if (b != QUOTE) throw Malformed("expected a member name")
            string(0)
            if (nextToken() != COLON) throw Malformed("expected ':'")
            skipValue(nextToken(), depth)
            val sep = nextToken()
            if (sep == RBRACE) return
            if (sep != COMMA) throw Malformed("expected ',' or '}'")
            b = nextToken()
        }
    }

    private fun skipArray(depth: Int) {
        if (depth > MAX_DEPTH) throw Malformed("nested deeper than $MAX_DEPTH")
        var b = nextToken()
        if (b == RBRACKET) return
        while (true) {
            skipValue(b, depth)
            val sep = nextToken()
            if (sep == RBRACKET) return
            if (sep != COMMA) throw Malformed("expected ',' or ']'")
            b = nextToken()
        }
    }

    companion object {
        const val END = -1
        const val LBRACE = '{'.code
        const val RBRACE = '}'.code
        const val LBRACKET = '['.code
        const val RBRACKET = ']'.code
        const val QUOTE = '"'.code
        const val COLON = ':'.code
        const val COMMA = ','.code
        private const val BACKSLASH = '\\'.code
        private const val MINUS = '-'.code
        private const val SPACE = ' '.code
        private const val TAB = '\t'.code
        private const val LF = '\n'.code
        private const val CR = '\r'.code
        private const val DIGIT_0 = '0'.code
        private const val DIGIT_1 = '1'.code
        private const val DIGIT_9 = '9'.code
        private const val REPLACEMENT = '�'
        private const val BUFFER_BYTES = 8 * 1024

        /**
         * A real manifest nests about ten levels (playlists → template →
         * zones → defaultConfig → …). The bound exists so a hostile body
         * cannot recurse this reader off its stack.
         */
        const val MAX_DEPTH = 128
    }
}

/**
 * A stream that will not keep reading past a deadline.
 *
 * `HttpURLConnection.readTimeout` bounds ONE read, so a proxy that answers
 * its headers and then drips a byte every nine seconds never trips it —
 * player rule 4's lesson ("`fetch()` resolves at headers"), on the native
 * side. This bounds the body as a whole. The clock is passed in, so the rule
 * has a JVM test.
 */
internal class DeadlineInputStream(
    private val inner: InputStream,
    private val deadlineMs: Long,
    private val nowMs: () -> Long,
) : InputStream() {

    override fun read(): Int {
        check()
        return inner.read()
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        check()
        return inner.read(b, off, len)
    }

    override fun close() = inner.close()

    private fun check() {
        if (nowMs() >= deadlineMs) {
            throw InterruptedIOException("the manifest body was still arriving at the deadline")
        }
    }
}

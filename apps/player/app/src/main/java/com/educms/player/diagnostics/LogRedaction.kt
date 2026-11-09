package com.educms.player.diagnostics

/**
 * ON-DEVICE REDACTION of an on-demand log bundle (2026-11-08, "Get recent
 * logs"). The first of two passes — the API redacts again
 * (`screen-diagnostics/diagnostics-redact.ts`) — so a credential never
 * leaves the panel in the clear even if the API's pass regressed.
 *
 * Removed:
 *   • JWT-shaped strings (`eyJ…`)                  → [credential]
 *   • `Bearer <anything>`                          → Bearer [credential]
 *   • URL query strings / fragments / userinfo     → scheme://host/path?[redacted]
 *   • `token=`, `password:`, `secret=`, `api_key=`… → key=[redacted]
 *   • Wi-Fi credentials (`psk=`, `passphrase`, `preSharedKey`, `wpa…`)
 *   • an SSID / BSSID value                        → ssid=[redacted]
 *   • e-mail addresses                             → [email]
 *   • opaque runs of 40+ base64/hex characters     → [redacted]
 *
 * Linear by construction: each line is held to [MAX_LINE] first and no
 * pattern nests a quantifier. Pure — LogRedactionTest pins it.
 */
object LogRedaction {

    const val MAX_LINE = 4096

    private val JWT = Regex("""\beyJ[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*){0,2}""")
    private val BEARER = Regex("""(?i)\b(bearer)\s+[^\s"',;]+""")
    private val URL = Regex("""(?i)\b([a-z][a-z0-9+.-]{0,31}://)([^\s/?#@]*@)?([^\s?#]*)([?#]\S*)?""")
    private val SECRET_PAIR = Regex(
        """(?i)\b([\w-]{0,40}?(?:token|jwt|secret|passw(?:or)?d|api[-_]?key|signature|cookie|authorization|session[-_]?id))(\s{0,3}["']?\s{0,3}[:=]\s{0,3}["']?)(?!\[(?:redacted|credential)\])[^\s"'&,;)}\]]+""",
    )
    private val WIFI_SECRET = Regex(
        """(?i)\b(psk|wpa[-_]?psk|wpa2?|passphrase|pre[-_]?shared[-_]?key|sae[-_]?password|wep[-_]?key\d?)(\s{0,3}["']?\s{0,3}[:=]\s{0,3}["']?)(?!\[redacted\])[^\s"',;)}\]]+""",
    )
    private val SSID = Regex("""(?i)\b(b?ssid)(\s{0,3}[:=]\s{0,3})("[^"\n]{0,64}"|[^\s,;)}\]]+)""")
    private val EMAIL = Regex("""[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}""")
    private val OPAQUE = Regex("""[A-Za-z0-9_+=-]{40,}""")

    fun line(raw: String): String {
        val bounded = if (raw.length > MAX_LINE) raw.substring(0, MAX_LINE) + " [line truncated]" else raw
        var s = JWT.replace(bounded, "[credential]")
        s = BEARER.replace(s) { "${it.groupValues[1]} [credential]" }
        s = URL.replace(s) { m ->
            val scheme = m.groupValues[1]
            val userinfo = m.groupValues[2]
            val rest = m.groupValues[3]
            val query = m.groupValues[4]
            scheme + (if (userinfo.isNotEmpty()) "[redacted]@" else "") + rest +
                (if (query.isNotEmpty()) "${query[0]}[redacted]" else "")
        }
        s = SECRET_PAIR.replace(s) { "${it.groupValues[1]}${it.groupValues[2]}[redacted]" }
        s = WIFI_SECRET.replace(s) { "${it.groupValues[1]}${it.groupValues[2]}[redacted]" }
        s = SSID.replace(s) { "${it.groupValues[1]}${it.groupValues[2]}[redacted]" }
        s = EMAIL.replace(s, "[email]")
        s = OPAQUE.replace(s, "[redacted]")
        return s
    }

    fun text(raw: String): String = raw.split('\n').joinToString("\n") { line(it) }

    /** The newest [maxBytes] of [raw] (UTF-8), cut at a line boundary, then redacted. */
    fun tail(raw: String, maxBytes: Int): String {
        val redacted = text(raw)
        val bytes = redacted.toByteArray(Charsets.UTF_8)
        if (bytes.size <= maxBytes) return redacted
        val cut = String(bytes, bytes.size - maxBytes, maxBytes, Charsets.UTF_8)
        val nl = cut.indexOf('\n')
        return "[earlier lines dropped — size cap]\n" + if (nl >= 0) cut.substring(nl + 1) else cut
    }
}

package com.educms.player.diagnostics

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.StatFs
import android.os.SystemClock
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.educms.player.webcompat.LegacyEnginePolicy
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URL
import java.security.cert.X509Certificate
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import javax.net.ssl.HttpsURLConnection

/**
 * The self-test's probes (2026-11-08). Every one is a READ, bounded by
 * [DiagnosticsPolicy.TIMEOUT_MS], run off the main thread, and reports codes
 * and numbers only — never a URL, a full address, an SSID or a message.
 *
 * Nothing here touches playback, the WebView, the content store or the
 * emergency tier. The write test writes and deletes ONE 64 KiB scratch file
 * in the app's cache dir.
 */
object DiagnosticsProbes {

    private val pool: ExecutorService = Executors.newFixedThreadPool(2, ThreadFactory { r ->
        Thread(r, "diag-probe").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }
    })

    data class Storage(val freeBytes: Long, val totalBytes: Long, val writeOk: Boolean?, val writeMs: Long?)

    /** StatFs of the app's data dir + a 64 KiB write/fsync/read/delete in the cache dir. */
    fun storage(ctx: Context, writeTest: Boolean = true, timeoutMs: Long = DiagnosticsPolicy.TIMEOUT_MS): Storage? = runCatching {
        val st = StatFs(ctx.filesDir.absolutePath)
        val free = st.availableBytes
        val total = st.totalBytes
        var ok: Boolean? = null
        var ms: Long? = null
        if (writeTest) {
            val t0 = SystemClock.elapsedRealtime()
            ok = DiagnosticsPolicy.bounded(pool, timeoutMs) { writeScratch(ctx.cacheDir) } ?: false
            ms = SystemClock.elapsedRealtime() - t0
        }
        Storage(free, total, ok, ms)
    }.getOrNull()

    private fun writeScratch(dir: File): Boolean {
        val f = File(dir, "venueos-write-test.bin")
        try {
            val data = ByteArray(DiagnosticsPolicy.WRITE_TEST_BYTES) { (it and 0xff).toByte() }
            FileOutputStream(f).use { out -> out.write(data); out.fd.sync() }
            val back = f.readBytes()
            return back.size == data.size && back.contentEquals(data)
        } finally {
            runCatching { f.delete() }
        }
    }

    /** One HTTPS GET of `<apiRoot>/api/v1/health` (liveness, always 200): reachability, latency, the server clock, the TLS chain. */
    fun apiAndTls(apiRoot: String): Pair<JSONObject, JSONObject> {
        val api = JSONObject()
        val tls = JSONObject()
        val clock = JSONObject()
        var err = "unknown"
        val result = DiagnosticsPolicy.bounded(pool, DiagnosticsPolicy.TIMEOUT_MS, { err = it }) {
            val t0 = SystemClock.elapsedRealtime()
            val conn = URL("${apiRoot.trimEnd('/')}/api/v1/health").openConnection() as HttpURLConnection
            try {
                conn.connectTimeout = 5_000
                conn.readTimeout = 5_000
                conn.instanceFollowRedirects = false
                conn.requestMethod = "GET"
                val code = conn.responseCode
                val ms = SystemClock.elapsedRealtime() - t0
                val serverDate = conn.getHeaderFieldDate("Date", 0L)
                var chain = -1
                var leafDays: Long? = null
                if (conn is HttpsURLConnection) {
                    val certs = runCatching { conn.serverCertificates }.getOrNull()
                    chain = certs?.size ?: -1
                    val leaf = certs?.firstOrNull() as? X509Certificate
                    if (leaf != null) leafDays = (leaf.notAfter.time - System.currentTimeMillis()) / 86_400_000L
                }
                runCatching { conn.inputStream.use { it.read(ByteArray(256)) } }
                arrayOf(code.toLong(), ms, serverDate, chain.toLong(), leafDays ?: Long.MIN_VALUE)
            } finally {
                conn.disconnect()
            }
        }
        if (result == null) {
            api.put("ok", false).put("error", err)
            // A handshake failure is the cert store / clock check failing.
            val tlsFail = err.contains("SSL", ignoreCase = true) || err.contains("Certificate", ignoreCase = true)
            tls.put("ok", if (tlsFail) false else JSONObject.NULL).put("error", if (tlsFail) err else JSONObject.NULL)
        } else {
            val code = result[0].toInt()
            api.put("ok", code in 200..299).put("status", code).put("ms", result[1])
            tls.put("ok", true)
            if (result[3] >= 0) tls.put("chainLength", result[3])
            if (result[4] != Long.MIN_VALUE) tls.put("leafDaysLeft", result[4])
            if (result[2] > 0L) clock.put("skewMs", System.currentTimeMillis() - result[2])
        }
        api.put("clock", clock)
        return api to tls
    }

    /** DNS of the API host: ok, latency, how many addresses — never the addresses. */
    fun dns(apiRoot: String): JSONObject {
        val out = JSONObject()
        val host = runCatching { URL(apiRoot).host }.getOrNull()
        if (host.isNullOrBlank()) return out.put("ok", false).put("error", "no-host")
        var err = "unknown"
        val t0 = SystemClock.elapsedRealtime()
        val addrs = DiagnosticsPolicy.bounded(pool, DiagnosticsPolicy.TIMEOUT_MS, { err = it }) { InetAddress.getAllByName(host) }
        val ms = SystemClock.elapsedRealtime() - t0
        return if (addrs == null || addrs.isEmpty()) out.put("ok", false).put("ms", ms).put("error", err)
        else out.put("ok", true).put("ms", ms).put("count", addrs.size)
    }

    /** ConnectivityManager facts: transport, validated, captive portal, Wi-Fi RSSI / link speed, masked IP + gateway. */
    @Suppress("DEPRECATION")
    fun network(ctx: Context): JSONObject {
        val out = JSONObject()
        runCatching {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val net = cm.activeNetwork
            val caps = net?.let { cm.getNetworkCapabilities(it) }
            if (net == null || caps == null) {
                out.put("transport", "none").put("ipKind", "none")
                return out
            }
            val transport = when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                else -> "other"
            }
            out.put("transport", transport)
            out.put("validated", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
            out.put("captivePortal", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL))
            if (transport == "wifi") {
                val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                val info = runCatching { wm?.connectionInfo }.getOrNull()
                val rssi = info?.rssi
                if (rssi != null && rssi in -127..0) out.put("rssi", rssi)
                val speed = info?.linkSpeed
                if (speed != null && speed > 0) out.put("linkMbps", speed)
            } else {
                val down = caps.linkDownstreamBandwidthKbps
                if (down > 0) out.put("linkMbps", down / 1000)
            }
            val lp: LinkProperties? = cm.getLinkProperties(net)
            val v4 = lp?.linkAddresses?.mapNotNull { it.address as? Inet4Address }?.firstOrNull()?.hostAddress
            out.put("ipKind", DiagnosticsPolicy.ipv4Kind(v4).wire)
            DiagnosticsPolicy.maskIpv4(v4)?.let { out.put("ip", it) }
            val gw = lp?.routes?.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.hostAddress
            DiagnosticsPolicy.maskIpv4(gw)?.let { out.put("gateway", it) }
        }
        return out
    }

    /** The system WebView's version and whether the legacy-engine layer (#258) is installed on this unit. */
    fun webview(ctx: Context): JSONObject {
        val out = JSONObject()
        runCatching {
            val vn = if (Build.VERSION.SDK_INT >= 26) WebViewCompat.getCurrentWebViewPackage(ctx)?.versionName else null
            val major = DiagnosticsPolicy.webViewMajor(vn)
            if (vn != null) out.put("versionName", vn.take(32).filter { it.isLetterOrDigit() || it == '.' })
            if (major != null) out.put("major", major)
            val docStart = runCatching { WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) }.getOrDefault(false)
            out.put("legacyLayer", LegacyEnginePolicy.decide(major, docStart) == LegacyEnginePolicy.Decision.INSTALL)
        }
        return out
    }
}

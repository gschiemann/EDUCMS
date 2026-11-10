package com.educms.player.health

import com.educms.player.ProcessExitPolicy
import com.educms.player.diagnostics.LogRedaction
import org.json.JSONArray
import org.json.JSONObject

/**
 * THE PREVIOUS PROCESS'S DEATH, OFF THE DEVICE (2026-11-09, player stability
 * gap 8). Pure — `ExitEvidencePolicyTest`.
 *
 * Before: `ProcessExitDiagnostics` read the OS's `ApplicationExitInfo` at
 * boot (API 30+) and wrote `PLAYER_PROCESS_EXIT` lines into the on-device log
 * only. They left the box only if someone ran "Get recent logs". An ANR, a
 * low-memory kill or a native crash was invisible to the fleet;
 * `CrashUploader` covers JVM crashes only.
 *
 * Now, two device-authenticated channels:
 *  1. SUMMARY — the last [KEEP] kept exits (time, reason, importance,
 *     pss/rss, the sanitised system description) are remembered at boot and
 *     ride every signed native heartbeat in `x-venueos-process-health`
 *     (`exits`), stored in `nativeRuntimeReport.processHealth`.
 *  2. TRACE — an ANR or a native crash is also posted ONCE to the existing
 *     `POST /screens/status/:fp/crash-report` route WITH the device
 *     credential, so it lands in `lastCrash*` (shown on the dashboard) with
 *     `lastCrashAuthenticated = true`. For an ANR the stack is the `"main"`
 *     thread's section of the OS trace only, redacted with `LogRedaction`,
 *     capped at [TRACE_CAP]. A JVM crash (`REASON_CRASH`) is not re-sent:
 *     `CrashUploader` already sent it as the process died. A low-memory or
 *     OEM kill is not a crash and is never posted there (summary only).
 *  3. At most [MAX_PENDING] traces are waiting at any time (oldest dropped);
 *     each is sent until the server answers 2xx or a 4xx other than 429, then
 *     forgotten — acknowledgement by value (the exit's own timestamp).
 */
object ExitEvidencePolicy {

    const val KEEP = 4
    const val MAX_PENDING = 2
    const val TRACE_CAP = 6 * 1024
    /** How much of the OS trace we read at most, before cutting out "main". */
    const val TRACE_READ_CAP = 256 * 1024

    data class Exit(
        val atMs: Long,
        val reason: Int,
        val status: Int,
        val importance: Int,
        val pssKb: Long,
        val rssKb: Long,
        val description: String?,
    )

    fun shouldPostTrace(reason: Int): Boolean =
        reason == ProcessExitPolicy.REASON_ANR || reason == ProcessExitPolicy.REASON_CRASH_NATIVE

    /** The remembered summary: newest [KEEP] of old + new, by time, deduplicated by time. */
    fun merge(previousJson: String?, fresh: List<Exit>): JSONArray {
        val all = LinkedHashMap<Long, JSONObject>()
        parseArray(previousJson).forEach { all[it.optLong("at")] = it }
        fresh.forEach { all[it.atMs] = summary(it) }
        val out = JSONArray()
        all.values.sortedByDescending { it.optLong("at") }.take(KEEP).forEach { out.put(it) }
        return out
    }

    fun summary(e: Exit): JSONObject = JSONObject()
        .put("at", e.atMs)
        .put("r", e.reason)
        .put("st", e.status)
        .put("imp", e.importance)
        .put("pssKb", e.pssKb.coerceAtLeast(0))
        .put("rssKb", e.rssKb.coerceAtLeast(0))
        .apply {
            val d = ProcessExitPolicy.sanitizeDescription(e.description)
            if (d.isNotEmpty()) put("desc", LogRedaction.line(d).take(ProcessExitPolicy.DESCRIPTION_CAP))
        }

    /** Pending trace timestamps after adding [fresh]: newest [MAX_PENDING]. */
    fun pendingAfter(previous: List<Long>, fresh: List<Exit>): List<Long> =
        (previous + fresh.filter { shouldPostTrace(it.reason) }.map { it.atMs })
            .distinct().sortedDescending().take(MAX_PENDING)

    /** Rule 3 — is the trace done with after this HTTP code (-1 = no answer)? */
    fun acknowledged(code: Int): Boolean = code in 200..299 || (code in 400..499 && code != 429)

    /**
     * The `"main"` thread's section of an ANR trace (the OS's
     * `traces.txt` format: each thread starts with `"name" prio=…` and ends
     * at a blank line), redacted and capped. Null when there is none.
     */
    fun mainThreadSection(trace: String?): String? {
        if (trace.isNullOrEmpty()) return null
        val lines = trace.split('\n')
        val start = lines.indexOfFirst { it.startsWith("\"main\"") }
        if (start < 0) return null
        val out = StringBuilder()
        for (i in start until lines.size) {
            val l = lines[i].trimEnd('\r')
            if (i > start && l.isBlank()) break
            out.append(l).append('\n')
            if (out.length > TRACE_CAP * 2) break
        }
        return LogRedaction.text(out.toString().trimEnd()).take(TRACE_CAP)
    }

    fun crashMessage(e: Exit): String {
        val kind = if (e.reason == ProcessExitPolicy.REASON_ANR) "ANR" else "native crash"
        val d = ProcessExitPolicy.sanitizeDescription(e.description)
        return LogRedaction.line("$kind (previous process, exited at=${e.atMs}, status=${e.status})" +
            if (d.isEmpty()) "" else ": $d").take(500)
    }

    fun crashBody(e: Exit, stack: String?, versionName: String, versionCode: Int): JSONObject = JSONObject()
        .put("source", "player")
        .put("versionName", versionName)
        .put("versionCode", versionCode)
        .put("message", crashMessage(e))
        .put("stack", stack ?: "")

    private fun parseArray(json: String?): List<JSONObject> = runCatching {
        if (json.isNullOrBlank()) return emptyList()
        val a = JSONArray(json)
        (0 until a.length()).mapNotNull { a.optJSONObject(it) }
    }.getOrDefault(emptyList())
}

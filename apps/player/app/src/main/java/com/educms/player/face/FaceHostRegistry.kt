package com.educms.player.face

import org.json.JSONArray
import org.json.JSONObject

/**
 * WHAT IS ACTUALLY HOSTED — contract §6.
 *
 * A read-only snapshot, published by [FaceHostController] and read by
 * `DisplayCapabilityProbe`. One direction only: the probe's own header says
 * THIS CLASS ONLY READS, and reading a registry somebody else publishes
 * preserves that. The probe must never be able to drive a face.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ "HOSTED" IS NOT "RENDERING" (player rule 5 — never equate signals)
 * ─────────────────────────────────────────────────────────────────────
 * `hosted` means a `Presentation` window is SHOWING on that display id. It
 * says nothing about whether the page inside it parsed, booted, registered
 * or painted. Each face proves THAT for itself, the same way every other
 * screen does: its own `POST /screens/:id/render-proof` against its own
 * `Screen` row. Reading a hosted face as a healthy face would re-create the
 * exact class of bug the boot-proof work exists to kill.
 *
 * A SHORTFALL — a face that was asked for and has no panel — is a NAMED,
 * honest state (`no-eligible-second-display` / `fewer-panels-than-faces`),
 * never an offline screen and never silence.
 *
 * Reached by the dashboard for free: `probeDisplay` already exists on both
 * bridge transports, `displayCapabilityReport.ts` already POSTs the whole
 * parsed probe root, and `boundInventoryReport` already persists it. No new
 * bridge method, no new endpoint.
 */
object FaceHostRegistry {

    /** Immutable, so a reader can never observe a half-written snapshot. */
    data class Snapshot(
        /** Faces this box has been asked to host, primary included. */
        val requested: List<Int>,
        /** faceIndex → displayId of the Presentation actually showing. */
        val hosted: Map<Int, Int>,
        /** Requested faces with no panel to live on. */
        val shortfall: List<Int>,
        /** Why, when [shortfall] is non-empty. Null otherwise. */
        val reason: String?,
        /** `SystemClock.elapsedRealtime()` of the last publish. 0 = never. */
        val updatedAtMs: Long,
    ) {
        companion object {
            /**
             * The state before anything has looked. Deliberately NOT
             * "face 0 hosted": on a box that never starts the controller,
             * claiming a hosted face would be an invented fact.
             */
            fun empty() = Snapshot(emptyList(), emptyMap(), emptyList(), null, 0L)
        }
    }

    @Volatile
    private var snapshot: Snapshot = Snapshot.empty()

    fun publish(
        requested: List<Int>,
        hosted: Map<Int, Int>,
        shortfall: List<Int>,
        reason: String?,
        nowMs: Long,
    ) {
        snapshot = Snapshot(
            requested = requested.sorted(),
            hosted = hosted.toSortedMap(),
            shortfall = shortfall.sorted(),
            reason = if (shortfall.isEmpty()) null else reason,
            updatedAtMs = nowMs,
        )
    }

    fun snapshot(): Snapshot = snapshot

    /** Test/teardown seam. Never called on the hot path. */
    fun reset() {
        snapshot = Snapshot.empty()
    }

    /**
     * The probe's `faces` section.
     *
     * `{ requested:[0,1], hosted:[{face:0,displayId:0},…], shortfall:[],
     *    reason:null, observed:true }`
     *
     * `observed:false` distinguishes "this APK never ran the face
     * controller" from "it ran and found nothing" — the same distinction
     * `reportsSecondDisplay` makes for a device that has never reported.
     * "We do not know" must never render as a claim.
     */
    fun snapshotJson(): JSONObject {
        val s = snapshot
        val hosted = JSONArray()
        for ((face, displayId) in s.hosted) {
            hosted.put(JSONObject().put("face", face).put("displayId", displayId))
        }
        return JSONObject()
            .put("observed", s.updatedAtMs > 0L)
            .put("requested", JSONArray(s.requested))
            .put("hosted", hosted)
            .put("shortfall", JSONArray(s.shortfall))
            .put("reason", s.reason ?: JSONObject.NULL)
    }
}

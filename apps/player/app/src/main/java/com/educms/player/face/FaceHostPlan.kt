package com.educms.player.face

/**
 * What the face host should DO, as pure math (2026-09-19).
 *
 * WHY THIS FILE EXISTS. The 1.1.18 verifiers found four defects in
 * `FaceHostController` and noted that every one of them lived in the single
 * file with no behavioural test: the controller is welded to `DisplayManager`
 * and `Presentation`, so nothing about hot-plug, re-enumeration or a failed
 * attach could be exercised off a device. `FaceDisplayMap` was well tested —
 * but it is the MAP, and the bugs were in the code that APPLIES the map.
 *
 * So the deciding moves here and the controller only carries the decision out.
 *
 * THE THREE RULES, each of which the first cut got wrong:
 *
 *  1. A FACE IS BOUND TO A DISPLAY, AND THE BINDING IS A FACT. `bound` is the
 *     displayId each Presentation was actually shown on. The first cut kept
 *     only "face N is hosted", so when HDMI re-enumerated (display 1 → 2) the
 *     face stayed in the map, every re-sync was a no-op, and the pane was dark
 *     forever. Here a face whose target differs from its binding is detached
 *     AND re-attached on the new panel.
 *
 *  2. REPORT THE BINDING, NEVER THE INTENT. The first cut published
 *     `displayForFace(...)` recomputed at report time — what the map WOULD
 *     choose, not where the window IS. A report that is not evidence.
 *
 *  3. NEVER SILENCE. A face whose panel exists but whose Presentation threw was
 *     reported as neither hosted nor short — it simply vanished. Shortfall is
 *     `requested − bound`, and each entry carries WHY.
 */
internal object FaceHostPlan {

    /** The panel exists and is eligible, but hosting on it failed. */
    const val REASON_HOST_FAILED = "panel-present-but-host-failed"

    /**
     * The face's page loaded WITHOUT proving it is isolated from the front's
     * localStorage. Hosting it would let the back overwrite the front's device
     * token and clear its cached emergency, so the face is refused instead.
     */
    const val REASON_NOT_ISOLATED = "face-storage-not-isolated"

    /** JS evaluated after every face page load; see [isolationProven]. */
    const val ISOLATION_PROBE_JS = "window.__eduFaceStorage"

    /**
     * Did the page prove it is running as THIS face, isolated?
     *
     * `evaluateJavascript` hands back JSON text: `1` for the number one, `null`
     * for undefined (an old shell with no isolation script at all), `-1` when
     * the script refused. Only the exact integer of this host's own index is a
     * yes — a string "1", a float, another face's index and every parse
     * failure are all NO, because a wrong "yes" here is a second writer into
     * the front's credential store.
     */
    fun isolationProven(jsResult: String?, faceIndex: Int): Boolean {
        if (faceIndex < 1) return false
        val text = jsResult?.trim() ?: return false
        if (!Regex("^[0-9]{1,2}$").matches(text)) return false
        return text.toIntOrNull() == faceIndex
    }

    data class Detach(val face: Int, val why: String)
    data class Attach(val face: Int, val displayId: Int)
    data class Plan(val detach: List<Detach>, val attach: List<Attach>)

    fun reconcile(
        displays: List<FaceDisplay>,
        requestedFaces: List<Int>,
        bound: Map<Int, Int>,
        /** Faces that may not be (re)attached right now — e.g. isolation cooldown. */
        blocked: Set<Int> = emptySet(),
    ): Plan {
        val detach = mutableListOf<Detach>()
        for ((face, boundId) in bound.toSortedMap()) {
            val target = FaceDisplayMap.displayForFace(displays, face)
            when {
                face !in requestedFaces -> detach += Detach(face, "no longer requested")
                target == null -> detach += Detach(face, "its panel is gone")
                target.displayId != boundId ->
                    detach += Detach(face, "its panel moved from display $boundId to display ${target.displayId}")
            }
        }
        val leaving = detach.map { it.face }.toSet()
        val attach = mutableListOf<Attach>()
        for (face in requestedFaces.sorted()) {
            val target = FaceDisplayMap.displayForFace(displays, face) ?: continue
            if (bound.containsKey(face) && face !in leaving) continue
            if (face in blocked) continue
            attach += Attach(face, target.displayId)
        }
        return Plan(detach, attach)
    }

    /**
     * Every requested face that is not actually on a panel, with the reason.
     *
     * A face with no eligible panel takes the map's reason; a face whose panel
     * EXISTS but is not bound is a host failure — the rk3288 two-WebView OOM
     * lands exactly here, and it must not read as "all fine".
     */
    fun shortfall(
        displays: List<FaceDisplay>,
        requestedFaces: List<Int>,
        bound: Map<Int, Int>,
        /** face → the specific reason it is being refused, when there is one. */
        blocked: Map<Int, String> = emptyMap(),
    ): Map<Int, String> {
        val out = sortedMapOf<Int, String>()
        for (face in requestedFaces) {
            if (bound.containsKey(face)) continue
            val refusal = blocked[face]
            out[face] = refusal ?:
                if (FaceDisplayMap.displayForFace(displays, face) == null) FaceDisplayMap.shortfallReason(displays)
                else REASON_HOST_FAILED
        }
        return out
    }

    /** One reason for the registry's single field: a host failure outranks a missing panel. */
    fun summaryReason(shortfall: Map<Int, String>): String? = when {
        shortfall.isEmpty() -> null
        shortfall.values.any { it == REASON_NOT_ISOLATED } -> REASON_NOT_ISOLATED
        shortfall.values.any { it == REASON_HOST_FAILED } -> REASON_HOST_FAILED
        else -> shortfall.values.first()
    }
}

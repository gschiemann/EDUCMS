package com.educms.player.standby

/**
 * WHICH MECHANISM MAY PUT A PANEL BACK TO SLEEP AFTER AN ALL-CLEAR?
 * (2026-10-11 — a life-safety fix to the 1.1.23 restore.)
 *
 * ═════════════════════════════════════════════════════════════════════
 * THE HOLE
 * ═════════════════════════════════════════════════════════════════════
 * 1.1.23's restore called the display registry's BLANK with no filter, so
 * on a box enrolled as device admin it ran `lockNow()`. That is the exact
 * mechanism that, on 2026-08-25, latched a Goodview G43 (Android 11, iFPDOS
 * firmware with a vendor device owner) and a Mobile A-Frame (Android 7.1,
 * rk3288) into a VENDOR standby: glass dark, IR remote and power button dead,
 * WAKE delivered and useless, mains power-cycle required. The server has
 * refused POWER_OFF on the admin-lock family ever since, and routes every
 * on/off schedule soft — but the restore never asked the server. On a panel
 * that latches, the NEXT alert's wake is the WAKE that was "delivered and
 * useless": an alert that cannot reach the glass. Several 1.1.23 screens
 * carry exactly that shape today (device admin on Android 7 and on Android
 * 11 iFPDOS).
 *
 * THE RULE. Unattended darkening takes only mechanisms that cannot latch:
 *  • `screen-timeout` (the OS's own idle sleep — the server's own power
 *    trials run on it), the software floor, and a vendor recipe (a per-model
 *    command written and proven for that model) are always allowed;
 *  • the LOCK family — `device-admin`, `device-owner`, `accessibility-lock`
 *    (the last is the same goToSleep + keyguard path) — only on Android 13
 *    or later, where the one round trip on record (L55VEC, 2026-08-25)
 *    recovered, and every latch on record was older; or on a model a
 *    supervised on-site round trip has added to [LOCK_RESTORE_PROVEN_MODELS].
 * Anything else falls through the chain to the next allowed mechanism, which
 * is never worse than "covered with black" (SleepProof reports which).
 *
 * Pure, so the rule has a JVM test that cannot be skipped.
 */
object RestoreBlankPolicy {

    /** Mechanisms that sleep the panel through a lock — the latch-prone family. */
    val LOCK_FAMILY: Set<String> = setOf("device-admin", "device-owner", "accessibility-lock")

    /** Android 13: the only release with an observed lock round trip and no observed latch. */
    const val LOCK_RESTORE_MIN_SDK = 33

    /**
     * `Build.MODEL` values proven by a SUPERVISED on-site round trip (lock →
     * our wake → content back, three times, plus an alert drill) on an older
     * Android. Empty until such a test passes. Never add a model from a probe
     * verdict, a vendor document or a single unsupervised success.
     */
    val LOCK_RESTORE_PROVEN_MODELS: Set<String> = emptySet()

    fun allows(providerId: String, sdkInt: Int, model: String?): Boolean =
        providerId !in LOCK_FAMILY ||
            sdkInt >= LOCK_RESTORE_MIN_SDK ||
            (model != null && model in LOCK_RESTORE_PROVEN_MODELS)
}

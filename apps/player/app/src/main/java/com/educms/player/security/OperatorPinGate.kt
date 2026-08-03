package com.educms.player.security

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.text.InputType
import android.widget.EditText
import android.widget.LinearLayout
import com.educms.player.logging.PlayerLogger
import java.security.MessageDigest

/**
 * Operator-PIN gate for locally-initiated destructive actions (AND-004).
 *
 * ============================================================
 * ⚠️ UNWIRED — RETAINED ON PURPOSE (2026-08-03)
 * ============================================================
 *
 * NOTHING CALLS THIS. It is deliberately kept on disk, un-referenced,
 * for the future server-/web-layer gate described at the bottom of this
 * comment. Do not re-attach it to the native bridge without reading why
 * it was detached:
 *
 *  1. WRONG LAYER — ZERO SECURITY VALUE WHERE IT SAT. The player's
 *     "unpair" is three layers deep and runs SERVER-FIRST:
 *     `apps/web/src/app/player/page.tsx` (~:6497-6550) calls
 *     `POST /api/v1/screens/unpair/:fp` FIRST (~:6527) and only then the
 *     native `EduCmsNative.unpair()` (~:6550). The gate sat on that last
 *     native step — by the time it ran, the server had already dropped
 *     the screen from the emergency channel. Gating it stopped nothing.
 *
 *  2. IT BRICKED THE ESCAPE HATCH. The gate fails CLOSED, and the
 *     provisioning path that would write a PIN DOES NOT EXIST (see the
 *     note below, and `usb/UsbIngestActivity.kt` — "V1 scaffold: no PIN
 *     prompt yet"). So on every deployed screen it permanently disabled
 *     the operator's on-device "Exit to device home", which is the only
 *     way back to the OEM launcher on a signage box.
 *
 * The real fix for the threat below — somebody physically at the screen
 * with a USB keyboard — is Android **lock task mode**, which stops them
 * escaping the WebView into the OS at all. See
 * `com.educms.player.security.LockTaskController`.
 *
 * If a PIN gate is ever genuinely wanted, it belongs on the SERVER side
 * of the unpair (an API that refuses a device-initiated unpair without a
 * tenant-set PIN), or in the web overlay BEFORE the server call — not
 * here, behind the action that already happened.
 *
 * ============================================================
 * THE THREAT
 * ============================================================
 *
 * A student with a $10 USB keyboard can reach the player's on-screen
 * info overlay (Enter/Space toggles it) and, in four keystrokes, hit
 * "Unpair" — which clears the device token, drops the screen back to the
 * pairing splash, and thereby removes that hallway display from the
 * lockdown / weather / evacuation alert channel. Same for "Exit to
 * device home", which drops the kiosk to the OEM launcher.
 *
 * ============================================================
 * WHAT THIS GATE DOES *NOT* DO
 * ============================================================
 *
 * It does NOT gate every call to `EduCmsNative.unpair()`. That method is
 * also driven by the SERVER: the signed `TENANT_CHANGED` WebSocket
 * message calls it so a re-homed screen wipes tenant-scoped local state.
 * A blanket PIN prompt would strand that flow on an unattended kiosk.
 *
 * Instead MainActivity records the timestamp of physical/local input
 * (`dispatchKeyEvent` + `onUserInteraction`) and only routes a destructive
 * bridge call through this gate when it lands within seconds of somebody
 * touching the device. Server-driven calls arrive with no human at the
 * keyboard and pass straight through, exactly as before.
 *
 * ============================================================
 * FAIL-CLOSED POSTURE (read before changing)
 * ============================================================
 *
 * When a PIN IS configured: 3 attempts, then the action is denied.
 * When NO PIN is configured: the locally-initiated action is DENIED and
 * the operator is told to do it from the dashboard instead. That is the
 * fail-closed choice — an unconfigured screen must not be unpairable by
 * whoever is standing in front of it.
 *
 * ⚠️ There is currently NO provisioning path that writes these prefs.
 * The intended follow-up (needs an API change, out of scope for the
 * player-only remediation pass) is: tenant sets a screen PIN in the
 * dashboard → the device-authenticated manifest carries `operatorPinSha256`
 * → the NATIVE heartbeat (which already talks to the API with the device
 * JWT, so JavaScript cannot forge it) writes `operator_pin_sha256` here.
 * Until then a PIN can only be pre-seeded by an MDM / provisioning profile
 * writing the `edu_player` SharedPreferences keys below.
 */
object OperatorPinGate {

    private const val TAG = "OperatorPinGate"
    private const val PREFS = "edu_player"

    /** Plaintext PIN (MDM-seeded). Checked first. */
    const val PREF_PIN_PLAIN = "operator_pin"

    /** Lowercase hex SHA-256 of the PIN. Preferred over the plaintext key. */
    const val PREF_PIN_SHA256 = "operator_pin_sha256"

    private const val MAX_ATTEMPTS = 3

    @Volatile private var promptShowing = false

    fun isConfigured(ctx: Context): Boolean {
        return try {
            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val plain = p.getString(PREF_PIN_PLAIN, null)
            val hash = p.getString(PREF_PIN_SHA256, null)
            (plain != null && plain.isNotBlank()) || (hash != null && hash.isNotBlank())
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Run [onGranted] only after the operator PIN has been entered
     * correctly. Denies (and logs) when no PIN is configured, when the
     * operator cancels, after [MAX_ATTEMPTS] wrong entries, or if the
     * dialog cannot be shown at all.
     */
    fun require(activity: Activity, actionLabel: String, onGranted: () -> Unit) {
        activity.runOnUiThread {
            if (!isConfigured(activity)) {
                PlayerLogger.e(
                    TAG,
                    "DENIED \"$actionLabel\" — locally initiated and this screen has no operator PIN configured",
                )
                showDeniedDialog(activity, actionLabel)
            } else if (promptShowing) {
                PlayerLogger.w(TAG, "DENIED \"$actionLabel\" — a PIN prompt is already on screen")
            } else {
                promptShowing = true
                showPinPrompt(activity, actionLabel, 1, onGranted)
            }
        }
    }

    // ─── internals ──────────────────────────────────────────────

    private fun showPinPrompt(
        activity: Activity,
        actionLabel: String,
        attempt: Int,
        onGranted: () -> Unit,
    ) {
        try {
            val input = EditText(activity)
            input.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            input.isFocusable = true
            input.isFocusableInTouchMode = true

            val container = LinearLayout(activity)
            container.orientation = LinearLayout.VERTICAL
            container.setPadding(48, 24, 48, 8)
            container.addView(input)

            val message = if (attempt == 1) {
                "Enter the operator PIN to continue."
            } else {
                "Incorrect PIN. Attempt $attempt of $MAX_ATTEMPTS."
            }

            val dialog = AlertDialog.Builder(activity)
                .setTitle(actionLabel)
                .setMessage(message)
                .setView(container)
                .setCancelable(false)
                .setPositiveButton("Unlock") { _, _ ->
                    val entered = input.text?.toString()?.trim() ?: ""
                    if (matches(activity, entered)) {
                        promptShowing = false
                        PlayerLogger.i(TAG, "operator PIN accepted — running \"$actionLabel\"")
                        try {
                            onGranted()
                        } catch (t: Throwable) {
                            PlayerLogger.e(TAG, "\"$actionLabel\" threw after PIN unlock", t)
                        }
                    } else if (attempt < MAX_ATTEMPTS) {
                        PlayerLogger.w(
                            TAG,
                            "operator PIN rejected for \"$actionLabel\" (attempt $attempt/$MAX_ATTEMPTS)",
                        )
                        showPinPrompt(activity, actionLabel, attempt + 1, onGranted)
                    } else {
                        promptShowing = false
                        PlayerLogger.e(
                            TAG,
                            "operator PIN rejected $MAX_ATTEMPTS times — \"$actionLabel\" DENIED",
                        )
                    }
                }
                .setNegativeButton("Cancel") { _, _ ->
                    promptShowing = false
                    PlayerLogger.i(TAG, "operator cancelled the PIN prompt — \"$actionLabel\" not run")
                }
                .create()
            dialog.setOnShowListener { input.requestFocus() }
            dialog.show()
        } catch (t: Throwable) {
            // Cannot show the prompt (activity finishing, bad window
            // token, OEM theme blow-up) → deny. Never fall through to
            // running the destructive action.
            promptShowing = false
            PlayerLogger.e(TAG, "PIN prompt could not be shown — DENYING \"$actionLabel\"", t)
        }
    }

    private fun showDeniedDialog(activity: Activity, actionLabel: String) {
        try {
            AlertDialog.Builder(activity)
                .setTitle("Locked")
                .setMessage(
                    "\"$actionLabel\" is blocked from the screen itself because no operator PIN " +
                        "is configured for this display.\n\nAn administrator can do this from the " +
                        "VenueOS dashboard.",
                )
                .setCancelable(true)
                .setPositiveButton("OK") { _, _ -> }
                .show()
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not show denial dialog: ${t.message}")
        }
    }

    private fun matches(ctx: Context, entered: String): Boolean {
        if (entered.isEmpty()) return false
        return try {
            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val plain = p.getString(PREF_PIN_PLAIN, null)
            if (plain != null && plain.isNotBlank() && constantTimeEquals(plain.trim(), entered)) {
                true
            } else {
                val hash = p.getString(PREF_PIN_SHA256, null)
                if (hash != null && hash.isNotBlank()) {
                    constantTimeEquals(hash.trim().lowercase(), sha256Hex(entered))
                } else {
                    false
                }
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun sha256Hex(value: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val bytes = md.digest(value.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xFF
            sb.append("0123456789abcdef"[v ushr 4])
            sb.append("0123456789abcdef"[v and 0x0F])
        }
        return sb.toString()
    }

    /** Length-leaking but content-constant comparison — enough for a PIN. */
    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) {
            diff = diff or (a[i].code xor b[i].code)
        }
        return diff == 0
    }
}

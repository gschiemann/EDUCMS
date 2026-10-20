package com.educms.player.media

/**
 * NativeStepAside — the native video layer gets out of the way of a system
 * install confirmation (1.1.46).
 *
 * Since 1.1.41 a solo native session is composed ABOVE the app window
 * (SoloVideoLayer). Every OTA push that worked was on a unit playing through
 * the web engine; the failures began once units played native above the
 * window. Whatever the OEM compositor does with that layer while the system
 * PackageInstaller dialog is up, the player must never let it compete: the
 * native layer may own the window only while the Activity is resumed AND
 * focused AND no install confirmation (ours, or the "Update ready" card) is
 * pending. A pause or focus loss already fails readiness
 * ([NativeVideoReadiness]); this adds the pending install to `uiClear`, so a
 * session ends on it and cannot re-attach until it clears.
 *
 * Emergency content never runs native (FaceVideoPolicy), and the install
 * hold itself yields to an emergency hold (MainActivity.installPromptOutstanding),
 * so nothing here can delay an alert.
 */
internal object NativeStepAside {
    fun uiClear(baseUiClear: Boolean, installPending: Boolean, updateCardShowing: Boolean): Boolean =
        baseUiClear && !installPending && !updateCardShowing
}

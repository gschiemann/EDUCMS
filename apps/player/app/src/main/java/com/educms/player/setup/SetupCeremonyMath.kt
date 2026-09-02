package com.educms.player.setup

/**
 * The pure half of [SetupCeremony] — which step comes next, and where the
 * operator is in the sequence.
 *
 * Split out for the same reason [com.educms.player.display.DeviceAdminEnrollmentMath]
 * and DisplayScheduleMath are: the rules that decide whether an operator
 * gets nagged, stalled, or silently skipped are worth a test that cannot be
 * skipped for want of an emulator. Everything here is a plain function over
 * plain data — no Context, no Activity, no dialog.
 */

/**
 * One step's situation at a moment in time.
 *
 * @param key       the SharedPreferences marker name, and the step's id.
 * @param applies   is this step meaningful on this box at all? (An SDK
 *                  floor, a companion app that is not installed, a device
 *                  owner that already pins HOME.)
 * @param satisfied is the grant already held? LIVE state — it always wins
 *                  over [offered], so a permission granted by hand, by adb,
 *                  or in an earlier install is never asked for again.
 * @param offered   have we already put this step's dialog on screen once
 *                  for this install?
 * @param optional  ADVANCED. The step still applies and is still tappable,
 *                  but it is NOT part of the happy path: it is never armed
 *                  as "next", it never counts toward "N of N", and it can
 *                  never hold the ceremony open. See the per-grant evidence
 *                  in [SetupCeremony]'s STEPS list for why a specific grant
 *                  earned this. Introduced 2026-08-25 (v1.1.5) for the wide
 *                  rollout: every remaining tap is multiplied by every panel
 *                  the operator installs, so a grant has to pay for its tap
 *                  in capability that is REACHABLE on a 2026-08-25 build.
 */
data class StepState(
    val key: String,
    val applies: Boolean,
    val satisfied: Boolean,
    val offered: Boolean,
    val optional: Boolean = false,
    /**
     * WHY this step does not apply, when the answer came from the HARDWARE
     * CLASS rather than from an SDK floor or a missing companion app
     * (2026-09-02, v1.1.15). Null on every generic Android box — nothing
     * about a Goodview / TCL / Pi / LCD panel reads or writes this.
     *
     * It exists because `applies:false` on its own is indistinguishable
     * from "we never looked", and the capability report is what tells a
     * remote operator whether a screen is FINISHED or UNPROVISIONED. A
     * NovaStar poster is finished on first launch, and it has to say so in
     * words a person can check — see [SetupCeremonyMath.notApplicableReason].
     */
    val notApplicableReason: String? = null,
)

object SetupCeremonyMath {

    /**
     * The next step to offer, or null when there is nothing outstanding.
     *
     * ⚠️ THE INVARIANT THAT KEEPS THIS FROM NAGGING **OR** STALLING:
     * a step is offered when it applies, is not already satisfied, and has
     * not been offered before. OFFERING — not granting — is what advances
     * the sequence. That is deliberate and load-bearing in both directions:
     *
     *  - If ADVANCING required a GRANT, an operator who taps "Later" (or
     *    who declines in the system dialog) would be re-asked the same
     *    question on every single resume, forever. That is the nag.
     *  - If a step were skipped for any reason OTHER than being satisfied
     *    or already offered, the sequence would stop dead at the first
     *    decline and the remaining steps would never be reached. That is
     *    the stall.
     *
     * Order is the caller's list order, which is a product decision (cheap
     * and safe first; HOME last, because it registers us as a launcher
     * candidate on a box where the vendor's CMS is the host).
     *
     * ⚠️ OPTIONAL STEPS ARE NEVER ARMED (2026-08-25). An advanced grant
     * must not be able to hold the ceremony open, become the big button, or
     * make a finished panel look unfinished — it is reachable by tapping
     * its own row and nowhere else. Without this clause a demoted step
     * would still be `applies && !satisfied && !offered` on first boot and
     * would arm exactly like a core one, which is the whole thing the
     * demotion exists to stop.
     */
    fun nextKey(states: List<StepState>): String? =
        states.firstOrNull { it.applies && !it.optional && !it.satisfied && !it.offered }?.key

    /** Steps that are meaningful on this box, in order. */
    fun applicable(states: List<StepState>): List<StepState> = states.filter { it.applies }

    /** The happy path: applicable AND not demoted to advanced. */
    fun core(states: List<StepState>): List<StepState> = states.filter { it.applies && !it.optional }

    /** Applicable but advanced — rendered, tappable, never counted. */
    fun optional(states: List<StepState>): List<StepState> =
        states.filter { it.applies && it.optional }

    /**
     * `granted to core` — what the status line reports. Counts only steps
     * that apply AND are on the happy path, so neither a box that
     * structurally cannot use a step nor an advanced grant nobody needs can
     * show a finished panel as incomplete.
     *
     * That second half is not cosmetic. `managerInstallPromptShown` can
     * never report satisfied — there is no unprivileged API to read another
     * package's appop, so its `isSatisfied` is a hard `false` — which meant
     * every fully-provisioned panel in a wide rollout would sit at "5 of 6"
     * forever. A count that can never reach its total is a count nobody
     * trusts.
     */
    fun progress(states: List<StepState>): Pair<Int, Int> {
        val app = core(states)
        return app.count { it.satisfied } to app.size
    }

    /**
     * 1-based position of [key] among the APPLICABLE steps, or 0 when it
     * does not apply here.
     *
     * Position is computed over applicable steps only so the "step 3 of 5"
     * in a dialog title can never promise a step this device will not be
     * asked for — an operator who is told there are five and gets four has
     * been left wondering what they missed.
     */
    fun positionOf(states: List<StepState>, key: String): Int =
        applicable(states).indexOfFirst { it.key == key } + 1

    /** True when nothing applicable is still outstanding. */
    fun isComplete(states: List<StepState>): Boolean = nextKey(states) == null

    // ─────────────────────────────────────────────────────────────────
    // v6 (2026-09-02, v1.1.15) — PER-HARDWARE-CLASS APPLICABILITY
    //
    // Operator, installing NovaStar TB LED posters: the ceremony walked
    // him through Android system pages that Android draws CENTRED in the
    // controller's 1920×1080 frame buffer — i.e. a metre off the right of
    // a 320 px LED column — so he was answering dialogs he could not see.
    // His instruction: the APK does the heavy lifting; the poster asks for
    // nothing.
    //
    // ⚠️ THIS IS NOT A COSMETIC SKIP. Each of the seven grants was checked
    // against what it can actually REACH on a ViPlex-provisioned Taurus,
    // and every one of them is either already held or aimed at the wrong
    // layer. Evidence, per grant (sources: docs/research/
    // 2026-09-01-taurus-brightness-power/01-control-surfaces.md §1.5–1.9,
    // and the 2026-09-02 device inventory for LED Poster 1):
    //
    //  • install-unknown-apps (Player AND Manager) — a ViPlex-installed box
    //    already reports `canRequestPackageInstalls:true` and
    //    `installerOfRecord:"com.nova.androidsystemsdk"`. The one Android
    //    dialog that remains is the package-installer confirmation the
    //    OPERATOR raises by pressing Install on an OTA, and 1.1.14's
    //    LedSystemPromptBanner already announces that one on the column.
    //  • WRITE_SETTINGS — its three consumers are Settings brightness,
    //    the screen-off timeout, and `kind:"settings"` recipe steps. On a
    //    Taurus the LED's brightness and power live in NovaStar's own
    //    control plane (`nova.priv.terminal.screen.ScreenService`,
    //    nvSetScreenBrightnessAsync / nvSetScreenPowerStateAsync), NOT in
    //    `Settings.System.SCREEN_BRIGHTNESS`. Asking for this grant buys a
    //    write that cannot reach the glass.
    //  • device admin — its only consumer is `lockNow()`, which is the same
    //    wrong layer, and the platform already refuses `device-admin` as an
    //    UNPROVEN power mechanism.
    //  • battery-optimisation exemption — a phone concept. This is a
    //    mains-powered signage controller; there is no battery optimiser
    //    for it to be exempted from.
    //  • overlay ("Display over other apps") — it exists to make OUR OWN
    //    background relaunch legal after an OTA. ViPlex's "auto launch on
    //    startup" already owns that on this box.
    //  • HOME — the HOME role is NovaStar's launcher. We are a guest here
    //    and must never take it; see [homeRoleRefusal].
    //
    // ⚠️ EVERY OTHER HARDWARE CLASS IS UNTOUCHED. [HardwareClass.GENERIC]
    // answers null for every key, which is exactly what the code did before
    // this block existed — that is the contract the tests pin.
    // ─────────────────────────────────────────────────────────────────

    /**
     * What kind of box is this, for the purposes of "what should we ask
     * for?" Deliberately tiny: a class earns a member here only when the
     * ANSWER TO A GRANT QUESTION differs, never merely because the
     * hardware differs.
     */
    enum class HardwareClass {
        /** Every LCD, Pi, Goodview, TCL and generic Android box. */
        GENERIC,

        /** NovaStar TB / Taurus LED poster (Rockchip rk356x_box class). */
        NOVASTAR_POSTER,
    }

    /** Step keys, so the table below and the ceremony cannot drift on a typo. */
    const val STEP_INSTALL_UNKNOWN = "installPromptShown"
    const val STEP_MANAGER_INSTALL = "managerInstallPromptShown"
    const val STEP_WRITE_SETTINGS = "writeSettingsPromptShown"
    const val STEP_BATTERY_EXEMPT = "batteryExemptPromptShown"
    const val STEP_DEVICE_ADMIN = "deviceAdminPromptShown"
    const val STEP_OVERLAY = "overlayPromptShown"
    const val STEP_HOME = "homeSetupPromptShown"

    /**
     * The reason a NovaStar poster is not asked for a given grant.
     *
     * Short, quotable, and prefixed with the hardware class so a reader of
     * `screen_device_inventory` can tell a hardware rule from an SDK floor
     * at a glance.
     */
    private val NOVASTAR_POSTER_REASONS: Map<String, String> = mapOf(
        STEP_INSTALL_UNKNOWN to "novastar-taurus: ViPlex installs and updates this app",
        STEP_MANAGER_INSTALL to "novastar-taurus: ViPlex installs and updates this app",
        STEP_WRITE_SETTINGS to "novastar-taurus: brightness/power are NovaStar-layer",
        STEP_BATTERY_EXEMPT to "novastar-taurus: mains-powered signage box, no battery optimiser",
        STEP_DEVICE_ADMIN to "novastar-taurus: brightness/power are NovaStar-layer",
        STEP_OVERLAY to "novastar-taurus: ViPlex auto-launch brings the player back",
        STEP_HOME to "novastar-taurus: launcher is NovaStar's",
    )

    /**
     * The answer for a step this table has never heard of.
     *
     * ⚠️ A NEW STEP DEFAULTS TO "NOT ASKED" ON A POSTER, ON PURPOSE. The
     * failure this whole block exists to stop is an Android system page
     * appearing where nobody can see it, so the safe direction for an
     * unknown step is silence — and [SetupHardwarePolicyTest] fails the
     * moment a step key exists without an explicit row above, so the
     * default is a backstop and never the shipped answer.
     */
    const val NOVASTAR_POSTER_DEFAULT_REASON =
        "novastar-taurus: ViPlex provisions this box; Android system pages draw off the LED"

    /**
     * Why [key] does not apply on [hardware], or null when it does.
     *
     * GENERIC answers null for every key — the pre-v1.1.15 behaviour,
     * unchanged and pinned by test.
     */
    fun notApplicableReason(hardware: HardwareClass, key: String): String? = when (hardware) {
        HardwareClass.GENERIC -> null
        HardwareClass.NOVASTAR_POSTER ->
            NOVASTAR_POSTER_REASONS[key] ?: NOVASTAR_POSTER_DEFAULT_REASON
    }

    /**
     * Why this box must NOT take the Android HOME role, or null when it may.
     *
     * ⚠️ THE POSTER ANSWER IS A REFUSAL, NOT A SKIP. Not asking for HOME
     * and not TAKING it are different things: `PlayerApp` enables the
     * KioskHomeAlias on its own whenever the Manager companion is device
     * owner, and `SetupCeremony`'s HOME step enables it before it opens
     * the chooser. Either path would register us as a launcher candidate
     * on a box whose launcher is `com.nova.launcher` — the vendor's, on
     * the vendor's own controller. Both callers ask this first.
     */
    fun homeRoleRefusal(hardware: HardwareClass): String? = when (hardware) {
        HardwareClass.GENERIC -> null
        HardwareClass.NOVASTAR_POSTER -> NOVASTAR_POSTER_REASONS.getValue(STEP_HOME)
    }

    /**
     * Why this box must NOT bootstrap the Manager companion, or null when it
     * may.
     *
     * ⚠️ THIS IS THE GATE 1.1.15 MISSED (2026-09-02, LED Poster 3). The
     * ceremony's seven steps were silenced on a poster, but `MainActivity`
     * has an OLDER flow in front of them: with the companion missing it
     * holds the whole player behind "Setting up your player", deep-links to
     * the install-unknown-apps toggle, and then fires a system Install
     * dialog — every one of those drawn in the middle of the controller's
     * 1920 frame, off the 320 px the LED shows. 1.1.15 put a banner over
     * that page instead of refusing the flow; the unit sat there with a
     * mouse and nothing to click. The companion exists for silent OTA
     * installs, which need device-owner — on a poster ViPlex already
     * installs and updates this app, so the companion buys nothing and
     * costs the install. Every caller — the boot gate, the upgrade hold,
     * `ManagerBootstrap.bootstrapIfNeeded` — asks this first.
     */
    fun companionBootstrapRefusal(hardware: HardwareClass): String? = when (hardware) {
        HardwareClass.GENERIC -> null
        HardwareClass.NOVASTAR_POSTER ->
            "novastar-taurus: ViPlex installs and updates this app; the companion's " +
                "install toggle and Install dialog draw off the LED"
    }

    // ─────────────────────────────────────────────────────────────────
    // v2 (2026-08-25) — the CHECKLIST model
    //
    // Operator, after walking a real panel through v1: *"the buttons to
    // allow permissions are all over the place, not even in a consistent
    // menu, and one menu wasnt even visible i had to guess where all
    // admin permissions was …. why cant we pop one menu where we quickly
    // check everything we want and then it auto configures everything"*.
    //
    // ⚠️ THE HONEST ANSWER, and it is a hard Android limit: WE CANNOT.
    // Without device-owner provisioning (a factory reset per screen —
    // off the table, every deployed box already carries the vendor's
    // owner) there is NO API that grants install-unknown-apps,
    // WRITE_SETTINGS, battery exemption, device-admin or the HOME
    // default from one dialog. Each one is a separate system Activity
    // the user must visit. Nothing below changes that, and no future
    // agent should be led to think it did.
    //
    // What v2 DOES fix is the part that was actually ours: the operator
    // was thrown at six vendor Settings pages with no thread between
    // them, so a hidden page (the invisible "all admin permissions"
    // menu) left them guessing with nothing to come back to. v2 keeps
    // ONE home-base screen up the whole time — every grant listed, live
    // status, progress, and the next one armed — so every Settings
    // round-trip lands back in the same consistent place.
    //
    // The functions below are the pure half of that screen: what each
    // row says and which button the operator gets. No Context, no View.
    // ─────────────────────────────────────────────────────────────────

    /** Copy shown on the checklist when there is still work to do. */
    const val HEADING_GRANTING = "Finish setting up this screen"

    /**
     * Copy shown when every step has been OFFERED but some were declined
     * or skipped. Deliberately not "complete" — saying "done" over a
     * half-granted panel is how a screen ships with no brightness
     * control and nobody knows until a site visit.
     */
    const val HEADING_PAUSED = "Setup paused"

    /** Copy shown when every applicable grant is actually held. */
    const val HEADING_COMPLETE = "Setup complete ✓"

    /**
     * Copy shown when every REQUIRED grant is held and optional rows are
     * still outstanding (v1.1.12).
     *
     * The state itself is not new — it is the one the operator at G65 met —
     * but it used to read "Setup complete ✓" and then vanish. Now that the
     * card STAYS UP waiting for him, the heading has to be true for as long
     * as he is reading it: the required work is done, the optional work is
     * not, and the amber progress line under this says how much.
     *
     * ⚠️ Says "required", never "complete". An installer working a stack of
     * panels reads the tick and walks; that is correct and intended — the
     * screen IS ready. It just is not a clean bill for the rows below.
     */
    const val HEADING_REQUIRED_DONE = "Required setup done ✓"

    /**
     * The label on the primary button of a card with nothing left armed.
     *
     * ⚠️ EVERY MODE MUST HAVE ONE (v1.1.12, field report G65-B). COMPLETE
     * used to render no buttons at all, and on a remote-only panel that is
     * not a cosmetic difference: with no button visible there is nothing for
     * `SetupChecklistView` to park focus on, so focus sat on the focusable
     * ROOT with no highlight anywhere, and OK did nothing. "when I push the
     * permissions dashboard to the screen it pops up but the remote control
     * has no control over that popup so it just sits there." A button is
     * what a D-pad can reach; a card without one is a trap.
     */
    const val PRIMARY_DONE = "Done"

    /**
     * The same button when optional rows are still outstanding.
     *
     * "Close" and not "Done": the operator is dismissing a card that still
     * lists work, and the button should say what it does rather than bless
     * what is left. Tapping it is not a decline — the rows stay exactly as
     * they were and the two re-entry routes in [REENTRY_LINE] still work.
     */
    const val PRIMARY_CLOSE = "Close"

    // ── v3 (2026-08-25, v1.1.6) — THE COMPLETION CARD MUST NOT LIE ───────
    //
    // Operator, installing the first panel on v1.1.5: *"it popped up with
    // the config page but after you do the first 4 requirements it just
    // launched so i didnt get to even do the optional ones at all and have
    // no way to know how to pull those up again"*.
    //
    // Both halves of that are real and they are separate defects:
    //
    //  1. THE CARD SAID "Setup complete ✓" over a panel with untouched
    //     OPTIONAL rows. The count was honest — `progress` is core-only by
    //     design, and that is what made "5 of 6 forever" go away — but a
    //     heading of "complete" plus a count of "4 of 4" is, to the person
    //     standing at the screen, a claim that there is nothing left. There
    //     was: the optional section they never got to.
    //  2. THE ONLY WAY BACK WAS AN ADB CABLE. `SetupCeremony.open` existed
    //     but the only caller was an `am start` action — useless to somebody
    //     at a wall-mounted panel with no laptop.
    //
    // So the completion state now STATES the outstanding optional work and
    // NAMES both routes back. The 4-second auto-dismiss stays (the operator
    // explicitly does not want a blocking screen) but it is no longer the
    // last word: the card says what is left and how to return before it
    // goes, and it lingers longer when there is something to read.
    //
    // ⚠️ COPY, NOT MECHANISM. Nothing here changes which step is armed,
    // what counts toward "N of N", or when the checklist appears — those
    // invariants are pinned by the tests above and are unchanged.

    /**
     * How the outstanding-optional truth reads next to the progress count.
     * Deliberately NOT folded into "N of N" — that count means "the happy
     * path is done", and it is the thing an installer working a stack of
     * panels reads to know they can walk away.
     */
    fun optionalNote(outstanding: Int): String? = when {
        outstanding <= 0 -> null
        outstanding == 1 -> "1 optional step not set up"
        else -> "$outstanding optional steps not set up"
    }

    /**
     * The two ways back into this list from a panel with no cable attached.
     *
     * Shown on the completion/paused card, which is exactly the moment the
     * operator is about to lose the screen. The dashboard route is named
     * FIRST because it is the one that works on a panel nobody is standing
     * next to; the on-panel gesture is the backup for a site with no laptop.
     *
     * ⚠️ Keep in lockstep with `SetupCornerGesture` — the "6 seconds" and
     * "top-left corner" here are that object's HOLD_MS and its corner, and a
     * line of copy that names the wrong corner is worse than no line.
     */
    const val REENTRY_LINE =
        "To finish these later: in the dashboard open Screens → the ⚙ menu → " +
            "\"Open setup on this panel\". Or, at the screen, press and hold the " +
            "TOP-LEFT corner for 6 seconds."

    /** Shown while there is still armed work — unchanged from v2. */
    const val FOOTNOTE_GRANTING =
        "Android asks for each permission on its own screen — that part is not " +
            "up to us. We bring you back to this list every time."

    // ── v4 (2026-09-01) — THE POST-UPGRADE RELAUNCH-GRANT OFFER ──────────
    //
    // WHY IT EXISTS. Two Goodview panels installed an OTA and never came
    // back on screen; the operator walked to each one. Root cause is an
    // Android rule, not a bug of ours: `startActivity` from a background
    // process is SILENTLY dropped on Android 10+ unless the app is the
    // default HOME, is/has a device owner, or holds "Display over other
    // apps". Neither panel had any of the three.
    //
    // The grant is now a normal ceremony step (see SetupCeremony's STEPS,
    // placed BEFORE the HOME step because HOME must stay last). But a screen
    // that finished its ceremony BEFORE this shipped will never see that
    // step in the flow it already completed — and it is precisely the fleet
    // that has the problem. So the first boot after a package replace gets
    // ONE brief offer of that single step.
    //
    // ⚠️ IT MUST NOT HOLD CONTENT HOSTAGE. The card is the same scrim the
    // checklist has always been — signage keeps playing behind it — it
    // carries a visible countdown, it auto-continues unattended, and the
    // emergency / lock-task refusals in `SetupCeremony.render` apply to it
    // unchanged: a life-safety hold takes it down, and always wins.
    //
    // ⚠️ AND IT MUST NOT BECOME A NAG. Showing it counts as OFFERING, which
    // is what advances the sequence everywhere else in this file, so the
    // normal checklist will not re-arm the step on the next boot. A panel
    // whose operator was not standing there therefore gets asked once per
    // upgrade and no more — the thing that tells a REMOTE operator about it
    // is the `RELAUNCH_BLOCKED` ota-state report, not another card on the
    // glass.

    /** Heading for the single-step post-upgrade offer. */
    const val HEADING_AFTER_UPDATE = "Updated. One tap keeps the next one hands-free"

    /**
     * Footnote for that card. Names the way back, like every other state the
     * screen disappears from, and is honest that skipping costs nothing
     * today — only a walk to the panel after the NEXT update.
     */
    const val FOOTNOTE_AFTER_UPDATE =
        "Skip this and the screen keeps playing — the next update just needs " +
            "somebody to tap the app at the panel. $REENTRY_LINE"

    /**
     * The line under the buttons on the offer card.
     *
     * States what is true: the card closes itself, and the screen behind it
     * was never paused. It does NOT claim content is "waiting" or "frozen" —
     * the checklist is a scrim over a live WebView and always has been.
     */
    fun countdownLine(secondsLeft: Int): String =
        "Closing in ${secondsLeft}s — the screen keeps playing behind this."

    // ── v5 (2026-09-01, v1.1.12) — AN UNFINISHED CARD MUST NOT CLOSE
    //    ITSELF ──────────────────────────────────────────────────────────
    //
    // Operator, panel G65, remote-control only, no touch: *"the splash
    // screen that allows me to set all the permissions goes away before I
    // can set the optional permissions."*
    //
    // What he met, in code: [ChecklistMode.COMPLETE] is entered whenever the
    // CORE grants are held — `nextKey` skips optional rows and `progress`
    // counts core rows only, both deliberately (see their headers) — so a
    // panel with untouched ADVANCED rows lands in COMPLETE too. v1.1.6 gave
    // that case a longer fuse (12 s) and an amber correction line, which was
    // the right diagnosis and not enough medicine: twelve seconds does not
    // cover reading two lines, arrowing DOWN past four granted rows into the
    // optional section, and pressing OK on a D-pad. When it expired the card
    // was gone, and the only routes back are a laptop or a six-second
    // corner hold that a remote cannot perform.
    //
    // So a card with outstanding optional work NO LONGER CLOSES ITSELF at
    // all. Its backstop is the checklist's existing idle stand-down
    // (`SetupCeremony.IDLE_STAND_DOWN_MS` — 10 minutes, reset by every
    // interaction), which is the protection live signage already had from an
    // abandoned checklist. An unattended panel is still back on content; it
    // is now on the timer built for "nobody is here" instead of one built
    // for "there is nothing left to do".
    //
    // ⚠️ GENUINE COMPLETE IS UNCHANGED. Nothing outstanding at all — the
    // adb-provisioned panel, the finished install — still shows its green
    // tick and clears itself in four seconds. That card has nothing to read
    // and nothing to do; holding it over a customer's board would be the
    // opposite bug, and the operator's standing instruction is that setup
    // must never become a blocking screen.

    /** How long a card with NOTHING left to do stays up before it clears. */
    const val COMPLETE_LINGER_MS = 4_000L

    /**
     * How long this card may sit on glass before it closes itself, or NULL
     * when it must not close itself at all.
     *
     * NULL is the answer for every state that still has work an operator
     * could do HERE: GRANTING and PAUSED never self-closed, and since v1.1.12
     * neither does a COMPLETE card with outstanding optional rows.
     *
     * ⚠️ This is the ONLY place that decides a card's lifetime. Do not add a
     * second fuse in the view or the ceremony — the 12-second one this
     * replaced was invisible from the model, which is how it survived a
     * release that was specifically about the completion card lying.
     */
    fun autoDismissMs(model: ChecklistModel): Long? = when {
        model.mode != ChecklistMode.COMPLETE -> null
        model.optionalOutstanding > 0 -> null
        else -> COMPLETE_LINGER_MS
    }

    /**
     * Everything the post-upgrade offer decision may use.
     *
     * @param lastHandledVc the versionCode the last offer decision was made
     *        for. 0 = never — either a FRESH install, or the very first boot
     *        of the build that introduced this marker.
     * @param previouslyProvisioned has this screen been through the ceremony
     *        before? True when any step OTHER than the relaunch grant carries
     *        an `offered` marker. It is what separates the two meanings of
     *        `lastHandledVc == 0` above, and it must be read off `offered`
     *        rather than `satisfied`: a grant can be satisfied by an adb
     *        provisioning script on a screen that has never seen our
     *        ceremony, but only the ceremony writes `offered`.
     * @param currentVc     this APK's versionCode.
     * @param overlayGranted `Settings.canDrawOverlays` — the grant itself.
     * @param isHomeApp     a HOME-default panel is relaunched by the OS, so
     *        it has nothing to gain here and must not be asked.
     * @param declinedVc    the versionCode an operator last tapped "Not now"
     *        on. Persisted so a decline holds until the NEXT upgrade.
     */
    data class RelaunchGrantFacts(
        val lastHandledVc: Long,
        val currentVc: Long,
        val previouslyProvisioned: Boolean,
        val overlayGranted: Boolean,
        val isHomeApp: Boolean,
        val declinedVc: Long,
        /**
         * Does the overlay STEP apply on this box at all? (2026-09-02.)
         *
         * Defaults true, so every existing caller and every generic Android
         * panel decides exactly what it decided before. It is false on a
         * NovaStar poster — ViPlex's auto-launch already owns the relaunch —
         * and on a ROM that ships no overlay Settings page.
         *
         * ⚠️ THIS IS THE OFFER'S OWN APPLICABILITY GATE, not a duplicate of
         * `renderRelaunchOffer`'s. That one refuses to PAINT, which is the
         * right outcome but happens after the decision is logged and spent;
         * this one stops the question being asked at all, so the log line a
         * remote operator reads says "not applicable here" rather than
         * "due" over a card that never appeared.
         */
        val overlayStepApplies: Boolean = true,
    )

    /**
     * Should the first resume after a package replace offer the relaunch
     * grant?
     *
     * ⚠️ THE FRESH-INSTALL GUARD IS LOAD-BEARING IN BOTH DIRECTIONS, and
     * getting either half wrong is a visible defect on a customer's board.
     *
     *  - Without it, a FRESH install reads as "the version changed" (the
     *    marker has never been written) and this card races the real
     *    first-boot ceremony: two drivers on one screen, the exact stacking
     *    the checklist shell was built to end.
     *  - With ONLY the `lastHandledVc > 0` half, the OTA that INTRODUCES the
     *    marker offers nothing to anybody — every already-deployed panel
     *    reads 0 on the one boot that matters, which is precisely the fleet
     *    that has the problem. That is why `previouslyProvisioned` exists:
     *    a screen that has been through the ceremony before is upgrading,
     *    not installing, whatever the marker says.
     */
    fun shouldOfferRelaunchGrant(f: RelaunchGrantFacts): Boolean =
        f.overlayStepApplies &&
            (f.lastHandledVc > 0L || f.previouslyProvisioned) &&
            f.lastHandledVc != f.currentVc &&
            !f.overlayGranted &&
            !f.isHomeApp &&
            f.declinedVc != f.currentVc

    /** How one row reads. */
    enum class RowStatus { GRANTED, CURRENT, NEEDED }

    /**
     * What the screen as a whole is doing.
     *
     *  - [GRANTING] — at least one step is still un-offered, so there is
     *    a "next" to arm. This is the ONLY mode the checklist is ever
     *    shown from cold; see `SetupCeremony.resume`.
     *  - [PAUSED]   — everything has been offered, something is still
     *    missing. Reachable only while the screen is already up, or from
     *    the explicit re-open intent — never as a fresh nag.
     *  - [COMPLETE] — every applicable grant is held. Auto-dismisses.
     */
    enum class ChecklistMode { GRANTING, PAUSED, COMPLETE }

    /**
     * One step's live situation plus the copy that describes it.
     *
     * @param note transient per-row message from the last launch attempt
     *        — e.g. "this panel hides the direct page". Not persisted;
     *        it describes what just happened, not what is true.
     */
    data class ChecklistInput(
        val state: StepState,
        val name: String,
        val why: String,
        val hint: String,
        val note: String? = null,
    )

    data class ChecklistRow(
        val key: String,
        val name: String,
        val why: String,
        val status: RowStatus,
        val note: String?,
        /** The "can't find it?" path. Only carried on the armed row. */
        val hint: String?,
        /** May the operator tap this row to (re-)run its grant? */
        val actionable: Boolean,
    )

    data class ChecklistModel(
        val mode: ChecklistMode,
        val heading: String,
        val progress: String,
        /** The happy path, in order. These are what "N of N" counts. */
        val rows: List<ChecklistRow>,
        /**
         * ADVANCED rows — rendered under [OPTIONAL_HEADING], tappable,
         * never armed, never counted. Empty when this box has none.
         */
        val optionalRows: List<ChecklistRow>,
        val primaryLabel: String?,
        val primaryKey: String?,
        val secondaryLabel: String?,
        /**
         * Applicable ADVANCED grants that are NOT held. Zero on a box with
         * none. This is the number the completion card owes the operator —
         * see [optionalNote].
         *
         * ⚠️ `managerInstallPromptShown` can never report satisfied (no
         * unprivileged API reads another package's appop), so on a box with
         * the companion installed this never reaches 0. That is honest — we
         * genuinely cannot tell — and it is exactly why this number is kept
         * OUT of "N of N": a count that can never complete must never be
         * the thing that decides whether an installer can walk away.
         */
        val optionalOutstanding: Int = 0,
        /**
         * The line under the buttons. Names the way back on the states where
         * the screen is about to disappear; explains Android's one-page-per-
         * grant reality while there is still work armed.
         */
        val footnote: String = FOOTNOTE_GRANTING,
        /**
         * The self-closing countdown, or null on every card that does not
         * close itself. Only the post-upgrade relaunch-grant offer sets it —
         * every other state renders byte-for-byte what it did before.
         */
        val countdown: String? = null,
    )

    /**
     * Section label above the demoted grants.
     *
     * The wording has a job: an installer working a stack of panels has to
     * be able to read this and keep walking. "Optional" is the operative
     * word; "most screens" is the honest hedge for the minority of boxes
     * that genuinely want one of these.
     */
    const val OPTIONAL_HEADING = "Optional — most screens don't need these"

    /**
     * Build the whole screen from live state + copy.
     *
     * Which row is ARMED is [nextKey] — unchanged from v1, so the
     * nag/stall invariant that file's tests pin still governs the
     * primary button. Rows that were offered and declined stay VISIBLE
     * and tappable; they just stop being what the big button points at.
     * That is the difference between a checklist and a nag: the operator
     * can retry any row whenever they like, and nothing re-asks on its
     * own.
     *
     * @param headingOverride / @param footnoteOverride / @param countdown
     *        set ONLY by the post-upgrade relaunch-grant offer, which is one
     *        step rendered on its own card. All three default to null, so
     *        every existing caller builds exactly the model it always did.
     */
    fun buildModel(
        inputs: List<ChecklistInput>,
        headingOverride: String? = null,
        footnoteOverride: String? = null,
        countdown: String? = null,
    ): ChecklistModel {
        val states = inputs.map { it.state }
        val armed = nextKey(states)
        val (done, total) = progress(states)

        fun rowFor(input: ChecklistInput): ChecklistRow {
            val status = when {
                input.state.satisfied -> RowStatus.GRANTED
                input.state.key == armed -> RowStatus.CURRENT
                else -> RowStatus.NEEDED
            }
            return ChecklistRow(
                key = input.state.key,
                name = input.name,
                why = input.why,
                status = status,
                note = input.note,
                // The hint is a paragraph of Settings-menu directions. On
                // the armed row it is help; on all six at once it is
                // wallpaper nobody reads. An ADVANCED row is never armed,
                // so it carries its hint whenever it is un-granted — that
                // section is read on purpose, by somebody who came looking.
                hint = when {
                    status == RowStatus.CURRENT -> input.hint
                    input.state.optional && !input.state.satisfied -> input.hint
                    else -> null
                },
                actionable = !input.state.satisfied,
            )
        }

        val rows = inputs.filter { it.state.applies && !it.state.optional }.map(::rowFor)
        val optionalRows = inputs.filter { it.state.applies && it.state.optional }.map(::rowFor)

        val mode = when {
            armed != null -> ChecklistMode.GRANTING
            done == total -> ChecklistMode.COMPLETE
            else -> ChecklistMode.PAUSED
        }

        // The outstanding-ADVANCED count. Read off the same `applies &&
        // optional` set the rows are built from, so a box that structurally
        // has none (no companion app, a device owner pinning HOME) reports 0
        // and its card is byte-for-byte what v2 showed.
        val optionalOutstanding = optionalRows.count {
            it.status != RowStatus.GRANTED
        }

        return ChecklistModel(
            mode = mode,
            heading = headingOverride ?: when (mode) {
                ChecklistMode.GRANTING -> HEADING_GRANTING
                ChecklistMode.PAUSED -> HEADING_PAUSED
                ChecklistMode.COMPLETE ->
                    if (optionalOutstanding > 0) HEADING_REQUIRED_DONE else HEADING_COMPLETE
            },
            // "4 of 4 done" is TRUE and was still read as "there is nothing
            // left" over a panel with untouched optional rows. The count is
            // unchanged (core-only, on purpose); the optional truth rides
            // beside it so the card cannot be read as a clean bill.
            progress = listOfNotNull(
                "$done of $total done",
                optionalNote(optionalOutstanding),
            ).joinToString(" · "),
            rows = rows,
            optionalRows = optionalRows,
            // ⚠️ NEVER null. A mode with no button is a card a D-pad cannot
            // reach — see [PRIMARY_DONE]. COMPLETE used to return null here
            // and that is half of field report G65-B; the other half is the
            // key dispatch in SetupChecklistView, which swallowed OK when
            // there was nothing visible to click.
            primaryLabel = when (mode) {
                ChecklistMode.GRANTING ->
                    "Grant next: " + (rows.firstOrNull { it.key == armed }?.name ?: "next step")
                ChecklistMode.PAUSED -> PRIMARY_DONE
                ChecklistMode.COMPLETE ->
                    if (optionalOutstanding > 0) PRIMARY_CLOSE else PRIMARY_DONE
            },
            primaryKey = armed,
            secondaryLabel = if (mode == ChecklistMode.GRANTING) "Not now" else null,
            optionalOutstanding = optionalOutstanding,
            // GRANTING keeps v2's explainer — the operator is mid-flow and
            // the thing they need is why Android keeps throwing them at
            // another page. COMPLETE and PAUSED are the states the screen
            // disappears from, so those get the way back instead.
            footnote = footnoteOverride
                ?: if (mode == ChecklistMode.GRANTING) FOOTNOTE_GRANTING else REENTRY_LINE,
            countdown = countdown,
        )
    }
}

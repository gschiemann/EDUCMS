package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rules that decide whether an Android SECURITY dialog appears on a
 * wall-mounted screen, and whether a real panel-off blank is available.
 *
 * Two failure modes this suite exists to prevent, both named in the
 * 2026-08-14 brief:
 *
 *  1. **Nagging.** A signage box that re-pops a system security dialog
 *     in front of customers is worse than a screen that dims in
 *     software. Once declined, we must not ask again for a while.
 *  2. **A tier that never lights up.** The whole point of the
 *     device-admin work is that BLANK stops being a black overlay. If
 *     the state machine cannot recognise "we are enrolled now", the
 *     registry never re-resolves and the feature is invisible even
 *     after the operator did the tap.
 *
 * Pure JVM — no android.*, no device clock, every "now" is passed in.
 */
class DeviceAdminEnrollmentMathTest {

    private val T0 = 1_800_000_000_000L   // an arbitrary fixed epoch ms

    private fun fresh() = AdminEnrollmentRecord(isActiveAdmin = false)

    // ─── state() ────────────────────────────────────────────────────

    @Test
    fun `an untouched screen is NOT_ENROLLED`() {
        assertEquals(AdminEnrollmentState.NOT_ENROLLED, DeviceAdminEnrollmentMath.state(fresh(), T0))
    }

    @Test
    fun `the OS answer always wins over our bookkeeping`() {
        // Enabled straight from Settings > Security: no prompt of ours
        // ever fired, and a stale decline from a previous refusal is
        // still on disk. Both must lose to isActiveAdmin.
        val viaSettings = AdminEnrollmentRecord(
            isActiveAdmin = true,
            promptedAtMs = 0L,
            declinedAtMs = T0 - 1_000L,
            enrolledAtMs = 0L,
        )
        assertEquals(AdminEnrollmentState.ENROLLED, DeviceAdminEnrollmentMath.state(viaSettings, T0))

        // And an admin revoked in Settings must NOT keep reporting
        // ENROLLED just because enrolledAtMs is set.
        val revoked = AdminEnrollmentRecord(isActiveAdmin = false, enrolledAtMs = T0 - 90_000L)
        assertTrue(DeviceAdminEnrollmentMath.state(revoked, T0) != AdminEnrollmentState.ENROLLED)
    }

    @Test
    fun `a just-fired prompt reads PROMPT_PENDING and a very old one reads DECLINED`() {
        val pending = fresh().copy(promptedAtMs = T0)
        assertEquals(AdminEnrollmentState.PROMPT_PENDING, DeviceAdminEnrollmentMath.state(pending, T0 + 5_000L))

        // Nobody ever came back — the operator wandered off, the box
        // slept. It must not report PROMPT_PENDING forever.
        val stale = fresh().copy(promptedAtMs = T0)
        assertEquals(
            AdminEnrollmentState.DECLINED,
            DeviceAdminEnrollmentMath.state(stale, T0 + DeviceAdminEnrollmentMath.PROMPT_STALE_MS + 1L),
        )
    }

    @Test
    fun `a backwards wall-clock step is read as still pending, not as declined`() {
        // Android steps currentTimeMillis on first NTP sync. Leniency
        // here only DELAYS a decline record; it can never lose one,
        // because promptedAtMs stays set.
        val pending = fresh().copy(promptedAtMs = T0)
        assertEquals(
            AdminEnrollmentState.PROMPT_PENDING,
            DeviceAdminEnrollmentMath.state(pending, T0 - 60L * 60 * 1000),
        )
    }

    // ─── settle() ───────────────────────────────────────────────────

    @Test
    fun `settle writes nothing when no prompt is outstanding`() {
        assertNull("no prompt = no write on every single onResume", DeviceAdminEnrollmentMath.settle(fresh(), T0))
        assertNull(
            DeviceAdminEnrollmentMath.settle(
                AdminEnrollmentRecord(isActiveAdmin = true, enrolledAtMs = T0 - 10_000L),
                T0,
            ),
        )
    }

    @Test
    fun `settle records the enrolment when the operator approved`() {
        val approved = fresh().copy(promptedAtMs = T0 - 30_000L).copy(isActiveAdmin = true)
        val out = DeviceAdminEnrollmentMath.settle(approved, T0)
        assertNotNull(out)
        assertEquals(0L, out!!.promptedAtMs)
        assertEquals("an approval must not leave a decline behind", 0L, out.declinedAtMs)
        assertEquals(T0, out.enrolledAtMs)
        assertEquals(AdminEnrollmentState.ENROLLED, DeviceAdminEnrollmentMath.state(out, T0))
    }

    @Test
    fun `settle keeps the FIRST enrolment time across a re-enrolment`() {
        val first = T0 - 5L * 24 * 60 * 60 * 1000
        val reenrolled = AdminEnrollmentRecord(
            isActiveAdmin = true,
            promptedAtMs = T0 - 20_000L,
            enrolledAtMs = first,
        )
        assertEquals(first, DeviceAdminEnrollmentMath.settle(reenrolled, T0)!!.enrolledAtMs)
    }

    @Test
    fun `settle records a decline once the grace window has passed`() {
        val cancelled = fresh().copy(promptedAtMs = T0 - DeviceAdminEnrollmentMath.SETTLE_GRACE_MS - 1L)
        val out = DeviceAdminEnrollmentMath.settle(cancelled, T0)
        assertNotNull(out)
        assertEquals(0L, out!!.promptedAtMs)
        assertEquals(T0, out.declinedAtMs)
        assertEquals(AdminEnrollmentState.DECLINED, DeviceAdminEnrollmentMath.state(out, T0))
    }

    @Test
    fun `settle does NOT invent a decline inside the grace window`() {
        // onResume can fire before the system dialog takes focus. A
        // decline recorded there would arm the cooldown against an
        // operator who is still reading the dialog.
        val justFired = fresh().copy(promptedAtMs = T0)
        assertNull(DeviceAdminEnrollmentMath.settle(justFired, T0 + 100L))

        // ...and the decline is not LOST — the next resume takes it.
        val later = T0 + DeviceAdminEnrollmentMath.SETTLE_GRACE_MS + 1L
        assertEquals(later, DeviceAdminEnrollmentMath.settle(justFired, later)!!.declinedAtMs)
    }

    // ─── decide() — the anti-nag rules ──────────────────────────────

    @Test
    fun `a fresh screen may be prompted`() {
        assertTrue(DeviceAdminEnrollmentMath.decide(fresh(), T0) is PromptDecision.Prompt)
    }

    @Test
    fun `an already-enrolled screen is never prompted again`() {
        val d = DeviceAdminEnrollmentMath.decide(AdminEnrollmentRecord(isActiveAdmin = true), T0)
        assertEquals(
            DeviceAdminEnrollmentMath.CODE_ALREADY_ENROLLED,
            (d as PromptDecision.Refuse).code,
        )
    }

    @Test
    fun `a double-tap inside the debounce does not raise a second dialog`() {
        val justPrompted = fresh().copy(promptedAtMs = T0)
        val d = DeviceAdminEnrollmentMath.decide(justPrompted, T0 + 500L)
        assertEquals(DeviceAdminEnrollmentMath.CODE_PROMPT_PENDING, (d as PromptDecision.Refuse).code)
    }

    @Test
    fun `once declined we do not nag for the cooldown, then we may ask again`() {
        val declined = fresh().copy(declinedAtMs = T0)

        val duringCooldown = DeviceAdminEnrollmentMath.decide(
            declined,
            T0 + DeviceAdminEnrollmentMath.DECLINE_COOLDOWN_MS - 1L,
        )
        assertEquals(
            "a re-prompt in front of customers is the thing we are preventing",
            DeviceAdminEnrollmentMath.CODE_RECENTLY_DECLINED,
            (duringCooldown as PromptDecision.Refuse).code,
        )

        val afterCooldown = DeviceAdminEnrollmentMath.decide(
            declined,
            T0 + DeviceAdminEnrollmentMath.DECLINE_COOLDOWN_MS + 1L,
        )
        assertTrue(
            "an operator who genuinely wants it later must not be locked out forever",
            afterCooldown is PromptDecision.Prompt,
        )
    }

    @Test
    fun `the cooldown never blocks a screen that has since been enrolled`() {
        val enrolledAfterDeclining = AdminEnrollmentRecord(isActiveAdmin = true, declinedAtMs = T0)
        // Not "recently-declined" — "already-enrolled". Ordering matters:
        // the reply the dashboard shows must be the true one.
        val d = DeviceAdminEnrollmentMath.decide(enrolledAfterDeclining, T0 + 1_000L)
        assertEquals(
            DeviceAdminEnrollmentMath.CODE_ALREADY_ENROLLED,
            (d as PromptDecision.Refuse).code,
        )
    }

    // ─── the full ceremony, end to end ──────────────────────────────

    @Test
    fun `prompt then approve makes the tier available in the SAME session`() {
        // This is the behaviour the whole feature rests on: the operator
        // taps Activate, comes back, and BLANK is device-admin without a
        // process restart. settle() is what MainActivity.onResume calls
        // immediately before DisplayControlRegistry.invalidate().
        var rec = fresh()

        // 1. operator asks
        assertTrue(DeviceAdminEnrollmentMath.decide(rec, T0) is PromptDecision.Prompt)
        rec = rec.copy(promptedAtMs = T0)
        assertEquals(AdminEnrollmentState.PROMPT_PENDING, DeviceAdminEnrollmentMath.state(rec, T0))

        // 2. operator taps Activate; the OS now says we are an admin
        val backAt = T0 + 8_000L
        rec = rec.copy(isActiveAdmin = true)
        val settled = DeviceAdminEnrollmentMath.settle(rec, backAt)
        assertNotNull("a resolved prompt must produce a write", settled)
        assertEquals(AdminEnrollmentState.ENROLLED, DeviceAdminEnrollmentMath.state(settled!!, backAt))

        // 3. asking again is a clean no-op, not a second dialog
        assertEquals(
            DeviceAdminEnrollmentMath.CODE_ALREADY_ENROLLED,
            (DeviceAdminEnrollmentMath.decide(settled, backAt) as PromptDecision.Refuse).code,
        )
    }

    @Test
    fun `prompt then cancel leaves the fallback tier and does not re-ask`() {
        var rec = fresh().copy(promptedAtMs = T0)
        val backAt = T0 + 20_000L
        rec = DeviceAdminEnrollmentMath.settle(rec, backAt)!!
        assertEquals(AdminEnrollmentState.DECLINED, DeviceAdminEnrollmentMath.state(rec, backAt))
        assertEquals(
            DeviceAdminEnrollmentMath.CODE_RECENTLY_DECLINED,
            (DeviceAdminEnrollmentMath.decide(rec, backAt + 1_000L) as PromptDecision.Refuse).code,
        )
    }

    // ─── wire vocabulary ────────────────────────────────────────────

    @Test
    fun `wire names are the stable strings the probe and dashboard read`() {
        assertEquals("enrolled", DeviceAdminEnrollmentMath.wireName(AdminEnrollmentState.ENROLLED))
        assertEquals("prompt-pending", DeviceAdminEnrollmentMath.wireName(AdminEnrollmentState.PROMPT_PENDING))
        assertEquals("declined", DeviceAdminEnrollmentMath.wireName(AdminEnrollmentState.DECLINED))
        assertEquals("not-enrolled", DeviceAdminEnrollmentMath.wireName(AdminEnrollmentState.NOT_ENROLLED))
    }
}

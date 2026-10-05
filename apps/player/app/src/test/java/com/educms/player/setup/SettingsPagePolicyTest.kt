package com.educms.player.setup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WHICH APP A SETUP BUTTON MAY OPEN (v1.1.23 — the X80 loop).
 *
 * Owner on a VisionCore X80 (Goodview firmware on an RK3328), remote only:
 * Enter on the setup card opened a Google web page, Back returned to the same
 * card, and there was no other way out. Every setup button used to be a bare
 * `startActivity(<implicit Settings intent>)`; whatever the ROM resolved it
 * to — a browser, a search app, a chooser — opened. These cases pin the rule
 * that replaced it, one shape per way a ROM can get it wrong.
 */
class SettingsPagePolicyTest {

    private val own = setOf("com.educms.player", "com.educms.manager", "com.educms.manager.debug")

    private fun h(
        pkg: String,
        activity: String = "$pkg.Main",
        system: Boolean = true,
        browser: Boolean = false,
    ) = PageHandler(pkg, activity, system, browser)

    private val settings = h("com.android.settings", "com.android.settings.Settings\$WriteSettingsActivity")
    private val goodviewSettings = h("com.goodview.settings", "com.goodview.settings.MainActivity")
    private val chrome = h("com.android.chrome", browser = true)
    private val chooser = h("android", "com.android.internal.app.ResolverActivity")

    @Test
    fun `the ROM's own Settings page opens, explicitly`() {
        val d = SettingsPagePolicy.decide(IntentResolution(listOf(settings), settings), own)
        assertTrue(d is PageDecision.Open)
        assertEquals(settings, (d as PageDecision.Open).handler)
    }

    @Test
    fun `a web browser is never a Settings page — the X80 Google page`() {
        val d = SettingsPagePolicy.decide(IntentResolution(listOf(chrome), chrome), own)
        assertTrue("a browser must be refused", d is PageDecision.Refuse)
        d as PageDecision.Refuse
        assertEquals(SettingsPagePolicy.REFUSE_NOT_SETTINGS, d.code)
        assertTrue("the refusal names what the ROM sent it to", d.reason.contains("com.android.chrome"))
    }

    @Test
    fun `the Google search app is refused even though it is not a generic browser`() {
        val google = h("com.google.android.googlequicksearchbox", browser = false)
        val d = SettingsPagePolicy.decide(IntentResolution(listOf(google), google), own)
        assertTrue(d is PageDecision.Refuse)
        assertEquals(SettingsPagePolicy.REFUSE_NOT_SETTINGS, (d as PageDecision.Refuse).code)
    }

    @Test
    fun `a downloaded app is never a Settings page`() {
        val thirdParty = h("com.some.launcher", system = false)
        val d = SettingsPagePolicy.decide(IntentResolution(listOf(thirdParty), thirdParty), own)
        assertTrue(d is PageDecision.Refuse)
    }

    @Test
    fun `a chooser is never opened — the Settings app is picked out of it`() {
        // Two apps answer and neither is the default: the ROM's resolver
        // reports the chooser. Opening the chooser on a remote-only panel
        // is exactly how "Settings or Chrome?" lands on Chrome.
        val d = SettingsPagePolicy.decide(
            IntentResolution(listOf(chrome, goodviewSettings), chooser),
            own,
        )
        assertTrue(d is PageDecision.Open)
        assertEquals(goodviewSettings, (d as PageDecision.Open).handler)
    }

    @Test
    fun `a browser set as the default loses to a Settings app that also answers`() {
        val d = SettingsPagePolicy.decide(IntentResolution(listOf(chrome, settings), chrome), own)
        assertEquals(settings, (d as PageDecision.Open).handler)
    }

    @Test
    fun `our own apps never open as a Settings page`() {
        val us = h("com.educms.player")
        val d = SettingsPagePolicy.decide(IntentResolution(listOf(us), us), own)
        assertTrue(d is PageDecision.Refuse)
    }

    @Test
    fun `nothing answering is reported as no page, not as a foreign app`() {
        val d = SettingsPagePolicy.decide(IntentResolution(emptyList(), null), own)
        assertEquals(SettingsPagePolicy.REFUSE_NO_PAGE, (d as PageDecision.Refuse).code)
        // The chooser alone (no real handler listed) is still "no page".
        val c = SettingsPagePolicy.decide(IntentResolution(emptyList(), chooser), own)
        assertEquals(SettingsPagePolicy.REFUSE_NO_PAGE, (c as PageDecision.Refuse).code)
    }

    @Test
    fun `the direct page wins when it opens`() {
        val r = SettingsPagePolicy.route(
            PageDecision.Open(settings),
            PageDecision.Open(goodviewSettings),
        )
        assertTrue(r.available)
        assertFalse(r.viaFallback)
        assertEquals(settings, r.handler)
        assertNull(r.directRefusal)
        assertNull(r.refusal)
    }

    @Test
    fun `a missing direct page falls back to the broader page — the X80 Modify-system-settings case`() {
        val missing = PageDecision.Refuse(SettingsPagePolicy.REFUSE_NO_PAGE, "nothing")
        val r = SettingsPagePolicy.route(missing, PageDecision.Open(goodviewSettings))
        assertTrue(r.available)
        assertTrue(r.viaFallback)
        assertEquals(goodviewSettings, r.handler)
        assertEquals(missing, r.directRefusal)
        assertNull(r.refusal)
    }

    @Test
    fun `when nothing vetted can open, the step is unavailable and says the more specific why`() {
        val toBrowser = PageDecision.Refuse(SettingsPagePolicy.REFUSE_NOT_SETTINGS, "sends this page to com.android.chrome — not a Settings app")
        val noFallback = PageDecision.Refuse(SettingsPagePolicy.REFUSE_NO_PAGE, "nothing")
        val r = SettingsPagePolicy.route(toBrowser, noFallback)
        assertFalse(r.available)
        assertNull(r.handler)
        assertEquals(toBrowser, r.refusal)
        // And with no fallback at all.
        val bare = SettingsPagePolicy.route(noFallback, null)
        assertFalse(bare.available)
        assertEquals(noFallback, bare.refusal)
    }
}

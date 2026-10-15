package com.educms.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

class UrlOverlayRecoveryWiringTest {
    private fun mainActivity(): String {
        var dir: File? = File("").absoluteFile
        while (dir != null && !File(dir, "src/main/AndroidManifest.xml").isFile) dir = dir.parentFile
        Assume.assumeTrue("player module root not on disk", dir != null)
        return File(dir, "src/main/java/com/educms/player/MainActivity.kt").readText()
    }

    @Test fun `failed plain URL retries saved target while healthy and Website Tabs views do not`() {
        val src = mainActivity()
        val fail = src.substringAfter("private fun failUrlOverlayLoad(").substringBefore("private fun scheduleUrlOverlayRetry(")
        val retry = src.substringAfter("private fun retryUrlOverlayNow()").substringBefore("private fun clearUrlOverlayRecovery(")
        assertTrue(fail.contains("urlOverlayCurrentUrl ?: return"))
        assertTrue(fail.contains("HostAllowlist.isSafeWebUrl(target)"))
        assertTrue(fail.contains("loadDataWithBaseURL("))
        assertTrue(fail.contains("scheduleUrlOverlayRetry(target)"))
        assertTrue(retry.contains("webTabsActive"))
        assertTrue(retry.contains("urlOverlayView.loadUrl(target)"))
        assertTrue(src.contains("registerUrlOverlayNetworkRecovery()"))
        assertTrue(src.contains("retryUrlOverlayNow()"))
    }

    @Test fun `plain URL Back dismisses visible overlay and returns focus to player`() {
        val src = mainActivity()
        val back = src.substringAfter("override fun handleOnBackPressed()").substringBefore("override fun onKeyDown")
        val escape = back.substringAfter("back-press: dismissing URL asset").substringBefore("Tell the web player")
        assertTrue(escape.contains("hideUrlOverlay()"))
        assertTrue(escape.contains("webView.requestFocus()"))
        assertFalse(escape.contains("evaluateJavascript"))
    }

    @Test fun `local offline card is excluded from spatial navigation injection`() {
        val src = mainActivity()
        val finished = src.substringAfter("override fun onPageFinished(view: WebView?, url: String?)")
            .substringBefore("\n            }\n        }")
        assertTrue(finished.contains("urlOverlayRecoveryFailed"))
        assertTrue(finished.contains("SpatialNavigation.inject(it)"))
        val config = src.substringAfter("private fun configureUrlOverlay(").substringBefore("private fun registerUrlOverlayNetworkRecovery(")
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .lines().filterNot { it.trimStart().startsWith("//") }.joinToString("\n")
        assertFalse(config.contains("addJavascriptInterface"))
        assertFalse(config.contains("addWebMessageListener"))
    }
}

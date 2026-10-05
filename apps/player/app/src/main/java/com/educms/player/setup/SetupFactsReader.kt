package com.educms.player.setup

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.provider.Settings
import com.educms.player.logging.PlayerLogger

/**
 * The PackageManager half of [SettingsPagePolicy]: what a Settings intent
 * resolves to on THIS box, read the way the system itself resolves it.
 *
 * ⚠️ OFF THE MAIN THREAD. Every call here is a binder transaction into the
 * package manager, and the X80 is a 2 GB RK3328 that also streams 4K video.
 * `SetupCeremony` runs these on its own `setup-facts` thread and posts the
 * result back; the probe runs them on the bridge thread. Nothing in this file
 * may be called from a click handler.
 *
 * Package visibility (API 30+): the `<queries>` block in AndroidManifest.xml
 * declares every Settings action the checklist opens, plus a plain https
 * link (to recognise browsers). Without it a release build is shown a
 * filtered list and every page would look "missing".
 */
internal object SetupFactsReader {

    private const val TAG = "SetupFacts"

    /** Any https page: what a web browser answers and a Settings app does not. */
    private const val BROWSER_PROBE_URL = "https://example.com/"

    /** Packages that answer a plain https link on this box — i.e. web browsers. */
    fun browserPackages(ctx: Context): Set<String> = try {
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse(BROWSER_PROBE_URL))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        ctx.packageManager.queryIntentActivities(probe, PackageManager.MATCH_ALL)
            .mapNotNull { it.activityInfo?.packageName }
            .toSet()
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "browser lookup failed: ${t.message}")
        emptySet()
    }

    /** What [intent] resolves to here. Never throws: a failed read is "nothing resolves". */
    fun resolve(ctx: Context, intent: Intent, browsers: Set<String>): IntentResolution {
        val pm = ctx.packageManager
        val handlers = try {
            pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
                .mapNotNull { handlerOf(pm, it, browsers) }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "queryIntentActivities(${intent.action}) failed: ${t.message}")
            emptyList()
        }
        val default = try {
            pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.let { handlerOf(pm, it, browsers) }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "resolveActivity(${intent.action}) failed: ${t.message}")
            null
        }
        return IntentResolution(handlers = handlers, defaultHandler = default)
    }

    private fun handlerOf(pm: PackageManager, ri: ResolveInfo, browsers: Set<String>): PageHandler? {
        val info = ri.activityInfo ?: return null
        val flags = info.applicationInfo?.flags ?: 0
        val system = (flags and (ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0
        val label = try {
            info.applicationInfo?.loadLabel(pm)?.toString()
        } catch (_: Throwable) {
            null
        }
        return PageHandler(
            packageName = info.packageName,
            activityName = info.name,
            systemApp = system,
            browser = info.packageName in browsers,
            label = label,
        )
    }

    /**
     * The label Android Settings shows for [pkg] ("VenueOS Player"), or null
     * when the package is not installed / not visible. Rows name the app by
     * THIS, never by a hard-coded string — the 1.1.22 hints said "Venue OS
     * Player" while every Settings list on the box said "VenueOS Player".
     */
    fun appLabel(ctx: Context, pkg: String): String? = try {
        val pm = ctx.packageManager
        pm.getApplicationInfo(pkg, 0).loadLabel(pm).toString().takeIf { it.isNotBlank() }
    } catch (_: Throwable) {
        null
    }

    /** `Settings.Global.BOOT_COUNT`, or -1 on a ROM that does not keep it. */
    fun bootCount(ctx: Context): Int = try {
        Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT, -1)
    } catch (_: Throwable) {
        -1
    }
}

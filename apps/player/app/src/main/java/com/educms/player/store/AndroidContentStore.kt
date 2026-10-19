package com.educms.player.store

import android.annotation.SuppressLint
import android.content.Context
import android.os.Process
import android.system.Os
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.face.FaceTokenStore
import com.educms.player.logging.PlayerLogger
import com.educms.player.media.SharedVideoSourcePolicy
import com.educms.player.security.HostAllowlist
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Production wiring: the real credential store (read-only), the API and
 * storage allowlists the native engines already use, `Os.stat` inodes and one
 * background-priority worker thread. The lead calls [start] once (see the PR's
 * "Integration points") and assigns the result to `ContentStorePort.store`.
 *
 * Ships DARK: until a face's authenticated manifest enrols it (`PLAYER_NATIVE_FIRST`)
 * the store downloads nothing, adopts nothing and reports `mode: off`.
 */
internal object AndroidContentStore {
    private const val TAG = "ContentStore"

    fun start(
        context: Context,
        classAllows: () -> Boolean = { true },
        enrolledBy: ((JSONObject) -> Boolean)? = null,
    ): ContentStore {
        val app = context.applicationContext
        val worker = Executors.newSingleThreadScheduledExecutor { r ->
            Thread({
                Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
                r.run()
            }, "content-store").apply { isDaemon = true }
        }
        val queued = AtomicBoolean(false)
        lateinit var store: ContentStore
        val kick: () -> Unit = {
            if (queued.compareAndSet(false, true)) worker.execute {
                queued.set(false)
                store.pump()
            }
        }
        store = ContentStore(app.filesDir, env(app, classAllows, enrolledBy), kick)
        // Retries, backoffs and the periodic re-reads (only while enrolled) are driven from here.
        worker.scheduleWithFixedDelay({ store.pump() }, 3, 60, TimeUnit.SECONDS)
        store.start()
        return store
    }

    private fun env(app: Context, classAllows: () -> Boolean, enrolledBy: ((JSONObject) -> Boolean)?): StoreEnv {
        val credentials = object : StoreCredentials {
            override fun faces(): List<Int> = listOf(0, 1)
            override fun token(face: Int): String? = FaceTokenStore.read(app, face)
            override fun apiBase(): String? = runCatching {
                val saved = app.getSharedPreferences("edu_player", Context.MODE_PRIVATE).getString("api_root", null) ?: return null
                SharedVideoSourcePolicy.apiBase(saved)
            }.getOrNull()
        }
        val disk = object : StoreDisk {
            // Conservative on purpose: the budget never counts cache space the OS has not freed
            // (getAllocatableBytes would, and a store sized on it could fill the disk).
            @SuppressLint("UsableSpace")
            override fun usableBytes(dir: File): Long = dir.usableSpace
            override fun inode(file: File): Long = runCatching { Os.stat(file.path).st_ino }.getOrDefault(0L)
            override fun link(from: File, to: File): Boolean = runCatching { Os.link(from.path, to.path); true }.getOrDefault(false)
        }
        val clock = object : StoreClock {
            override fun nowMs(): Long = System.currentTimeMillis()
            override fun sleep(ms: Long) = Thread.sleep(ms)
        }
        return StoreEnv(
            clock = clock,
            http = UrlConnectionStoreHttp(),
            credentials = credentials,
            disk = disk,
            screenIdOf = { NativeAlertWatchPolicy.screenIdOf(it) },
            apiHostAllowed = { HostAllowlist.isApiHost(it) },
            storageAllowed = { SharedVideoSourcePolicy.allowed(it) },
            classAllows = classAllows,
            enrolledBy = enrolledBy ?: ::nativeFirstEnrolled,
            log = { PlayerLogger.i(TAG, it) },
        )
    }
}

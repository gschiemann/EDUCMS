package com.educms.player.network

import android.content.Context

/**
 * RELEASE: there is no demo. The debug source set's twin builds scripted
 * networks for screenshots; a release APK can never show one ([NetworkDemo]).
 *
 * ⚠️ This file must stay TRACKED — without it a release build does not
 * compile. `apps/player/.gitignore`'s bare `release/` rule (meant for build
 * output) also matches `src/release/`, so it was added with `git add -f`.
 */
internal object NetworkScreenDemo {
    @Suppress("UNUSED_PARAMETER")
    fun scenario(ctx: Context): NetworkDemo? = null
}

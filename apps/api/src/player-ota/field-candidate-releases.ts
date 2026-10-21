/** Immutable provenance records for explicitly enabled private field artifacts.
 * Populated only after signed CI artifact/hash/certificate verification. These
 * entries never participate in the stable GitHub release catalogue.
 */
export interface FieldCandidateRelease {
  versionName: string;
  versionCode: number;
  sha256: string;
  size: number;
  sourceUrl: string;
}
export const FIELD_CANDIDATE_RELEASES: Readonly<
  Record<string, FieldCandidateRelease>
> = {
  // Signed CI run 37979383254, source 583ccf14. Private mirror read back and
  // verified; release certificate e45adf50…3d1897 matches the installed fleet.
  '1.1.25-field.1': {
    versionName: '1.1.25-field.1',
    versionCode: 10125,
    sha256: 'b4d83b39a8732b8a8a513a7016091ea7ad6caec4f033a28f5bf8f73cc23b4dcd',
    size: 2353191,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/37979383254',
  },
  // Signed CI run 38233912481, source 8cf68fae (native video protocol 3).
  // Private mirror read back and verified; release certificate
  // e45adf50…3d1897 matches the installed fleet. Test units only (owner
  // 2026-10-12: VisionCore, M43, L55VEC), one at a time.
  '1.1.30-field.1': {
    versionName: '1.1.30-field.1',
    versionCode: 10130,
    sha256: '4a530a4c4fa3c7bbfd9d6a8dd2cc285ce6afb13fed271d78bf30f4f56301b77f',
    size: 2387599,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38233912481',
  },
  // Signed CI run 38258733645 (native: credential compared by screen identity).
  // Mirror read back + verified; certificate e45adf50…3d1897 = installed fleet.
  '1.1.31-field.1': {
    versionName: '1.1.31-field.1',
    versionCode: 10131,
    sha256: '256fdb4d87b73c6c55d5379259989a1ced7e50c77f82bf63fbeef49c47007062',
    size: 2387607,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38258733645',
  },
  // Signed CI run 38263856359 (native: decoder accepted by size+rate in either orientation).
  // Mirror read back + verified; certificate e45adf50…3d1897 = installed fleet.
  '1.1.32-field.1': {
    versionName: '1.1.32-field.1',
    versionCode: 10132,
    sha256: '87d04e9b06fea466d66fc1bf65d1870c53545ca7db754f006f037fc0ceeec4f0',
    size: 2387603,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38263856359',
  },
  // Signed CI run 38315564358 (native: solo video above the page — Rockchip white-glass fix).
  // Mirror read back + verified; certificate e45adf50…3d1897 = installed fleet.
  '1.1.33-field.1': {
    versionName: '1.1.33-field.1',
    versionCode: 10133,
    sha256: 'bb1b2202212ede7632c9421457e404471193bcd35025ad40cac829797d0a5c14',
    size: 2387599,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38315564358',
  },
  // Signed CI run 38451639426, source d0d7a99e. First-frame solo layer
  // promotion with operator/blackout retirement; whole-content P2 fit.
  // Verified non-debuggable, universal ABIs, release certificate
  // e45adf50…3d1897 matches stable 1.1.29. Private two-screen field test.
  '1.1.34-field.1': {
    versionName: '1.1.34-field.1',
    versionCode: 10134,
    sha256: 'e6a173f22fbe10149fa2aa2656f6c55b2e8f0e7b1453f1a273d23a8c47ce021a',
    size: 2387599,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38451639426',
  },
  // Signed private CI run 38465765964, source b44b97ee; native lifecycle readiness.
  // Private mirror read back; release certificate matches stable 1.1.29.
  '1.1.35-field.1': {
    versionName: "1.1.35-field.1",
    versionCode: 10135,
    sha256: "b2dfd82ff50984052f69355091480f3ff8585a2250f145349de5f47356009ed1",
    size: 2387607,
    sourceUrl: "https://github.com/gschiemann/EDUCMS/actions/runs/38465765964",
  },
  // Signed CI run 38469499321 (Rockchip 16-aligned decoder check + solo layer above window).
  // Mirror read back + verified; certificate e45adf50…3d1897 = installed fleet.
  '1.1.36-field.1': {
    versionName: '1.1.36-field.1',
    versionCode: 10136,
    sha256: '6228d788df4d300935c61e8b29fb7edb3788db475bebc3d10913593f53ff1e35',
    size: 2387607,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38469499321',
  },
  // Signed CI run 38518351926, source ad5704cd; Android 11 solo surface ownership.
  // Immutable private mirror verified; production certificate matches stable 1.1.29.
  '1.1.37-field.1': {
    versionName: '1.1.37-field.1',
    versionCode: 10137,
    sha256: '83ebe2268a590a1a2a87dda34d23362836d609e692a307bfaaa790edd6317321',
    size: 2403983,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38518351926',
  },
  // Signed CI 38743322973, source 3a98877a; skip foreground watchdog relaunch.
  // Private mirror verified against the APK and production signing certificate.
  '1.1.38-field.1': {
    versionName: '1.1.38-field.1',
    versionCode: 10138,
    sha256: 'a1bb3935e7e48d0f3e73a2b844cf34e4fbfec7d59f2ca297fe3a757492382a2f',
    size: 2403987,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38743322973',
  },
  // Signed CI 38786943327, source f47885d3; native pacing and URL recovery.
  // Private mirror, production certificate and new DEX feature markers verified.
  '1.1.39-field.1': {
    versionName: '1.1.39-field.1',
    versionCode: 10139,
    sha256: 'a7bc9672883ca5b087f2b4958d644d8716837f0aa07c80dfbff963ca83c7e078', // gitleaks:allow -- verified public APK integrity digest
    size: 2403987,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38786943327',
  },
  // Signed CI 38824589080, source becb845f; legacy Rockchip solo surface ownership.
  // Signature, new DEX markers and immutable private mirror verified; hardware qualification pending.
  '1.1.40-field.1': {
    versionName: '1.1.40-field.1',
    versionCode: 10140,
    sha256: 'bda5ad6b361dd3602b9e22b667f7bc4313050e9de81a363a59d36105c23ba2e9', // gitleaks:allow -- verified public APK integrity digest
    size: 2403987,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38824589080',
  },
  // Signed CI 39074710993, source ce7ea68b (branch claude/suspicious-moser-432bdd, never rebased):
  // one compositing contract (opaque WebView; solo AND positioned slots above the window or
  // refused), device-class policy table, callback-interval histogram + reboot-aware ledger,
  // the three M43 experiments behind manifest flags. Production certificate e45adf50…3d1897,
  // versionCode 10141, universal APK (4 ABIs), non-debuggable, 1.1.41-only DEX markers present
  // and absent from the .40 artifact. Private mirror NOT uploaded by the registering session.
  // Hardware qualification pending (2026-10-21).
  '1.1.41-field.1': {
    versionName: '1.1.41-field.1',
    versionCode: 10141,
    sha256: 'b0354519381b73bee6af2de35cac40f8e2175b6b0919203ee96c79b9c27a31e3', // gitleaks:allow -- verified public APK integrity digest
    size: 2403987,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/39074710993',
  },
  // Signed CI 39095313732, source 184ca7ed (branch claude/goofy-gagarin-914f85, off master 861ddc7e):
  // pacing — vsync-snapped release on a Choreographer-measured grid with a bounded media-clock
  // slew (`vsync-snap`), a same-resolution ~60 Hz mode request at a native session boundary
  // (`prefer-60hz`, default OFF: a mode switch can blank the panel), every supported display mode
  // on the snapshot and the device report, keep-screen-on observed (never held), the sleep report's
  // proven off cause. Production certificate e45adf50…3d1897, versionCode 10142, universal APK
  // (4 ABIs), non-debuggable, 1.1.42-only DEX markers present and absent from the .41 artifact.
  // Private mirror NOT uploaded by the registering session. Hardware qualification pending.
  '1.1.42-field.1': {
    versionName: '1.1.42-field.1',
    versionCode: 10142,
    sha256: '1bde8ad37345fa0deafa7c53012b0de457a7b4fd847707f912ad691332f29ce5', // gitleaks:allow -- verified public APK integrity digest
    size: 2420475,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/39095313732',
  },
  // Signed CI 39306215680, source f7132ea6 (PR #113, merged 48e18251): auto-detected pacing
  // defaults — vsync snap on per class, a grid-sized release lead (0.5 of a period at >= 50 Hz,
  // 0.8 below), an automatic same-resolution ~60 Hz request on the main display with a 10 s
  // safety net (no switch / no frames -> reverted and blocked 24 h; never asked or undone under an
  // emergency hold), the closed native end-reason grading (host-replaced transient), the panel's
  // firmware display facts. Production certificate e45adf50…3d1897, versionCode 10143, universal
  // APK (4 ABIs), non-debuggable, 1.1.43-only DEX markers present. Hardware qualification pending.
  '1.1.43-field.1': {
    versionName: '1.1.43-field.1',
    versionCode: 10143,
    sha256: 'a2ca45bdac135471e66913ef5b6216c9db2bcb66f551d0ea43919240e949a5f7', // gitleaks:allow -- verified public APK integrity digest
    size: 2436899,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/39306215680',
  },
  // Signed CI 39315500242, source b6bfd12a (PR #118, native-first integration): 1.1.43 plus native
  // first SHIPPED DARK — protocol v4 intents on the existing shared-video methods, the page lease
  // (playback survives the page), the native->native boundary switch, the alert watch polling fast
  // only for a presenting native face with no page lease, the closed end-reason table, the content
  // store (unwired). Nothing changes for a screen PLAYER_NATIVE_FIRST does not name. Production
  // certificate e45adf50…3d1897, versionCode 10144, universal APK (4 ABIs), non-debuggable.
  // Hardware qualification pending (the §7 E1–E7 drills on an enrolled unit).
  '1.1.44-field.1': {
    versionName: '1.1.44-field.1',
    versionCode: 10144,
    sha256: '26cc99a54104ffa0d6c1637e4edf807208feebad6c0cf299d7cdcb9212b57264', // gitleaks:allow -- verified public APK integrity digest
    size: 2463481,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/39315500242',
  },
  // Signed CI 39457549024, source 5179ca39 (PR #119): native-first restores after an all-clear
  // (an emergency manifest no longer clears the persisted switch); GUQ decode-stall mitigations
  // (decode thread display priority, background workers lowered, page cache work paused while
  // native presents, never the emergency set). Production certificate e45adf50…3d1897,
  // versionCode 10145, non-debuggable. Hardware qualification pending.
  '1.1.45-field.1': {
    versionName: '1.1.45-field.1',
    versionCode: 10145,
    sha256: 'ace0b655af64b46741d4153aae572e64f049be141a5b8a91cf31ad0df7c64714', // gitleaks:allow -- verified public APK integrity digest
    size: 2463489,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/39457549024',
  },
  // Signed CI 39472974677, source ba680515 (PR #120): a pending install is never buried by recovery;
  // the Back menu shows "Install <target>" and opens Android's dialog on press; a re-push replaces a
  // stuck install; correct version label; Android 9 push trigger. Production certificate e45adf50…3d1897,
  // versionCode 10146, non-debuggable. Hardware qualification pending.
  '1.1.46-field.1': {
    versionName: '1.1.46-field.1',
    versionCode: 10146,
    sha256: '13c4737971d3d831b63ae0f1707963e4aceb32089e33c8371adccccd4efad27f', // gitleaks:allow -- verified public APK integrity digest
    size: 2479873,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/39472974677',
  },
  // Signed CI 39481406005 (PR #121): 30 fps releases locked to one phase of a 60 Hz grid
  // (parityLocked / parityFlips / driftCorrections on the timing snapshot) — the M43/L55VEC
  // 30 Hz-panel judder. Production certificate e45adf50…3d1897, versionCode 10147,
  // non-debuggable. Hardware qualification pending.
  '1.1.47-field.1': {
    versionName: '1.1.47-field.1',
    versionCode: 10147,
    sha256: 'f534a70a4a53f7ced9338c95435d92a86e872b02b1afaa367a924143c57375b1', // gitleaks:allow -- verified public APK integrity digest
    size: 2479865,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/39481406005',
  },
  // Signed CI 39607517698, source 101b0f5c; emergency presentation handoff.
  // Production certificate e45adf50…3d1897, versionCode 10148, all four ABIs,
  // non-debuggable and immutable private mirror verified. Hardware qualification pending.
  '1.1.48-field.1': {
    versionName: '1.1.48-field.1',
    versionCode: 10148,
    sha256: 'ae6017539339275988a45dbd13279f60cb906a5da80487c7b65c6dc2c4b66efd', // gitleaks:allow -- verified public APK integrity digest
    size: 2479869,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/39607517698',
  },
};

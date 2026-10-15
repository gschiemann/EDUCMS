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
};

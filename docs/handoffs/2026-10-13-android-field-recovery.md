# Android recovery and full-screen media fitting — Claude handoff

## Current outcome

Template work is paused and preserved. Android 1.1.34-field.1 is installed on Brookfield L55VEC and M43. The owner confirmed no white screens and full-screen fill with edges intact. Normal media fill is live at c20f9db3. A rolling API/web deployment briefly restored bars on older open pages; this change keeps the API fit explicit so that cannot recur. Stable fleet APK remains 1.1.29.

The owner used remotes/menus, exposing a separate native resume defect: Android retired native on Activity pause, and the web policy kept that content on HTML video. Both .34 units had genuine above-window native first-frame logs; their later rVFC reports were browser playback, not native decoder proof. A private .35 readiness/epoch correction is implemented and source-reviewed by Astra; signed build, delivery, and physical acceptance are pending at this checkpoint.

The owner explicitly added Brookfield DH43 on 2026-10-13. Authorized physical devices are now L55VEC, M43, and DH43 (both faces). DH43 primary screen 40864836-9367-47a3-b349-ba1c3378f814; back screen 80bf9b8d-1271-4b21-bb5b-0626ce6a8092. The two faces share one Android 7.1/SDK25 APK installation. At 20:36Z, HTML samples dropped 833/1569 front (~53%) and 755/1550 back (~49%); the primary's .29 native attempt at 16:32Z failed hardware-codec-unavailable before presenting and wrote a genuine build-scoped block. Do not clear that block manually. The newer APK inherits the already-reviewed size/rate check in either video orientation. Its actual codec acceptance and two-face performance remain to be measured.

## Native pause/resume correction

Additive read-only availability on sharedVideoState publishes UI-thread observations of Activity foreground, panel interactivity, actual window focus, physical native UI clearance, and a monotonically increasing ready epoch. The operator-request latch is kept separate and only the existing eligible prepare clears it. Secondary Presentation reports focusRequired=false because it need not own remote input; its readiness still requires foreground, a visible attached host, clear recovery UI, and the primary's clear native UI predicate.

Pause sets foreground false and refreshes primary/secondary snapshots BEFORE retiring native sessions. Protocol-2 prepare, commit and watch enforce readiness independently of above-window layer eligibility. The SDK33 primary layer promotion remains unchanged; Android7 and secondary window layering are not generalized blindly.

The web keeps the browser alive while waiting. Exact activity-paused/page-stopped failures on a supporting APK receive one recovery attempt per newer ready epoch, including resume-before-failure-poll. A missing/invalid bridge reply is unknown, never proof of an old APK; valid legacy absence preserves old behavior. A handoff timeout rechecks the SAME prepared attempt rather than inventing a pause. Boundary listeners, timers and late callbacks are canceled on retirement/identity change. All other post-presenting transient policies and genuine codec/digest/file fault blocks remain intact. Native decoder drops are now carried in protocol-2 telemetry separately from HTML loop evidence.

Astra's two initial review blockers were corrected and covered by mounted React regressions; follow-up found no remaining actionable blocker in scope. Tests: Android 903 tests/82 suites, lint and debug build PASS; focused web 85 tests/5 suites PASS; full preflight PASS. Chromium/WebKit lifecycle, decoder-release/fallback, and mocked emergency/all-clear browser checks PASS (6/6). These are software checks, not hardware qualification.

## Exact private APK scope and provenance

Tenant28d09f9d-0a6c-4828-b46d-38712eb69f1f, Brookfield Residential Northern California.
L55VEC882706a8-33d9-45a6-a10c-c102e56da8b2; M43c4945182-435e-4260-8765-8091243828cc. Both Android13/SDK33, primary faces2160x3840. Do not widen APK enrollment based on these two successes.

Signed Actions run https://github.com/gschiemann/EDUCMS/actions/runs/38451639426 SUCCESS, source d0d7a99ecc3e2d09013118783cc47c9f7d5fabcd. Packagecom.educms.player; version1.1.34-field.1/code10134; universalarm64-v8a/armeabi-v7a/x86/x86_64; non-debuggable; size2387599bytes.
SHA256 e6a173f22fbe10149fa2aa2656f6c55b2e8f0e7b1453f1a273d23a8c47ce021a.
Certificate e45adf50fd7236cdeb07aa1583368f5cc5430187633a1b99ad62086edd3d1897 matches downloaded stable1.1.29. apks storagebucket verified private(public=false); immutable field-player/<sha>.apk uploaded without overwrite and read back with exactsize/hash. APK/PROVENANCE.json saved on Desktop. Registry entry records immutable provenance; no private build is a stable release.

Audited PLAYER_APK_FIELD_* window targets only these two IDs/tenant, expires2026-10-13T22:30:00Z. Individual authenticated pushes returned201 with L55corrIdota-mv72jhyj-ixb2nm and M43ota-mv72jiap-fv9zop. AuditLogs verified. Device status confirmed both10134; no merely queued push was called installed. No credentials were minted, cleared, rotated or committed. Old user-agent1.1.23 and previous legacy engine=native/rvfc telemetry were not used as native/installation proof.

## White-screen cause and correction

Astra found previous .33 setZOrderMediaOverlay(true) still keeps a SurfaceView BELOW the window. Web video was destroyed and the held canvas hidden on decoder callbacks although the opaque window could obscure nativeoutput. Healthy decode callbacks cannot prove panel visibility.

SoloVideoLayer stages UNDER_WINDOW→QUEUED→ABOVE_WINDOW→RETIRED. Protocol2, primaryface0, SDK33+ prepares below the window through download/prepare/loop-boundary wait. A valid first renderedframe queues UI-thread promotion with same-session/surface/emergency/operator checks; only then setZOrderOnTop(true) and presenting. Stale callbacks cannot reclaim output. Stop retires before renderer shutdown and immediately hides/removes the output on the mainthread. Back/setup/sites/manager/nativeblackout and web update/Blank/Dim/editor/touch overlays yield ownership; existing transient page-stopped avoids a24hour fileblock. WebViewblack supports native margins. OlderROMs/secondary/protocol1/3 layer approaches remain unchanged. No bridge/auth/hash/enrollment bypass was added.

Astra's three draft blockers (nativeblackout, web controls/dim, unknown stopreason) were fixed and reviewed; final review found no remaining actionable blocker in scope. Both devices reported >16k advancingframecallbacks, five loops/zero stalls, and the owner separately confirmed no white. Surface callbacks are diagnostics, not a substitute for physical proof.

## Fitting: final behavior and evidence

Clipping traced to91319ced(fill→cover) and5fc09198(near ratios staycover);0ec43a11 supplied dimensions so the heuristic ran. A1080x1668 file on1080x1920 loses13.125%width undercover (70.875sourcepixels eachside), consistent with the clipped ARC logo.

Initial contain correction preserved proportions but produced top/bottom bars and was REJECTED by owner. It is superseded by full-surface independent-axis fill. Normal full-screen raster/GIF/video and held frames now usefill, preserving every source edge without generated bars. Wrong aspect ratios can change proportions. Emergency remainscontain; explicitly authored template/widget fit choices remain unchanged.

Inspected Goodview CloudSign3.1.8 GVBOX/RK3288 APKs explicitly useFIT_XY for image/GIF views, match_parent video surfaces, and MediaPlayer without a scaling override. Android documents its default SCALE_TO_FIT as full-surface stretch without cropping. VideoViewBitmap982/972/3328 size callbacks are empty. This supports the platform path; it does not qualify every vendor decoder/hardware class. Full exactclass/resource/hash evidence is in research07.
Primary documentation: https://developer.android.com/reference/android/media/MediaPlayer#VIDEO_SCALING_MODE_SCALE_TO_FIT and https://developer.android.com/reference/android/view/SurfaceView#setZOrderMediaOverlay(boolean).

The temporary fillpilot affected ONLY L55/M43 through an exactUUID selector (noall/wildcard). Nativeoutput changed from2160x3336/3338 to2160x3840. Owner physically confirmed both fillcorrectly, edgesintact. The final change removes the pilot selector/config/state and uses the verified normal default consistently across web/nativeP2. PLAYER_FULLSCREEN_FILL_SCREEN_IDS is cleared for nextAPIdeployment; immutable audit records the physicalacceptance before configuration. ExistingAPK supportsfill, so this web/API correction requires no new APK.

## Verification and limits

Native900tests/81suites, lint/debugassemble PASS; signedCI artifact PASS. Initial integrated API64tests/5suites and web69tests/6suites PASS. Final API focused40tests/2suites and integrated web70tests/6suites PASS; full pnpm preflight PASS. Final production-build Chromium/WebKit8/8 cases PASS: realbitmap exactfourcornerRGB pixels nearportrait and portrait-on-landscape, wrongshapevideo on single-element/two-deck paths. DPR-normalized screenshots inspected and saved. RealPNG used because SVG preserveAspectRatio can pad internally independently of object-fit; SVG-authored internalpadding remains an asset-format behavior, not bitmap/video crop.

No production emergency endpoint/security/audit change. Emergency/messages testhelper mock prevents unrelated liveAPI CORS. No new inset styles. Tenant/hash/credential/emergency fan-out/HTTPfallback retained. Every admission/config/push action audited. Pilot DeployReliability green; full broadCI must finish on the final push before claiming fully shipped. Prior in-progress broadE2E was superseded/cancelled by laterpushes, never counted aspass.

No fleet hardwarequalification PASS is claimed. Physical coldinstall/reboot/offline/update/remote-nav/OTA/boot/emergency trigger/all-clear qualification is still required for the required hardware classes before any stable APK release. Native candidate remains UNQUALIFIED for fleet use, restricted to the authorized two units. Template work remains paused, including Astra WIP.

## Saved work and next completion checks

Paid reports01–10 force-tracked in docs/research/2026-10-13-android-field; finalsource commits in codex/android-field-recovery and isolatedwriterbranches. Photo, APK/provenance, logs, screenshots and bundle are under Desktop/template-flagship-audit/android-field-2026-10-13. Usage reached100%; credits available, lowcost Luna used for APKresearch/scaling work; Astra only for difficult native review. Every substantive return saved immediately.

Next: push finaldefault with preflight hook; watch actualCI green; verify productionbuild-info/assets and Railwaycommit; refresh only authorized officeplayers via authenticated controls; preserve final runtimeverification without repeatedly pushing docs and cancelling CI. Fullscreen fix is for web/API; APKrollout remains two-screen private. Existing players need the new web bundle to use the webdefault; don't claim every running device refreshed without evidence.

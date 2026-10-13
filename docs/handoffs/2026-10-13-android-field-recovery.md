# Android recovery and full-screen media fitting — Claude handoff

## Current outcome

Template work is paused and preserved. Android1.1.34-field.1 is installed ONLY on Brookfield L55VEC and M43. Both physically passed the owner's white-screen check and full-screen beach-clip check: neither turnswhite; bothfillcorrectly with edgecontentintact. The verified full-screen mapping is now the final normal-playlist web/nativeP2 default, tested and ready for the final production deployment. Final deployment/CI verification is still pending at this source checkpoint; see Desktop LIVE-DELIVERY-CHECKPOINT.md for later runtime evidence. Stable APK remains1.1.29; no new fleet APK tag/catalogue was published.

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

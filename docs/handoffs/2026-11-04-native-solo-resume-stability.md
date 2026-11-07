# Normal solo-video resume stability — 2026-11-04

The owner reports a long black interval on the double-sided DH43 AFTER clearing an emergency. It returns without operator intervention; the estimated test time was about 2:30 PM Pacific. No agent trigger/clear, reload, power command, enrolment change or cache wipe was performed.

## Verified source defect and correction

The normal solo branch in page.tsx switched between NativeDualVideo(browser) and the bare browser child as native eligibility changed. Late protocol discovery, descriptor withdrawal, and overlay eligibility could therefore replace the browser media component, resetting its element/current time and loop-package work. The correction keeps the existing NativeDualVideo boundary mounted for a normal solo item and passes null while native is not admitted. Emergency playlist rendering and the mixed/multi-video branches keep their existing path.

Keeping the component alive requires a separate admission epoch: after native had presented, withdrawing and re-admitting the same descriptor must not reuse its former presenting phase and hide the fallback browser before a new native frame. The epoch is internal rendering state, not a native authority, session id or wire change. Existing descriptor checks, lifecycle readiness, emergency suppression, stale-callback retirement, codec limits and loop-boundary handoff remain intact. The latest onPlaying callback is synchronized after commit rather than mutating a ref during render.

Validation: 41 controller/readiness/resume/emergency-ordering unit tests; 16 real-player scenarios across Chromium and WebKit, including loaded browser element identity through withdrawal/re-admission, no current-time/load reset in the unit test, no premature re-hide after a previous native presentation, retired callbacks, menu pause/resume, native failure fallback, emergency preemption via native-v1/native-v2/WebSocket, no regular video while alert details are pending, all-clear restoration, and poll-only overlay survival. Production build, targeted ESLint and inset-serialization guard passed. These are software results; DH43 recovery timing on glass remains UNVERIFIED.

## DH43 evidence and limits

Brookfield primary40864836-9367-47a3-b349-ba1c3378f814/back80bf9b8d-1271-4b21-bb5b-0626ce6a8092 both .64, Android SDK25. Browser usage662459589/quota2331613593: no FUH-style 159 MB shortage demonstrated. Native-video flags name both, native-first/store flags do not; do not silently expand the trial to this hardware class.

Latest recorded drill started 21:40:00.780Z / cleared21:40:31.614Z (1:40 PM Pacific), not an exact match to the owner's approximate2:30 time. Both screen ledgers record clear21:40:32.392Z. A relaunch entry21:40:57.762Z is classified reboot by boot876→877, but a contemporaneous device log reports uptime40777382ms (~11h). Do not equate that label with a proven physical reboot or blame the operator. The owner explicitly says it returned by itself.

Alert-paint recovery records21:41:33–52 report no-overlay-paint-proof, including step4 unconfirmed. Subsequent actual native output appears on back21:42:25 and front format21:43:02. Those are native handoff times, NOT proof the glass stayed black until then; the web-first player may have already been visible. Earlier fallback reason emergency-held/next=stay at21:32:46 was before the .64 install recorded21:35:38, so do not treat it as .64 regression proof.

The later native stops at02:00:12/21Z (6 PM Pacific) coincide with DH43's active Amoruso Ranch Community 07:00–18:00 display schedule. Keep those distinct from the earlier emergency recovery. No automatic schedule edits were made.

Field timing/camera qualification remains necessary. This patch removes a demonstrated remount path; it is not proof that every DH43 delay, the recovery ladder, or Cleveland's multi-video pause is solved. Earlier Astra review approved stable browser/wrapper and boundary-controlled transitions as a development direction; no new Astra review was commissioned per the owner's instruction to stop additional usage. Never shorten a safety hold to conceal black time.

Rollback: revert the web PR. This introduces no API, APK, bridge method, flag, schema or fleet action. Working screens keep their current bundle until existing idle/operator activation permits the new one.

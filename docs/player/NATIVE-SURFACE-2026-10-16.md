# Legacy Rockchip native surface candidate

Brookfield DH43 and Mobile A-Frame showed a pale area at the top of native
video on 1.1.39-field.1. SAR55 went white; returning SAR55 to web playback on
the same APK restored its picture. Decoder callbacks advanced with zero
reported drops during the visible failures. Those counters measure progress,
not final panel appearance. The owner also recalled haze on the paired
settings splash, but could not observe the A-Frame native-off comparison
after leaving the office. Vision Core was not reported hazy.

These devices report Android 7.1 (SDK25), board rk30sdk and model rk3288. Their
assigned Test 4k Port playlist has no template and uses the solo protocol-2
session. The telemetry's protocol=3 field advertised APK capability; it did
not identify a positioned video session. Template clip-path theories do not
apply to this incident. The 4K original and 1080 rendition both declare
H264/yuv420p, limited TV range, BT709 matrix/transfer/primaries and 30fps.

The previous solo ownership fix only covered the primary Android 11+ window.
Older Rockchip solo sessions remained under a transparent WebView. They also
fell outside the immediate native Back retirement filter. The opaque paired
splash means a correctly composed video underneath alone is insufficient to
explain sustained haze; a vendor compositor failure remains a hypothesis.

## Private 1.1.40-field.1 candidate

- Keep hardware decode and SurfaceView. On SDK24–29 Rockchip solo sessions,
  set the above-window order before the surface's child window is created.
- Prepare at full size beyond the physical display, accounting for parent
  position and fitted overhang. Leave the existing web frame visible.
- A valid native callback may request a position-only reveal. Require live
  session, attached output, foreground/UI readiness and no emergency hold.
  Observe matching box and surface geometry at pre-draw, then require a
  later render timestamp. A separate 3.5-second deadline also bounds layout.
- Keep the WebView opaque. Back/emergency/lifecycle retirement hides and
  removes the surface, box and container and restores the background.
- Keep positioned protocol-3 sessions and other hardware policies unchanged.
- Reapply scaling on codec output-format/buffer changes. Log bounded numeric
  input/output crop, stride and color facts. Sample top/middle/bottom buffer
  RGB and alpha after handoff. Buffer samples still do not prove panel output.
- Preserve actual session protocol and composition mode in optional strict
  telemetry fields, separately from capability and frame counters.

Source becb845f, signed workflow run 38824589080. Production certificate,
versionCode10140, all four ABIs, non-debuggable status, new DEX markers and
private storage readback verified. Local verification: 929 Android tests
passed, two pre-existing skips, lint, 83 API telemetry tests, 35 web parser /
zone / resume tests and preflight. Independent source review found no blocker.

This is a private test candidate, not a fleet release or hardware pass. The
physical test must cover DH43 both faces, Mobile A-Frame, normal video and
paired splash, Back/Resume, looping, foreground recovery and emergency
trigger/all-clear. Healthy callbacks must not override a visible artifact.
Stable fleet remains 1.1.29; do not automatically enable A-Frame native before
the supervised comparison. Preserve the existing unaffected screen scopes.

# Astra native white-screen source finding

User scope: only Android; Brookfield L55VEC and M43 private-field recovery and whole-content media fitting. Template work stopped and preserved separately. Source base `44a608e8`.

Agent's early finding, preserved before further work:

> Early source result: current 44a608e8 still uses NativeDualVideo/nativeSharedVideo (requested FaceNativeVideo names absent). Protocol-2 surface is attached while web video continues up to 60 s awaiting loop; setZOrderMediaOverlay(true) remains BELOW window. At commit DOM video is destroyed; native callbacks then hide hold canvas, even though callbacks/isShown cannot prove surface visible through window. This exactly permits brief web→persistent white with healthy counters and no watchdog. Blind setOnTop at attach would occlude whole 60 s boundary period, explaining earlier black/UI regression. Tracing explicit UI surrender/reveal lifecycle and escape now.

Official Android reference confirms media-overlay ordering remains behind the containing window. The finding is source evidence, not a new on-glass test. Full patch/escape/emergency lifecycle analysis pending.

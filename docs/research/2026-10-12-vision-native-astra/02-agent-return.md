# Astra native investigation return

b4eea034, codex/vision-native-astra-review; source report and exact-ID reproduction committed. User confirms Vision Core’s Venue-OS Media Player.

1. Current native playback explicitly excluded by -13eb0b62-d420-4517-922e-e17700716fae in PLAYER_NATIVE_VIDEO. Exact-ID reproduction confirms exclusions override positive enrolment.
2. Latest visibility fix uses wrong API: setZOrderMediaOverlay(true) stays behind app window. https://developer.android.com/reference/android/view/SurfaceView#setZOrderMediaOverlay(boolean)
3. Early SKIPPED message can consume persistent-warning/upload budgets before later native failure.

Decisive proposed test: private target-only comparison, actual above-window ordering at handoff, full native lifecycle logging, physical emergency/escape verification. Changing the creation-time call alone risks up to60sec black coverage. API29/29,web16/16,4rollout reproductions passed. No product changes/deploy/devicecommands/hardwarefix claim.

Lead retrieved historical PLAYER_RECOVERY_EVENT logs; these must be incorporated before final root-cause verdict. Logs include18:10Z SKIPPEDdesc=no/proto3 and22:26Z activity-paused,stage=presenting/next=stay. Current noAPKdecodeproof in latesttelemetry remains unchanged.

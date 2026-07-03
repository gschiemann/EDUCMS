# CRUSH Wave E — E3: publish from inside the editor (2026-07-03)

Fable-approved executor-safe (lift-and-reuse). An operator editing a template can
now push it live WITHOUT leaving the editor.

- New shared hook apps/web/src/lib/put-on-screen.ts (`usePutOnScreen`) — extracted
  verbatim from the gallery's putOnScreen: create a one-item template-backed
  playlist (useCreatePlaylist), then full-nav to /[schoolId]/playlists?publishPlaylist=<id>
  (lands on the existing Publish-to-Screens sheet). templates/page.tsx now uses the
  shared hook (dedup, gallery behavior unchanged).
- BuilderToolbar SaveStatusChip morphs into "Saved · Put on a screen →" once there's
  a persisted, non-dirty template (post-save flash AND steady-state); hidden for
  system/starter templates.
- BuilderShell handlePutOnScreen: if dirty, await the exact handleSave the Save
  button calls, re-check isDirty, bail silently if it didn't land (existing 409/
  error banner is the feedback) — then publish. No second competing dialog.

Proof: e3-put-on-screen.test.tsx (6 RTL cases, real component + real Zustand store)
across saved/idle-clean/dirty/system; agent also verified live via an ephemeral
preview route (deleted pre-commit). tsc clean; 218 template-builder tests green;
mobile-perf clean. Commit b51deb7b. NOTE: full-stack round trip (real API + real
nav) unverified without a DB — RTL + live-DOM component proof substitute.

# D6 — Multiplayer co-edit cursors (deferred)

**Status:** Deferred from Phase D ship (2026-05-12). Tracked for a
future sprint.

## What it would be

Real-time presence + cursor + selection sync between multiple
operators editing the same template at the same time. Live indicators
for who's editing which zone, plus a soft conflict-detection layer
("Greg is editing this widget — your changes will overwrite theirs").

## Why we're deferring it

D6 needs infrastructure D1–D5 doesn't:

1. **Presence + cursor sync** — a WebSocket presence channel per
   `template:<id>` topic. Our existing signed pub/sub is one-way
   (server → kiosks). Two-way authoring sync needs a different
   pattern, ideally Redis pub/sub on a separate channel with reverse
   broadcasting. Easily 3–5 days of infra alone.

2. **Operational transform or CRDT** — once two operators are editing
   the same zone, we need to merge their edits without dropping data.
   The Zustand store's snapshot-then-replace pattern would lose half
   the edits. Either OT (Etherpad-style) or CRDT (Yjs/Automerge)
   would work; both are 1–2 weeks to integrate.

3. **Permission model gaps** — district admins editing the same
   template as their school admins is a real scenario, but our role
   model doesn't currently express "can edit IN PARALLEL with X."
   We'd want a soft lock + override flow that needs UX design.

## Honest cost estimate

- Presence + read-only awareness (no edit merging): ~1 week
- Add edit-merging via Yjs: ~2 weeks
- Add soft locks + override UX: ~1 week
- Total: ~4 weeks of dedicated focus

## What ships in D6's place

- D2.5 already shows operator-driven scene assignment without
  collisions because zones can only belong to one scene at a time
- The AppDialogHost + ProfileHydrator patterns give us safety nets
  for stale-write detection if we ever need them as a stopgap

## Reviving D6

Pre-reqs to make D6 feasible:

1. Pull the existing signed-pub/sub into a generic Realtime module
   so we can add new channel topics without touching the emergency
   broadcast path
2. Stand up Yjs (or pick CRDT alternative) behind a feature flag
3. Add a TemplateLock model to the schema (additive — locks expire
   on heartbeat timeout)
4. Wire the builder Zustand store to a Yjs document instead of
   plain state, with a dev mode that keeps both paths running so
   we can validate parity before flipping

When that infra exists, D6 is a 2-week build.

---

This file is the load-bearing record of why D6 didn't ship in Phase D.
Don't delete — when someone asks "why didn't we build multiplayer?",
point them here.

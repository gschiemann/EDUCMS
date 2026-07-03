# CRUSH Wave C — editor safety net (2026-07-03, compact)

Commits df862b00 (C4) + 306816df (C1) + 90551c2a (C2 client + 3 UI bars) +
ada28005 (C2 server + C3 stack). Reused the prior WIP's C1/C2/C4 (reviewed
line-by-line vs api-client error shape) + built C3 fresh.
- C1: autosave-draft.ts — debounced 3s / max 30s local draft per templateId,
  2MB cap + oldest-eviction, restore bar gated on isDraftNewer(draft,
  template.updatedAt), cleared on Save. Pure store OBSERVER — reads getState()
  only, imports zero store actions, never pushes history / touches
  activeTransaction (18-test proof).
- C2: expectedUpdatedAt optional on both save PUTs; server 409
  {code:'TEMPLATE_STALE', serverUpdatedAt} when stale, FAILS OPEN on omitted/
  malformed; conflict bar Reload/Overwrite (Overwrite omits field = pre-C2
  behavior exactly).
- C3: additive TemplateVersion model + migration (file only), snapshot from
  replaceZones best-effort, capped 5 (skip:5 eviction), GET versions (light),
  POST restore (snapshots current first, then applies via normal save path +
  audit row). BuilderToolbar History trigger.
- C4: touch-mode/idle-reset toggles snapshot before change (tx-aware,
  no-op-guarded). Deliberately NOT swept: scene CRUD, nav, view-state.
Verify: db:generate clean; web+api tsc clean; api templates 42 (+ c2/c3
specs); template-builder 212 (+ c1 spec); parity 45; mobile-perf clean;
migrate NOT run.
Migration: packages/database/prisma/migrations/20260702120000_add_template_versions/

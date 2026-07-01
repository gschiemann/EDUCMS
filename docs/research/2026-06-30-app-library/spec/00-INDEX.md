# App Library — Engineering Spec Index

This is the how-to-build companion to the App Library initiative. Where
[`../00-SYNTHESIS.md`](../00-SYNTHESIS.md) sets the **strategy** (why an app
library, what it unlocks, the shape of the bet), this spec set provides the
**build-level detail** — the contracts, services, per-app work, and hardening
that turn the strategy into shipped code.

## Sections

1. **[10-registry-and-panel.md](10-registry-and-panel.md)** (771 lines) —
   The app registry contract and the operator-facing App Library panel: how an
   app declares itself, its config schema, its render surface, and how the panel
   discovers, lists, and mounts apps. This is the interface every app author
   codes against.

2. **[20-backend-services.md](20-backend-services.md)** (642 lines) —
   The NestJS services that back the library: install/enable lifecycle,
   per-tenant config persistence, credential/BYOK handling, data-fetch proxies,
   caching, and the API contracts the panel and player consume.

3. **[30-per-app-checklist.md](30-per-app-checklist.md)** (405 lines) —
   The repeatable checklist every individual app must satisfy before merge:
   registry entry, config schema, editability, brand-token honoring, offline
   behavior, and the acceptance gates that make an app "done."

4. **[40-hardening-redteam.md](40-hardening-redteam.md)** (554 lines) —
   The adversarial pass: Taurus/Chromium-83 safety, offline resilience,
   cross-tenant isolation, credential leakage, failure-mode degradation, and the
   red-team scenarios each app and service must survive.

## Execution model

- **Sonnet-5 agents build.** Each app is implemented by a Sonnet-5 agent working
  in its own isolated worktree, following the per-app checklist
  ([30](30-per-app-checklist.md)) and coding to the registry contract
  ([10](10-registry-and-panel.md)) and backend service contracts
  ([20](20-backend-services.md)). One app per agent, single-domain scope, no
  overlapping files.
- **The lead (Opus) reviews, upgrades, and merges.** The lead reads every diff
  and upgrades it for the three non-negotiables — **Taurus-safety** (Chromium-83
  longhand, no `inset`/`gap` landmines on player/widget surfaces),
  **offline resilience** (graceful degradation, service-worker cache tiers, no
  throw on missing data/keys), and **brand-native render** (honors
  `var(--brand-primary)`/`var(--brand-accent)`, looks like a $$$ product) — per
  [40-hardening-redteam.md](40-hardening-redteam.md). Only the lead cherry-picks
  and pushes to master; agents never push directly.

# Walnut Creek demo district — recon + research (2026-07-31)

Built for the launch demo to leadership: a fully-detailed, real-world demo of the
**Walnut Creek School District** (K-8, Contra Costa County, CA) live on prod.
Build/teardown script: `packages/database/prisma/seed-walnut-creek-demo.mjs`
(`build | status | freshen | teardown | restore | logos`).
Demo login: `districtadmin@wcsd.demo` / `WalnutCreek!2026`.

| Report | Scope |
|---|---|
| [01-recon-tenants.md](01-recon-tenants.md) | Tenant hierarchy creation (signup, /tenants/children, seed patterns, license/seat enforcement) |
| [02-recon-branding.md](02-recon-branding.md) | Branding scrape/adopt/apply pipeline, brand-contrast contract, script auth patterns |
| [03-recon-teardown.md](03-recon-teardown.md) | Demo-data lifecycle, archive-not-delete teardown, emergency playlist wiring |
| [04-recon-fleetmap.md](04-recon-fleetmap.md) | Fleet map surfaces, geocoding chain, pin/cluster rules, DistrictSchoolsCard |
| [05-recon-screens.md](05-recon-screens.md) | Screen model, derived ONLINE status (35s STALE_MS), offline scanner, direct-insert rules |
| [06-research-wcsd-schools.json](06-research-wcsd-schools.json) | Verified real-world data: 7 schools, addresses, lat/lng, websites, mascots, site-CSS hex colors, logo URLs |

Findings that outlived the demo build:
- **Prod bug:** `SupabaseStorageService.uploadToBucket` fails network-level ("fetch failed")
  in the Railway container — breaks branding-logo re-hosting and likely every server-side
  upload. Same upload succeeds off-box; storage + `sb_secret` key are healthy. Task spawned.
- Local `apps/api/.env` `SUPABASE_SERVICE_ROLE_KEY` is stale (rotated) — "signature
  verification failed" on direct uploads until updated.
- Settings page renders raw i18n key `settings.license.tierPilot`. Task spawned.
- Web-app auth injection: `sessionStorage` wins over `localStorage` for
  `edu_cms_token`/`edu_cms_user` — swap both when switching tenants programmatically.

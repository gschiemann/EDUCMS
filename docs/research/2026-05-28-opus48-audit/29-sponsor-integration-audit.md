# Sponsorship System Audit — VenueOS Sports (Sprint 13 §7)

> Opus 4.8 read-only, 2026-05-28 (Wave 3). Sponsorship as "first-class revenue system."
> Every UI/enum/endpoint traced to real callers + render paths. Verdict scale standard.

## Headline
The revenue **DISPLAY** loop closes (a paid sponsor genuinely shows on board/ribbon +
co-branded celebrations). The revenue **ACCOUNTABILITY** loop — the proof-of-play that
closes renewals, the literal §7 pitch — is a **double-broken costume**: real "Estimated"
UI on top, dead per-impression pipeline underneath.

## Status table
| Capability | Status | Evidence | Gap |
|---|---|---|---|
| Sponsor data model (`Sponsor`+`SponsorImpression`, tenant-scoped) | **WORKS** | `schema.prisma:1899-1942`; 3 migrations present (sponsors, adops flight/cap, impressions) | spec said `SponsorPlacement`; actual `Sponsor`+`SponsorImpression`. Schema comment header `:1893-1895` STALE ("no per-impression rows" but table exists below) |
| Board banner rotation | **WORKS** | `board/[gameId]/page.tsx:921-1016` SponsorBanner; weighted slots `563-597`; served `sports.service.ts:376` | none |
| Ribbon rotation | **WORKS** | `ribbon/[gameId]/page.tsx:541-545,1216-1222` + anti-adjacency `520` | none |
| Co-branded celebration ("brought to you by…") | **WORKS** | cue sponsor `sports/[gameId]/page.tsx:3715-3718`→GameEvent→read `sports.service.ts:437-439`→render `board:2061-2122`. Full loop closes | none |
| Persistent scorebug bug | **PARTIAL** | scorebug page exists; report counts a `scorebug` surface `sponsors.service.ts:314` but the page fires NO impression + renders NO sponsor | scorebug column always 0; no bug shown |
| Concourse loops | **NOT-BUILT** | no concourse sponsor surface | spec item unimplemented |
| Scheduling — flight dates + freq cap | **WORKS (caveat)** | schema `1910-1912`; clamp/persist `sponsors.service.ts:181-212`; game-day UI `sports/[gameId]/page.tsx:3848-4024`; flight filter `137-165` + client cap recheck board `568-575`/ribbon `810-820` | dayparting (hour windows) + makegoods NOT-BUILT; flight/cap NOT exposed on standalone `/sports/sponsors` page (only per-game console) → discoverability split |
| **Proof-of-play — real per-impression report (`gameReport`)** | **COSTUME** | endpoint real `sports.controller.ts:104-118`→`sponsors.service.ts:273-343` (real counts + capCompliant) but **ZERO frontend callers** (grep) | real report has no UI |
| **Proof-of-play — impression WRITE path** | **COSTUME (BROKEN)** | board `:623-627` + ribbon `:866-870` POST `/sports/sponsors/:id/impression`, but `SponsorsController` is class-level `@UseGuards(JwtAuthGuard,RbacGuard)` `sponsors.controller.ts:33`; public board/ribbon send NO auth header; NO `@Public()` bypass (grep zero) → **every impression POST 401s, swallowed by `.catch(()=>{})`** → `SponsorImpression` never written → gameReport always all-zeros | needs `@Public()`/anon bypass on `:sponsorId/impression` (like the un-guarded SportsBoardController) |
| Proof-of-play — estimated report (the one operators SEE) | **WORKS (estimate)** | `SponsorPanel.tsx:462-522`→`useSponsorReport`→tenant-wide `report()` `sponsors.service.ts:355-408` (live seconds ÷ cycle × weight) | arithmetic estimate, honestly labeled "Estimated"; tenant-wide not per-game; no real impressions, no "% delivered" |
| Upload/management UX (add/logo/assign/schedule pre-game) | **WORKS** | standalone `/sports/sponsors/page.tsx:286-492` + game-day `SponsorPanel.tsx:204-430` + scheduling; hardened upload; AuditLog on CRUD `sponsors.service.ts:49-70` | flight/cap only on game-day console (split) |
| Sponsor logo on board (task #39) | **WORKS** | board banner logos `:934-950`, co-brand `:2092-2108`; URL paste or upload e2e | none for board surfaces |
| Cross-tenant marketplace | **NOT-BUILT (expected)** | none | future per spec — not a gap |

## Honest end-to-end answer
Sell→load→schedule→show works. **Hand the sponsor a proof-of-play report = the weak link.**
Operator sees "~N spots (Estimated)" (arithmetic, tenant-wide). The REAL per-game per-surface
report (`gameReport` with cap-compliance) has no UI AND would show all-zeros because every
impression POST 401s. No PDF, no "% delivered," no per-game breakdown. The "buying trigger…
proof-of-play that closes the renewal" is the costume.

## Costumes ranked by visibility
1. **Real per-impression proof-of-play — HIGHEST, double-broken.** (a) impression write 401s (`sponsors.controller.ts:33` class guard vs unauthenticated board/ribbon — needs `@Public()` on `:sponsorId/impression`); (b) `games/:id/sponsor-report` read has zero frontend callers. The §7 pitch ("47K impressions, 92% delivered") is unbacked.
2. Scorebug sponsor bug — counted in report, never rendered/logged.
3. Dayparting/makegoods — absent (sophistication gap).
4. Concourse loops — listed inventory, not built.
- UX split: flight/cap scheduling only on per-game console, not the standalone sponsor manager.

## ACTIONABLE FIX LIST
1. **Unblock the impression pipeline** — add `@Public()` (anon) to the `POST /sports/sponsors/:sponsorId/impression` route (mirror the un-guarded `SportsBoardController` pattern); keep CRUD guarded. Then `SponsorImpression` actually records.
2. **Wire the real `gameReport`** into the SponsorPanel (per-game proof-of-play with per-surface counts + capCompliant), replacing/augmenting the estimate. Add a CSV/PDF export for the sponsor.
3. **Scorebug sponsor bug** — render a persistent bug + fire its impression (or drop it from the report's surface list if out of scope).
4. Expose flight/cap on the standalone `/sports/sponsors` page (kill the discoverability split).
5. Fix stale schema comment `:1893-1895`. (Dayparting/makegoods/concourse = deferred feature gaps.)

# Compliance Posture — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against code + schema:** 2026-05-29.
**Audience:** district / school IT reviewers, procurement, and the VenueOS team.
**Grounding:** every data claim is traced to the Prisma schema or shipped code
(`file:line`). This document describes the **current** posture, not a target
state. Where a control is a gap, it says so (see `SECURITY_BASELINE.md` §"Known
gaps"). It is not legal advice; it is an engineering statement of what data the
system holds and how it is protected.

---

## 1. The one-paragraph truth

VenueOS is a **digital-signage + emergency-alert CMS**. It stores **operator
accounts and operational content**, not student academic records. There is **no
grade, GPA, transcript, attendance, or academic-roster column anywhere in the
schema** (verified: no such fields in `packages/database/prisma/schema.prisma`).
The Clever SIS integration is built but **deliberately fetches only
`admins` / `teachers` / `staff`** — never student rosters
(`integrations/clever/clever-http.client.ts:84`). Payment card data **never
touches our servers** — Stripe Checkout/Portal are hosted (PCI-SAQ-A). The two
places minors' data can appear are (a) **content an operator chooses to
publish** (e.g. a "Student of the Month" image, a sports roster name/photo on a
scoreboard) and (b) nothing else. Those are operator-authored signage content,
not records VenueOS ingests or processes for an educational purpose.

---

## 2. FERPA (Family Educational Rights and Privacy Act)

**What FERPA governs:** "education records" — records directly related to a
student and maintained by an educational agency (grades, transcripts,
attendance, disciplinary records, SIS data).

**VenueOS posture: minimal-to-no FERPA surface, by design.**

- **No education records are stored.** No grade/GPA/transcript/attendance/
  academic-roster fields exist (schema-verified).
- **Clever SIS pulls staff only** — `for (const roleSeg of ['admins',
  'teachers', 'staff'])` (`clever-http.client.ts:84`). Synced users land in the
  `User` table (`firstName`/`lastName`/`email`/`role`), which is staff
  directory data, not student records. The Clever scope requested is
  `read:user_id read:users read:sis` (`clever.service.ts:101`) but the client
  only reads the staff role segments.
- **Operator-published content may incidentally name a student** — e.g. a
  "Welcome, Class of 2027" image, a `StaffSpotlight`/achievement tile, or a
  **sports `RosterPlayer`** (`schema.prisma:1847`: `name`, `number`,
  `photoUrl`). This is **directory-information-style display content the school
  chooses to put on its own signage**, analogous to a printed program or a wall
  poster — not an education record VenueOS maintains. The school remains the
  data controller and is responsible for its FERPA directory-information policy.
- **Multi-tenant isolation** keeps one district's content from another's
  (app-layer Prisma `tenantId` scoping; see `THREAT_MODEL.md` §2.2).
- **Immutable audit trail** of privileged actions supports the
  "who-did-what" accountability districts expect (`audit_logs` append-only
  trigger, `migrations/20260526010000_audit_log_immutability/migration.sql`).

**If VenueOS later ingests student rosters (e.g. SIS-driven reunification,
V2 WS-5):** that crosses into education-record territory and requires a signed
**FERPA "school official" data-sharing agreement / DPA** with each district, a
documented educational-purpose limitation, and the retention/deletion controls
in `DATA_RETENTION.md`. **Do not enable student-roster ingest without that
agreement in place.**

## 3. COPPA (Children's Online Privacy Protection Act)

**What COPPA governs:** online collection of personal information **from
children under 13**, typically by the child interacting with the service.

**VenueOS posture: not a child-directed service; no collection from children.**

- The product is operated by **school staff / district admins** (operator
  accounts). Children do not create accounts, log in, or submit personal
  information to VenueOS.
- Players/kiosks are **display surfaces** authenticated by a device token; a
  student walking past a hallway screen is a viewer, not a data subject the
  system collects from. The touch "request help" action
  (`notifications/help`) is anonymous, server-side tenant-resolved, rate-limited,
  and stores no personal data about the tapper (`csrf.middleware.ts:73-83`).
- Any minor's image on a screen is **operator-uploaded content** governed by the
  school's own parental-consent/photo-release policy, under the school's COPPA
  "operator" relationship with parents — not data VenueOS solicits from a child.

**Conclusion:** COPPA's verifiable-parental-consent obligations sit with the
school's existing photo/directory policies; VenueOS does not collect personal
information directly from children.

## 4. PCI-DSS — SAQ-A

**Posture: SAQ-A eligible. Card data never touches VenueOS servers.**

- **Stripe-hosted only** — Checkout and Billing Portal are hosted Stripe
  sessions; VenueOS receives a redirect `url` and never a PAN/CVV
  (`billing/stripe.service.ts:233-245,262-266`). Card entry happens entirely in
  Stripe's iframe/hosted page.
- **No card fields anywhere** — schema-verified: no `cardNumber`/`cvv`/`pan`
  columns; `License` stores Stripe customer/subscription IDs, not card data
  (`schema.prisma:519`).
- **Webhook authenticity** — verified against `STRIPE_WEBHOOK_SECRET`
  (`billing/billing-webhook.controller.ts`); the endpoint is CSRF-exempt because
  Stripe POSTs without cookies (`csrf.middleware.ts:84-89`).
- **No PAN in logs** — the operational breadcrumb interceptor logs method/route/
  actor only (`security/request-log.interceptor.ts`); audit rows carry IDs, not
  card data.

**Obligation to keep SAQ-A:** never add a card field to any form or log line;
keep all card capture inside Stripe-hosted pages.

## 5. State student-privacy laws (SOPIPA / NY Ed Law 2-d / etc.)

Several states (CA SOPIPA, NY Ed Law §2-d, others) impose operator obligations
on K-12 vendors. VenueOS's minimal-data posture (§2) reduces but does not
eliminate exposure:

- We are an **operator/contractor** to the district under most state statutes.
- The signed DPA with each district should incorporate the data classes in
  `DATA_RETENTION.md`, the deletion/DSAR path, the security controls in
  `SECURITY_BASELINE.md`, and a no-sale/no-targeted-ads-to-students commitment
  (VenueOS does not sell data or run student-targeted advertising — sponsor ads
  are operator-sold venue signage, not behavioral ads on students).
- **NY Ed Law §2-d** specifically requires a published "parents bill of rights"
  and a data-security/privacy plan per contract — coordinate with the district;
  this doc + `DATA_RETENTION.md` + `SECURITY_BASELINE.md` are the engineering
  inputs to that plan.

## 6. Data we DO hold (so reviewers can reason precisely)

See `DATA_RETENTION.md` for the full table with locations + retention. Summary
of personal/operational data classes:

| Class | Examples | Schema |
|---|---|---|
| Operator accounts | name, email, phone (opt-in), Argon2id hash, role, MFA secret (encrypted) | `User` `schema.prisma:357` |
| Tenant/org | district/school name, slug, branding, address, lat/lng | `Tenant`, `TenantBranding` |
| Device/forensic | screen fingerprint, OS/browser info, **IP address** | `Screen` `schema.prisma:660-662` |
| Content | assets (images/video/PDF), templates, playlists, schedules | `Asset`, `Template`, … |
| Operator-published people | staff spotlight images, **sports roster** name/number/photo | `RosterPlayer` `schema.prisma:1847` |
| Integration tokens | Clever/POS/streaming OAuth refresh tokens (encrypted), Stripe IDs | `*ProviderConnection`, `License` |
| Audit/forensic | immutable action log | `AuditLog` `schema.prisma:1024` |
| Support | bug reports + screenshots (operator-initiated) | `Bug` `schema.prisma:1997` |

## 7. Accountability & sub-processors

- **Sub-processors:** Supabase (Postgres + storage), Railway (API host), Vercel
  (web host), Stripe (payments), Resend (email), Clever (SIS, opt-in), Square
  (POS, opt-in), AI providers (Anthropic/OpenAI/Google — platform key for
  Concierge, customer BYOK for creative). Maintain a current sub-processor list
  in the DPA.
- **Data residency:** US-region Supabase/Railway/Vercel (confirm region per
  deploy; document in the DPA).
- **Audit access:** district admins can view their tenant's `AuditLog` via the
  `/audit` page; cross-tenant access is SUPER_ADMIN only.

## 8. Open compliance items (tracked, NOT done)

1. **Signed DPA template** per district — not yet a repo artifact; required
   before any student-roster ingest (V2).
2. **Published privacy policy / "parents bill of rights"** for NY §2-d
   districts — coordinate with sales/legal.
3. **Sub-processor list as a living doc** — keep in the DPA, update on any new
   integration.
4. **Upload malware scanning** — open security gap that a district security
   review will ask about; mitigations + tracking in `SECURITY_BASELINE.md`.
5. **DSAR / deletion runbook** — see `DATA_RETENTION.md` §4 (path exists for
   operator accounts + tenant purge; formalize SLA).

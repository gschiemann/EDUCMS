# Parking branch — Twin Oaks OS

This directory is a **temporary parking spot**, not part of EDUCMS/VenueOS.

The owner requested a brand-new standalone repository (`twin-oaks-app`) for
**Twin Oaks OS** — the business operating system for Twin Oaks Farm & Tech
LLC. The Claude session that built it cannot create GitHub repositories, so
the irreplaceable design artifacts are parked on this branch until the new
repository exists.

Parked here:

- `docs/SPEC.md` — the owner-written Master Build Specification (source of truth)
- `docs/ROADMAP.md` — build status vs. the spec
- `README.md`, `CLAUDE.md` — project docs
- `package.json`, `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/domain.ts`
  — the V1 data model, domain constants, and sample data

The complete application (54 files — receipts/expenses/income/equipment/tax
center UI, verified typecheck + production build + runtime smoke) was built
in the session workspace and is pushed to the `twin-oaks-app` repository once
it exists.

**Once `gschiemann/twin-oaks-app` contains the full app, delete this branch.**

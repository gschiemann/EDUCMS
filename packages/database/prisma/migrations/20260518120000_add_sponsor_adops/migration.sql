-- VenueOS Sports — Sprint 13 Phase 2. Sponsor ad-ops columns.
-- Adds flight-window scheduling (flightStartAt / flightEndAt) and a
-- per-hour frequency cap to the `sponsors` table. All three columns are
-- nullable so existing rows are unaffected — null means "no bound" on
-- the flight window and "uncapped" on frequency. Purely additive —
-- safe to apply to live pilot tenants with zero data loss.

-- AlterTable
ALTER TABLE "sponsors"
    ADD COLUMN "flight_start_at"        TIMESTAMP(3),
    ADD COLUMN "flight_end_at"          TIMESTAMP(3),
    ADD COLUMN "frequency_cap_per_hour" INTEGER;

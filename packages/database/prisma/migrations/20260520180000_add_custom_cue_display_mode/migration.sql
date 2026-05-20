-- 2026-05-20 — custom cue display mode. Operator reported custom cues
-- took over the entire screen; they should overlay. Add a display_mode
-- column (overlay | takeover) defaulting to 'overlay' so existing cues
-- immediately overlay instead of full-screen-covering the board.
-- Purely additive; safe for the live pilot.
ALTER TABLE "custom_cues" ADD COLUMN "display_mode" TEXT NOT NULL DEFAULT 'overlay';

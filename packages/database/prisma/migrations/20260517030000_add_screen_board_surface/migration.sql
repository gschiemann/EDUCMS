-- VenueOS Sports — per-screen surface picker.
-- Lets an operator choose whether a screen pushed a live game shows the
-- full scoreboard, the LED ribbon, or the broadcast scorebug. Additive,
-- nullable — existing pushed screens read null as BOARD (back-compat).
ALTER TABLE "screens" ADD COLUMN "active_board_surface" TEXT;

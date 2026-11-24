/**
 * SHORT_PANIC_SCREEN_QUERY — is /panic on a screen too short for the six
 * trigger buttons AND the panic-phone row above them? (2026-11-23)
 *
 * The 2026-11-16 release train put the "Keep this phone ready" card (and, on
 * a phone that is set up, the "This phone is ready" line) directly above the
 * `flex-1 min-h-0` trigger grid, whose buttons are sized by their row. Every
 * pixel the card took came off the buttons: in Safari with its toolbars
 * showing (390 × 664) they shrank from 89 px to 65 px, below the 88 px floor
 * `emergency-targeting.spec.ts` holds them to. On a short screen the buttons
 * own the space, so /panic moves the phone row below them, out of their way.
 *
 * Why 799 px: on a 390 × 844 iPhone it matches in Safari whichever viewport
 * WebKit measures (about 664 with toolbars, about 750 without), and it leaves
 * the installed app at 844 and every screen 800 px or taller exactly as it
 * was. It also matches a short laptop browser window (about 657 px on a
 * 1366 × 768 screen), which gets the same layout.
 *
 * Read through `usePanicLayout` (`@/hooks/use-panic-layout`), which combines
 * it with phone landscape; the boolean hook that lived here had no other user
 * and was folded into that one.
 */
export const SHORT_PANIC_SCREEN_QUERY = '(max-height: 799px)';

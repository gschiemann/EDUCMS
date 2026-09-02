/**
 * /[schoolId]/settings/usb — preserved old URL (handoff §8).
 *
 * The signed USB / offline-ingest surface now lives at
 * /[schoolId]/settings/player/offline. This route re-exports that page
 * rather than redirecting, so an existing bookmark or support link renders
 * the identical screen with no extra navigation hop — and the shell still
 * highlights Player & offline, because `registry.ts` lists `usb` in that
 * section's `matches`.
 */
export { default } from '../player/offline/page';

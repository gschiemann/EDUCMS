import { SetMetadata } from '@nestjs/common';

/**
 * `@AllowUnpairedDevice()` — a `JwtAuthGuard` route that still answers a
 * device principal whose live screen row has NO tenant (SDW-01, 2026-11-23).
 *
 * `DeviceIdentityInterceptor` re-derives a device principal's tenant from the
 * live `Screen` row on every request. A screen with no tenant is unpaired, and
 * an unpaired screen's credential is refused on every guard-protected route
 * EXCEPT the ones carrying this marker. It is the guard-surface twin of
 * `verifyDeviceForScreen(req, id, { allowUnpaired: true })`: a route opts in,
 * it never inherits the permissive answer by saying nothing.
 *
 * Mark a route only when BOTH hold:
 *   1. a real player or APK calls it while the screen is unpaired (cite the
 *      call site in `screens/device-principal-routes.spec.ts`), and
 *   2. its handler never builds a query from `req.user.tenantId` — it reads
 *      the screen's own row, or answers "nothing" when there is no tenant.
 *
 * Handler-level only. A class-level marker would open every route the class
 * gains later, which is the failure this exists to prevent.
 */
export const ALLOW_UNPAIRED_DEVICE_KEY = 'venueos:allow-unpaired-device';

export const AllowUnpairedDevice = (): MethodDecorator =>
  SetMetadata(ALLOW_UNPAIRED_DEVICE_KEY, true) as MethodDecorator;

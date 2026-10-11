/**
 * USER SCOPING (2026-10-11) — the helpers a controller uses on a LIST route.
 *
 * UserScopeInterceptor resolves the person's screen scope once per request and
 * parks it on `req.userScope`. Every route a screen-scoped person can reach is
 * decided by the interceptor (default deny — user-scope.policy.ts); the few
 * routes it lets through as `filter` are lists, and those narrow their query
 * with the helpers below. Outside the interceptor (a unit spec that builds a
 * controller by hand) `req.userScope` is absent and every helper is a no-op —
 * exactly the behaviour of an unscoped person. `user-scope.module.spec.ts`
 * pins that the interceptor is registered globally in the running app.
 */
import type { ScreenScope } from './user-scope.policy';

export const USER_SCOPE_REQ_KEY = 'userScope';

/** The person's screen scope in the active location, or null when unscoped. */
export function screenScopeOf(req: any): ScreenScope | null {
  const s = req?.[USER_SCOPE_REQ_KEY];
  return s && Array.isArray(s.screenIds) && Array.isArray(s.groupIds) ? (s as ScreenScope) : null;
}

/** Prisma `where` fragment for a `screen` query: `{}` or `{ id: { in } }`. */
export function scopedScreenWhere(req: any): Record<string, unknown> {
  const s = screenScopeOf(req);
  return s ? { id: { in: s.screenIds } } : {};
}

/** Prisma `where` fragment for a `screenGroup` query. */
export function scopedGroupWhere(req: any): Record<string, unknown> {
  const s = screenScopeOf(req);
  return s ? { id: { in: s.groupIds } } : {};
}

/**
 * Prisma `where` fragment for a schedule-shaped row (Schedule,
 * DisplaySchedule): targets one of the person's screens or groups. A row with
 * no target never matches.
 */
export function scopedTargetWhere(req: any): Record<string, unknown> {
  const s = screenScopeOf(req);
  if (!s) return {};
  return { OR: [{ screenId: { in: s.screenIds } }, { screenGroupId: { in: s.groupIds } }] };
}

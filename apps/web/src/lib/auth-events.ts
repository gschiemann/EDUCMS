/**
 * Tiny event bus for session-expired / explicit-logout events.
 *
 * Lives in its own file so both api-client.ts (producer) and
 * ui-store.ts (producer via explicit logout) can import it without
 * the two depending on each other — a circular import would break
 * Next.js's module graph and cause unpredictable "undefined is not a
 * function" errors at runtime.
 *
 * The canonical listener is AuthExpirationGuard in DashboardLayout.
 */

export type AuthEvent = {
  reason: 'session-expired' | 'explicit-logout';
  url?: string;
};

type Listener = (event: AuthEvent) => void;

const listeners = new Set<Listener>();

export function subscribeAuthEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitAuthEvent(event: AuthEvent): void {
  listeners.forEach((l) => {
    try { l(event); } catch { /* listener errors swallowed */ }
  });
}

export function notifyExplicitLogout(): void {
  emitAuthEvent({ reason: 'explicit-logout' });
}

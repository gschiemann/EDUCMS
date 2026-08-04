import { SetMetadata } from '@nestjs/common';
import { AppRole } from '@cms/database';

export const ROLES_KEY = 'roles';

/**
 * Decorator to enforce that a route can only be accessed by users with one of the given roles.
 * Maps strictly to the RBAC_MATRIX.md permissions.
 * @param roles Target allowed roles.
 */
export const RequireRoles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

export const NO_VIEWER_READ_KEY = 'noViewerRead';

/**
 * Opt a GET route OUT of the RESTRICTED_VIEWER read pass-through.
 *
 * RbacGuard lets RESTRICTED_VIEWER read (GET/HEAD only) anything a CONTRIBUTOR
 * can read, so the viewer role does not have to be pasted onto every list
 * route. That shortcut assumes one thing: **a GET only discloses data.**
 *
 * AUTHZ-01 (2026-08-04) found where that assumption breaks. Some GETs MINT A
 * CREDENTIAL. `GET /sports/games/:id/feed-credentials` returns a live HMAC feed
 * token (plus a ready-made curl example) whose only purpose is to authorize
 * POSTs to the otherwise-unauthenticated scoreboard ingest controller. Reading
 * it is therefore a write capability, and the read-only role could obtain it.
 *
 * Mark any route whose RESPONSE is itself an authorization — tokens, API keys,
 * signed URLs, pairing codes, shared secrets — with this decorator. It is
 * deliberately opt-OUT rather than opt-in: flipping the shortcut to opt-in
 * would silently strip a viewer's legitimate read access across every list in
 * the product until each one was re-marked.
 */
export const NoViewerRead = () => SetMetadata(NO_VIEWER_READ_KEY, true);

/**
 * Confirmed deletion of content that is still in use (2026-09-26).
 *
 * `ba1a8ed` turned the server's in-use refusals into a warning that ONLY the
 * new dashboard shows: `DELETE /assets/:id` stopped answering 409 ASSET_IN_USE
 * and `DELETE /playlists/:id` removed a published playlist, its publishing
 * rules and every location copy without asking. A dashboard tab opened before
 * that deploy (or any API-key client) never shows the warning, so the same
 * click now deleted live signage silently.
 *
 * The confirmation is therefore part of the request: an in-use delete needs
 * `?confirm=in-use`, which the dashboard sends only after the operator
 * confirmed a warning that named the usage. Without it the server answers 409
 * in the shape older dashboards already handle — `ASSET_IN_USE` with the usage
 * summary, `PLAYLIST_PUBLISHED` with its reach — and deletes nothing.
 *
 * Emergency refusals are separate and unconditional: the confirmation never
 * overrides them (emergency-content-use.ts, the protected-playlist guards).
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/** The only `?confirm=` value that authorises deleting content still in use. */
export const IN_USE_DELETE_CONFIRMATION = 'in-use';

/** Strict: a repeated, empty or misspelled parameter is not a confirmation. */
export function isInUseDeleteConfirmed(confirm: unknown): boolean {
  return confirm === IN_USE_DELETE_CONFIRMATION;
}

export type InUseDeleteCode = 'ASSET_IN_USE' | 'PLAYLIST_PUBLISHED';

export interface InUseDeletePayload {
  code: InUseDeleteCode;
  /** A complete sentence: older dashboards show it as-is. */
  message: string;
  /** How to confirm, for API clients that meet this refusal. */
  confirmQuery?: string;
  /** The usage summary (`usage` for an asset, `reach` for a playlist). */
  [detail: string]: unknown;
}

/** The 409 an unconfirmed in-use delete answers with. */
export class InUseDeleteConflict extends HttpException {
  constructor(payload: InUseDeletePayload) {
    super(
      { confirmQuery: `confirm=${IN_USE_DELETE_CONFIRMATION}`, ...payload },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Thrown INSIDE a delete transaction when the content is in use and the
 * request carried no confirmation. Nothing has been written yet, so it simply
 * rolls the transaction back; the handler turns it into an InUseDeleteConflict
 * AFTER the transaction, where the usage summary can be read without widening
 * the transaction. Deciding inside the transaction is what closes the race: a
 * reference added between a check and the delete is seen by the delete.
 */
export class InUseDeleteUnconfirmed<Facts> extends Error {
  constructor(readonly facts: Facts) {
    super('in-use delete not confirmed');
    this.name = 'InUseDeleteUnconfirmed';
  }
}

/**
 * Puts the WHOLE conflict on the wire. The global AllExceptionsFilter reduces
 * every error to `{ error, code, message }`, which drops the usage summary —
 * the one thing an older dashboard needs to show its in-use dialog (the
 * pre-`ba1a8ed` Media Library opens its in-use block from `body.usage`, the
 * v1 playlist library prints `body.reach`). Scoped to the two delete handlers
 * with @UseFilters and to this one exception type, so every other error keeps
 * the normal envelope.
 */
@Catch(InUseDeleteConflict)
export class InUseDeleteConflictFilter implements ExceptionFilter {
  catch(exception: InUseDeleteConflict, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const payload = exception.getResponse() as InUseDeletePayload;
    if (res && !res.headersSent) {
      res.status(exception.getStatus()).json({
        ...payload,
        error: true,
        code: payload.code,
        message: payload.message,
      });
    }
  }
}

/** "1 playlist" / "3 playlists". */
export function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

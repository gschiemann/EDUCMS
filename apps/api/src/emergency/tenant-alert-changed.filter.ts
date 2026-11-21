/**
 * EMG-01 review round 1 (2026-11-21) — the 409 ALERT_CHANGED, ON THE WIRE.
 *
 * The tenant all-clear refuses a request that names an alert a newer one
 * replaced, and the refusal has to tell the dashboard and /panic WHICH alert
 * is live now, so the operator reads "a newer LOCKDOWN is active" and not
 * just "409". The production global AllExceptionsFilter (main.ts) reduces
 * every error to `{ error, code, message }` and keeps extra fields only on a
 * 402, so a plain ConflictException carrying `currentAlert` reached the
 * browser without it (proven by the review: the type was always undefined).
 *
 * The same remedy as `InUseDeleteConflictFilter` (common/in-use-delete.ts):
 * a dedicated exception type, and a filter scoped with @UseFilters to the one
 * handler that throws it (`clearEmergency`) and to this one exception type.
 * Every other error from that handler keeps the normal envelope.
 *
 * What goes on the wire is a NAMED, PRIMITIVE-ONLY set of facts about the
 * alert the caller is already allowed to see and end: the same id, type,
 * severity, drill flag and raise time `GET /emergency/active` returns to the
 * same caller. Both shapes are sent: `currentAlert` (nested, as the
 * controller builds it) and flat `currentAlert*` fields, so a client can read
 * either.
 */
import {
  type ArgumentsHost,
  Catch,
  ConflictException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ALERT_CHANGED_CODE,
  type alertChangedBody,
} from './tenant-alert-identity';

export type AlertChangedBody = ReturnType<typeof alertChangedBody>;

/** The 409 a tenant all-clear for a replaced alert answers with. */
export class TenantAlertChangedConflict extends ConflictException {
  constructor(readonly body: AlertChangedBody) {
    super(body);
  }
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/** The exact JSON the browser receives. Primitive values only, every one named. */
export function alertChangedWireBody(
  body: AlertChangedBody,
  requestId?: string,
): Record<string, unknown> {
  const c = (body?.currentAlert ?? {}) as Partial<
    AlertChangedBody['currentAlert']
  >;
  const currentAlert = {
    alertId: str(c.alertId),
    scopeType: 'tenant' as const,
    scopeId: str(c.scopeId),
    type: str(c.type),
    severity: str(c.severity),
    isDrill: c.isDrill === true,
    triggeredAt: str(c.triggeredAt),
  };
  return {
    error: true,
    code: ALERT_CHANGED_CODE,
    message:
      str(body?.message) ??
      'A newer alert is active. This all-clear named an earlier alert, so nothing was cleared.',
    requestedAlertId: str(body?.requestedAlertId),
    currentAlert,
    currentAlertId: currentAlert.alertId,
    currentAlertType: currentAlert.type,
    currentAlertSeverity: currentAlert.severity,
    currentAlertIsDrill: currentAlert.isDrill,
    currentAlertTriggeredAt: currentAlert.triggeredAt,
    ...(requestId ? { requestId } : {}),
  };
}

@Catch(TenantAlertChangedConflict)
export class TenantAlertChangedConflictFilter implements ExceptionFilter {
  catch(exception: TenantAlertChangedConflict, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<{ requestId?: unknown }>();
    const requestId =
      typeof req?.requestId === 'string' ? req.requestId : undefined;
    if (res && !res.headersSent) {
      res
        .status(exception.getStatus())
        .json(alertChangedWireBody(exception.body, requestId));
    }
  }
}

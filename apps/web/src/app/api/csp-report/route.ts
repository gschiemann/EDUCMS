/**
 * CSP violation collector — SEC-010 (2026-09-04).
 *
 * WHY THIS EXISTS. Since 2026-08-02 the player has shipped a broad
 * `Content-Security-Policy-Report-Only` header. It had no `report-uri`, and
 * nothing anywhere in this repo consumed a report. A report-only policy with
 * no collector logs to the kiosk's own devtools console — on a wall-mounted
 * Android panel nobody will ever open — so the policy was decorative: it
 * proved nothing, and it could not be promoted to enforcing because there was
 * no evidence about what it would break. That is the gap this closes. The
 * report-only policies now have somewhere to report TO, which is the
 * precondition for tightening `script-src`/`connect-src` later.
 *
 * WHAT IT DOES NOT DO. It does not store anything. Reports go to the platform
 * log (Vercel → Logs, filter `[csp]`), which is where the operator already
 * reads deploy and cron output. A database table for violations would need a
 * retention policy, a tenant scope and an auth story for an endpoint that is
 * unauthenticated by construction — browsers post violation reports with no
 * credentials, so this route can never sit behind auth. Logging is the honest
 * amount of machinery for "tell me what the policy would have blocked".
 *
 * ── THE THREE HAZARDS OF AN UNAUTHENTICATED REPORT SINK ───────────────────
 *
 * 1. IT IS A LOG-WRITE PRIMITIVE FOR ANYONE ON THE INTERNET. Anybody can POST
 *    here forever. `ReportThrottle` caps this process at a fixed number of
 *    reports per window and collapses repeats of the same violation to one
 *    line, so a flood costs a counter increment rather than a log bill.
 * 2. VIOLATION REPORTS CARRY URLS, AND URLS CARRY SECRETS. `blocked-uri` and
 *    `document-uri` are full URLs — and the legacy SSE transport accepts a
 *    device JWT as `?token=`. A report about that request would otherwise copy
 *    a fleet credential into the log. `safeUrl` strips query and fragment from
 *    every one before it is logged (same class of bug as SEC-011).
 * 3. IT RUNS ON A METERED KIOSK LINK. Every violation is an extra HTTP request
 *    from a screen that may be on cellular. The body is capped, the response
 *    is a bare 204 with no body, and `CSP_REPORTING_DISABLED=1` removes
 *    `report-uri` from the policies entirely (see `next.config.ts`) if the
 *    traffic is ever a problem. That switch is read at BUILD time, so turning
 *    it off needs a redeploy — deliberate, because a runtime switch would mean
 *    reading env on every player response.
 *
 * Report bodies are attacker-controlled data. Nothing here is parsed into a
 * type that is trusted; every field is read defensively and truncated. The
 * parsing and redaction live in `report-normalizer.ts` and are unit-tested.
 */
import { NextResponse } from 'next/server';
import {
  ReportThrottle,
  formatReportLine,
  normalizeCspReport,
  reportKey,
} from './report-normalizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reports larger than this are dropped unread. A real report is < 2 KB. */
const MAX_BODY_BYTES = 16 * 1024;

const throttle = new ReportThrottle();

export async function POST(req: Request): Promise<Response> {
  const declared = req.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  let payload: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });
    payload = JSON.parse(raw);
  } catch {
    // A malformed report is not worth a log line or an error status: the
    // browser cannot act on either, and a 4xx here would only invite retries.
    return new NextResponse(null, { status: 204 });
  }

  for (const report of normalizeCspReport(payload)) {
    if (!report.directive) continue;
    if (!throttle.shouldLog(reportKey(report))) continue;
    console.warn(formatReportLine(report));
  }

  // 204 with no body: the smallest possible response on a metered link, and
  // the status browsers treat as "delivered, do not retry".
  return new NextResponse(null, { status: 204 });
}

/**
 * A GET is never a violation report. Answering it with a tiny JSON status
 * makes the endpoint self-describing for an operator who finds `report-uri`
 * in a header and pastes it into a browser, and gives a deploy check
 * something to curl.
 */
export function GET(): Response {
  return NextResponse.json({
    ok: true,
    endpoint: 'csp-report',
    accepts: ['application/csp-report', 'application/reports+json'],
    sink: 'platform logs (grep "[csp]")',
  });
}

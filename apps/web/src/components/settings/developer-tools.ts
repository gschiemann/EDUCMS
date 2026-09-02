/**
 * Who may reach the integration sample-data harness
 * (`/[schoolId]/settings/test-integrations`).
 *
 * Handoff §7.10 + §22: "Integration sample-data tooling must not appear in
 * ordinary operator navigation … Sample integration data is absent from
 * ordinary production operator navigation." So: SUPER_ADMIN always, and
 * DISTRICT_ADMIN only outside production, where the harness is genuinely how
 * you smoke-test a deploy. That is stricter than the RoleGate the page used
 * to carry (every SCHOOL_ADMIN could open it, and it was linked from the
 * main Settings landing page).
 *
 * It lives in its own module — not in either page — precisely so the LINK
 * (Developer & audit) and the PAGE evaluate the identical predicate and can
 * never drift apart. This is a PRESENTATION gate; the API keeps its own
 * guards on `/health/integrations` and `/sample-data/*`.
 */
export function developerToolsVisible(role: string | undefined | null): boolean {
  if (role === 'SUPER_ADMIN') return true;
  return role === 'DISTRICT_ADMIN' && process.env.NODE_ENV !== 'production';
}

/**
 * conciergeVenue — the venue name a Concierge generation is FOR (2026-09-22).
 *
 * The Concierge path never sent `venueName` to the Designer (research report 01,
 * bug 8), so the model had to guess the business's name from the brief, and the
 * server could not tell that a board for "Super Taco" made from a K-12 account
 * belongs to someone else (no RIOT brand voice on a taqueria's board; never show
 * the model Super Taco's own wall as a reference for Super Taco).
 *
 * The name comes from the website reference the operator pasted. A structured
 * name field wins when the reference carries one; otherwise it is read from the
 * summary the API writes (`summarizeUrlReference`: "Brand: <name>. …").
 * Pure; unit-tested in __tests__/concierge-venue.test.ts.
 */
import type { ConciergeReference } from '@cms/api-types';

/** "Brand: <name>." — ended by the next label `summarizeUrlReference` writes (or the end). */
const BRAND_RE = /(?:^|\s)Brand:\s*(.{1,120}?)\.\s*(?=What they are|The brand's|Tagline:|Brand palette:|Fonts:|Has a |Menu found|NO MENU|$)/;

export function conciergeVenueName(refs: ConciergeReference[] | undefined | null): string | undefined {
  for (const ref of refs || []) {
    const r = ref as ConciergeReference & { venueName?: unknown; name?: unknown };
    for (const direct of [r.venueName, r.name]) {
      if (typeof direct === 'string' && direct.trim()) return direct.trim().slice(0, 120);
    }
  }
  for (const ref of refs || []) {
    if (ref.kind !== 'url' || typeof ref.summary !== 'string') continue;
    const m = BRAND_RE.exec(ref.summary);
    const name = m?.[1]?.trim();
    if (name) return name.slice(0, 120);
  }
  return undefined;
}

/**
 * Custom messages aimed at SPECIFIC screens (2026-10-26).
 *
 * The owner, on site: "broadcast should let me pick displays if i want as well
 * and not have to hit them all."
 *
 * HOW A SCREEN-LIST SEND IS STORED
 * --------------------------------
 * An `EmergencyMessage` row has ONE scope. Rather than teach the device poll,
 * the realtime gateway and the player a new kind of scope — every one of them
 * is life-safety delivery code that already works — a send to N screens is
 * stored as N ordinary DEVICE-scoped rows, one per pane of every chosen
 * display, each under that screen's own tenant. Delivery is therefore exactly
 * the delivery of a single-screen message: `device:<screenId>` on the bus, and
 * `deviceMessagesWhere`'s `{ scopeType: 'device', scopeId: <me> }` on the poll.
 *
 * What ties the rows into ONE send is their id:
 *
 *     bcast_<uuid>                the first pane (sorted by screen id)
 *     bcast_<uuid>_<screenId>     every other pane
 *
 * so the id the API returns is a real row (clearable on its own) AND the
 * common prefix of the whole set. `sendRootIdOf` recovers `bcast_<uuid>` from
 * any member; the clear derives the set from it ("clearing clears exactly that
 * set"). A UUID has a fixed length, so a prefix match can never leak into a
 * different send.
 *
 * PURE — no Prisma, no network — so each rule is a microsecond unit test
 * (`message-targets.spec.ts`).
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `bcast_<uuid>` optionally followed by `_<suffix>`; group 1 is the send's root id. */
const SEND_ID_RE = new RegExp(`^(bcast_${UUID})(?:_.+)?$`, 'i');

/** The root id of the custom-message send a row belongs to, or null for any other kind of id. */
export function sendRootIdOf(messageId: string | null | undefined): string | null {
  if (typeof messageId !== 'string') return null;
  const m = SEND_ID_RE.exec(messageId);
  return m ? m[1] : null;
}

/**
 * Row ids for the panes of ONE screen-list send: the first pane (by screen
 * id, so the answer never depends on the order a database happened to return
 * rows in) carries the bare `rootId`; every other pane `<rootId>_<screenId>`.
 */
export function screenListMessageIds(rootId: string, paneIds: readonly string[]): Map<string, string> {
  const sorted = [...new Set(paneIds)].sort();
  const out = new Map<string, string>();
  sorted.forEach((paneId, i) => out.set(paneId, i === 0 ? rootId : `${rootId}_${paneId}`));
  return out;
}

/** The minimal row shape the grouping below reads. */
export interface ScreenListRow {
  id: string;
  type?: string | null;
  scopeType: string;
  scopeId: string;
  tenantId: string;
}

/** A row that is a member of a custom-message screen-list send (or a single-screen send). */
export function isScreenListRow(row: Pick<ScreenListRow, 'id' | 'type' | 'scopeType'>): boolean {
  return row.type === 'TEXT_BROADCAST' && row.scopeType === 'device' && sendRootIdOf(row.id) !== null;
}

/** One screen as the listing needs it. */
export interface ScreenFact {
  id: string;
  name: string | null;
  faceOfScreenId?: string | null;
}

/** What an operator list shows for one screen-list send. */
export interface ScreenListTargets {
  /** The send's root id — what `GET /status` hands back as `sendId`. */
  sendId: string;
  /** Every pane that carries the message (both sides of a double-sided display). */
  paneIds: string[];
  /** The displays the operator would count: one per physical unit, by name. */
  screens: Array<{ id: string; name: string | null }>;
  /** `screens.length` — what "N screens" means in words. */
  screenCount: number;
}

/**
 * Group screen-list rows by send and say, per send, which displays they reach.
 * A double-sided display counts ONCE (its front pane names it); a pane whose
 * front is not in the set names itself, so nothing is ever dropped from the
 * count.
 */
export function groupScreenListSends(
  rows: readonly ScreenListRow[],
  facts: ReadonlyMap<string, ScreenFact>,
): Map<string, ScreenListTargets> {
  const bySend = new Map<string, ScreenListRow[]>();
  for (const row of rows) {
    const root = sendRootIdOf(row.id);
    if (!root) continue;
    const list = bySend.get(root) ?? [];
    list.push(row);
    bySend.set(root, list);
  }
  const out = new Map<string, ScreenListTargets>();
  for (const [sendId, members] of bySend) {
    const paneIds = members.map((m) => m.scopeId).sort();
    const paneSet = new Set(paneIds);
    const displays = new Map<string, { id: string; name: string | null }>();
    for (const paneId of paneIds) {
      const fact = facts.get(paneId);
      // A face is part of the display its front names — when that front is
      // itself in the set. Otherwise the face stands for itself.
      const frontId = fact?.faceOfScreenId && paneSet.has(fact.faceOfScreenId) ? fact.faceOfScreenId : paneId;
      if (displays.has(frontId)) continue;
      displays.set(frontId, { id: frontId, name: facts.get(frontId)?.name ?? fact?.name ?? null });
    }
    const screens = [...displays.values()].sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));
    out.set(sendId, { sendId, paneIds, screens, screenCount: screens.length });
  }
  return out;
}

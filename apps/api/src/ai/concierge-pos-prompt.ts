/**
 * The Concierge's POS CONTEXT block (2026-09-22).
 *
 * Greg: "our AI needs to be super tuned into our POS integrations so that when
 * we ask for an integration it knows to ask what one". Until now the Concierge's
 * prompt told EVERY operator "I can pull live prices straight from your POS" and
 * "auto-86" — connected or not, Toast (which reports no sold-out) or not — and
 * nothing ever asked which POS they use.
 *
 * The server now reads the venue's real POS state every turn
 * (pos/concierge-pos-context.ts) and this block tells the model, in plain terms,
 * which of four situations it is in:
 *
 *   SELECTED  a connected POS menu is picked for THIS board — the items are IN
 *             HAND and will be BOUND: never ask for the menu; ready once the
 *             purpose and the look are known.
 *   CONNECTED a POS is connected but not picked — offer it in one line.
 *   DETECTED  nothing connected, but their website links to one — offer to
 *             connect THAT one.
 *   NONE      nothing connected — on a menu board, ask ONE question: which POS,
 *             or paste the menu.
 *
 * and, whatever the situation, never to promise live prices unless a POS is
 * connected AND selected — nor sold-out syncing a provider does not do.
 *
 * PURE — string in, string out. Unit-tested in signage-concierge.spec.ts.
 */
import {
  conciergeConnectablePos,
  type ConciergeDetectedPos,
  type ConciergePosConnection,
  type ConciergePosContext,
  type ConciergePosSelection,
  type ConciergeReference,
  type PosLiveFacts,
} from '@cms/api-types';
import { resolveConciergePosSelection, type ResolvedPosSelection } from '../pos/concierge-pos-context';

export interface ConciergePosPromptState {
  /** The venue's POS context as the server read it this turn; null = it could not be read. */
  context: ConciergePosContext | null;
  /** The operator's pick, already verified against `context` (resolveConciergePosSelection). */
  selected: ResolvedPosSelection | null;
  /** POS providers the operator's website links to. */
  detected?: ConciergeDetectedPos[];
  /** The clock for "synced N minutes ago". */
  now?: Date;
}

export type ConciergePosState = 'selected' | 'connected' | 'detected' | 'none' | 'unknown';

/**
 * POS providers the operator's shared website references link to
 * (`ConciergeReference.detectedPos`, set server-side by the URL endpoint). The
 * references ride back from the browser each turn, so only known, connectable
 * provider ids are honoured — a doctored one can at most change which POS the
 * Concierge suggests connecting.
 */
export function detectedPosFromReferences(references: ConciergeReference[] | null | undefined): ConciergeDetectedPos[] {
  const known = new Map(conciergeConnectablePos().map((p) => [p.providerId, p.name]));
  const out: ConciergeDetectedPos[] = [];
  for (const ref of references || []) {
    const list: ConciergeDetectedPos[] = Array.isArray(ref?.detectedPos) ? ref.detectedPos : [];
    for (const d of list) {
      const id = typeof d?.providerId === 'string' ? d.providerId : '';
      if (!known.has(id) || out.some((o) => o.providerId === id)) continue;
      const confidence = typeof d?.confidence === 'number' && Number.isFinite(d.confidence) ? Math.max(0, Math.min(1, d.confidence)) : 0.5;
      out.push({ providerId: id, name: known.get(id)!, confidence });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

/**
 * The chat's POS state for one turn: the server-read context, the client's
 * selection honoured only against it, and what the shared site links to.
 */
export function conciergePosPromptState(
  context: ConciergePosContext | null,
  selection: ConciergePosSelection | null | undefined,
  references: ConciergeReference[] | null | undefined,
  now?: Date,
): ConciergePosPromptState {
  return {
    context,
    selected: resolveConciergePosSelection(context, selection),
    detected: detectedPosFromReferences(references),
    ...(now ? { now } : {}),
  };
}

/** Which of the situations above this turn is in. */
export function conciergePosState(state: ConciergePosPromptState | null | undefined): ConciergePosState {
  if (!state || !state.context) return 'unknown';
  if (state.selected) return 'selected';
  if (state.context.connections.length) return 'connected';
  if ((state.detected || []).length) return 'detected';
  return 'none';
}

function ago(iso: string | undefined, now: Date): string {
  if (!iso) return 'not synced yet';
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'synced just now';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'synced just now';
  if (min < 90) return `last synced ${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `last synced ${h} hours ago`;
  return `last synced ${Math.round(h / 24)} days ago`;
}

function statusPhrase(c: ConciergePosConnection): string {
  switch (c.status) {
    case 'ACTIVE': return 'connected';
    case 'PENDING': return 'connected, first sync still pending';
    case 'ERROR': return 'connected, but its last sync FAILED';
    case 'EXPIRED':
    case 'REVOKED': return 'connected, but its sign-in has EXPIRED';
    default: return `status ${String(c.status).toLowerCase()}`;
  }
}

function sectionList(sections: Array<{ name: string; itemCount: number }>, max = 8): string {
  const shown = sections.slice(0, max).map((s) => `${s.name} (${s.itemCount})`);
  const more = sections.length > max ? `, +${sections.length - max} more` : '';
  return `${shown.join(', ')}${more}`;
}

/** What stays live, in words — never more than the provider does. */
export function describeLive(providerName: string, live: PosLiveFacts): string {
  const fields = [
    live.names && 'names',
    live.prices && 'prices',
    live.descriptions && 'descriptions',
    live.photos && 'photos',
  ].filter(Boolean) as string[];
  const list = fields.length > 1 ? `${fields.slice(0, -1).join(', ')} and ${fields[fields.length - 1]}` : fields[0] || 'prices';
  const when =
    live.cadence === 'publish-5min'
      ? `about 5 minutes after they publish a change in ${providerName}`
      : live.cadence === 'webhook'
        ? `as soon as they change in ${providerName}`
        : live.cadence === 'push'
          ? 'whenever their system pushes a change'
          : `within the hour after they change in ${providerName}`;
  const soldOut = live.soldOut
    ? `Sold-out items also update on their own.`
    : `${providerName} does NOT report sold-out items — never say they update on their own.`;
  return `${list} update ${when}. ${soldOut}`;
}

const NEVER_PROMISE =
  'NEVER promise live prices, automatic price updates or sold-out syncing unless a POS above is SELECTED FOR THIS BOARD — without one, a board is a snapshot of the items it was given.';

/**
 * The POS CONTEXT block for the Concierge system prompt. Always present — even
 * when the state could not be read, the "never promise" rule rides along.
 */
export function buildConciergePosBlock(state: ConciergePosPromptState | null | undefined): string {
  const now = state?.now ?? new Date();
  const lines: string[] = [
    'POS CONTEXT — AUTHORITATIVE. The server read the venue\'s POS this turn; it outranks anything else you believe about their menu or POS:',
  ];
  const kind = conciergePosState(state);

  if (kind === 'unknown') {
    lines.push(
      '- The POS status could not be read right now. If they want a menu or price board, ask them to pick their POS in the card below or paste their menu.',
    );
  } else if (kind === 'selected') {
    const sel = state!.selected!;
    const c = sel.connection;
    lines.push(
      `- SELECTED FOR THIS BOARD: the venue's ${c.providerName} menu (${statusPhrase(c)}; ${ago(c.lastSyncedAt, now)}) — ${sel.itemCount} item${sel.itemCount === 1 ? '' : 's'} in ${sel.sections.length} section${sel.sections.length === 1 ? '' : 's'}: ${sectionList(sel.sections)}.`,
      `- These items are IN HAND and will be BOUND to ${c.providerName} on the board. NEVER ask the customer to type, paste, list or confirm menu items or prices — you have them. Acknowledge it in a few words ("I'll use your ${c.providerName} menu — all ${sel.itemCount} items").`,
      '- For content that is all you need: set purpose "menu", include "menu" in widgets, and as soon as you know the LOOK set ready=true. The brief must say the items come from the live POS menu and that no item, price, combo or deal may be invented; do NOT re-type the items into it.',
      `- What stays live on this board: ${describeLive(c.providerName, c.live)}`,
    );
    if (c.status !== 'ACTIVE') {
      lines.push(`- Mention once, briefly, that ${c.providerName} needs attention in Settings → POS (${statusPhrase(c)}), so the board may show the last menu it synced.`);
    }
  } else if (kind === 'connected') {
    const conns = state!.context!.connections;
    for (const c of conns.slice(0, 3)) {
      const owner = c.owner === 'parent' ? ' (connected by their organisation)' : '';
      const menu = c.itemCount
        ? `${c.itemCount} items in ${c.sections.length} section${c.sections.length === 1 ? '' : 's'}: ${sectionList(c.sections)}`
        : 'no menu items synced yet';
      lines.push(`- CONNECTED POS: ${c.providerName}${owner} — ${statusPhrase(c)}; ${ago(c.lastSyncedAt, now)} — ${menu}. NOT selected for this board yet.`);
    }
    const first = conns.find((c) => c.itemCount > 0) || conns[0];
    lines.push(
      first.itemCount > 0
        ? `- If this board shows a menu or prices, OFFER it in one line: "Want me to use your ${first.providerName} menu? Tick the sections in the card below." Do not ask them to type items unless they decline.`
        : `- Its menu has not synced yet: if they want a menu board, tell them to open Settings → POS and press Sync (or paste their menu for now).`,
      `- If they accept, what would stay live: ${describeLive(first.providerName, first.live)}`,
    );
  } else if (kind === 'detected') {
    const names = (state!.detected || []).map((d) => d.name);
    const lead = names[0];
    lines.push(
      `- NO POS IS CONNECTED. Their website links to ${names.join(' and ')}, so they very likely use ${lead}.`,
      `- If this is a menu or price board, offer to connect it in one line: "Your site uses ${lead} — connect it with the ${lead} button in the card below and I'll bind the board to your live menu." They can also paste their menu instead — never ask both in separate turns.`,
    );
  } else {
    lines.push(
      '- NO POS IS CONNECTED.',
      '- If this is a menu or price board, ask ONE question, once: which POS they use (Toast, Square, Clover, Lightspeed or Shopify — the card below connects it), or whether they would rather paste their menu. If they already named a POS or pasted a menu, do not ask again.',
    );
  }
  lines.push(`- ${NEVER_PROMISE}`);
  return lines.join('\n');
}

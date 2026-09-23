/**
 * The Concierge knows the venue's POS (2026-09-22).
 *
 * Greg: "our AI needs to be super tuned into our POS integrations so that when
 * we ask for an integration it knows to ask what one and ensures the template is
 * created with perfect integrations into those systems".
 *
 * Shared by the API (GET /templates/concierge/pos-context, the Concierge chat's
 * POS CONTEXT block, the bound-board generator) and the web card
 * (ConciergePosCard) so both sides say the same thing about what each POS keeps
 * live, and count the same row limit.
 */
import { z } from 'zod';
import { POS_PROVIDERS, type PosAuthKind } from './pos';

/** What the operator picked in the Concierge's POS card: this connection, these sections. */
export const ConciergePosSelectionSchema = z.object({
  connectionId: z.string().trim().min(1).max(64),
  sections: z.array(z.string().trim().min(1).max(80)).min(1).max(40),
});
export type ConciergePosSelection = z.infer<typeof ConciergePosSelectionSchema>;

/**
 * How a POS change reaches a bound board:
 *   publish-5min — checked every ~5 minutes; a change lands after it is PUBLISHED in the POS (Toast)
 *   webhook      — pushed the moment it changes (Square)
 *   hourly       — the hourly sync (Clover, Lightspeed, Shopify)
 *   push         — whenever the venue's own system pushes (custom webhook)
 */
export type PosLiveCadence = 'publish-5min' | 'webhook' | 'hourly' | 'push';

/** What a connected POS honestly keeps live on a bound board — never more. */
export interface PosLiveFacts {
  names: boolean;
  prices: boolean;
  descriptions: boolean;
  photos: boolean;
  /** Sold-out (86'd) items update on their own. */
  soldOut: boolean;
  cadence: PosLiveCadence;
}

/**
 * Per provider, from what each connector actually syncs (apps/api/src/pos/
 * providers/*, research 2026-09-22 §2). Toast and Lightspeed do NOT report
 * sold-out — nothing here may promise auto-86 for them.
 */
export const POS_LIVE_FACTS: Readonly<Record<string, PosLiveFacts>> = {
  toast: { names: true, prices: true, descriptions: true, photos: true, soldOut: false, cadence: 'publish-5min' },
  square: { names: true, prices: true, descriptions: true, photos: false, soldOut: true, cadence: 'webhook' },
  clover: { names: true, prices: true, descriptions: false, photos: false, soldOut: false, cadence: 'hourly' },
  'lightspeed-retail': { names: true, prices: true, descriptions: true, photos: true, soldOut: false, cadence: 'hourly' },
  'shopify-pos': { names: true, prices: true, descriptions: true, photos: false, soldOut: false, cadence: 'hourly' },
  'custom-webhook': { names: true, prices: true, descriptions: true, photos: true, soldOut: true, cadence: 'push' },
};

/** A provider nobody has described is promised the least. */
const UNKNOWN_POS_LIVE: PosLiveFacts = {
  names: true, prices: true, descriptions: false, photos: false, soldOut: false, cadence: 'hourly',
};

export function posLiveFactsFor(providerId: string | null | undefined): PosLiveFacts {
  return POS_LIVE_FACTS[String(providerId || '')] ?? UNKNOWN_POS_LIVE;
}

/**
 * How many menu rows one board may carry. Legibility across a room depends on
 * the panel, not its pixel count, so 4K earns a modest bump (bigger panels), not
 * four times the rows; a small LED cabinet or 720p canvas gets fewer.
 * The web card and the server use this same number — the server enforces it.
 */
export function conciergePosRowLimit(width?: number | null, height?: number | null): number {
  const w = width && width > 0 ? width : 1920;
  const h = height && height > 0 ? height : 1080;
  if (Math.min(w, h) / 1080 >= 1.6) return 28;
  const area = (w * h) / (1920 * 1080);
  if (area >= 0.9) return 24;
  if (area >= 0.45) return 16;
  return 12;
}

/** One POS section and how many bindable items it has. */
export interface ConciergePosSection {
  name: string;
  itemCount: number;
}

/** A POS connection this location's boards can bind to. */
export interface ConciergePosConnection {
  id: string;
  providerId: string;
  providerName: string;
  displayName?: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ERROR' | string;
  statusReason?: string;
  lastSyncedAt?: string;
  /** This location's own connection, or its organisation's (chain parent). */
  owner: 'self' | 'parent';
  /** Items a board can bind (named, priced, with a POS id), across every section. */
  itemCount: number;
  sections: ConciergePosSection[];
  live: PosLiveFacts;
}

/** A POS the operator can connect themselves, for the card's buttons. */
export interface ConciergePosProviderOption {
  providerId: string;
  name: string;
  auth: PosAuthKind;
}

/** GET /api/v1/templates/concierge/pos-context */
export interface ConciergePosContext {
  connections: ConciergePosConnection[];
  connectable: ConciergePosProviderOption[];
}

/** A POS the operator's website links to (Toast / Square / Clover ordering links). */
export interface ConciergeDetectedPos {
  providerId: string;
  name: string;
  confidence: number;
}

export const ConciergeDetectedPosSchema = z.object({
  providerId: z.string().trim().max(40),
  name: z.string().trim().max(60),
  confidence: z.number().min(0).max(1),
});

/**
 * The POS providers the card offers a Connect button for: self-serve today
 * (DIRECT tier, plus Toast's machine-client connector), not sales-led, and not
 * the developer-only custom webhook.
 */
export function conciergeConnectablePos(): ConciergePosProviderOption[] {
  return POS_PROVIDERS
    .filter((p) => (p.integrationTier === 'DIRECT' || p.id === 'toast') && !p.salesLedOnly && p.id !== 'custom-webhook')
    .map((p) => ({ providerId: p.id, name: p.name, auth: p.auth }));
}

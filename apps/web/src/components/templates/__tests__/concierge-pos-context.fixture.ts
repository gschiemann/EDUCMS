/**
 * GET /api/v1/templates/concierge/pos-context responses — PRODUCER-CUT.
 *
 * Not hand-written: printed by the API's own `loadConciergePosContext`
 * (apps/api/src/pos/concierge-pos-context.ts, 2026-09-22) run over
 *   • a location whose CHAIN connected Toast, with a menu shaped exactly like
 *     MenuService.resolvePosMenuForLocation returns it — Tacos 13, Burritos 8,
 *     Drinks 26 (bigger than one 1080p screen);
 *   • a location with nothing connected.
 * Regenerate from the producer, never edit by hand.
 */
import type { ConciergePosContext } from '@cms/api-types';

export const POS_CONTEXT_TOAST: ConciergePosContext = {"connections":[{"id":"conn-chain-toast","providerId":"toast","providerName":"Toast","status":"ACTIVE","lastSyncedAt":"2026-09-22T19:56:00.000Z","owner":"parent","itemCount":47,"sections":[{"name":"Tacos","itemCount":13},{"name":"Burritos","itemCount":8},{"name":"Drinks","itemCount":26}],"live":{"names":true,"prices":true,"descriptions":true,"photos":true,"soldOut":false,"cadence":"publish-5min"}}],"connectable":[{"providerId":"square","name":"Square","auth":"oauth2"},{"providerId":"toast","name":"Toast","auth":"machineClient"},{"providerId":"clover","name":"Clover","auth":"oauth2"},{"providerId":"lightspeed-retail","name":"Lightspeed Retail","auth":"oauth2"},{"providerId":"shopify-pos","name":"Shopify POS","auth":"oauth2"}]};

export const POS_CONTEXT_NONE: ConciergePosContext = {"connections":[],"connectable":[{"providerId":"square","name":"Square","auth":"oauth2"},{"providerId":"toast","name":"Toast","auth":"machineClient"},{"providerId":"clover","name":"Clover","auth":"oauth2"},{"providerId":"lightspeed-retail","name":"Lightspeed Retail","auth":"oauth2"},{"providerId":"shopify-pos","name":"Shopify POS","auth":"oauth2"}]};

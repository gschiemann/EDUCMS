/**
 * POS copy says only what each POS really does (POS-A, 2026-09-23).
 *
 * POS_LIVE_FACTS (packages/api-types concierge-pos.ts) is the per-provider
 * truth: how a change reaches a board, and whether sold-out items update on
 * their own (only Square and the custom webhook report them). Copy that went
 * past it, fixed in this wave:
 *   • Settings → POS showed "⚡ realtime" on Shopify, which syncs hourly;
 *   • Square's tile promised "modifiers", which are never synced;
 *   • Settings → POS said items, prices "and availability" sync for Clover,
 *     Lightspeed and Shopify;
 *   • the Super Taco panel said availability comes from Toast;
 *   • the help center promised "Sold-out handling is automatic" for every POS.
 */
import * as fs from 'fs';
import * as path from 'path';
import { POS_PROVIDERS, posLiveFactsFor } from '@cms/api-types';
import en from '@/i18n/messages/en.json';

const HELP = path.resolve(__dirname, '../../../content/help/menu-boards-pos.md');

describe('Settings → POS tiles', () => {
  it.each(POS_PROVIDERS.filter((p) => p.integrationTier !== 'CLOSED').map((p) => [p.id, p] as const))(
    '%s shows "realtime" only if a change really is pushed',
    (_id, p) => {
      const facts = posLiveFactsFor(p.id);
      const pushed = facts.cadence === 'webhook' || facts.cadence === 'push';
      if (p.capabilities.realtimeUpdates) expect(pushed).toBe(true);
    },
  );

  it('Shopify syncs hourly — no realtime badge', () => {
    expect(POS_PROVIDERS.find((p) => p.id === 'shopify-pos')!.capabilities.realtimeUpdates).toBe(false);
  });

  it('no tile promises modifiers (they are never synced)', () => {
    for (const p of POS_PROVIDERS) expect(p.blurb).not.toMatch(/modifier/i);
  });

  it('the self-serve line promises sold-out only for the POS that reports it', () => {
    const line = en.billingCommerce.catalogSyncLiveDetail;
    expect(line).not.toMatch(/availability/i);
    expect(line).toMatch(/Square keeps sold-out items current/);
    expect(posLiveFactsFor('square').soldOut).toBe(true);
    for (const id of ['clover', 'lightspeed-retail', 'shopify-pos', 'toast']) expect(posLiveFactsFor(id).soldOut).toBe(false);
  });
});

describe('the Toast wall panel and the help center', () => {
  it('the Super Taco panel does not claim availability comes from Toast', () => {
    expect(en.toastBindings.intro).not.toMatch(/availability/i);
    expect(en.toastBindings.intro).toMatch(/Toast doesn't report sold-out items/);
    expect(posLiveFactsFor('toast').soldOut).toBe(false);
  });

  it('the help center no longer promises automatic sold-out for every POS', () => {
    const md = fs.readFileSync(HELP, 'utf8');
    expect(md).not.toMatch(/Sold-out handling is automatic/);
    expect(md).toMatch(/Toast, Clover, Lightspeed and Shopify don't report sold-out items/);
    // …and it states how fast each POS reaches the screens, matching the facts.
    expect(posLiveFactsFor('toast').cadence).toBe('publish-5min');
    expect(md).toMatch(/\*\*Toast\*\* — about 5 minutes after you publish/);
    expect(posLiveFactsFor('clover').cadence).toBe('hourly');
    expect(md).toMatch(/\*\*Clover, Lightspeed, Shopify\*\* — within the hour/);
  });
});

'use client';

/**
 * Self-serve trial → paid (2026-10-11) — the ONE billing read the dashboard
 * makes: `GET /billing/summary` (apps/api BillingController.summary; the state
 * is computed by apps/api/src/billing/trial-policy.ts, the same function that
 * gates pairing and editing, so the banner can never disagree with the API).
 *
 * Mobile-perf standard: ONE request per 10 minutes at most, never polled,
 * never refetched on focus (the global default stays off). A failed read
 * renders nothing — billing chrome must never be what breaks a page.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

export type BillingState =
  | 'none'
  | 'offline'
  | 'trial'
  | 'trial_card'
  | 'trial_ended'
  | 'locked'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'suspended';

export interface BillingSummary {
  state: BillingState;
  billingReady: boolean;
  canManage: boolean;
  canCheckout?: boolean;
  cardOnFile?: boolean;
  trialEndsAt?: string | null;
  daysLeft?: number | null;
  graceEndsAt?: string | null;
  pairingBlocked?: boolean;
  readOnly?: boolean;
  period?: 'monthly' | 'annual' | null;
  seatsUsed?: number;
  seatLimit?: number | null;
  renewsAt?: string | null;
  /** 2026-10-11 — when the card first failed / Stripe's next retry (null after the last). */
  paymentFailedAt?: string | null;
  nextPaymentAttemptAt?: string | null;
  /** The plan ended because the card could not be charged (vs a cancellation). */
  endedForNonPayment?: boolean;
  prices: { monthlyCents: number; annualCents: number };
}

export const BILLING_SUMMARY_KEY = ['billing', 'summary'] as const;
export const SALES_EMAIL = 'sales@venueos.app';

export function useBillingSummary(enabled = true) {
  return useQuery<BillingSummary | null>({
    queryKey: BILLING_SUMMARY_KEY,
    queryFn: () => apiFetch<BillingSummary>('/billing/summary').catch(() => null),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    enabled,
  });
}

/** Re-read the summary (after a checkout return or a seat change). */
export function useRefreshBillingSummary() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: BILLING_SUMMARY_KEY }), [qc]);
}

export const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Leave for a Stripe-hosted page. One seam so tests can observe it (jsdom cannot navigate). */
export function goTo(url: string): void {
  window.location.href = url;
}

/** Opens Stripe Checkout (card entry happens there only — PCI SAQ-A). */
export async function startCheckout(period: 'monthly' | 'annual'): Promise<
  { kind: 'redirect'; url: string } | { kind: 'not-set-up'; message?: string }
> {
  const res = await apiFetch<{ url?: string; message?: string }>('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ billingPeriod: period }),
  });
  if (res?.url) return { kind: 'redirect', url: res.url };
  return { kind: 'not-set-up', message: res?.message };
}

/**
 * Opens the Stripe Customer Portal (card, invoices, plan, screens, cancel).
 * `'update-card'` opens it straight on "update payment method" and returns to
 * the Billing page with `?card=updated` (2026-10-11).
 */
export async function openPortal(flow?: 'update-card'): Promise<{ kind: 'redirect'; url: string } | { kind: 'none' }> {
  const res = await apiFetch<{ url?: string }>('/billing/portal', {
    method: 'POST',
    ...(flow ? { body: JSON.stringify({ flow }) } : {}),
  });
  if (res?.url) return { kind: 'redirect', url: res.url };
  return { kind: 'none' };
}

/** Back from "Update card": charge the open invoice with the new card now. */
export async function retryPayment(): Promise<{ result: 'paid' | 'declined' | 'not-applicable'; message?: string }> {
  return apiFetch('/billing/retry-payment', { method: 'POST' });
}

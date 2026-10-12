/**
 * ai-plan.ts — the VenueOS + AI plan as the dashboard words it (owner pricing decision, 2026-10-12).
 *
 *   VenueOS        $20 / screen / month · $200 / year
 *   VenueOS + AI   $25 / screen / month · $250 / year
 *
 * AI on VenueOS's own keys needs the AI plan (or a free trial). Without it, every AI surface shows
 * the same upsell — "Add AI for $5/screen/month" (Settings → Billing) — or the way that works on
 * every plan: the organisation's own AI key (Settings → AI provider). The API refuses a spend with
 * the 402 `AI_PLAN_REQUIRED` (apps/api/src/billing/ai-plan.ts); the status reads carry
 * `planRequired` / `reasonCode: 'AI_PLAN_REQUIRED'`.
 *
 * Pure: no React, no fetch — every surface asks these, and they are tested without mounting any.
 */
import type { AiAllowance } from '@/hooks/use-api';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The AI add-on, per screen per month, when the API has not said (cents). */
export const DEFAULT_AI_ADDON_CENTS = 500;

/** The 402 a spend without the AI plan answers with. */
export function isAiPlanRequired(e: unknown): boolean {
  const x = e as { code?: unknown; body?: { code?: unknown } } | null | undefined;
  return x?.code === 'AI_PLAN_REQUIRED' || x?.body?.code === 'AI_PLAN_REQUIRED';
}

/**
 * English fallback for the surfaces whose copy is still English-only (inline rewrite, translate,
 * chat-to-edit) — the localized upsell is `AiPlanUpsell`.
 */
export const AI_PLAN_REQUIRED_EN =
  'Add VenueOS AI for $5/screen/month — or connect your own AI key for free (Settings → AI).';

/** "$5" — whole dollars show no cents. */
export function formatCents(cents: number, locale = 'en-US'): string {
  const usd = cents / 100;
  const whole = Number.isInteger(usd);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(usd);
  } catch {
    return `$${whole ? usd : usd.toFixed(2)}`;
  }
}

/** The add-on price the upsell names. */
export function aiAddonPrice(a: Pick<AiAllowance, 'aiAddonMonthlyCents'> | null | undefined, locale = 'en-US'): string {
  const cents =
    typeof a?.aiAddonMonthlyCents === 'number' && Number.isFinite(a.aiAddonMonthlyCents) && a.aiAddonMonthlyCents > 0
      ? a.aiAddonMonthlyCents
      : DEFAULT_AI_ADDON_CENTS;
  return formatCents(cents, locale);
}

/** Does this allowance answer mean "show the upsell"? */
export function needsAiPlan(a: Pick<AiAllowance, 'source' | 'reasonCode'> | null | undefined): boolean {
  return !!a && a.source === 'none' && a.reasonCode === 'AI_PLAN_REQUIRED';
}

/** Settings → Billing, scrolled to the plans (where AI is added). */
export function billingPlansHref(schoolId: string | null | undefined): string {
  return schoolId ? `/${schoolId}/settings/billing#bill-plans` : '/settings/billing';
}

/** "Oct 1" — named in UTC (a month boundary is a UTC instant). */
function day(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export interface ImagesLine {
  text: string;
  /** None left: the line reads as a warning. */
  out: boolean;
}

/**
 * "14 of 20 AI images left this month · resets Nov 1" / "9 of 10 AI images left in your free
 * trial" — only on OUR key (the tenant's own key has no image count here). Namespace: aiPlan.
 */
export function imagesLine(t: Translate, locale: string, a: AiAllowance | null | undefined): ImagesLine | null {
  if (!a || a.source !== 'platform') return null;
  if (typeof a.imagesLeft !== 'number' || !Number.isFinite(a.imagesLeft)) return null;
  const left = Math.max(0, Math.floor(a.imagesLeft));
  const used = typeof a.imagesUsed === 'number' && Number.isFinite(a.imagesUsed) ? Math.max(0, Math.floor(a.imagesUsed)) : 0;
  const total = Math.max(left + used, typeof a.imagesIncluded === 'number' ? a.imagesIncluded : 0);
  const text =
    a.period === 'trial'
      ? t('imagesLeftTrial', { left, total })
      : t('imagesLeft', { left, total, date: day(a.resetAt, locale) });
  return { text, out: left === 0 };
}

/**
 * A refused generation, in the operator's language (namespace: aiPlan): the AI plan upsell, or the
 * limit reached on our key ("add your own AI key or contact us for more"). Null = not one of ours —
 * the caller keeps its own mapping.
 */
export function aiPaywallText(t: Translate, e: unknown): string | null {
  const x = e as { code?: unknown; body?: { unit?: unknown; plan?: unknown; aiAddonMonthlyCents?: unknown } } | null | undefined;
  if (isAiPlanRequired(e)) {
    const cents = typeof x?.body?.aiAddonMonthlyCents === 'number' ? x.body.aiAddonMonthlyCents : DEFAULT_AI_ADDON_CENTS;
    return t('upsell.body', { price: formatCents(cents) });
  }
  if (x?.code !== 'AI_CAP_REACHED') return null;
  const unit = x?.body?.unit;
  const trial = x?.body?.plan === 'trial';
  if (unit === 'images') return t(trial ? 'limit.imagesTrial' : 'limit.images');
  if (unit === 'boards' && trial) return t('limit.boardsTrial');
  return null;
}

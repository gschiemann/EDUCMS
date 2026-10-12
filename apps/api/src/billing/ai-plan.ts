/**
 * THE VenueOS + AI PLAN — the pure rules (owner pricing decision, 2026-10-12).
 *
 *   VenueOS          $20 / screen / month  ·  $200 / screen / year   (STRIPE_PRICE_MONTHLY / _ANNUAL)
 *   VenueOS + AI     $25 / screen / month  ·  $250 / screen / year   (STRIPE_PRICE_MONTHLY_AI / _ANNUAL_AI)
 *   Enterprise       custom quote, invoice / PO — AI is a toggle in the super-admin customer console
 *   Free trial       14 days, 3 screens — WITH AI, at the trial limits below (so people experience it)
 *
 * WHO MAY SPEND OUR PLATFORM AI KEYS. Exactly the organisations `aiEntitlementOf` says 'ai' or
 * 'trial'. Everyone else gets an upsell ("Add AI for $5/screen/month") or uses their OWN key, which
 * stays available on every plan. We never silently spend platform money on a tenant without AI.
 *
 * LIMITS ON OUR KEY (per organisation, pooled across its schools / locations):
 *   AI plan   boards  AI_BOARDS_PER_SCREEN (10) × paired screens, per UTC month
 *             images  AI_IMAGES_PER_SCREEN (20) × paired screens, per UTC month
 *   trial     boards  AI_TRIAL_BOARDS (2) for the whole trial
 *             images  AI_TRIAL_IMAGES (2) for the whole trial
 *   both      the dollar allowance (ai-allowance.service.ts) stays the hard ceiling.
 *
 * Everything here is a function of its arguments (env and clock are passed in), so every state is
 * pinned in ai-plan.spec.ts and the gate, the allowance, the checkout and the Billing page all ask
 * the same function.
 */
import {
  billingStateOf,
  PRICE_ANNUAL_CENTS,
  PRICE_MONTHLY_CENTS,
  TRIAL_DAYS,
  type TrialLicenseLike,
} from './trial-policy';

/** Per-screen list prices (USD cents). The no-AI pair is the old STRIPE_PRICE_MONTHLY / _ANNUAL. */
export const PLAN_PRICES = {
  monthlyCents: PRICE_MONTHLY_CENTS,
  annualCents: PRICE_ANNUAL_CENTS,
  monthlyAiCents: 2500,
  annualAiCents: 25000,
} as const;

/** What AI adds per screen per month, in cents ("Add AI for $5/screen/month"). */
export const AI_ADDON_MONTHLY_CENTS = PLAN_PRICES.monthlyAiCents - PLAN_PRICES.monthlyCents;

export type BillingPeriod = 'monthly' | 'annual';

export interface PlanPriceIds {
  monthly: string | null;
  annual: string | null;
  monthlyAi: string | null;
  annualAi: string | null;
}

const clean = (v: string | undefined): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

export function planPriceIds(env: NodeJS.ProcessEnv = process.env): PlanPriceIds {
  return {
    monthly: clean(env.STRIPE_PRICE_MONTHLY),
    annual: clean(env.STRIPE_PRICE_ANNUAL),
    monthlyAi: clean(env.STRIPE_PRICE_MONTHLY_AI),
    annualAi: clean(env.STRIPE_PRICE_ANNUAL_AI),
  };
}

/** The AI plan may be offered at checkout: BOTH AI price ids are configured. Missing → option hidden. */
export function aiPlanOffered(env: NodeJS.ProcessEnv = process.env): boolean {
  const p = planPriceIds(env);
  return !!(p.monthlyAi && p.annualAi);
}

/** The Stripe Price id for a plan, or null when that price is not configured on this deploy. */
export function priceIdForPlan(
  period: BillingPeriod,
  ai: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const p = planPriceIds(env);
  if (ai) return period === 'annual' ? p.annualAi : p.monthlyAi;
  return period === 'annual' ? p.annual : p.monthly;
}

/**
 * Which plan a Stripe Price id is. `null` = a price this deploy does not know (the webhook then
 * keeps the license's current `aiIncluded` rather than guessing either way).
 */
export function planOfPriceId(
  priceId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { ai: boolean; period: BillingPeriod } | null {
  if (!priceId) return null;
  const p = planPriceIds(env);
  if (priceId === p.monthlyAi) return { ai: true, period: 'monthly' };
  if (priceId === p.annualAi) return { ai: true, period: 'annual' };
  if (priceId === p.monthly) return { ai: false, period: 'monthly' };
  if (priceId === p.annual) return { ai: false, period: 'annual' };
  return null;
}

/** The same plan at the other AI setting (the "switch AI on/off" path), or null when unpriced. */
export function switchedPriceId(
  currentPriceId: string | null | undefined,
  ai: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const cur = planOfPriceId(currentPriceId, env);
  if (!cur) return null;
  return priceIdForPlan(cur.period, ai, env);
}

// ── entitlement ──────────────────────────────────────────────────────────────────────────────

export type AiPlan = 'ai' | 'trial' | 'none';

export interface AiLicenseLike extends TrialLicenseLike {
  aiIncluded?: boolean | null;
}

export interface AiEntitlement {
  plan: AiPlan;
  /** Trial only: the window the trial's allowance is counted over. */
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * May this organisation spend OUR AI keys, and on which allowance?
 *
 *   * suspended / cancelled                → none
 *   * a free trial (with or without card)  → trial (AI at the trial limits, whatever plan it picked)
 *   * aiIncluded, license ACTIVE/PAST_DUE  → ai (past-due keeps AI while Stripe retries the card)
 *   * anything else (incl. no license)     → none
 *
 * `governing` is the nearest license up the tenant tree (LicenseService.orgAccount) — a district's
 * schools inherit the district's plan.
 */
export function aiEntitlementOf(
  governing: AiLicenseLike | null | undefined,
  now: Date,
  billingReady: boolean,
): AiEntitlement {
  const none: AiEntitlement = { plan: 'none', trialStartsAt: null, trialEndsAt: null };
  if (!governing) return none;
  if (governing.status === 'SUSPENDED' || governing.status === 'CANCELLED') return none;
  const b = billingStateOf(governing, now, billingReady);
  if (b.state === 'trial' || b.state === 'trial_card') {
    const end = b.trialEndsAt;
    return {
      plan: 'trial',
      trialEndsAt: end,
      trialStartsAt: end ? new Date(end.getTime() - TRIAL_DAYS * DAY_MS) : null,
    };
  }
  if (governing.aiIncluded === true && (governing.status ?? 'ACTIVE') !== 'CANCELLED') {
    if (b.state === 'locked' || b.state === 'cancelled' || b.state === 'suspended') return none;
    return { plan: 'ai', trialStartsAt: null, trialEndsAt: null };
  }
  return none;
}

// ── limits ───────────────────────────────────────────────────────────────────────────────────

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : fallback;
}

export interface AiPlanLimits {
  boardsPerScreen: number;
  imagesPerScreen: number;
  trialBoards: number;
  trialImages: number;
}

export function aiPlanLimits(env: NodeJS.ProcessEnv = process.env): AiPlanLimits {
  return {
    boardsPerScreen: envInt(env, 'AI_BOARDS_PER_SCREEN', 10),
    imagesPerScreen: envInt(env, 'AI_IMAGES_PER_SCREEN', 20),
    trialBoards: envInt(env, 'AI_TRIAL_BOARDS', 2),
    trialImages: envInt(env, 'AI_TRIAL_IMAGES', 2),
  };
}

/**
 * Included units for the allowance period. The AI plan scales with paired screens (at least one —
 * an organisation that pays for AI before pairing still gets a screen's worth); a trial is a flat
 * total; no plan includes nothing.
 */
export function includedFor(
  unit: 'boards' | 'images',
  plan: AiPlan,
  screens: number,
  limits: AiPlanLimits = aiPlanLimits(),
): number {
  if (plan === 'trial') return unit === 'boards' ? limits.trialBoards : limits.trialImages;
  if (plan !== 'ai') return 0;
  const n = Number.isFinite(screens) ? Math.max(1, Math.floor(screens)) : 1;
  return n * (unit === 'boards' ? limits.boardsPerScreen : limits.imagesPerScreen);
}

/**
 * What one image on our OpenAI key costs us, in micro-dollars, for the dollar meter. Image calls are
 * priced per image, not per token, so this is a deliberate list-price estimate (gpt-image at the
 * sizes we ask for is ~$0.04–$0.07): `AI_IMAGE_COST_USD`, default $0.08 — rounded UP so the dollar
 * ceiling errs toward protecting margin.
 */
export function platformImageCostMicros(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AI_IMAGE_COST_USD;
  const n = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
  const usd = Number.isFinite(n) && n >= 0 && n <= 10 ? n : 0.08;
  return Math.round(usd * 1_000_000);
}

/** "$5" — the AI add-on price as the upsell says it. */
export function aiAddonUsd(): string {
  const d = AI_ADDON_MONTHLY_CENTS / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

/** The English upsell the API answers with (the dashboard shows its own en/es/zh copy by `code`). */
export function aiPlanRequiredMessage(): string {
  return (
    `Add VenueOS AI for ${aiAddonUsd()}/screen/month (Settings → Billing) — ` +
    'or connect your own AI key for free (Settings → AI). Your own key works on every plan, with every AI feature.'
  );
}

/** The friendly limit message (en). The dashboard localizes by `code` + `unit`. */
export function aiLimitMessage(o: { unit: 'boards' | 'images'; plan: AiPlan; resetAt: string | null }): string {
  const what = o.unit === 'boards' ? 'AI board designs' : 'AI images';
  const when =
    o.plan === 'trial'
      ? 'for your free trial'
      : `this month${o.resetAt ? ` (they reset ${new Date(o.resetAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })})` : ''}`;
  return (
    `You've used all your ${what} ${when}. ` +
    'Add your own AI key in Settings → AI provider to keep going, or contact us for more.'
  );
}

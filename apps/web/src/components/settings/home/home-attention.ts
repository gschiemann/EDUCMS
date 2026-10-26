/**
 * What the Settings home puts under "Needs attention" — pure, so it is tested
 * without mounting anything (2026-10-26, Settings simplification Phase 1).
 *
 * Every line is backed by a server answer: the emergency readiness report
 * (its items carry a stable `code` since 2026-10-26) and the billing summary
 * the trial bar already loads. Nothing is inferred in the browser, nothing is
 * shown while a check has not answered, and the list is capped at three —
 * the most serious first.
 */
import type { BillingSummary } from '@/components/billing/billing-summary';

export interface HomeReadinessItem {
  key: string;
  status: 'ok' | 'warn' | 'missing';
  code?: string;
  params?: Record<string, number>;
}
export interface HomeReadiness {
  verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_CONFIGURED' | 'DISABLED';
  items: readonly HomeReadinessItem[];
}

export type AttentionId =
  | 'delivery'
  | 'noSender'
  | 'oneSender'
  | 'noScreens'
  | 'screensOffline'
  | 'practice'
  | 'paymentProblem'
  | 'planEnded'
  | 'trialEnds'
  | 'seatsFull';

export interface AttentionLine {
  id: AttentionId;
  severity: 'error' | 'attention';
  /** i18n key under `settings.shell.home.attention` for the sentence. */
  messageKey: string;
  /** ICU values for the sentence. */
  values?: Record<string, number>;
  /** i18n key under `settings.shell.home.attention` for the fix button. */
  actionKey: string;
  /** Path under `/[schoolId]/` the fix button opens. */
  href: string;
}

/** Days before the end of a free trial at which the home starts asking. */
export const TRIAL_WARN_DAYS = 7;
export const MAX_ATTENTION_LINES = 3;

function readinessLines(r: HomeReadiness | null | undefined): AttentionLine[] {
  if (!r || r.verdict === 'DISABLED' || r.verdict === 'READY') return [];
  const out: AttentionLine[] = [];
  for (const item of r.items) {
    if (item.status === 'ok') continue;
    switch (item.key) {
      case 'delivery':
        if (item.status === 'missing') {
          out.push({ id: 'delivery', severity: 'error', messageKey: 'delivery', actionKey: 'openEmergency', href: 'settings/emergency' });
        }
        // A realtime fallback (warn) still delivers within ~20 s — not the
        // operator's to fix, so it is not put in front of them here.
        break;
      case 'staff':
        out.push(
          item.status === 'missing'
            ? { id: 'noSender', severity: 'error', messageKey: 'noSender', actionKey: 'chooseSenders', href: 'settings/people' }
            : { id: 'oneSender', severity: 'attention', messageKey: 'oneSender', actionKey: 'chooseSenders', href: 'settings/people' },
        );
        break;
      case 'screens': {
        const none = item.code === 'screens.none' || (item.code == null && item.status === 'missing' && (item.params?.total ?? 0) === 0);
        out.push(
          none
            ? { id: 'noScreens', severity: 'attention', messageKey: 'noScreens', actionKey: 'pairScreen', href: 'screens' }
            : { id: 'screensOffline', severity: 'attention', messageKey: 'screensOffline', actionKey: 'checkScreens', href: 'screens?filter=offline' },
        );
        break;
      }
      case 'exercise':
        out.push({ id: 'practice', severity: 'attention', messageKey: 'practice', actionKey: 'practiceAction', href: 'settings/emergency#emergency-practice' });
        break;
      default:
        break;
    }
  }
  return out;
}

function billingLines(b: BillingSummary | null | undefined): AttentionLine[] {
  if (!b) return [];
  const out: AttentionLine[] = [];
  switch (b.state) {
    case 'past_due':
      out.push({ id: 'paymentProblem', severity: 'error', messageKey: 'paymentProblem', actionKey: 'fixPayment', href: 'settings/billing' });
      break;
    case 'trial_ended':
    case 'locked':
    case 'cancelled':
      out.push({ id: 'planEnded', severity: 'error', messageKey: 'planEnded', actionKey: 'pickPlan', href: 'settings/billing' });
      break;
    case 'trial': {
      const days = b.daysLeft ?? null;
      if (days !== null && days <= TRIAL_WARN_DAYS) {
        out.push({
          id: 'trialEnds',
          severity: days <= 1 ? 'error' : 'attention',
          messageKey: 'trialEnds',
          values: { days: Math.max(0, days) },
          actionKey: 'pickPlan',
          href: 'settings/billing',
        });
      }
      break;
    }
    default:
      break;
  }
  if (b.seatLimit != null && b.seatLimit > 0 && (b.seatsUsed ?? 0) >= b.seatLimit && (b.state === 'active' || b.state === 'trial_card')) {
    out.push({
      id: 'seatsFull',
      severity: 'attention',
      messageKey: 'seatsFull',
      values: { used: b.seatsUsed ?? 0, limit: b.seatLimit },
      actionKey: 'addSeats',
      href: 'settings/billing',
    });
  }
  return out;
}

/**
 * Within a severity, what hurts most first: an alert that cannot be sent or
 * delivered, then money that stops the product, then people and screens, and
 * last the gentle "practice" nudge.
 */
const IMPACT: Record<AttentionId, number> = {
  delivery: 0,
  noSender: 1,
  paymentProblem: 2,
  planEnded: 3,
  oneSender: 4,
  noScreens: 5,
  screensOffline: 6,
  trialEnds: 7,
  seatsFull: 8,
  practice: 9,
};

/** The home's attention lines: errors first, then by impact, at most three. */
export function homeAttention(
  readiness: HomeReadiness | null | undefined,
  billing: BillingSummary | null | undefined,
): AttentionLine[] {
  const all = [...readinessLines(readiness), ...billingLines(billing)];
  const sev = (l: AttentionLine) => (l.severity === 'error' ? 0 : 1);
  return all
    .sort((a, b) => sev(a) - sev(b) || IMPACT[a.id] - IMPACT[b.id])
    .slice(0, MAX_ATTENTION_LINES);
}

export type AreaStatusTone = 'good' | 'warn' | 'bad' | 'muted';
export interface AreaStatusLine {
  /** i18n key under `settings.shell.home.status`. */
  key: string;
  values?: Record<string, number>;
  tone: AreaStatusTone;
}

/** The one-line live status on the Emergency card. */
export function emergencyStatus(r: HomeReadiness | null | undefined, loading: boolean): AreaStatusLine | null {
  if (!r) return loading ? { key: 'checking', tone: 'muted' } : null;
  switch (r.verdict) {
    case 'READY': return { key: 'emergencyReady', tone: 'good' };
    case 'NEEDS_ATTENTION': return { key: 'emergencyAttention', tone: 'warn' };
    case 'NOT_CONFIGURED': return { key: 'emergencyNotSet', tone: 'bad' };
    case 'DISABLED': return { key: 'emergencyOff', tone: 'muted' };
    default: return null;
  }
}

/** The one-line live status on the Plan & billing card. */
export function billingStatus(b: BillingSummary | null | undefined): AreaStatusLine | null {
  if (!b) return null;
  switch (b.state) {
    case 'trial':
    case 'trial_card':
      return b.daysLeft != null
        ? { key: 'trial', values: { days: Math.max(0, b.daysLeft) }, tone: b.daysLeft <= TRIAL_WARN_DAYS ? 'warn' : 'muted' }
        : null;
    case 'trial_ended':
    case 'locked':
      return { key: 'trialEnded', tone: 'bad' };
    case 'active':
      return { key: 'active', tone: 'good' };
    case 'past_due':
      return { key: 'paymentProblem', tone: 'bad' };
    case 'cancelled':
      return { key: 'ended', tone: 'bad' };
    default:
      return null;
  }
}

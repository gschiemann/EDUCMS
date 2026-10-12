'use client';

/**
 * Customer management console — the customer detail view (license & billing, suspension, owner
 * link, ARC invoices, locations, admins, audited history). Rendered by /super/customers/[id].
 */
import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Check, Copy, Link2, Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';
import { SupportAccessCard } from './SupportAccessCard';
import {
  useCreateInvoice,
  useIssueStarterLink,
  useSuspendCustomer,
  useUpdateCustomerLicense,
  useUpdateInvoice,
} from '@/hooks/use-customer-console';
import {
  BILLING_MODES,
  PLANS,
  TONE_CLASSES,
  formatCents,
  formatDate,
  fromDateInput,
  isInvoiceBilled,
  parseDollarsToCents,
  statusTone,
  toDateInput,
  type CustomerDetail,
  type InvoiceStatus,
} from '@/lib/customer-console';

const INPUT = 'w-full min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900';
const LABEL = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1';
const CARD = 'bg-white rounded-2xl border border-slate-200 p-4 sm:p-5';
const BTN = 'inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-lg text-sm font-semibold disabled:opacity-50';

const errMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function CustomerView({ c }: { c: CustomerDetail }) {
  const t = useTranslations('customerConsole');
  const locale = useLocale();
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <Link href="/super/customers" className="inline-flex items-center gap-1.5 min-h-10 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" aria-hidden /> {t('detail.back')}
        </Link>
        <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 break-words">{c.name}</h1>
            <p className="text-sm text-slate-500">
              {t('detail.accountUrl')}: /{c.slug} · {t('detail.added', { date: formatDate(c.createdAt, locale) })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE_CLASSES[statusTone(c.status)]}`}>{t(`status.${c.status}`)}</span>
            <span className="text-sm text-slate-600 tabular-nums">
              {t('detail.screensInUse')}: <strong>{c.seatsUsed}</strong> / {c.license?.seatLimit ?? '—'}
            </span>
          </div>
        </header>

        <LicenseCard c={c} />
        {/* 2026-10-11 — VenueOS reaches this customer's data only under a grant. */}
        <SupportAccessCard orgId={c.id} orgName={c.name} />
        <SuspensionCard c={c} />
        <OwnerLinkCard c={c} />
        <InvoicesCard c={c} />

        <div className="grid gap-4 md:grid-cols-2">
          <section className={CARD}>
            <h2 className="font-semibold text-slate-900 mb-2">{t('detail.locationsSection')}</h2>
            {c.locations.length === 0 ? (
              <p className="text-sm text-slate-500">{t('detail.noLocations')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {c.locations.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2 py-2">
                    <span className="min-w-0 break-words">{l.name}</span>
                    <span className="tabular-nums text-slate-500">{l.seatsUsed}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={CARD}>
            <h2 className="font-semibold text-slate-900 mb-2">{t('detail.adminsSection')}</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {c.admins.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="break-all">{a.email ?? a.name ?? '—'}</div>
                  <div className="text-xs text-slate-500">
                    {a.role}
                    {a.atLocation && <> · {t('detail.atLocation')}</>}
                    {a.awaitingSetup && <> · {t('detail.awaitingSetup')}</>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className={CARD}>
          <h2 className="font-semibold text-slate-900 mb-2">{t('detail.activitySection')}</h2>
          {c.activity.length === 0 ? (
            <p className="text-sm text-slate-500">{t('detail.noActivity')}</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {c.activity.map((a) => (
                <li key={a.id} className="py-2 flex flex-wrap justify-between gap-x-4">
                  <span className="font-mono text-xs text-slate-700">
                    {a.action}
                    {Array.isArray(a.details?.changed) && a.details.changed.length > 0 && <span className="text-slate-500"> · {a.details.changed.join(', ')}</span>}
                  </span>
                  <span className="text-xs text-slate-500">{formatDate(a.at, locale)}{a.by ? ` · ${a.by}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function LicenseCard({ c }: { c: CustomerDetail }) {
  const t = useTranslations('customerConsole');
  const update = useUpdateCustomerLicense(c.id);
  const lic = c.license;
  const [seatLimit, setSeatLimit] = useState(String(lic?.seatLimit ?? 0));
  const [price, setPrice] = useState(lic?.monthlyPriceCents != null ? (lic.monthlyPriceCents / 100).toFixed(2) : '');
  const [plan, setPlan] = useState(lic?.plan === 'MONTHLY' ? 'MONTHLY' : 'ANNUAL');
  const [billingMode, setBillingMode] = useState<string>(lic?.billingMode ?? 'INVOICE');
  const [status, setStatus] = useState(lic?.status && lic.status !== 'SUSPENDED' ? lic.status : 'ACTIVE');
  const [renewal, setRenewal] = useState(toDateInput(lic?.contractRenewalDate ?? null));
  const [po, setPo] = useState(lic?.poNumber ?? '');
  const [notes, setNotes] = useState(lic?.notes ?? '');
  // 2026-10-12 — the enterprise AI toggle (VenueOS + AI on an invoice / PO / comp license).
  const [aiIncluded, setAiIncluded] = useState<boolean>(!!lic?.aiIncluded);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const stripe = !!lic?.stripeManaged;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    const seats = Number(seatLimit);
    if (!/^\d+$/.test(seatLimit.trim()) || !Number.isInteger(seats)) return setError(t('detail.invalidSeats'));
    const cents = parseDollarsToCents(price);
    if (cents === 'invalid') return setError(t('detail.invalidPrice'));
    const body: Record<string, unknown> = { seatLimit: seats, renewalDate: fromDateInput(renewal), poNumber: po, notes };
    if (!stripe) {
      body.monthlyPriceCents = cents;
      body.plan = plan;
      body.billingMode = billingMode;
      // A card customer's AI comes from their Stripe price; the API refuses a toggle there.
      if (aiIncluded !== !!lic?.aiIncluded) body.aiIncluded = aiIncluded;
    }
    if (lic?.status !== 'SUSPENDED') body.status = status;
    try {
      await update.mutateAsync(body);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err, t('detail.genericError')));
    }
  };

  const note = stripe
    ? t('detail.stripeManaged')
    : billingMode === 'COMP'
      ? t('detail.compNote')
      : isInvoiceBilled(billingMode)
        ? t('detail.invoiceNote')
        : t('detail.cardNote');

  return (
    <form className={CARD} onSubmit={save} aria-labelledby="lic-h">
      <h2 id="lic-h" className="font-semibold text-slate-900">{t('detail.licenseSection')}</h2>
      {!lic && <p className="text-sm text-slate-500 mt-1">{t('detail.noLicenseYet')}</p>}
      <p className="text-sm text-slate-600 mt-1">{note}</p>
      <div className="grid gap-3 mt-4 sm:grid-cols-2 lg:grid-cols-4">
        <label><span className={LABEL}>{t('detail.seatLimit')}</span>
          <input className={INPUT} inputMode="numeric" value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} />
        </label>
        <label><span className={LABEL}>{t('detail.pricePerScreen')}</span>
          <input className={INPUT} inputMode="decimal" value={price} disabled={stripe || billingMode === 'COMP'} onChange={(e) => setPrice(e.target.value)} placeholder="20.00" />
        </label>
        <label><span className={LABEL}>{t('detail.planLabel')}</span>
          <select className={INPUT} value={plan} disabled={stripe} onChange={(e) => setPlan(e.target.value as 'MONTHLY' | 'ANNUAL')}>
            {PLANS.map((p) => <option key={p} value={p}>{t(`plan.${p}`)}</option>)}
          </select>
        </label>
        <label><span className={LABEL}>{t('detail.billingMethod')}</span>
          <select className={INPUT} value={billingMode} disabled={stripe} onChange={(e) => setBillingMode(e.target.value)}>
            {BILLING_MODES.map((m) => <option key={m} value={m}>{t(`billing.${m}`)}</option>)}
          </select>
        </label>
        <label><span className={LABEL}>{t('detail.renewalDate')}</span>
          <input type="date" className={INPUT} value={renewal} onChange={(e) => setRenewal(e.target.value)} />
        </label>
        <label><span className={LABEL}>{t('detail.poNumber')}</span>
          <input className={INPUT} value={po} onChange={(e) => setPo(e.target.value)} />
        </label>
        <label><span className={LABEL}>{t('detail.licenseStatusLabel')}</span>
          <select className={INPUT} value={lic?.status === 'SUSPENDED' ? 'SUSPENDED' : status} disabled={lic?.status === 'SUSPENDED'} onChange={(e) => setStatus(e.target.value)}>
            {lic?.status === 'SUSPENDED' && <option value="SUSPENDED">{t('licenseStatus.SUSPENDED')}</option>}
            {(['ACTIVE', 'PAST_DUE', 'CANCELLED'] as const).map((s) => <option key={s} value={s}>{t(`licenseStatus.${s}`)}</option>)}
          </select>
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2.5" data-testid="customer-ai-toggle">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-violet-600"
          checked={aiIncluded}
          disabled={stripe}
          onChange={(e) => setAiIncluded(e.target.checked)}
        />
        <span className="text-sm">
          <span className="font-medium text-slate-900">{t('detail.aiIncluded')}</span>
          <span className="block text-slate-500">{stripe ? t('detail.aiIncludedStripe') : t('detail.aiIncludedHint')}</span>
        </span>
      </label>
      <label className="block mt-3"><span className={LABEL}>{t('detail.notes')}</span>
        <textarea className={`${INPUT} py-2 min-h-20`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-rose-700 mt-2">{error}</p>}
      <div className="flex items-center gap-3 mt-3">
        <button type="submit" disabled={update.isPending} className={`${BTN} bg-slate-900 text-white`}>
          {update.isPending ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('detail.saving')}</> : t('detail.save')}
        </button>
        {saved && <span role="status" className="text-sm text-emerald-700 inline-flex items-center gap-1"><Check className="w-4 h-4" aria-hidden />{t('detail.saved')}</span>}
      </div>
    </form>
  );
}

function SuspensionCard({ c }: { c: CustomerDetail }) {
  const t = useTranslations('customerConsole');
  const locale = useLocale();
  const mutate = useSuspendCustomer(c.id);
  const [error, setError] = useState('');
  const suspended = c.license?.status === 'SUSPENDED';
  const act = async () => {
    setError('');
    try {
      if (suspended) {
        if (!(await appConfirm({ title: t('detail.reactivateConfirmTitle', { name: c.name }), message: t('detail.reactivateExplain'), confirmLabel: t('detail.reactivate') }))) return;
        await mutate.mutateAsync({ suspend: false });
      } else {
        const reason = await appPrompt({ title: t('detail.suspendConfirmTitle', { name: c.name }), message: t('detail.suspendExplain'), placeholder: t('detail.reasonLabel'), confirmLabel: t('detail.suspend') });
        if (reason === null) return;
        await mutate.mutateAsync({ suspend: true, reason });
      }
    } catch (err) {
      setError(errMessage(err, t('detail.genericError')));
    }
  };
  return (
    <section className={CARD}>
      <h2 className="font-semibold text-slate-900">{t('detail.suspendSection')}</h2>
      <p className="text-sm text-slate-600 mt-1">{t('detail.suspendExplain')}</p>
      {suspended && (
        <p className="text-sm text-rose-700 mt-2">
          {t('detail.suspendedSince', { date: formatDate(c.license?.suspendedAt, locale) })}
          {c.license?.suspendReason ? ` — ${c.license.suspendReason}` : ''}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-rose-700 mt-2">{error}</p>}
      <button type="button" onClick={act} disabled={mutate.isPending || !c.license} className={`${BTN} mt-3 ${suspended ? 'bg-emerald-600 text-white' : 'border border-rose-300 text-rose-700 bg-white'}`}>
        {suspended ? <PlayCircle className="w-4 h-4" aria-hidden /> : <PauseCircle className="w-4 h-4" aria-hidden />}
        {suspended ? t('detail.reactivate') : t('detail.suspend')}
      </button>
    </section>
  );
}

function OwnerLinkCard({ c }: { c: CustomerDetail }) {
  const t = useTranslations('customerConsole');
  const locale = useLocale();
  const issue = useIssueStarterLink(c.id);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const s = c.starterLogin;
  const state = !s
    ? t('detail.starterNone')
    : s.state === 'set_up'
      ? s.ownerEmail ? t('detail.starterSetUp', { email: s.ownerEmail }) : t('detail.starterSetUpNoEmail')
      : s.state === 'claimed'
        ? t('detail.starterClaimed')
        : s.state === 'expired'
          ? t('detail.starterExpired')
          : t('detail.starterPending');
  const create = async () => {
    setError('');
    try {
      setLink(await issue.mutateAsync(undefined as never));
    } catch (err) {
      setError(errMessage(err, t('detail.genericError')));
    }
  };
  return (
    <section className={CARD}>
      <h2 className="font-semibold text-slate-900">{t('detail.ownerSection')}</h2>
      <p className="text-sm text-slate-600 mt-1">
        {state}
        {s?.state === 'pending' && s.expiresAt && <> {t('detail.expiresOn', { date: formatDate(s.expiresAt, locale) })}</>}
      </p>
      {link ? (
        <OneTimeLink url={link.url} expiresAt={link.expiresAt} />
      ) : (
        s?.state !== 'set_up' && (
          <>
            <button type="button" onClick={create} disabled={issue.isPending} className={`${BTN} mt-3 border border-slate-300 bg-white text-slate-800`}>
              <Link2 className="w-4 h-4" aria-hidden /> {t('detail.newLink')}
            </button>
            <p className="text-xs text-slate-500 mt-1">{t('detail.newLinkHint')}</p>
          </>
        )
      )}
      {error && <p role="alert" className="text-sm text-rose-700 mt-2">{error}</p>}
    </section>
  );
}

/** The single-use owner link, shown once, with a copy button that says whether it copied. */
export function OneTimeLink({ url, expiresAt }: { url: string; expiresAt: string }) {
  const t = useTranslations('customerConsole');
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3" data-testid="one-time-link">
      <p className="text-sm font-semibold text-indigo-900">{t('detail.linkReady')}</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={`${INPUT} font-mono text-xs`} aria-label={t('detail.linkReady')} />
        <button type="button" onClick={copy} className={`${BTN} bg-indigo-600 text-white shrink-0`}>
          {copied ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
          {copied ? t('detail.copied') : t('detail.copy')}
        </button>
      </div>
      <p className="text-xs text-indigo-900/80 mt-2">{t('detail.linkSingleUse', { date: formatDate(expiresAt, locale) })}</p>
    </div>
  );
}

function InvoicesCard({ c }: { c: CustomerDetail }) {
  const t = useTranslations('customerConsole');
  const locale = useLocale();
  const create = useCreateInvoice(c.id);
  const update = useUpdateInvoice(c.id);
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const invoiceBilled = isInvoiceBilled(c.license?.billingMode);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!number.trim()) return setError(t('detail.invoiceNumberRequired'));
    const cents = parseDollarsToCents(amount);
    if (cents === 'invalid' || cents === null) return setError(t('detail.invoiceAmountInvalid'));
    try {
      await create.mutateAsync({ number: number.trim(), amountCents: cents, dueAt: fromDateInput(due) });
      setNumber('');
      setAmount('');
      setDue('');
    } catch (err) {
      setError(errMessage(err, t('detail.genericError')));
    }
  };
  const setStatus = async (invoiceId: string, status: InvoiceStatus) => {
    setError('');
    try {
      await update.mutateAsync({ invoiceId, status });
    } catch (err) {
      setError(errMessage(err, t('detail.genericError')));
    }
  };

  return (
    <section className={CARD}>
      <h2 className="font-semibold text-slate-900">{t('detail.invoicesSection')}</h2>
      {!invoiceBilled && <p className="text-sm text-slate-500 mt-1">{t('detail.invoicesOnlyInvoice')}</p>}
      {c.invoices.length === 0 ? (
        invoiceBilled && <p className="text-sm text-slate-500 mt-2">{t('detail.noInvoices')}</p>
      ) : (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-3">{t('detail.invoiceNumber')}</th>
                <th className="py-2 pr-3">{t('detail.amount')}</th>
                <th className="py-2 pr-3">{t('detail.sent')}</th>
                <th className="py-2 pr-3">{t('detail.due')}</th>
                <th className="py-2 pr-3">{t('detail.invoiceStatusLabel')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {c.invoices.map((i) => (
                <tr key={i.id} className="border-b border-slate-50 last:border-0" data-testid="invoice-row">
                  <td className="py-2 pr-3 font-medium">{i.number}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatCents(i.amountCents, locale)}</td>
                  <td className="py-2 pr-3">{formatDate(i.sentAt, locale)}</td>
                  <td className="py-2 pr-3">{formatDate(i.dueAt, locale)}</td>
                  <td className="py-2 pr-3">
                    {t(`detail.invoiceStatus.${i.status}`)}
                    {i.overdue && i.status === 'SENT' && <span className="ml-1 text-amber-700">· {t('detail.overdue')}</span>}
                    {i.status === 'PAID' && i.paidAt && <span className="text-slate-500"> · {formatDate(i.paidAt, locale)}</span>}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {i.status !== 'PAID' && i.status !== 'VOID' && (
                      <>
                        <button type="button" className="text-emerald-700 font-semibold mr-3 min-h-10" onClick={() => setStatus(i.id, 'PAID')}>{t('detail.markPaid')}</button>
                        {i.status !== 'PAST_DUE' && <button type="button" className="text-amber-700 font-semibold mr-3 min-h-10" onClick={() => setStatus(i.id, 'PAST_DUE')}>{t('detail.markPastDue')}</button>}
                        <button type="button" className="text-slate-500 font-semibold min-h-10" onClick={() => setStatus(i.id, 'VOID')}>{t('detail.markVoid')}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invoiceBilled && (
        <form onSubmit={add} className="grid gap-2 mt-3 sm:grid-cols-4 items-end">
          <label><span className={LABEL}>{t('detail.invoiceNumber')}</span><input className={INPUT} value={number} onChange={(e) => setNumber(e.target.value)} /></label>
          <label><span className={LABEL}>{t('detail.amount')}</span><input className={INPUT} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label><span className={LABEL}>{t('detail.due')}</span><input type="date" className={INPUT} value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <button type="submit" disabled={create.isPending} className={`${BTN} bg-slate-900 text-white`}>{t('detail.addInvoice')}</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-rose-700 mt-2">{error}</p>}
    </section>
  );
}

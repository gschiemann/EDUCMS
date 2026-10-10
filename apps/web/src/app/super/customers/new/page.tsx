'use client';

/**
 * /super/customers/new — create a customer organization: name + industry + licenses + billing
 * method (+ optional owner name and brand colors) → POST /super/customers, which creates the
 * organization, its license, its branding, and a starter owner reachable ONLY through the
 * single-use link shown here. The 30-second path: name, industry, screens, Create, Copy link.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useCreateCustomer } from '@/hooks/use-customer-console';
import { OneTimeLink } from '@/components/super/customers/CustomerDetailView';
import { BILLING_MODES, PLANS, VERTICAL_IDS, fromDateInput, parseDollarsToCents } from '@/lib/customer-console';

const INPUT = 'w-full min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900';
const LABEL = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1';

export default function NewCustomerPage() {
  const t = useTranslations('customerConsole');
  const user = useAppStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const create = useCreateCustomer();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [vertical, setVertical] = useState('K12');
  const [seatLimit, setSeatLimit] = useState('10');
  const [price, setPrice] = useState('20.00');
  const [plan, setPlan] = useState<'MONTHLY' | 'ANNUAL'>('ANNUAL');
  const [billingMode, setBillingMode] = useState('INVOICE');
  const [po, setPo] = useState('');
  const [renewal, setRenewal] = useState('');
  const [ownerFirst, setOwnerFirst] = useState('');
  const [ownerLast, setOwnerLast] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [useColors, setUseColors] = useState(false);
  const [primary, setPrimary] = useState('#1d4ed8');
  const [accent, setAccent] = useState('#f59e0b');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ id: string; name: string; url: string; expiresAt: string } | null>(null);

  if (!mounted) return null;
  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" aria-hidden />
          <h1 className="text-lg font-bold text-slate-900">{t('ownerOnlyTitle')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('ownerOnlyBody')}</p>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError(t('create.nameRequired'));
    if (!/^\d+$/.test(seatLimit.trim())) return setError(t('detail.invalidSeats'));
    const cents = parseDollarsToCents(price);
    if (cents === 'invalid') return setError(t('detail.invalidPrice'));
    try {
      const out = await create.mutateAsync({
        name: name.trim(),
        slug: slug.trim() || undefined,
        vertical,
        seatLimit: Number(seatLimit),
        monthlyPriceCents: cents,
        plan,
        billingMode,
        poNumber: po || null,
        renewalDate: fromDateInput(renewal),
        ownerFirstName: ownerFirst || null,
        ownerLastName: ownerLast || null,
        displayName: displayName || null,
        primaryColor: useColors ? primary : null,
        accentColor: useColors ? accent : null,
      });
      setDone({ id: out.id, name: name.trim(), url: out.starterLink.url, expiresAt: out.starterLink.expiresAt });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('detail.genericError'));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <Link href="/super/customers" className="inline-flex items-center gap-1.5 min-h-10 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" aria-hidden /> {t('detail.back')}
        </Link>
        <header>
          <h1 className="text-2xl font-bold text-slate-900">{t('create.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('create.subtitle')}</p>
        </header>

        {done ? (
          <section className="bg-white rounded-2xl border border-slate-200 p-5" data-testid="customer-created">
            <h2 className="text-lg font-semibold text-slate-900">{t('create.createdTitle', { name: done.name })}</h2>
            <p className="text-sm text-slate-600 mt-1">{t('create.createdBody')}</p>
            <OneTimeLink url={done.url} expiresAt={done.expiresAt} />
            <div className="flex flex-wrap gap-2 mt-4">
              <Link href={`/super/customers/${done.id}`} className="inline-flex items-center min-h-10 px-4 rounded-lg bg-slate-900 text-white text-sm font-semibold">{t('create.openCustomer')}</Link>
              <button type="button" onClick={() => { setDone(null); setName(''); setSlug(''); }} className="inline-flex items-center min-h-10 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold">{t('create.createAnother')}</button>
            </div>
          </section>
        ) : (
          <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className={LABEL}>{t('create.orgName')}</span>
                <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="organization" />
              </label>
              <label><span className={LABEL}>{t('create.industry')}</span>
                <select className={INPUT} value={vertical} onChange={(e) => setVertical(e.target.value)}>
                  {VERTICAL_IDS.map((v) => <option key={v} value={v}>{t(`vertical.${v}`)}</option>)}
                </select>
              </label>
              <label><span className={LABEL}>{t('create.accountUrl')}</span>
                <input className={INPUT} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={t('create.accountUrlHint')} />
              </label>
              <label><span className={LABEL}>{t('detail.seatLimit')}</span>
                <input className={INPUT} inputMode="numeric" value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} />
              </label>
              <label><span className={LABEL}>{t('detail.billingMethod')}</span>
                <select className={INPUT} value={billingMode} onChange={(e) => setBillingMode(e.target.value)}>
                  {BILLING_MODES.map((m) => <option key={m} value={m}>{t(`billing.${m}`)}</option>)}
                </select>
              </label>
              <label><span className={LABEL}>{t('detail.pricePerScreen')}</span>
                <input className={INPUT} inputMode="decimal" value={price} disabled={billingMode === 'COMP'} onChange={(e) => setPrice(e.target.value)} />
              </label>
              <label><span className={LABEL}>{t('detail.planLabel')}</span>
                <select className={INPUT} value={plan} onChange={(e) => setPlan(e.target.value as 'MONTHLY' | 'ANNUAL')}>
                  {PLANS.map((p) => <option key={p} value={p}>{t(`plan.${p}`)}</option>)}
                </select>
              </label>
              {(billingMode === 'INVOICE' || billingMode === 'PURCHASE_ORDER') && (
                <label><span className={LABEL}>{t('detail.poNumber')}</span>
                  <input className={INPUT} value={po} onChange={(e) => setPo(e.target.value)} />
                </label>
              )}
              <label><span className={LABEL}>{t('detail.renewalDate')}</span>
                <input type="date" className={INPUT} value={renewal} onChange={(e) => setRenewal(e.target.value)} />
              </label>
              <label><span className={LABEL}>{t('create.ownerFirst')}</span>
                <input className={INPUT} value={ownerFirst} onChange={(e) => setOwnerFirst(e.target.value)} />
              </label>
              <label><span className={LABEL}>{t('create.ownerLast')}</span>
                <input className={INPUT} value={ownerLast} onChange={(e) => setOwnerLast(e.target.value)} />
              </label>
            </div>
            <fieldset className="border-t border-slate-100 pt-4">
              <legend className="font-semibold text-slate-900">{t('create.brandingSection')}</legend>
              <div className="grid gap-3 sm:grid-cols-3 mt-2">
                <label className="sm:col-span-3"><span className={LABEL}>{t('create.displayName')}</span>
                  <input className={INPUT} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </label>
                <label className="flex items-center gap-2 text-sm min-h-10 sm:col-span-3">
                  <input type="checkbox" checked={useColors} onChange={(e) => setUseColors(e.target.checked)} /> {t('create.useColors')}
                </label>
                {useColors && (
                  <>
                    <label><span className={LABEL}>{t('create.primaryColor')}</span><input type="color" className="h-10 w-full rounded-lg border border-slate-200" value={primary} onChange={(e) => setPrimary(e.target.value)} /></label>
                    <label><span className={LABEL}>{t('create.accentColor')}</span><input type="color" className="h-10 w-full rounded-lg border border-slate-200" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
                  </>
                )}
              </div>
            </fieldset>
            {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            <button type="submit" disabled={create.isPending} className="inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-xl bg-slate-900 text-white text-sm font-semibold disabled:opacity-50">
              {create.isPending ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('create.creating')}</> : t('create.submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, CreditCard, Loader2, Mail, Palette, Plus } from 'lucide-react';
import { useAllocateCustomerScreens, useCreateCustomerLocation, useCustomerBranding, useCustomerInvite, useCustomerPaymentSummary } from '@/hooks/use-customer-console';
import { formatDate, type CustomerDetail } from '@/lib/customer-console';
import { OneTimeLink } from './CustomerDetailView';

const CARD = 'rounded-2xl border border-slate-200 bg-white p-5';
const INPUT = 'mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm';
const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-50';
const errorMessage = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;

export function CustomerPaymentCard({ c }: { c: CustomerDetail }) {
  const t = useTranslations('businessConsole');
  const locale = useLocale();
  const payment = useCustomerPaymentSummary(c.id);
  const d = payment.data;
  return <section className={CARD} aria-labelledby="payment-heading"><h2 id="payment-heading" className="flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4 text-indigo-600" aria-hidden />{t('paymentSummary')}</h2>{payment.isLoading ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-slate-400" aria-label={t('loading')} /> : payment.isError || !d || d.state === 'unavailable' ? <p className="mt-3 text-sm text-slate-500">{t('paymentUnavailable')}</p> : d.state !== 'available' ? <p className="mt-3 text-sm text-slate-500">{t(d.state === 'not_subscribed' ? 'noSubscription' : 'invoicePayment')}</p> : <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-slate-500">{t('cardOnFile')}</p><p className="mt-1 text-sm font-medium">{d.card ? `${d.card.brand} •••• ${d.card.last4}` : t('noCard')}</p>{d.card ? <p className="mt-1 text-xs text-slate-400">{t('expires', { month: d.card.expMonth, year: d.card.expYear })}</p> : null}</div><div><p className="text-xs text-slate-500">{t('nextPayment')}</p>{d.nextPayment ? <><p className="mt-1 text-lg font-semibold">{new Intl.NumberFormat(locale, { style: 'currency', currency: d.nextPayment.currency }).format(d.nextPayment.amountCents / 100)}</p><p className="text-xs text-slate-500">{formatDate(d.nextPayment.at, locale)}</p></> : <p className="mt-1 text-sm">{t('noUpcomingPayment')}</p>}</div></div>}</section>;
}

export function CustomerInviteCard({ c }: { c: CustomerDetail }) {
  const t = useTranslations('businessConsole');
  const invite = useCustomerInvite(c.id);
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [result, setResult] = useState<{ emailDelivered: boolean; acceptUrl: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  return <section className={CARD} id="customer-people"><h2 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-indigo-600" aria-hidden />{t('inviteAdmin')}</h2><p className="mt-1 text-sm text-slate-500">{t('inviteBody')}</p><form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); setError(''); setResult(null); try { setResult(await invite.mutateAsync({ email: email.trim(), ...(location ? { tenantId: location } : {}) })); setEmail(''); } catch (err) { setError(errorMessage(err, t('saveFailed'))); } }}><label className="text-xs font-medium text-slate-600">{t('email')}<input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={INPUT} autoComplete="email" /></label><label className="text-xs font-medium text-slate-600">{t('inviteScope')}<select value={location} onChange={e => setLocation(e.target.value)} className={INPUT}><option value="">{c.name}</option>{c.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><div className="sm:col-span-2"><button className={BTN} disabled={invite.isPending}>{invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />}{t('sendInvite')}</button></div></form>{error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}{result ? <div className="mt-3"><p role="status" className={`text-sm ${result.emailDelivered ? 'text-emerald-700' : 'text-amber-800'}`}>{t(result.emailDelivered ? 'inviteSent' : 'inviteNotDelivered')}</p>{!result.emailDelivered ? <OneTimeLink url={result.acceptUrl} expiresAt={result.expiresAt} /> : null}</div> : null}</section>;
}

export function CustomerBrandingCard({ c }: { c: CustomerDetail }) {
  const t = useTranslations('businessConsole');
  const save = useCustomerBranding(c.id);
  const [name, setName] = useState(c.branding?.displayName ?? c.name);
  const [primary, setPrimary] = useState(c.branding?.primary ?? '#4f46e5');
  const [accent, setAccent] = useState(c.branding?.accent ?? '#0ea5e9');
  const [logo, setLogo] = useState(c.branding?.logoUrl ?? '');
  const [error, setError] = useState('');
  return <section className={CARD} id="customer-branding"><h2 className="flex items-center gap-2 font-semibold"><Palette className="h-4 w-4 text-indigo-600" aria-hidden />{t('branding')}</h2><p className="mt-1 text-sm text-slate-500">{t('brandingBody')}</p><form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); setError(''); try { await save.mutateAsync({ displayName: name.trim() || null, primaryColor: primary, accentColor: accent, logoUrl: logo.trim() || null }); } catch (err) { setError(errorMessage(err, t('saveFailed'))); } }}><label className="text-xs font-medium text-slate-600">{t('displayName')}<input value={name} onChange={e => setName(e.target.value)} className={INPUT} /></label><label className="text-xs font-medium text-slate-600">{t('logoUrl')}<input type="url" value={logo} onChange={e => setLogo(e.target.value)} className={INPUT} placeholder="https://" /></label><div className="flex gap-5"><label className="text-xs font-medium text-slate-600">{t('primaryColor')}<input type="color" value={primary} onChange={e => setPrimary(e.target.value)} className="mt-2 block h-10 w-16 rounded-lg border border-slate-200 bg-white" /></label><label className="text-xs font-medium text-slate-600">{t('accentColor')}<input type="color" value={accent} onChange={e => setAccent(e.target.value)} className="mt-2 block h-10 w-16 rounded-lg border border-slate-200 bg-white" /></label></div><div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"><span className="h-9 w-2 rounded-full" style={{ backgroundColor: primary }} /><span className="text-sm font-semibold">{name}</span><span className="ml-auto h-4 w-4 rounded-full" style={{ backgroundColor: accent }} /></div><div className="flex items-center gap-3 sm:col-span-2"><button className={BTN} disabled={save.isPending}>{t('saveBranding')}</button>{save.isSuccess ? <span role="status" className="inline-flex items-center gap-1 text-sm text-emerald-700"><Check className="h-4 w-4" aria-hidden />{t('saved')}</span> : null}</div></form>{error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}</section>;
}

export function CustomerLocationsCard({ c }: { c: CustomerDetail }) {
  const t = useTranslations('businessConsole');
  const create = useCreateCustomerLocation(c.id);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [error, setError] = useState('');
  return <section className={CARD} id="customer-locations"><h2 className="font-semibold">{t('locationHierarchy')}</h2><p className="mt-1 text-sm text-slate-500">{t('locationBody')}</p><div className="mt-4 rounded-xl border border-slate-200"><div className="flex items-center justify-between gap-2 bg-slate-50 px-4 py-3"><span className="text-sm font-semibold">{c.name}</span><span className="text-xs text-slate-500">{t('corporateAccount')}</span></div>{c.locations.map(l => <LocationAllocation key={`${l.id}-${l.allocatedSeats}`} customer={c} location={l} />)}{!c.locations.length ? <p className="p-4 text-sm text-slate-400">{t('noLocations')}</p> : null}</div><details className="mt-4"><summary className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold text-indigo-700"><Plus className="h-4 w-4" aria-hidden />{t('addLocation')}</summary><form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); setError(''); try { await create.mutateAsync({ name: name.trim(), ...(parent ? { parentId: parent } : {}) }); setName(''); } catch (err) { setError(errorMessage(err, t('saveFailed'))); } }}><label className="text-xs font-medium text-slate-600">{t('locationName')}<input required value={name} onChange={e => setName(e.target.value)} className={INPUT} /></label><label className="text-xs font-medium text-slate-600">{t('parentLocation')}<select value={parent} onChange={e => setParent(e.target.value)} className={INPUT}><option value="">{c.name}</option>{c.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><button className={`${BTN} sm:col-span-2 sm:justify-self-start`} disabled={create.isPending}>{t('addLocation')}</button></form></details>{error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}</section>;
}

function LocationAllocation({ customer, location }: { customer: CustomerDetail; location: CustomerDetail['locations'][number] }) {
  const t = useTranslations('businessConsole');
  const allocate = useAllocateCustomerScreens(customer.id);
  const [seats, setSeats] = useState(location.allocatedSeats == null ? '' : String(location.allocatedSeats));
  const [error, setError] = useState('');
  return <div className="border-t border-slate-100 px-4 py-3"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1" style={{ paddingLeft: Math.min(location.depth ?? 0, 4) * 12 }}><p className="text-sm font-medium">{location.name}</p><p className="mt-1 text-xs text-slate-500">{t('screensInUse', { count: location.seatsUsed })}</p></div>{customer.license?.pooledSeats ? <form className="flex items-end gap-2" onSubmit={async e => { e.preventDefault(); setError(''); if (seats && !/^\d+$/.test(seats)) { setError(t('invalidAllocation')); return; } try { await allocate.mutateAsync({ locationId: location.id, seatLimit: seats === '' ? null : Number(seats) }); } catch (err) { setError(errorMessage(err, t('saveFailed'))); } }}><label className="text-[11px] text-slate-500">{t('allocatedScreens')}<input aria-label={t('allocationFor', { name: location.name })} value={seats} onChange={e => setSeats(e.target.value)} inputMode="numeric" placeholder={t('sharedPool')} className="mt-1 block min-h-10 w-24 rounded-lg border border-slate-200 px-2 text-sm" /></label><button disabled={allocate.isPending} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-indigo-700">{t('save')}</button></form> : <span className="text-xs text-slate-400">{t('individualBilling')}</span>}</div>{allocate.isSuccess ? <p role="status" className="mt-1 text-xs text-emerald-700">{t('saved')}</p> : null}{error ? <p role="alert" className="mt-1 text-xs text-rose-700">{error}</p> : null}</div>;
}

"use client";

/**
 * Signup — the first surface a new operator touches.
 *
 * 2026-05-16 — design refresh: "minimal & precise". A clean split —
 * white form column on the left, a dark navy brand panel on the right
 * (lg+). The old rounded Fredoka type, rainbow device mockup, and
 * drifting gradient orbs are retired; this reads as professional
 * infrastructure, not a K-12 toy. Industry-neutral by default;
 * reflavors its copy to whatever vertical the operator picks.
 *
 * 2026-10-24 — every word is in the `signup.*` catalog (en / es / zh) and the
 * page carries the same language switcher as /login. It used to be the one
 * pre-auth page that was English-only (launch QA U2). Server answers are
 * mapped to translated messages by `signup-errors.ts`.
 *
 * Explicitly NOT themed per-tenant: this is the PRODUCT surface
 * (public, pre-auth) so brand colors stay locked to VenueOS.
 */

import { useState, useEffect, useId, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle, ArrowRight, Shield, Calendar, Palette, MonitorPlay, ChevronDown } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';
import { VERTICALS, isVertical, type Vertical } from '@cms/api-types';
import { BrandMark } from '@/components/marketing/BrandMark';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { LanguageSwitcherInline } from '@/components/layout/LanguageMenu';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { signupErrorFor, type SignupErrorKey } from './signup-errors';

const NAVY = '#070a14';

function slugify(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Per-vertical example values for the two technical fields. They are format
 * examples (a URL slug, an email address), so they stay the same in every
 * language; the words around them — picker label, field label, example name,
 * hero phrase — live in `signup.verticals.<VERTICAL>.*`.
 */
const VERTICAL_EXAMPLES: Record<Vertical, { slug: string; email: string }> = {
  K12: { slug: 'springfield', email: 'you@school.edu' },
  GYM: { slug: 'iron-peak', email: 'you@yourgym.com' },
  RETAIL: { slug: 'northside', email: 'you@yourstore.com' },
  CORPORATE: { slug: 'acme', email: 'you@company.com' },
  // 2026-07-24 — one consolidated food option (the full-service RESTAURANT
  // entry is hidden from the picker below), matching the Settings switcher's
  // "Restaurant/QSR". Operator: "make sure it's fixed in the new customer
  // setup as well."
  QSR: { slug: 'burger-junction', email: 'you@yourbrand.com' },
  FASHION: { slug: 'studio-5', email: 'you@yourbrand.com' },
  BAR: { slug: 'tap-room', email: 'you@yourbar.com' },
  HEALTHCARE: { slug: 'harbor-health', email: 'you@yourpractice.com' },
  HOSPITALITY: { slug: 'summit-hotels', email: 'you@yourproperty.com' },
  RESTAURANT: { slug: 'copper-table', email: 'you@yourrestaurant.com' },
  SPORTS: { slug: 'riverside-arena', email: 'you@yourvenue.com' },
  WORSHIP: { slug: 'grace-community', email: 'you@yourchurch.org' },
};
const DEFAULT_EXAMPLES = { slug: 'your-venue', email: 'you@yourvenue.com' };

const VALUE_PROPS = [
  { icon: Shield, key: 'alerts' },
  { icon: Calendar, key: 'schedule' },
  { icon: Palette, key: 'templates' },
  { icon: MonitorPlay, key: 'screens' },
] as const;

const INPUT_CLS =
  'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition';

/** A `t.rich` handler that renders its chunk as an in-app link. */
const legalLink = (href: string) => function LegalLink(chunks: ReactNode) {
  return <Link href={href} className="text-indigo-600 hover:underline">{chunks}</Link>;
};

export default function SignupPage() {
  const t = useTranslations('signup');
  const [districtName, setDistrictName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // 2026-05-25 — operator: "lets ask for the first, last, email, and
  // phone number when signing up a new account." Identity fields
  // captured up front so the dashboard greeting + user-list rows
  // read like a real person from day one. Phone is optional because
  // TOTP / passkey 2FA paths don't need it; we only require it if
  // the user wants SMS-2FA later.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  // 2026-05-25 — optional address at signup. Sprint 8's fleet map
  // plots tenants by lat/lng. Operator: "this could auto build out
  // our map from the screen area if we collect it with every
  // account setup." Address-autocomplete (Photon + Nominatim)
  // captures lat/lng client-side at pick time so the map plots
  // immediately, no follow-up geocoding pass needed for addresses
  // entered this way.
  const [address, setAddress] = useState('');
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLon, setAddressLon] = useState<number | null>(null);
  const [vertical, setVertical] = useState<Vertical | ''>('');
  const [loading, setLoading] = useState(false);
  // A catalog key (shown in the reader's language) or, when the server said
  // something this page does not know, the server's own sentence.
  const [error, setError] = useState<{ key: SignupErrorKey | 'passwordLength' | 'passwordMismatch' | 'unreachable' } | { raw: string } | null>(null);
  const login = useUIStore((s) => s.login);
  const router = useRouter();
  // 2026-10-11 — the language this page is shown in; trial reminder emails
  // are written in it (License.noticeLocale).
  const { locale } = useLocaleSwitch();
  const vk = vertical || null;
  const copy = (field: 'nameLabel' | 'namePlaceholder' | 'where') =>
    vk ? t(`verticals.${vk}.${field}`) : t(`defaults.${field}`);
  const examples = vk ? VERTICAL_EXAMPLES[vk] : DEFAULT_EXAMPLES;

  // Preselect the vertical from ?vertical= — the landing-page industry
  // showcase deep-links here with it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('vertical');
    if (q && isVertical(q.toUpperCase())) setVertical(q.toUpperCase() as Vertical);
  }, []);

  const handleDistrictChange = (val: string) => {
    setDistrictName(val);
    if (!slugTouched) setSlug(slugify(val));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!vertical) { setError({ key: 'industry' }); return; }
    if (password.length < 8) { setError({ key: 'passwordLength' }); return; }
    if (password !== confirmPassword) { setError({ key: 'passwordMismatch' }); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          districtName,
          slug,
          adminEmail,
          password,
          vertical,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
          latitude: addressLat ?? undefined,
          longitude: addressLon ?? undefined,
          locale,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.access_token) {
        login(data.access_token, data.user);
        // New workspaces land on onboarding first (paste-your-URL
        // auto-branding); that page has its own "Skip for now" to the
        // dashboard, so the step is never a dead end.
        router.push('/onboarding/branding');
      } else {
        setError(signupErrorFor(res.status, data));
      }
    } catch {
      setError({ key: 'unreachable' });
    } finally { setLoading(false); }
  };

  const errorText = !error
    ? ''
    : 'raw' in error
      ? error.raw
      : error.key === 'unreachable'
        ? t('errors.unreachable', { url: API_URL })
        : t(`errors.${error.key}`);

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-2">
      {/* ── LEFT — form ── */}
      <div className="flex flex-col min-h-screen px-6 py-7 sm:px-10 lg:px-14">
        <div className="flex items-center justify-between gap-4">
          <BrandMark />
          <Link href="/login" className="text-sm font-medium text-slate-500 hover:text-slate-900 text-right">
            {t('haveWorkspace')} <span className="text-indigo-600">{t('signIn')}</span>
          </Link>
        </div>

        <div className="flex-1 flex flex-col justify-center py-10">
          <div className="w-full max-w-md mx-auto lg:mx-0">
            <span className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-600">
              {t('trialBadge')}
            </span>
            <h1 className="mt-3 text-3xl md:text-[34px] font-semibold tracking-tight text-slate-900 leading-[1.1]">
              {t('title')}
            </h1>
            <p className="mt-2.5 text-[15px] text-slate-600 leading-relaxed">
              {t('lead', { where: copy('where') })}
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4">
              <Field label={t('industryLabel')}>
                {(id) => (
                  // appearance-none + our own chevron: Safari otherwise draws its
                  // native 20px menulist here, beside 42px rounded inputs — the
                  // first control a new customer touches (QA 2026-10-23).
                  <div className="relative">
                    <select
                      id={id}
                      required
                      value={vertical}
                      onChange={(e) => setVertical(e.target.value as Vertical | '')}
                      className={`${INPUT_CLS} cursor-pointer appearance-none pr-10`}
                    >
                      <option value="" disabled>{t('industryPlaceholder')}</option>
                      {/* Hide the full-service RESTAURANT — it's merged into the
                          single "Restaurant / QSR" option (QSR vertical) so new
                          customers don't see two restaurant choices. */}
                      {VERTICALS.filter((v) => v !== 'RESTAURANT').map((v) => (
                        <option key={v} value={v}>{t(`verticals.${v}.picker`)}</option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  </div>
                )}
              </Field>

              <Field label={copy('nameLabel')}>
                {(id) => (
                  <input
                    id={id}
                    required
                    autoComplete="organization"
                    value={districtName}
                    onChange={(e) => handleDistrictChange(e.target.value)}
                    placeholder={copy('namePlaceholder')}
                    className={INPUT_CLS}
                  />
                )}
              </Field>

              <Field label={t('workspaceUrl')} hint={t('workspaceUrlHint')}>
                {(id) => (
                  <div className="flex items-center bg-white border border-slate-300 rounded-lg overflow-hidden focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition">
                    <span className="pl-3.5 pr-2 py-2.5 text-sm text-slate-400 font-mono shrink-0 border-r border-slate-200" aria-hidden>/</span>
                    <input
                      id={id}
                      required
                      value={slug}
                      onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                      placeholder={examples.slug}
                      className="flex-1 min-w-0 px-3 py-2.5 bg-transparent text-sm font-mono text-slate-900 placeholder:text-slate-400 outline-none"
                    />
                  </div>
                )}
              </Field>

              {/* 2026-05-25 — identity row. Name fields side-by-side so
                  the form stays compact; phone gets its own row with
                  an explicit "optional" hint and 2FA copy so the
                  operator understands why we're asking. */}
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('firstName')}>
                  {(id) => (
                    <input
                      id={id}
                      type="text"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder={t('firstNamePlaceholder')}
                      className={INPUT_CLS}
                    />
                  )}
                </Field>
                <Field label={t('lastName')}>
                  {(id) => (
                    <input
                      id={id}
                      type="text"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder={t('lastNamePlaceholder')}
                      className={INPUT_CLS}
                    />
                  )}
                </Field>
              </div>

              <Field label={t('adminEmail')}>
                {(id) => (
                  <input
                    id={id}
                    type="email"
                    required
                    autoComplete="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder={examples.email}
                    className={INPUT_CLS}
                  />
                )}
              </Field>

              <Field label={t('phone')} hint={t('phoneHint')}>
                {(id) => (
                  <input
                    id={id}
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (213) 555-1234"
                    className={INPUT_CLS}
                  />
                )}
              </Field>

              <Field label={t('address')} hint={t('addressHint')}>
                {(id) => (
                  <AddressAutocomplete
                    id={id}
                    value={address}
                    onChange={(v) => {
                      setAddress(v);
                      if (addressLat !== null || addressLon !== null) {
                        setAddressLat(null);
                        setAddressLon(null);
                      }
                    }}
                    onPick={(p) => {
                      setAddress(p.displayName);
                      setAddressLat(p.latitude);
                      setAddressLon(p.longitude);
                    }}
                    placeholder={t('addressPlaceholder')}
                  />
                )}
              </Field>

              <Field label={t('password')}>
                {(id) => (
                  <input
                    id={id}
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('passwordPlaceholder')}
                    className={INPUT_CLS}
                  />
                )}
              </Field>

              <Field label={t('confirmPassword')}>
                {(id) => (
                  <input
                    id={id}
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t('confirmPasswordPlaceholder')}
                    className={INPUT_CLS}
                  />
                )}
              </Field>

              {error && (
                <div role="alert" data-testid="signup-error" className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" aria-hidden />
                  <p className="text-xs text-rose-700 font-medium">{errorText}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('creating')}</>
                  : <>{t('create')} <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden /></>}
              </button>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                {/* Handlers inline: the i18n parity gate reads them next to the
                    t.rich call to prove every <tag> in the message renders. */}
                {vertical === 'K12'
                  ? t.rich('agreeK12', {
                      terms: legalLink('/terms'),
                      privacy: legalLink('/privacy'),
                      ferpa: legalLink('/ferpa'),
                      coppa: legalLink('/coppa'),
                    })
                  : t.rich('agree', { terms: legalLink('/terms'), privacy: legalLink('/privacy') })}
              </p>
            </form>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label={t('footer.label')} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>&copy; {new Date().getFullYear()} VenueOS</span>
            <Link href="/terms" className="hover:text-slate-700">{t('footer.terms')}</Link>
            <Link href="/privacy" className="hover:text-slate-700">{t('footer.privacy')}</Link>
            <Link href="/security" className="hover:text-slate-700">{t('footer.security')}</Link>
            <Link href="/dpa" className="hover:text-slate-700">{t('footer.dpa')}</Link>
            <Link href="/ferpa" className="hover:text-slate-700">FERPA</Link>
            <Link href="/coppa" className="hover:text-slate-700">COPPA</Link>
          </nav>
          {/* Same switcher /login carries — a visitor must be able to change
              the language before they have an account. */}
          <LanguageSwitcherInline className="sm:justify-end" />
        </div>
      </div>

      {/* ── RIGHT — dark brand panel (lg+) ── */}
      <div
        className="hidden lg:flex relative flex-col justify-center overflow-hidden px-14"
        style={{ background: NAVY }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 right-0 h-[720px] w-[720px]"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.18), transparent 62%)' }}
        />
        <svg
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 h-full w-full opacity-40"
          viewBox="0 0 560 880"
          preserveAspectRatio="xMidYMid slice"
        >
          <g stroke="#26304d" strokeWidth="1.25" fill="none">
            <polygon points="90,120 135,146 135,198 90,224 45,198 45,146" />
            <polygon points="470,300 515,326 515,378 470,404 425,378 425,326" />
            <polygon points="400,560 445,586 445,638 400,664 355,638 355,586" />
            <polygon points="120,640 165,666 165,718 120,744 75,718 75,666" />
          </g>
        </svg>

        <div className="relative max-w-md">
          <span className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-300">
            {t('panel.eyebrow')}
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white leading-[1.15]">
            {t('panel.title')}
          </h2>
          <p className="mt-3 text-[15px] text-slate-400 leading-relaxed">
            {t('panel.lead')}
          </p>
          <ul className="mt-9 space-y-5">
            {VALUE_PROPS.map((p) => (
              <li key={p.key} className="flex gap-3.5">
                <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                  <p.icon className="w-4 h-4 text-indigo-300" strokeWidth={2} aria-hidden />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{t(`panel.${p.key}Title`)}</div>
                  <div className="mt-0.5 text-[13px] text-slate-400 leading-relaxed">{t(`panel.${p.key}Desc`)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** A labelled form row. The label is tied to its control (`htmlFor`), so a
 *  screen reader announces it and a tap on the label focuses the field. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      {children(id)}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

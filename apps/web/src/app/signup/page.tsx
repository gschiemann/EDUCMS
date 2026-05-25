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
 * Explicitly NOT themed per-tenant: this is the PRODUCT surface
 * (public, pre-auth) so brand colors stay locked to VenueOS.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, ArrowRight, Shield, Calendar, Palette, MonitorPlay } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';
import { VERTICALS, isVertical, type Vertical } from '@cms/api-types';
import { BrandMark } from '@/components/marketing/BrandMark';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';

const NAVY = '#070a14';

function slugify(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Per-vertical signup copy. VenueOS serves every venue — the picker,
 * field labels, and hero word reflavor to the industry the operator
 * picks (or arrives with via ?vertical=).
 */
interface VerticalSignup {
  picker: string;
  nameLabel: string;
  namePlaceholder: string;
  slugPlaceholder: string;
  emailPlaceholder: string;
  heroWord: string;
}

const SIGNUP_VERTICALS: Record<Vertical, VerticalSignup> = {
  K12: {
    picker: 'K-12 school or district',
    nameLabel: 'District or school name',
    namePlaceholder: 'Springfield Unified School District',
    slugPlaceholder: 'springfield',
    emailPlaceholder: 'you@school.edu',
    heroWord: 'whole district',
  },
  GYM: {
    picker: 'Gym, fitness club, or athletic facility',
    nameLabel: 'Gym or club name',
    namePlaceholder: 'Iron Peak Fitness',
    slugPlaceholder: 'iron-peak',
    emailPlaceholder: 'you@yourgym.com',
    heroWord: 'whole gym',
  },
  RETAIL: {
    picker: 'Retail store or chain',
    nameLabel: 'Store or chain name',
    namePlaceholder: 'Northside Outfitters',
    slugPlaceholder: 'northside',
    emailPlaceholder: 'you@yourstore.com',
    heroWord: 'whole store',
  },
  CORPORATE: {
    picker: 'Corporate office or enterprise',
    nameLabel: 'Company name',
    namePlaceholder: 'Acme Corp',
    slugPlaceholder: 'acme',
    emailPlaceholder: 'you@company.com',
    heroWord: 'whole office',
  },
  QSR: {
    picker: 'Quick-service restaurant',
    nameLabel: 'Restaurant or brand name',
    namePlaceholder: 'Burger Junction',
    slugPlaceholder: 'burger-junction',
    emailPlaceholder: 'you@yourbrand.com',
    heroWord: 'whole brand',
  },
  FASHION: {
    picker: 'Fashion boutique or apparel',
    nameLabel: 'Boutique or brand name',
    namePlaceholder: 'Studio 5 Boutique',
    slugPlaceholder: 'studio-5',
    emailPlaceholder: 'you@yourbrand.com',
    heroWord: 'whole boutique',
  },
  BAR: {
    picker: 'Bar, taproom, or nightclub',
    nameLabel: 'Bar or venue name',
    namePlaceholder: 'The Tap Room',
    slugPlaceholder: 'tap-room',
    emailPlaceholder: 'you@yourbar.com',
    heroWord: 'whole bar',
  },
  HEALTHCARE: {
    picker: 'Clinic, practice, or hospital',
    nameLabel: 'Practice or network name',
    namePlaceholder: 'Harbor Health',
    slugPlaceholder: 'harbor-health',
    emailPlaceholder: 'you@yourpractice.com',
    heroWord: 'whole practice',
  },
  HOSPITALITY: {
    picker: 'Hotel, resort, or property',
    nameLabel: 'Property or group name',
    namePlaceholder: 'Summit Hotels',
    slugPlaceholder: 'summit-hotels',
    emailPlaceholder: 'you@yourproperty.com',
    heroWord: 'whole property',
  },
  RESTAURANT: {
    picker: 'Full-service restaurant',
    nameLabel: 'Restaurant or group name',
    namePlaceholder: 'The Copper Table',
    slugPlaceholder: 'copper-table',
    emailPlaceholder: 'you@yourrestaurant.com',
    heroWord: 'whole restaurant',
  },
  SPORTS: {
    picker: 'Sports venue, stadium, or athletic program',
    nameLabel: 'Venue, team, or league name',
    namePlaceholder: 'Riverside Arena',
    slugPlaceholder: 'riverside-arena',
    emailPlaceholder: 'you@yourvenue.com',
    heroWord: 'whole venue',
  },
  WORSHIP: {
    picker: 'Church, ministry, or house of worship',
    nameLabel: 'Church or ministry name',
    namePlaceholder: 'Grace Community Church',
    slugPlaceholder: 'grace-community',
    emailPlaceholder: 'you@yourchurch.org',
    heroWord: 'whole ministry',
  },
};

/** Neutral default — shown before the visitor picks an industry. */
const DEFAULT_SIGNUP: Omit<VerticalSignup, 'picker'> = {
  nameLabel: 'Organization name',
  namePlaceholder: 'Your venue or organization',
  slugPlaceholder: 'your-venue',
  emailPlaceholder: 'you@yourvenue.com',
  heroWord: 'whole venue',
};

const VALUE_PROPS = [
  { icon: Shield, title: 'Emergency alerts in a tap', desc: 'Lockdown, evacuate, and weather messages flip every screen in seconds.' },
  { icon: Calendar, title: 'Schedule once, everywhere', desc: 'Content by day, time block, or one-off event — one screen or ten thousand.' },
  { icon: Palette, title: '170+ templates, every industry', desc: 'Fully editable, recolored to your brand, ready to drop on a screen.' },
  { icon: MonitorPlay, title: 'Runs on any screen', desc: 'Smart TVs, Android players, LED controllers, kiosks — no special hardware.' },
];

const INPUT_CLS =
  'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 ' +
  'placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition';

export default function SignupPage() {
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
  const [error, setError] = useState('');
  const login = useUIStore((s) => s.login);
  const router = useRouter();
  const v = vertical ? SIGNUP_VERTICALS[vertical] : DEFAULT_SIGNUP;

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
    setError('');
    if (!vertical) { setError('Please choose your industry.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
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
        }),
      });
      const data = await res.json();
      if (res.ok && data.access_token) {
        login(data.access_token, data.user);
        // New workspaces land on onboarding first (paste-your-URL
        // auto-branding); that page has its own "Skip for now" to the
        // dashboard, so the step is never a dead end.
        router.push('/onboarding/branding');
      } else {
        setError(data.message || 'Signup failed. Please try again.');
      }
    } catch {
      setError(`Can't reach the server at ${API_URL}.`);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-2">
      {/* ── LEFT — form ── */}
      <div className="flex flex-col min-h-screen px-6 py-7 sm:px-10 lg:px-14">
        <div className="flex items-center justify-between">
          <BrandMark />
          <Link href="/login" className="text-sm font-medium text-slate-500 hover:text-slate-900">
            Have a workspace? <span className="text-indigo-600">Sign in</span>
          </Link>
        </div>

        <div className="flex-1 flex flex-col justify-center py-10">
          <div className="w-full max-w-md mx-auto lg:mx-0">
            <span className="text-xs font-semibold tracking-[0.14em] uppercase text-indigo-600">
              Free pilot — first 10 screens, no card
            </span>
            <h1 className="mt-3 text-3xl md:text-[34px] font-semibold tracking-tight text-slate-900 leading-[1.1]">
              Start your free workspace.
            </h1>
            <p className="mt-2.5 text-[15px] text-slate-600 leading-relaxed">
              Set up VenueOS for your {v.heroWord} in under three minutes — then schedule
              every screen, and trigger an emergency alert across all of them in seconds.
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4">
              <Field label="What are you running?">
                <select
                  required
                  value={vertical}
                  onChange={(e) => setVertical(e.target.value as Vertical | '')}
                  className={`${INPUT_CLS} cursor-pointer`}
                >
                  <option value="" disabled>Choose your industry…</option>
                  {VERTICALS.map((vk) => (
                    <option key={vk} value={vk}>{SIGNUP_VERTICALS[vk].picker}</option>
                  ))}
                </select>
              </Field>

              <Field label={v.nameLabel}>
                <input
                  required
                  value={districtName}
                  onChange={(e) => handleDistrictChange(e.target.value)}
                  placeholder={v.namePlaceholder}
                  className={INPUT_CLS}
                />
              </Field>

              <Field label="Workspace URL" hint="Letters, numbers, and dashes only.">
                <div className="flex items-center bg-white border border-slate-300 rounded-lg overflow-hidden focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition">
                  <span className="pl-3.5 pr-2 py-2.5 text-sm text-slate-400 font-mono shrink-0 border-r border-slate-200">/</span>
                  <input
                    required
                    value={slug}
                    onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                    placeholder={v.slugPlaceholder}
                    className="flex-1 px-3 py-2.5 bg-transparent text-sm font-mono text-slate-900 placeholder:text-slate-400 outline-none"
                  />
                </div>
              </Field>

              {/* 2026-05-25 — identity row. Name fields side-by-side so
                  the form stays compact; phone gets its own row with
                  an explicit "optional" hint and 2FA copy so the
                  operator understands why we're asking. */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name">
                  <input
                    type="text"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Alex"
                    className={INPUT_CLS}
                  />
                </Field>
                <Field label="Last name">
                  <input
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Garcia"
                    className={INPUT_CLS}
                  />
                </Field>
              </div>

              <Field label="Admin email">
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder={v.emailPlaceholder}
                  className={INPUT_CLS}
                />
              </Field>

              <Field label="Phone (optional)">
                <input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (213) 555-1234"
                  className={INPUT_CLS}
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Used for two-factor recovery if you ever lose access to your
                  authenticator app. We&rsquo;ll never SMS you marketing.
                </p>
              </Field>

              <Field label="Address (optional)">
                <AddressAutocomplete
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
                  placeholder="Start typing — 1000 Vin Scully Ave…"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Start typing to pick from a list. We&rsquo;ll plot your locations on a fleet map.
                </p>
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8+ characters"
                  className={INPUT_CLS}
                />
              </Field>

              <Field label="Confirm password">
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Type it again"
                  className={INPUT_CLS}
                />
              </Field>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-700 font-medium">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating your workspace…</>
                  : <>Create workspace <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></>}
              </button>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                By creating a workspace you agree to our{' '}
                <Link href="/terms" className="text-indigo-600 hover:underline">terms</Link> and{' '}
                <Link href="/privacy" className="text-indigo-600 hover:underline">privacy policy</Link>
                {vertical === 'K12' && (
                  <>, including our{' '}
                    <Link href="/ferpa" className="text-indigo-600 hover:underline">FERPA</Link> /{' '}
                    <Link href="/coppa" className="text-indigo-600 hover:underline">COPPA</Link>{' '}
                    data commitments</>
                )}.
              </p>
            </form>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          <span>&copy; {new Date().getFullYear()} VenueOS</span>
          <Link href="/terms" className="hover:text-slate-600">Terms</Link>
          <Link href="/privacy" className="hover:text-slate-600">Privacy</Link>
          <Link href="/ferpa" className="hover:text-slate-600">FERPA</Link>
          <Link href="/coppa" className="hover:text-slate-600">COPPA</Link>
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
            Why teams choose VenueOS
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white leading-[1.15]">
            Every screen you run, in one place.
          </h2>
          <p className="mt-3 text-[15px] text-slate-400 leading-relaxed">
            One dashboard for signage, kiosks, scoreboards, and the life-safety alert
            that overrides them all.
          </p>
          <ul className="mt-9 space-y-5">
            {VALUE_PROPS.map((p) => (
              <li key={p.title} className="flex gap-3.5">
                <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                  <p.icon className="w-4 h-4 text-indigo-300" strokeWidth={2} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{p.title}</div>
                  <div className="mt-0.5 text-[13px] text-slate-400 leading-relaxed">{p.desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

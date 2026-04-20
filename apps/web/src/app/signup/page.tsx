"use client";

/**
 * Signup page — the first impression a school administrator has of
 * EduSignage. Previously a small dark form card on a slate gradient
 * that read as an indie side project ("kinda lame", per user).
 *
 * Rebuilt as a split-screen product story:
 *   • LEFT — the form itself + a hero headline, trust row, and
 *     value-prop bullets. Warm off-white surface so it feels like
 *     a classroom tool, not a devops dashboard. Sticks to the
 *     indigo → violet → fuchsia gradient the marketing landing
 *     page already uses so signup doesn't jarringly look like a
 *     different product.
 *   • RIGHT (lg+) — a stylized device preview showing the Rainbow
 *     welcome template in miniature, with 4 floating feature
 *     chips orbiting it. Shows the operator what they'll actually
 *     be building in their own district within 60 seconds of
 *     signup. Animated with the same aurora/float cadence as the
 *     gold-standard templates.
 *
 * Explicitly NOT themed per-tenant: this is the PRODUCT surface
 * (public, pre-auth) so brand colors stay locked to EduSignage's
 * identity. No --brand-primary reads here.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  AlertCircle,
  ShieldCheck,
  Zap,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  MonitorPlay,
  Calendar,
  Palette,
  Bell,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';

function slugify(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export default function SignupPage() {
  const [districtName, setDistrictName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useUIStore((s) => s.login);
  const router = useRouter();

  const handleDistrictChange = (v: string) => {
    setDistrictName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ districtName, slug, adminEmail, password }),
      });
      const data = await res.json();
      if (res.ok && data.access_token) {
        login(data.access_token, data.user);
        router.push(`/${data.user.tenantSlug || data.user.tenantId}/dashboard`);
      } else {
        setError(data.message || 'Signup failed. Please try again.');
      }
    } catch {
      setError(`Can't reach the server at ${API_URL}.`);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] relative overflow-hidden">
      <style>{CSS}</style>

      {/* ── Ambient background — three huge blurred orbs that lazily
          drift behind the whole page. Gives the off-white surface
          depth without the "dark-mode devops" vibe the previous
          screen had. Orbs pick up the marketing gradient (indigo
          → violet → fuchsia) so signup reads as the same product
          as the landing page. ── */}
      <div className="signup-orbs" aria-hidden>
        <div className="signup-orb signup-orb-1" />
        <div className="signup-orb signup-orb-2" />
        <div className="signup-orb signup-orb-3" />
      </div>

      {/* ── Top nav ── */}
      <header className="relative z-10 max-w-7xl mx-auto px-6 pt-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/25 group-hover:shadow-indigo-500/40 transition-shadow">
            <MonitorPlay className="w-5 h-5 text-white" />
          </div>
          <span className="font-[family-name:var(--font-fredoka)] text-xl font-semibold tracking-tight text-slate-900">
            EduSignage
          </span>
        </Link>
        <Link
          href="/login"
          className="text-sm font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 group"
        >
          Already have a workspace?
          <span className="text-indigo-600 group-hover:text-indigo-500">Sign in →</span>
        </Link>
      </header>

      {/* ── Main grid — split at lg; stacked on mobile ── */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12 lg:py-16 grid lg:grid-cols-[1fr_1fr] gap-12 lg:gap-16 items-start">

        {/* ── LEFT — hero + form ── */}
        <section className="space-y-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 shadow-sm text-xs font-medium text-slate-600 mb-5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Free for the first 10 screens — no credit card
            </div>
            <h1 className="font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 leading-[1.08]">
              Digital signage your{' '}
              <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
                whole district
              </span>{' '}
              can actually run.
            </h1>
            <p className="mt-5 text-base md:text-lg text-slate-600 leading-relaxed max-w-xl">
              Set up your workspace in under three minutes. Schedule content on every
              hallway, lobby, and classroom TV — and push a lockdown alert to every
              screen in seconds when it matters.
            </p>
          </div>

          {/* Trust row — three short props with icons. The emergency
              one is the headline because it's our single biggest
              differentiator vs. Yodeck / OptiSigns / Rise Vision. */}
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <TrustPill icon={Zap} iconClass="text-rose-500">
              Emergency alerts in <strong>&lt;2s</strong>
            </TrustPill>
            <TrustPill icon={ShieldCheck} iconClass="text-emerald-500">
              <strong>FERPA</strong> &amp; <strong>COPPA</strong> ready
            </TrustPill>
            <TrustPill icon={CheckCircle2} iconClass="text-indigo-500">
              Works on <strong>any</strong> TV or Android box
            </TrustPill>
          </div>

          {/* ── Form card — white, clean, the actual CTA ── */}
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_12px_40px_rgba(15,23,42,0.08)] p-6 md:p-8 space-y-4"
          >
            <div>
              <h2 className="font-[family-name:var(--font-fredoka)] text-xl font-semibold text-slate-900">
                Create your workspace
              </h2>
              <p className="text-sm text-slate-500 mt-1">Takes under three minutes. You&rsquo;ll be signed in when it&rsquo;s done.</p>
            </div>

            <FieldLabel label="District or school name">
              <input
                required
                value={districtName}
                onChange={(e) => handleDistrictChange(e.target.value)}
                placeholder="Springfield Unified School District"
                className="signup-input"
              />
            </FieldLabel>

            <FieldLabel
              label="Workspace URL"
              hint="Letters, numbers, and dashes only."
            >
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition">
                <span className="pl-4 pr-2 py-3 text-sm text-slate-400 font-mono shrink-0 border-r border-slate-200">edu/</span>
                <input
                  required
                  value={slug}
                  onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                  placeholder="springfield"
                  className="flex-1 px-3 py-3 bg-transparent text-sm font-mono text-slate-900 placeholder:text-slate-400 outline-none"
                />
              </div>
            </FieldLabel>

            <FieldLabel label="Admin email">
              <input
                type="email"
                required
                autoComplete="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="you@school.edu"
                className="signup-input"
              />
            </FieldLabel>

            <div className="grid md:grid-cols-2 gap-4">
              <FieldLabel label="Password">
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8+ characters"
                  className="signup-input"
                />
              </FieldLabel>
              <FieldLabel label="Confirm password">
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Type it again"
                  className="signup-input"
                />
              </FieldLabel>
            </div>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-xl">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-700 font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60 text-white font-semibold py-3.5 px-4 rounded-2xl shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-2"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating your workspace…</>
                : <>Create workspace <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></>
              }
            </button>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              By creating a workspace you agree to our{' '}
              <Link href="/terms" className="text-indigo-600 hover:underline">terms</Link>,{' '}
              <Link href="/privacy" className="text-indigo-600 hover:underline">privacy policy</Link>,{' '}
              and our <Link href="/ferpa" className="text-indigo-600 hover:underline">FERPA</Link> /{' '}
              <Link href="/coppa" className="text-indigo-600 hover:underline">COPPA</Link> data commitments.
            </p>
          </form>
        </section>

        {/* ── RIGHT — device preview + orbiting feature chips ── */}
        <aside className="hidden lg:flex relative min-h-[640px] items-center justify-center">
          <DevicePreview />
        </aside>
      </main>

      {/* Tiny footer — keeps pre-auth weight on the signup CTA. */}
      <footer className="relative z-10 max-w-7xl mx-auto px-6 pb-8 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div>&copy; {new Date().getFullYear()} EduSignage. Built for K-12.</div>
        <div className="flex items-center gap-4">
          <Link href="/terms" className="hover:text-slate-700">Terms</Link>
          <Link href="/privacy" className="hover:text-slate-700">Privacy</Link>
          <Link href="/ferpa" className="hover:text-slate-700">FERPA</Link>
          <Link href="/coppa" className="hover:text-slate-700">COPPA</Link>
        </div>
      </footer>
    </div>
  );
}

/* ─────────── Helpers ─────────── */

function FieldLabel({
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

function TrustPill({
  icon: Icon,
  iconClass,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200/80 shadow-sm">
      <div className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
        <Icon className={`w-4 h-4 ${iconClass}`} />
      </div>
      <span className="text-slate-700 leading-tight">{children}</span>
    </div>
  );
}

/**
 * DevicePreview — stylized 16:9 kiosk rendering a miniature
 * Rainbow-welcome scene, with four feature chips orbiting. No real
 * widget code; this is pure SVG/CSS "marketing glass" so the file
 * stays portable and the render is identical on every browser.
 */
function DevicePreview() {
  return (
    <div className="signup-device-wrap">
      {/* Device "frame" */}
      <div className="signup-device">
        <div className="signup-device-bezel">
          {/* Scene — a lightweight homage to the Animated Rainbow template */}
          <div className="signup-scene">
            <div className="signup-scene-bg" />
            <div className="signup-scene-rainbow" />
            <div className="signup-scene-sun" />
            <div className="signup-scene-header">
              <div className="signup-scene-logo">🍎</div>
              <div className="signup-scene-title">Welcome, Friends!</div>
            </div>
            <div className="signup-scene-grid">
              <div className="signup-scene-card signup-scene-weather">
                <div className="signup-scene-weather-sun" />
                <div className="signup-scene-weather-temp">72°</div>
              </div>
              <div className="signup-scene-card signup-scene-announce">
                <div className="signup-scene-announce-label">Big News</div>
                <div className="signup-scene-announce-msg">Book Fair Monday!</div>
              </div>
              <div className="signup-scene-card signup-scene-countdown">
                <div className="signup-scene-cd-num">3</div>
                <div className="signup-scene-cd-unit">days</div>
              </div>
            </div>
            <div className="signup-scene-ticker" />
          </div>
        </div>
        <div className="signup-device-stand" />
      </div>

      {/* Orbiting feature chips — four, two per side, float gently
          so the composition feels alive without the eye chasing one
          element more than another. */}
      <FeatureChip
        style={{ top: '6%', left: '-12%' }}
        icon={Bell}
        iconClass="bg-rose-100 text-rose-600"
        title="Emergency Alerts"
        sub="Lockdown, evacuate, weather — two taps"
        animDelay="0s"
      />
      <FeatureChip
        style={{ top: '24%', right: '-14%' }}
        icon={Calendar}
        iconClass="bg-indigo-100 text-indigo-600"
        title="Smart Scheduling"
        sub="Day, bell period, one-off events"
        animDelay="1.5s"
      />
      <FeatureChip
        style={{ bottom: '18%', left: '-10%' }}
        icon={Palette}
        iconClass="bg-violet-100 text-violet-600"
        title="17 K-12 Templates"
        sub="Menu boards, hallway, cafeteria…"
        animDelay="3s"
      />
      <FeatureChip
        style={{ bottom: '4%', right: '-12%' }}
        icon={ShieldCheck}
        iconClass="bg-emerald-100 text-emerald-600"
        title="FERPA-Ready"
        sub="Audit log, RBAC, signed events"
        animDelay="4.5s"
      />
    </div>
  );
}

function FeatureChip({
  icon: Icon,
  iconClass,
  title,
  sub,
  style,
  animDelay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  title: string;
  sub: string;
  style?: React.CSSProperties;
  animDelay: string;
}) {
  return (
    <div
      className="signup-chip"
      style={{ ...style, animationDelay: animDelay }}
    >
      <div className={`signup-chip-icon ${iconClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div className="signup-chip-title">{title}</div>
        <div className="signup-chip-sub">{sub}</div>
      </div>
    </div>
  );
}

const CSS = `
/* ─── Ambient background ─── */
.signup-orbs {
  position: absolute; inset: 0; pointer-events: none;
  overflow: hidden;
}
.signup-orb {
  position: absolute; border-radius: 50%;
  filter: blur(90px);
  opacity: 0.35;
  will-change: transform;
}
.signup-orb-1 {
  width: 620px; height: 620px;
  background: radial-gradient(circle, #818cf8, transparent 70%);
  top: -180px; left: -120px;
  animation: signup-drift-a 36s ease-in-out infinite alternate;
}
.signup-orb-2 {
  width: 520px; height: 520px;
  background: radial-gradient(circle, #c084fc, transparent 70%);
  top: 20%; right: -120px;
  animation: signup-drift-b 42s ease-in-out infinite alternate;
}
.signup-orb-3 {
  width: 540px; height: 540px;
  background: radial-gradient(circle, #f0abfc, transparent 70%);
  bottom: -140px; left: 40%;
  animation: signup-drift-c 48s ease-in-out infinite alternate;
}
@keyframes signup-drift-a { from { transform: translate(0,0); } to { transform: translate(60px, 40px); } }
@keyframes signup-drift-b { from { transform: translate(0,0); } to { transform: translate(-40px, 50px); } }
@keyframes signup-drift-c { from { transform: translate(0,0); } to { transform: translate(30px, -50px); } }

/* ─── Form inputs ─── */
.signup-input {
  width: 100%; padding: 12px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  font-size: 14px;
  color: #0f172a;
  outline: none;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.signup-input::placeholder { color: #94a3b8; }
.signup-input:focus {
  background: #ffffff;
  border-color: transparent;
  box-shadow: 0 0 0 2px #6366f1;
}

/* ─── Device preview ─── */
.signup-device-wrap {
  position: relative;
  width: 100%; max-width: 540px;
  aspect-ratio: 1 / 1;
  animation: signup-device-bob 6s ease-in-out infinite;
}
@keyframes signup-device-bob {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50%      { transform: translateY(-14px) rotate(1deg); }
}

.signup-device {
  position: absolute; inset: 8% 5% 8% 5%;
  display: flex; flex-direction: column; align-items: center;
}
.signup-device-bezel {
  width: 100%;
  aspect-ratio: 16 / 10;
  background: #0b1020;
  border-radius: 26px;
  padding: 14px;
  box-shadow:
    0 40px 80px rgba(15,23,42,0.25),
    0 0 0 1px rgba(255,255,255,0.08) inset,
    0 10px 40px rgba(99,102,241,0.25);
}
.signup-device-stand {
  width: 42%; height: 22px;
  background: linear-gradient(180deg, #1e293b, #0b1020);
  border-radius: 0 0 24px 24px / 0 0 30px 30px;
  margin-top: -2px;
  box-shadow: 0 6px 20px rgba(15,23,42,0.25);
}

/* ─── Mini Rainbow scene ─── */
.signup-scene {
  position: relative;
  width: 100%; height: 100%;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(180deg, #BFE8FF 0%, #FFE0EC 55%, #FFD8A8 100%);
}
.signup-scene-bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 50% 110%, #fef3c7 0%, transparent 50%);
}
.signup-scene-rainbow {
  position: absolute; left: -10%; right: -10%; top: 42%;
  height: 10px;
  background: repeating-linear-gradient(135deg,
    #ff5e7e 0 14px, #ffb950 14px 28px, #ffe66d 28px 42px,
    #6cd97e 42px 56px, #5cc5ff 56px 70px, #b48cff 70px 84px);
  transform: rotate(-3deg);
  box-shadow: 0 3px 10px rgba(0,0,0,.15);
}
.signup-scene-sun {
  position: absolute; top: 10%; right: 12%;
  width: 38px; height: 38px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 75%, #d97706);
  box-shadow: 0 0 20px rgba(251,191,36,0.6);
}
.signup-scene-header {
  position: absolute; top: 8%; left: 0; right: 0;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.signup-scene-logo {
  width: 28px; height: 28px; border-radius: 50%; background: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
  box-shadow: 0 2px 6px rgba(0,0,0,.15);
}
.signup-scene-title {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 14px;
  background: linear-gradient(90deg, #ec4899, #f59e0b, #10b981, #6366f1);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.signup-scene-grid {
  position: absolute; bottom: 15%; left: 8%; right: 8%;
  display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 6px;
}
.signup-scene-card {
  background: rgba(255,255,255,0.85);
  border-radius: 10px; padding: 6px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(0,0,0,.08);
  min-height: 60px;
}
.signup-scene-weather { background: linear-gradient(180deg, #fef3c7, #fde68a); }
.signup-scene-weather-sun {
  width: 20px; height: 20px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 70%, #d97706);
  box-shadow: 0 0 12px rgba(251,191,36,0.7);
  margin-bottom: 2px;
}
.signup-scene-weather-temp {
  font-family: 'Fredoka'; font-weight: 700; font-size: 14px; color: #92400e;
}
.signup-scene-announce-label {
  font-family: 'Fredoka'; font-size: 8px; letter-spacing: .15em;
  color: #b45309; text-transform: uppercase; margin-bottom: 2px;
}
.signup-scene-announce-msg {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 13px;
  color: #be185d; text-align: center; line-height: 1.1;
}
.signup-scene-countdown { background: linear-gradient(180deg, #ffe4e6, #fecdd3); }
.signup-scene-cd-num {
  font-family: 'Fredoka'; font-weight: 700; font-size: 24px; color: #7c2d12; line-height: 1;
}
.signup-scene-cd-unit {
  font-family: 'Caveat'; font-size: 10px; color: #7c2d12;
}
.signup-scene-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 12px;
  background: linear-gradient(90deg, #fcd34d, #fbbf24);
  border-top: 2px solid #ec4899;
}

/* ─── Feature chips orbiting the device ─── */
.signup-chip {
  position: absolute;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  box-shadow: 0 12px 32px rgba(15,23,42,0.1);
  min-width: 200px;
  backdrop-filter: blur(8px);
  animation: signup-chip-float 6s ease-in-out infinite;
  will-change: transform;
}
@keyframes signup-chip-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-8px); }
}
.signup-chip-icon {
  width: 32px; height: 32px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.signup-chip-title {
  font-weight: 600; font-size: 13px; color: #0f172a; line-height: 1.2;
}
.signup-chip-sub {
  font-size: 11px; color: #64748b; line-height: 1.3; margin-top: 1px;
}
`;

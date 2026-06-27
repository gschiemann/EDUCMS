"use client";

/**
 * Multi-location card for parent tenants — visible to top-level admins
 * (DISTRICT_ADMIN + SUPER_ADMIN). Lists all child tenants under the
 * current parent and lets the admin add a new one inline.
 *
 * Vertical-aware: terminology adapts to the tenant's industry so a
 * McDonald's franchisee sees "Add a location," a Planet Fitness owner
 * sees "Add a gym," and a school district admin sees "Add a school."
 * One UI, every industry. Pulled from Tenant.vertical (K12 default).
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import { Building2, Plus, MonitorPlay, Users, ExternalLink, AlertTriangle, Loader2, Home, Pencil, Check, X } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { getVerticalSample } from '@cms/api-types';

interface ChildTenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  _count: { screens: number; users: number };
}

interface ListResponse {
  districtId: string;
  children: ChildTenant[];
}

// Vertical-aware copy. Add new verticals here as the platform expands.
// 2026-05-03 — VenueOS launch set: K12 / GYM / RETAIL / CORPORATE / QSR /
// FASHION. Legacy names (RESTAURANT, HEALTHCARE, FITNESS, OTHER) kept
// for forward-compat with any tenants on those strings.
// 2026-05-26 — Audit gap: BAR / HOSPITALITY / SPORTS / WORSHIP were in
// packages/api-types/src/verticals.ts but missing here, so admins in
// those verticals saw the generic OTHER fallback ("location/group")
// instead of bar/venue/property/church. Added vertical-tuned copy that
// matches VERTICAL_LABELS + VERTICAL_GROUP_NOUN nouns from the
// canonical taxonomy.
type Vertical = 'K12' | 'GYM' | 'RETAIL' | 'CORPORATE' | 'QSR' | 'FASHION' | 'RESTAURANT' | 'HEALTHCARE' | 'FITNESS' | 'BAR' | 'HOSPITALITY' | 'SPORTS' | 'WORSHIP' | 'OTHER';
interface Copy {
  parentNoun: string;       // "district", "franchise", "group"
  childNoun: string;        // "school", "location", "gym"
  childNounPlural: string;
  cardHeading: string;      // "Schools in this district"
  addButton: string;        // "Add a school"
  exampleSlug: string;      // "lincoln-high"
  exampleName: string;      // "Lincoln High School"
  emptyState: string;
  inheritanceNote: string;
}
const COPY: Record<Vertical, Copy> = {
  K12: {
    parentNoun: 'district', childNoun: 'school', childNounPlural: 'schools',
    cardHeading: 'Schools in this district',
    addButton: 'School',
    exampleName: 'Lincoln High School', exampleSlug: 'lincoln-high',
    emptyState: 'No schools yet. Click + School to spin up your first one.',
    inheritanceNote: 'Each school gets its own screens, playlists, users, and emergency settings — but inherits your district branding.',
  },
  RESTAURANT: {
    parentNoun: 'franchise', childNoun: 'location', childNounPlural: 'locations',
    cardHeading: 'Locations in this group',
    addButton: 'Location',
    exampleName: 'Times Square Store', exampleSlug: 'times-square',
    emptyState: 'No locations yet. Click + Location to add your first store.',
    inheritanceNote: 'Each location gets its own menu boards, schedules, and staff — but inherits your franchise branding.',
  },
  RETAIL: {
    parentNoun: 'chain', childNoun: 'store', childNounPlural: 'stores',
    cardHeading: 'Stores in this chain',
    addButton: 'Store',
    exampleName: 'Mall of America Store', exampleSlug: 'mall-of-america',
    emptyState: 'No stores yet. Click + Store to onboard your first location.',
    inheritanceNote: 'Each store gets its own promo signage and inventory feeds — but inherits your chain branding.',
  },
  HEALTHCARE: {
    parentNoun: 'network', childNoun: 'clinic', childNounPlural: 'clinics',
    cardHeading: 'Clinics in this network',
    addButton: 'Clinic',
    exampleName: 'Downtown Clinic', exampleSlug: 'downtown',
    emptyState: 'No clinics yet. Click + Clinic to onboard your first practice.',
    inheritanceNote: 'Each clinic gets its own waiting-room boards and HIPAA-compliant alerts — but inherits your network branding.',
  },
  FITNESS: {
    parentNoun: 'group', childNoun: 'gym', childNounPlural: 'gyms',
    cardHeading: 'Gyms in this group',
    addButton: 'Gym',
    exampleName: 'Chicago Loop Gym', exampleSlug: 'chicago-loop',
    emptyState: 'No gyms yet. Click + Gym to onboard your first location.',
    inheritanceNote: 'Each gym gets its own class schedule boards and member-facing screens — but inherits your group branding.',
  },
  CORPORATE: {
    parentNoun: 'company', childNoun: 'office', childNounPlural: 'offices',
    cardHeading: 'Offices in this company',
    addButton: 'Office',
    exampleName: 'San Francisco Office', exampleSlug: 'san-francisco',
    emptyState: 'No offices yet. Click + Office to add your first location.',
    inheritanceNote: 'Each office gets its own lobby boards and event calendars — but inherits your company branding.',
  },
  // 2026-06-01 — UNIVERSAL copy (Greg): every account is a "Location" and the
  // top-level (parent) account is the "Primary", across every vertical.
  // copyFor() returns THIS for all verticals now; the per-vertical entries
  // below are retained for reference but no longer surfaced.
  OTHER: {
    parentNoun: 'primary account', childNoun: 'location', childNounPlural: 'locations',
    cardHeading: 'Locations',
    addButton: 'Location',
    exampleName: 'Downtown', exampleSlug: 'downtown',
    emptyState: 'No locations yet. Click + Location to add your first one.',
    inheritanceNote: 'Each location gets its own screens, playlists, users, and emergency settings — but inherits your primary account branding.',
  },
  // 2026-05-03 — VenueOS launch additions. GYM mirrors FITNESS, QSR
  // mirrors RESTAURANT semantically; FASHION is its own boutique-y
  // language. Kept as separate entries so each can drift independently
  // (e.g., a gym chain "region" sounds wrong; "group" reads better).
  GYM: {
    parentNoun: 'group', childNoun: 'gym', childNounPlural: 'gyms',
    cardHeading: 'Gyms in this group',
    addButton: 'Gym',
    exampleName: 'Chicago Loop Gym', exampleSlug: 'chicago-loop',
    emptyState: 'No gyms yet. Click + Gym to onboard your first location.',
    inheritanceNote: 'Each gym gets its own class schedule boards and member-facing screens — but inherits your group branding.',
  },
  QSR: {
    parentNoun: 'brand', childNoun: 'restaurant', childNounPlural: 'restaurants',
    cardHeading: 'Restaurants in this brand',
    addButton: 'Restaurant',
    exampleName: 'Times Square Store', exampleSlug: 'times-square',
    emptyState: 'No restaurants yet. Click + Restaurant to onboard your first location.',
    inheritanceNote: 'Each restaurant gets its own menu boards, schedules, and staff — but inherits your brand styling.',
  },
  FASHION: {
    parentNoun: 'brand', childNoun: 'boutique', childNounPlural: 'boutiques',
    cardHeading: 'Boutiques in this brand',
    addButton: 'Boutique',
    exampleName: 'SoHo Studio', exampleSlug: 'soho',
    emptyState: 'No boutiques yet. Click + Boutique to onboard your first location.',
    inheritanceNote: 'Each boutique gets its own lookbook signage and storefront screens — but inherits your brand styling.',
  },
  // 2026-05-26 — Audit fix: added BAR / HOSPITALITY / SPORTS / WORSHIP.
  // Nouns line up with packages/api-types/src/verticals.ts so the team
  // page, multi-location card, and "Add a [noun]" buttons all speak
  // the same vertical-tuned language. K12 still says "school"; a bar
  // chain now says "bar" instead of "location"; a hotel group says
  // "property" instead of "location"; a stadium operator says
  // "venue"; a worship admin says "church."
  BAR: {
    parentNoun: 'group', childNoun: 'bar', childNounPlural: 'bars',
    cardHeading: 'Bars in this group',
    addButton: 'Bar',
    exampleName: 'Downtown Taproom', exampleSlug: 'downtown',
    emptyState: 'No bars yet. Click + Bar to onboard your first location.',
    inheritanceNote: 'Each bar gets its own tap lists, drink specials, and game-day signage — but inherits your group branding.',
  },
  HOSPITALITY: {
    parentNoun: 'group', childNoun: 'property', childNounPlural: 'properties',
    cardHeading: 'Properties in this group',
    addButton: 'Property',
    exampleName: 'Downtown Marriott', exampleSlug: 'downtown',
    emptyState: 'No properties yet. Click + Property to onboard your first hotel.',
    inheritanceNote: 'Each property gets its own lobby boards, event calendars, and wayfinding — but inherits your group branding.',
  },
  SPORTS: {
    parentNoun: 'league', childNoun: 'venue', childNounPlural: 'venues',
    cardHeading: 'Venues in this league',
    addButton: 'Venue',
    exampleName: 'Memorial Stadium', exampleSlug: 'memorial-stadium',
    emptyState: 'No venues yet. Click + Venue to onboard your first stadium or arena.',
    inheritanceNote: 'Each venue gets its own scoreboards, ribbon boards, and game-day cues — but inherits your league branding.',
  },
  WORSHIP: {
    parentNoun: 'ministry', childNoun: 'church', childNounPlural: 'churches',
    cardHeading: 'Churches in this ministry',
    addButton: 'Church',
    exampleName: 'Main Campus', exampleSlug: 'main-campus',
    emptyState: 'No churches yet. Click + Church to onboard your first location.',
    inheritanceNote: 'Each church gets its own service times, sermon cards, and giving signage — but inherits your ministry branding.',
  },
};
// Universal across verticals (2026-06-01) — see COPY.OTHER. The vertical arg
// is ignored now that the account-hierarchy nouns are unified to
// Location (each account) + Primary (the top-level account).
function copyFor(_v?: string): Copy {
  return COPY.OTHER;
}

export function DistrictSchoolsCard() {
  const user = useAppStore((s) => s.user);
  // 2026-05-25 — parent tenant info for the "Default" row at top
  // of the list. Falls back to "Your organization" if the tenant
  // name isn't hydrated yet (rare; ui-store loads at boot).
  const uiUser = useUIStore((s) => s.user);
  const fallbackName = (uiUser as any)?.tenantName || 'Your organization';
  // Live tenant info (name + address) — re-fetched after inline edit
  // saves so the row shows the latest values without a page reload.
  const [tenantInfo, setTenantInfo] = useState<{ name: string; address: string | null } | null>(null);
  const parentTenantName = tenantInfo?.name || fallbackName;
  const parentTenantAddress = tenantInfo?.address || null;
  // Inline edit state for the Default row.
  const [editingParent, setEditingParent] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editAddressLat, setEditAddressLat] = useState<number | null>(null);
  const [editAddressLon, setEditAddressLon] = useState<number | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);
  const [vertical, setVertical] = useState<string>('K12');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [address, setAddress] = useState('');
  // 2026-05-25 — when the user picks an autocomplete suggestion we
  // capture lat/lng too (the Photon/Nominatim response includes
  // them). Saved alongside `address` so the fleet map can plot
  // immediately without Sprint 8's geocoding pass.
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLon, setAddressLon] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2026-05-11 — clicking a child school used to be a bare <Link> which
  // navigated WITHOUT re-issuing the JWT. The new dashboard URL would
  // load but /branding/me still answered as the parent district, so the
  // child's page rendered with the district's logo/colors. Now we route
  // through the same useTenantSwitch hook the top-right toolbar uses —
  // POST /tenants/switch → new JWT → store update → cache wipe → nav.
  // The branding repaint then happens automatically because
  // BrandStyleInjector watches [tenantId, activeTenant, user].
  const { switchToTenant, switchingId, error: switchError } = useTenantSwitch();

  const role = user?.role || '';
  const visible = role === 'DISTRICT_ADMIN' || role === 'SUPER_ADMIN';
  // 2026-06-27 — account-hierarchy NOUNS stay unified ("Location" /
  // "Primary", per Greg 2026-06-01), but the add-location form's EXAMPLE
  // name/slug placeholder is now on-vertical (canonical VERTICAL_SAMPLE in
  // @cms/api-types) so a fresh QSR / clinic / worship admin sees an
  // industry-appropriate hint instead of the generic "Downtown". Fixes the
  // per-vertical beta finding without reverting the noun unification.
  const sample = getVerticalSample(vertical);
  const c = { ...copyFor(vertical), exampleName: sample.exampleName, exampleSlug: sample.exampleSlug };

  useEffect(() => {
    if (!visible) { setLoading(false); return; }
    load();
    // Best-effort fetch of the parent tenant's vertical so the copy
    // adapts. Falls back to K12 if the call fails or returns nothing.
    apiFetch<{ vertical?: string }>('/tenants').then((t) => {
      if (t?.vertical) setVertical(t.vertical);
    }).catch(() => { /* keep K12 default */ });
  }, [visible]);

  const load = async () => {
    setLoading(true);
    try {
      const [res, me] = await Promise.all([
        apiFetch<ListResponse>('/tenants/children'),
        // 2026-05-25 — also fetch the current tenant so the Default
        // row reads the live name + address (not the stale value
        // from the JWT payload's tenantName).
        apiFetch<{ name: string; address: string | null }>('/tenants').catch(() => null),
      ]);
      setData(res);
      if (me) setTenantInfo({ name: me.name, address: me.address ?? null });
    } catch (e: any) {
      setError(e?.message || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  /** Open the Default-row inline editor with the current values prefilled. */
  const openEditParent = () => {
    setEditingParent(true);
    setEditError(null);
    setEditName(parentTenantName || '');
    setEditAddress(parentTenantAddress || '');
    setEditAddressLat(null);
    setEditAddressLon(null);
  };
  const cancelEditParent = () => {
    setEditingParent(false);
    setEditError(null);
  };
  /** PATCH /tenants/me with the edited name + address. */
  const saveEditParent = async () => {
    setEditError(null);
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Name is required.');
      return;
    }
    setEditSaving(true);
    try {
      await apiFetch('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmedName,
          // Empty string explicitly clears; non-empty overwrites.
          address: editAddress.trim(),
          // Only send coords if the user just picked an autocomplete
          // suggestion in this edit session. If they typed freeform
          // OR edited after picking, we leave lat/lng to the
          // server-side null-out path in PATCH /tenants/me (which
          // auto-invalidates cached coords on address change).
          latitude: editAddressLat ?? undefined,
          longitude: editAddressLon ?? undefined,
        }),
      });
      setEditingParent(false);
      await load();
    } catch (e: any) {
      setEditError(e?.message || 'Could not save changes.');
    } finally {
      setEditSaving(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError(`${c.childNoun.charAt(0).toUpperCase() + c.childNoun.slice(1)} name is required.`); return; }
    setSubmitting(true);
    try {
      await apiFetch('/tenants/children', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          // Slug auto-derived from name silently — see 2026-05-25
          // form-redesign comment in the JSX.
          slug: slug.trim() || undefined,
          address: address.trim() || undefined,
          // lat/lng from the autocomplete pick. Stored only when
          // the user PICKED a suggestion (vs typed freeform), so
          // a typo-d address doesn't carry stale coords.
          latitude: addressLat ?? undefined,
          longitude: addressLon ?? undefined,
        }),
      });
      setName(''); setSlug(''); setAddress('');
      setAddressLat(null); setAddressLon(null);
      setAdding(false);
      await load();
    } catch (e: any) {
      setError(e?.message || `Could not create ${c.childNoun}.`);
    } finally {
      setSubmitting(false);
    }
  };

  // Was a plain object declared in function body — re-created every render,
  // so `lastAutoSlug.current` was always '' after the first character and
  // the slug froze at one letter. useRef persists across renders.
  const lastAutoSlug = useRef('');
  const onNameChange = (v: string) => {
    setName(v);
    const auto = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    if (!slug || slug === lastAutoSlug.current) {
      setSlug(auto);
      lastAutoSlug.current = auto;
    }
  };

  if (!visible) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-indigo-500" /> {c.cardHeading}
          {data?.children?.length ? (
            <span className="ml-1 text-xs font-normal text-slate-400">({data.children.length})</span>
          ) : null}
        </h2>
        {!adding && (
          // 2026-05-25 — match the size of the Configure pills used on
          // every other settings row (Emergency, AI, Branding, Billing):
          // px-4 py-2 rounded-lg font-bold. Keeps the visual rhythm of
          // the settings page uniform.
          <button
            type="button"
            onClick={() => { setAdding(true); setError(null); }}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> {c.addButton}
          </button>
        )}
      </div>

      <div className="p-6 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading {c.childNounPlural}…
          </div>
        ) : (
          <>
            {adding && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                {/* 2026-05-25 — operator: "why even show URL Slug
                    and that name is not user friendly...we dont
                    need to show the /name at all, it just happens?"
                    Slug is now auto-derived from name SILENTLY at
                    submit time; no form field for it.
                    Plus: "maybe we should be asking for address
                    info right? dont make it required but this could
                    auto build out our map." Address added as an
                    optional second field; future Sprint 8 work
                    geocodes it for the fleet map view. */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    {c.childNoun.charAt(0).toUpperCase() + c.childNoun.slice(1)} name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder={c.exampleName}
                    className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Address <span className="text-slate-400 normal-case font-normal">(optional)</span>
                  </label>
                  <AddressAutocomplete
                    value={address}
                    onChange={(v) => {
                      setAddress(v);
                      // If they edit after a pick, the coords no
                      // longer match the typed text — clear them
                      // so we don't save mismatched values.
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
                    Start typing to pick from a list. We&rsquo;ll plot it on the fleet map. You can edit it later.
                  </p>
                </div>
                {error && (
                  <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 px-3 py-2 rounded border border-rose-200">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => { setAdding(false); setName(''); setSlug(''); setAddress(''); setError(null); }}
                    disabled={submitting}
                    className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting || !name.trim()}
                    className="px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-1.5"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {submitting ? 'Creating…' : `Create ${c.childNoun}`}
                  </button>
                </div>
              </div>
            )}

            {!loading && error && !adding && (
              <div className="text-sm text-rose-600">{error}</div>
            )}

            {/* 2026-05-25 — operator: "this area should show the
                initial location as the default location not as not
                set up." Parent tenant is ALWAYS the first row now
                (marked "Default" with a home icon). The "no
                locations yet" empty state went away — there's
                always at least one location (the parent itself),
                so the empty state was never accurate. inheritanceNote
                still renders as a one-line footer under the list. */}
            <div className="space-y-2">
              {switchError && (
                <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 px-3 py-2 rounded border border-rose-200">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{switchError}</span>
                </div>
              )}
              {/* Parent / default row. 2026-05-25 — operator:
                  "no need for the /dodgers here, just dump that text,
                  and where do i edit my existing location to add the
                  address? i would think right here we have a little
                  edit icon on the location where i can update whatever
                  i need to." Slug row removed; pencil button opens an
                  inline editor for name + address. PATCH /tenants/me. */}
              {editingParent ? (
                <div className="w-full rounded-lg border border-indigo-300 bg-indigo-50/40 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Edit location</span>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Address <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <AddressAutocomplete
                      value={editAddress}
                      onChange={(v) => {
                        setEditAddress(v);
                        // Drop the cached pick if the user edits
                        // after picking — coords no longer match.
                        if (editAddressLat !== null || editAddressLon !== null) {
                          setEditAddressLat(null);
                          setEditAddressLon(null);
                        }
                      }}
                      onPick={(p) => {
                        setEditAddress(p.displayName);
                        setEditAddressLat(p.latitude);
                        setEditAddressLon(p.longitude);
                      }}
                      placeholder="Start typing — 1000 Vin Scully Ave…"
                    />
                  </div>
                  {editError && (
                    <div className="flex items-start gap-2 text-[11px] text-rose-700 bg-rose-50 px-2 py-1.5 rounded border border-rose-200">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>{editError}</span>
                    </div>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={cancelEditParent}
                      disabled={editSaving}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold text-slate-600 hover:text-slate-900"
                    >
                      <X className="w-3 h-3" /> Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveEditParent}
                      disabled={editSaving || !editName.trim()}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold"
                    >
                      {editSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      {editSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-indigo-200 bg-indigo-50/40 text-left">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Home className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-800 truncate flex items-center gap-2">
                        {parentTenantName}
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-600 text-white">
                          Default
                        </span>
                      </div>
                      {parentTenantAddress && (
                        <div className="text-xs text-slate-500 truncate">{parentTenantAddress}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500">You&rsquo;re here</span>
                    <button
                      type="button"
                      onClick={openEditParent}
                      className="p-1.5 rounded-md text-slate-500 hover:text-indigo-700 hover:bg-indigo-100/60 transition-colors"
                      title="Edit name + address"
                      aria-label="Edit name + address"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
              {data?.children?.map((row) => {
                const isSwitching = switchingId === row.id;
                return (
                  <button
                    type="button"
                    key={row.id}
                    onClick={() => switchToTenant({ id: row.id, slug: row.slug })}
                    disabled={!!switchingId}
                    className="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors group disabled:opacity-60 disabled:cursor-wait text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800 group-hover:text-indigo-700 truncate">
                        {row.name}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">/{row.slug}</div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <MonitorPlay className="w-3.5 h-3.5" /> {row._count.screens}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" /> {row._count.users}
                      </span>
                      {isSwitching ? (
                        <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                      ) : (
                        <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                      )}
                    </div>
                  </button>
                );
              })}
              <p className="text-xs text-slate-400 pt-1">{c.inheritanceNote}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

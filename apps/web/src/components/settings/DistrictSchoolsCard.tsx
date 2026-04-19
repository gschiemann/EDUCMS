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
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { Building2, Plus, MonitorPlay, Users, ExternalLink, AlertTriangle, Loader2 } from 'lucide-react';

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
type Vertical = 'K12' | 'RESTAURANT' | 'RETAIL' | 'HEALTHCARE' | 'FITNESS' | 'CORPORATE' | 'OTHER';
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
    addButton: 'Add a school',
    exampleName: 'Lincoln High School', exampleSlug: 'lincoln-high',
    emptyState: 'No schools yet. Click Add a school to spin up your first one.',
    inheritanceNote: 'Each school gets its own screens, playlists, users, and emergency settings — but inherits your district branding.',
  },
  RESTAURANT: {
    parentNoun: 'franchise', childNoun: 'location', childNounPlural: 'locations',
    cardHeading: 'Locations in this group',
    addButton: 'Add a location',
    exampleName: 'Times Square Store', exampleSlug: 'times-square',
    emptyState: 'No locations yet. Click Add a location to add your first store.',
    inheritanceNote: 'Each location gets its own menu boards, schedules, and staff — but inherits your franchise branding.',
  },
  RETAIL: {
    parentNoun: 'chain', childNoun: 'store', childNounPlural: 'stores',
    cardHeading: 'Stores in this chain',
    addButton: 'Add a store',
    exampleName: 'Mall of America Store', exampleSlug: 'mall-of-america',
    emptyState: 'No stores yet. Click Add a store to onboard your first location.',
    inheritanceNote: 'Each store gets its own promo signage and inventory feeds — but inherits your chain branding.',
  },
  HEALTHCARE: {
    parentNoun: 'network', childNoun: 'clinic', childNounPlural: 'clinics',
    cardHeading: 'Clinics in this network',
    addButton: 'Add a clinic',
    exampleName: 'Downtown Clinic', exampleSlug: 'downtown',
    emptyState: 'No clinics yet. Click Add a clinic to onboard your first practice.',
    inheritanceNote: 'Each clinic gets its own waiting-room boards and HIPAA-compliant alerts — but inherits your network branding.',
  },
  FITNESS: {
    parentNoun: 'group', childNoun: 'gym', childNounPlural: 'gyms',
    cardHeading: 'Gyms in this group',
    addButton: 'Add a gym',
    exampleName: 'Chicago Loop Gym', exampleSlug: 'chicago-loop',
    emptyState: 'No gyms yet. Click Add a gym to onboard your first location.',
    inheritanceNote: 'Each gym gets its own class schedule boards and member-facing screens — but inherits your group branding.',
  },
  CORPORATE: {
    parentNoun: 'company', childNoun: 'office', childNounPlural: 'offices',
    cardHeading: 'Offices in this company',
    addButton: 'Add an office',
    exampleName: 'San Francisco Office', exampleSlug: 'san-francisco',
    emptyState: 'No offices yet. Click Add an office to add your first location.',
    inheritanceNote: 'Each office gets its own lobby boards and event calendars — but inherits your company branding.',
  },
  OTHER: {
    parentNoun: 'group', childNoun: 'location', childNounPlural: 'locations',
    cardHeading: 'Locations in this group',
    addButton: 'Add a location',
    exampleName: 'New Location', exampleSlug: 'new-location',
    emptyState: 'No locations yet. Click Add a location to get started.',
    inheritanceNote: 'Each location gets its own screens, playlists, and users — but inherits your group branding.',
  },
};
function copyFor(v?: string): Copy {
  const key = ((v || 'K12').toUpperCase()) as Vertical;
  return COPY[key] || COPY.OTHER;
}

export function DistrictSchoolsCard() {
  const user = useAppStore((s) => s.user);
  const [data, setData] = useState<ListResponse | null>(null);
  const [vertical, setVertical] = useState<string>('K12');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = user?.role || '';
  const visible = role === 'DISTRICT_ADMIN' || role === 'SUPER_ADMIN';
  const c = copyFor(vertical);

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
      const res = await apiFetch<ListResponse>('/tenants/children');
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError(`${c.childNoun.charAt(0).toUpperCase() + c.childNoun.slice(1)} name is required.`); return; }
    setSubmitting(true);
    try {
      await apiFetch('/tenants/children', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() || undefined }),
      });
      setName(''); setSlug(''); setAdding(false);
      await load();
    } catch (e: any) {
      setError(e?.message || `Could not create ${c.childNoun}.`);
    } finally {
      setSubmitting(false);
    }
  };

  const onNameChange = (v: string) => {
    setName(v);
    const auto = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    if (!slug || slug === lastAutoSlug.current) {
      setSlug(auto);
      lastAutoSlug.current = auto;
    }
  };
  const lastAutoSlug = { current: '' } as { current: string };

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
          <button
            type="button"
            onClick={() => { setAdding(true); setError(null); }}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      URL slug
                    </label>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
                      placeholder={c.exampleSlug}
                      className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  This becomes the URL: <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">/{slug || c.exampleSlug}/dashboard</code>. Pick something short.
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
                    onClick={() => { setAdding(false); setName(''); setSlug(''); setError(null); }}
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

            {data?.children?.length ? (
              <div className="space-y-2">
                {data.children.map((row) => (
                  <Link
                    key={row.id}
                    href={`/${row.slug}/dashboard`}
                    className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors group"
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
                      <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              !adding && (
                <div className="text-sm text-slate-500 bg-slate-50 px-4 py-6 rounded-lg text-center border border-dashed border-slate-200">
                  {c.emptyState}
                  <div className="text-xs text-slate-400 mt-1">{c.inheritanceNote}</div>
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * DistrictSchoolsCard — visible to DISTRICT_ADMIN + SUPER_ADMIN.
 *
 * Lists all child schools under the current district and lets the
 * admin add a new school inline. Each row links to that school's
 * dashboard via the existing tenant-switcher route. Screen counts
 * come from the GET /api/v1/tenants/children endpoint.
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

export function DistrictSchoolsCard() {
  const user = useAppStore((s) => s.user);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show for district-level roles
  const role = user?.role || '';
  const visible = role === 'DISTRICT_ADMIN' || role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!visible) { setLoading(false); return; }
    load();
  }, [visible]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ListResponse>('/tenants/children');
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load schools.');
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError('School name is required.'); return; }
    setSubmitting(true);
    try {
      await apiFetch('/tenants/children', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() || undefined }),
      });
      setName(''); setSlug(''); setAdding(false);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not create school.');
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-suggest slug from name
  const onNameChange = (v: string) => {
    setName(v);
    const auto = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    if (!slug || slug === lastAutoSlug.current) {
      setSlug(auto);
      lastAutoSlug.current = auto;
    }
  };
  // Track which slug was auto-generated so manual edits stick
  const lastAutoSlug = { current: '' } as { current: string };

  if (!visible) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-indigo-500" /> Schools in this district
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
            <Plus className="h-3.5 w-3.5" /> Add a school
          </button>
        )}
      </div>

      <div className="p-6 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading schools…
          </div>
        ) : (
          <>
            {/* Add-school inline form */}
            {adding && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      School name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => onNameChange(e.target.value)}
                      placeholder="Lincoln High School"
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
                      placeholder="lincoln-high"
                      className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  This becomes the URL: <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">/{slug || 'your-slug'}/dashboard</code>. Pick something short and easy to remember.
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
                    {submitting ? 'Creating…' : 'Create school'}
                  </button>
                </div>
              </div>
            )}

            {!loading && error && !adding && (
              <div className="text-sm text-rose-600">{error}</div>
            )}

            {/* Children list */}
            {data?.children?.length ? (
              <div className="space-y-2">
                {data.children.map((c) => (
                  <Link
                    key={c.id}
                    href={`/${c.slug}/dashboard`}
                    className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800 group-hover:text-indigo-700 truncate">
                        {c.name}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">/{c.slug}</div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <MonitorPlay className="w-3.5 h-3.5" /> {c._count.screens}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" /> {c._count.users}
                      </span>
                      <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              !adding && (
                <div className="text-sm text-slate-500 bg-slate-50 px-4 py-6 rounded-lg text-center border border-dashed border-slate-200">
                  No schools yet. Click <strong>Add a school</strong> to spin up your first one.
                  <div className="text-xs text-slate-400 mt-1">Each school gets its own screens, playlists, users, and emergency settings — but inherits your district branding.</div>
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

'use client';

/**
 * VenueOS Sports — Sprint 13 Phase 2. Sponsor management + proof of play.
 *
 * Sponsorship is the buying trigger for school athletics — a venue
 * that sells local ads on its scoreboard pays for the whole system.
 * This page is where an admin manages those advertisers and sees the
 * proof-of-play numbers that justify the ad sale.
 */

import { useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Pencil, Trash2, X, BadgeDollarSign, Upload, Loader2, ImageIcon,
} from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { appConfirm } from '@/components/ui/app-dialog';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import {
  useSponsors,
  useSponsorReport,
  useCreateSponsor,
  useUpdateSponsor,
  useDeleteSponsor,
} from '@/hooks/use-api';

const SPONSOR_COLORS = ['#0f172a', '#4f46e5', '#dc2626', '#0891b2', '#16a34a', '#d97706', '#7c3aed', '#db2777'];

interface Sponsor {
  id: string;
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  color: string | null;
  tier: string | null;
  weight: number;
  active: boolean;
}
interface ReportRow {
  id: string;
  estimatedSpots: number;
  estimatedExposureSeconds: number;
}

function fmtDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export default function SponsorsPage() {
  return (
    <RoleGate
      // 2026-06-09 — sports locked to admin + Editor (operator). No viewer.
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR']}
      fallback={
        <div className="text-center py-24 text-sm text-slate-500">
          You don&rsquo;t have permission to view sponsors.
        </div>
      }
    >
      <SponsorManager />
    </RoleGate>
  );
}

function SponsorManager() {
  const params = useParams();
  const router = useRouter();
  const schoolId = String(params?.schoolId || '');
  const { data: sponsors, isLoading } = useSponsors();
  const { data: report } = useSponsorReport();
  const deleteSponsor = useDeleteSponsor();

  const [editing, setEditing] = useState<Sponsor | null>(null);
  const [creating, setCreating] = useState(false);

  const list: Sponsor[] = Array.isArray(sponsors) ? sponsors : [];
  const reportRows: ReportRow[] = report?.sponsors && Array.isArray(report.sponsors) ? report.sponsors : [];
  const rowFor = (id: string) => reportRows.find((r) => r.id === id);

  const handleDelete = async (s: Sponsor) => {
    const ok = await appConfirm({
      title: 'Remove sponsor?',
      message: `"${s.name}" will be removed from the scoreboard rotation.`,
      tone: 'danger',
      confirmLabel: 'Remove',
    });
    if (ok) deleteSponsor.mutate(s.id);
  };

  return (
    <div className="max-w-5xl mx-auto px-1 py-2">
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push(`/${schoolId}/sports`)}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Game Day
        </button>
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
          <Button onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add sponsor
          </Button>
        </RoleGate>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="h-11 w-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
          <BadgeDollarSign className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Sponsors</h1>
          <p className="text-sm text-slate-500">
            Advertisers that rotate through the scoreboard banner — and the proof-of-play that sells the next deal.
          </p>
        </div>
      </div>

      {/* proof-of-play summary */}
      {report && (
        <div className="rounded-2xl bg-slate-900 text-white p-5 mb-5 flex flex-wrap items-center gap-x-8 gap-y-2">
          <Stat label="Games run" value={String(report.totalGames ?? 0)} />
          <Stat label="Live game time" value={fmtDuration(report.totalLiveSeconds ?? 0)} />
          <Stat label="Active sponsors" value={String(list.filter((s) => s.active).length)} />
          <p className="text-xs text-slate-400 ml-auto max-w-xs">
            Spots are estimated from real live game time at an {report.spotSeconds ?? 8}s banner rotation.
          </p>
        </div>
      )}

      {/* sponsor list */}
      {isLoading ? (
        <div className="text-center py-24 text-sm text-slate-400">Loading sponsors…</div>
      ) : list.length === 0 ? (
        <div className="text-center py-24 rounded-2xl border-2 border-dashed border-slate-200">
          <BadgeDollarSign className="h-10 w-10 mx-auto text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">No sponsors yet</p>
          <p className="text-sm text-slate-400">Add your first advertiser to start the scoreboard rotation.</p>
          <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
            <Button onClick={() => setCreating(true)} className="mt-4 gap-1.5">
              <Plus className="h-4 w-4" />
              Add sponsor
            </Button>
          </RoleGate>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {list.map((s) => {
            const row = rowFor(s.id);
            const color = s.color || '#0f172a';
            return (
              <div
                key={s.id}
                className="rounded-2xl bg-white ring-1 ring-slate-200 p-5"
                style={{ borderLeft: `6px solid ${color}` }}
              >
                <div className="flex items-start gap-3">
                  {s.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.logoUrl}
                      alt=""
                      className="h-12 w-12 rounded-lg object-contain bg-slate-50 ring-1 ring-slate-200"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-black text-lg"
                      style={{ backgroundColor: color }}
                    >
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-900 truncate">{s.name}</span>
                      {!s.active && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          PAUSED
                        </span>
                      )}
                    </div>
                    {s.tagline && <p className="text-sm text-slate-500 truncate">{s.tagline}</p>}
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      {s.tier && (
                        <span
                          className="font-bold px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: color }}
                        >
                          {s.tier}
                        </span>
                      )}
                      <span>weight {s.weight}</span>
                    </div>
                  </div>
                </div>

                {/* proof of play for this sponsor */}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-50 p-2.5 text-center">
                    <div className="text-lg font-black text-slate-900 tabular-nums">
                      {row ? row.estimatedSpots.toLocaleString() : '—'}
                    </div>
                    <div className="text-[11px] text-slate-400">est. spots</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 text-center">
                    <div className="text-lg font-black text-slate-900 tabular-nums">
                      {row ? fmtDuration(row.estimatedExposureSeconds) : '—'}
                    </div>
                    <div className="text-[11px] text-slate-400">est. exposure</div>
                  </div>
                </div>

                <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => setEditing(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleDelete(s)}
                      aria-label={`Remove ${s.name}`}
                    >
                      <Trash2 className="h-4 w-4 text-slate-400" />
                    </Button>
                  </div>
                </RoleGate>
              </div>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <SponsorModal sponsor={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

/** Upload one image file (a sponsor logo) and return its hosted URL.
 *  Reuses the hardened /assets/upload chain. */
async function uploadLogo(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const token = useUIStore.getState().token;
  const res = await fetch(`${API_URL}/assets/upload`, {
    method: 'POST',
    body: fd,
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Logo upload failed (${res.status}) ${t}`.trim());
  }
  const data = await res.json().catch(() => ({}) as any);
  const url = data.fileUrl || data.url || data?.asset?.fileUrl || '';
  if (!url) throw new Error('Upload succeeded but no URL came back.');
  return url;
}

function SponsorModal({ sponsor, onClose }: { sponsor: Sponsor | null; onClose: () => void }) {
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  const createSponsor = useCreateSponsor();
  const updateSponsor = useUpdateSponsor();
  const isEdit = !!sponsor;

  const [name, setName] = useState(sponsor?.name || '');
  const [tagline, setTagline] = useState(sponsor?.tagline || '');
  const [logoUrl, setLogoUrl] = useState(sponsor?.logoUrl || '');
  const [logoBusy, setLogoBusy] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [tier, setTier] = useState(sponsor?.tier || '');
  const [color, setColor] = useState(sponsor?.color || SPONSOR_COLORS[0]);
  const [weight, setWeight] = useState(sponsor?.weight || 1);
  const [active, setActive] = useState(sponsor?.active ?? true);
  const [err, setErr] = useState('');

  const pending = createSponsor.isPending || updateSponsor.isPending;

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    setErr('');
    try {
      setLogoUrl(await uploadLogo(file));
    } catch (e) {
      setErr((e as Error).message || 'Logo upload failed.');
    } finally {
      setLogoBusy(false);
      if (logoFileRef.current) logoFileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (!name.trim()) {
      setErr('Sponsor name is required.');
      return;
    }
    const data = {
      name: name.trim(),
      tagline: tagline.trim() || null,
      logoUrl: logoUrl.trim() || null,
      tier: tier.trim() || null,
      color,
      weight,
      active,
    };
    try {
      if (isEdit && sponsor) {
        await updateSponsor.mutateAsync({ id: sponsor.id, data });
      } else {
        await createSponsor.mutateAsync(data);
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Could not save the sponsor.');
    }
  };

  return (
    // Backdrop — mouse-only convenience; the aria-label="Close" button
    // below is the keyboard/AT-accessible dismissal path. a11y wave
    // (2026-08-24).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">{isEdit ? 'Edit sponsor' : 'Add sponsor'}</h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Field label="Sponsor name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Joe's Pizza" maxLength={120} />
        </Field>
        <Field label="Tagline (optional)">
          <Input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Best slice in town"
            maxLength={160}
          />
        </Field>
        <Field label="Logo">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="h-12 w-12 rounded-md object-contain bg-slate-100 ring-1 ring-slate-200 shrink-0"
              />
            ) : (
              <div className="h-12 w-12 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                <ImageIcon className="h-4 w-4 text-slate-300" />
              </div>
            )}
            <input
              ref={logoFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickLogo(e.target.files?.[0])}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={logoBusy}
              onClick={() => logoFileRef.current?.click()}
            >
              {logoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {logoUrl ? 'Replace logo' : 'Upload logo'}
            </Button>
            {logoUrl && (
              <button
                type="button"
                onClick={() => setLogoUrl('')}
                className="text-xs text-slate-400 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>
          <Input
            className="mt-2"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="…or paste a logo URL"
            maxLength={2048}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Tier (optional)">
            <Input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="Gold" maxLength={40} />
          </Field>
          <Field label="Rotation weight">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={10}
                value={weight}
                onChange={(e) => setWeight(parseInt(e.target.value, 10))}
                className="flex-1 accent-emerald-600"
              />
              <span className="w-6 text-center text-sm font-bold text-slate-700">{weight}</span>
            </div>
          </Field>
        </div>

        <Field label="Brand color">
          <div className="flex flex-wrap gap-1.5">
            {SPONSOR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full transition-transform ${
                  color === c ? 'ring-2 ring-offset-2 ring-slate-900 scale-110' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>

        <button
          type="button"
          onClick={() => setActive((a) => !a)}
          className="mt-2 flex items-center gap-2 text-sm font-medium text-slate-700"
        >
          <span
            className={`h-5 w-9 rounded-full transition-colors relative ${
              active ? 'bg-emerald-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                active ? 'left-[1.125rem]' : 'left-0.5'
              }`}
            />
          </span>
          {active ? 'Active — in rotation' : 'Paused — not shown'}
        </button>

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add sponsor'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

'use client';

/**
 * VenueOS Sports — ribbon sponsor manager.
 *
 * Sponsors scroll across the LED ribbon board (and the scoreboard's
 * banner slot) alongside the live score and player cards. This panel
 * is the operator's "upload a brand, it scrolls" surface — the thing
 * that turns the ribbon into sellable ad inventory.
 *
 * Sponsors are tenant-wide: add a brand once and it rotates on every
 * game's ribbon (same model as the cue deck). `weight` controls how
 * often a sponsor comes around per loop. Logo upload reuses the
 * hardened /assets/upload chain.
 */

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  ImageIcon,
  Megaphone,
  BarChart3,
  ChevronDown,
  Download,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useSponsors,
  useCreateSponsor,
  useUpdateSponsor,
  useDeleteSponsor,
  useSponsorReport,
  useSponsorGameReport,
} from '@/hooks/use-api';
import { AssetPicker } from '@/components/assets/AssetPicker';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { FREQ_TIERS, FREQ_TIER_WEIGHT, weightToTier } from './sponsor-frequency';

interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  tier?: string | null;
  weight: number;
  active: boolean;
}

/** Common sponsor-tier labels — offered as datalist hints, freeform. */
const TIER_SUGGESTIONS = ['Title', 'Presenting', 'Gold', 'Silver', 'Bronze', 'Community'];

export function SponsorPanel() {
  const { data, isLoading } = useSponsors();
  const create = useCreateSponsor();
  const update = useUpdateSponsor();
  const remove = useDeleteSponsor();
  const [editing, setEditing] = useState<Sponsor | 'new' | null>(null);

  const sponsors: Sponsor[] = Array.isArray(data) ? data : [];
  const activeCount = sponsors.filter((s) => s.active).length;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs text-slate-400">
          Sponsors scroll across the LED ribbon alongside the score and player cards.
          Add a brand once — its logo rotates on every game&rsquo;s ribbon. Put the ribbon
          on a screen with <span className="font-semibold text-slate-500">Put it on your
          screens</span> above.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 shrink-0"
          onClick={() => setEditing('new')}
        >
          <Plus className="h-3.5 w-3.5" /> Add sponsor
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400 py-3">Loading sponsors…</p>
      ) : sponsors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
          <Megaphone className="h-6 w-6 text-slate-300 mx-auto mb-1.5" />
          <p className="text-sm text-slate-400">
            No sponsors yet — add a brand&rsquo;s logo and it starts scrolling on the ribbon.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sponsors.map((s) => (
            <SponsorRow
              key={s.id}
              sponsor={s}
              busy={update.isPending}
              onEdit={() => setEditing(s)}
              onToggle={() => update.mutate({ id: s.id, data: { active: !s.active } })}
            />
          ))}
        </div>
      )}

      {sponsors.length > 0 && (
        <p className="text-[11px] text-slate-400 mt-2">
          {activeCount} of {sponsors.length} active on the ribbon. Set how often each
          brand appears in its editor — Occasionally, Normal, or Often.
        </p>
      )}

      {sponsors.length > 0 && <GameProofOfPlay />}
      {sponsors.length > 0 && <SponsorReport />}

      {editing && (
        <SponsorEditorModal
          sponsor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (vals) => {
            if (editing === 'new') await create.mutateAsync(vals);
            else await update.mutateAsync({ id: editing.id, data: vals });
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  await remove.mutateAsync(editing.id);
                  setEditing(null);
                }
          }
        />
      )}
    </div>
  );
}

function SponsorRow({
  sponsor,
  busy,
  onEdit,
  onToggle,
}: {
  sponsor: Sponsor;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const s = sponsor;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2">
      {s.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={s.logoUrl}
          alt=""
          className="h-10 w-10 rounded-md object-contain bg-slate-50 ring-1 ring-slate-100 shrink-0"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
      ) : (
        <div
          className="h-10 w-10 rounded-md flex items-center justify-center shrink-0"
          style={{ background: s.color || '#eef2ff' }}
        >
          <ImageIcon className="h-4 w-4 text-white/80" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
        <div className="text-[11px] text-slate-500 truncate">
          {s.tier ? <span className="font-semibold text-slate-600">{s.tier}</span> : null}
          {s.tier ? '  ·  ' : ''}
          shows {FREQ_TIERS.find((t) => t.value === weightToTier(s.weight))?.label.toLowerCase()}
          {s.tagline ? `  ·  ${s.tagline}` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-colors disabled:opacity-50 ${
          s.active
            ? 'bg-green-100 text-green-700 hover:bg-green-200'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
        }`}
        title={s.active ? 'Showing on the ribbon — click to pause' : 'Paused — click to show on the ribbon'}
      >
        {s.active ? 'On ribbon' : 'Off'}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="p-1.5 text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
        aria-label="Edit sponsor"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SponsorEditorModal({
  sponsor,
  onClose,
  onSave,
  onDelete,
}: {
  sponsor: Sponsor | null;
  onClose: () => void;
  onSave: (vals: {
    name: string;
    logoUrl: string;
    tagline: string;
    color: string;
    tier: string;
    weight: number;
    active: boolean;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  const [name, setName] = useState(sponsor?.name || '');
  const [logoUrl, setLogoUrl] = useState(sponsor?.logoUrl || '');
  const [tagline, setTagline] = useState(sponsor?.tagline || '');
  const [color, setColor] = useState(sponsor?.color || '#4f46e5');
  const [tier, setTier] = useState(sponsor?.tier || '');
  const [weight, setWeight] = useState(sponsor?.weight || 1);
  const [active, setActive] = useState(sponsor ? sponsor.active : true);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim()) {
      setErr('Sponsor name is required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        logoUrl: logoUrl.trim(),
        tagline: tagline.trim(),
        color: color.trim(),
        tier: tier.trim(),
        weight,
        active,
      });
    } catch (e: any) {
      setErr(e?.message || 'Could not save the sponsor.');
      setBusy(false);
    }
  };

  return (
    // Backdrop — mouse-only convenience; the aria-label="Close" button
    // below is the keyboard/AT-accessible dismissal path. a11y wave
    // (2026-08-24).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="bg-white rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900">
            {sponsor ? 'Edit sponsor' : 'New sponsor'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* logo */}
        <div
          className="rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center"
          style={{ aspectRatio: '16 / 9' }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="w-full h-full object-contain" />
          ) : (
            <ImageIcon className="h-6 w-6 text-slate-300" />
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon className="h-4 w-4" />
            {logoUrl ? 'Replace logo' : 'Choose logo'}
          </Button>
          {logoUrl && (
            <button
              type="button"
              onClick={() => setLogoUrl('')}
              className="text-xs text-slate-400 hover:text-red-600 cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>
        {pickerOpen && (
          <AssetPicker
            kind="image"
            title="Choose sponsor logo"
            onPick={(url) => {
              setLogoUrl(url);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}

        <div className="space-y-3 mt-4">
          <Field label="Sponsor name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Hardware"
              maxLength={120}
            />
          </Field>
          <Field label="Tagline" hint="Optional — shows under the name on the ribbon.">
            <Input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Your hometown hardware store since 1962"
              maxLength={160}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tier" hint="Optional label.">
              <Input
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                placeholder="Gold"
                maxLength={40}
                list="sponsor-tiers"
              />
              <datalist id="sponsor-tiers">
                {TIER_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Banner accent">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4f46e5'}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-12 rounded border border-slate-200 cursor-pointer bg-white p-0.5"
                  aria-label="Banner accent color"
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#4f46e5"
                  maxLength={32}
                />
              </div>
            </Field>
          </div>

          {/* item G (2026-06-16) — plain "how often" instead of the
              "rotation weight 1–10" slider. `weight` stays the source of
              truth; the buttons just pick it. */}
          <div>
            {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control:
                heads a row of frequency-tier buttons, not one control. */}
            <div className="text-xs font-semibold text-slate-500">
              How often it appears
            </div>
            <div className="mt-1 flex rounded-lg border border-slate-200 overflow-hidden">
              {FREQ_TIERS.map((t) => {
                const on = weightToTier(weight) === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    title={t.help}
                    onClick={() => setWeight(FREQ_TIER_WEIGHT[t.value])}
                    className={`flex-1 px-2 py-1.5 text-xs font-bold transition-colors ${
                      on ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {FREQ_TIERS.find((t) => t.value === weightToTier(weight))?.help}
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 accent-indigo-600 cursor-pointer"
            />
            <span className="text-sm font-medium text-slate-700">
              Show on the ribbon now
            </span>
          </label>
        </div>

        {err && <p className="mt-3 text-xs text-red-600 font-medium">{err}</p>}

        <div className="mt-5 flex items-center gap-2">
          <Button onClick={save} disabled={busy || !name.trim()} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {sponsor ? 'Save' : 'Add sponsor'}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="ml-auto text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Seconds → a compact "1h 12m" / "8m" / "40s" duration string. */
function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

interface SponsorReportRow {
  id: string;
  name: string;
  tier?: string | null;
  active: boolean;
  estimatedSpots: number;
  estimatedExposureSeconds: number;
}
interface SponsorReportData {
  totalGames?: number;
  totalLiveSeconds?: number;
  sponsors?: SponsorReportRow[];
}

// ── REAL per-game proof-of-play ───────────────────────────────────
// Surfaces are board + ribbon only. The broadcast scorebug overlay is a
// transparent OBS bug that shows no sponsor + fires no impression, so it
// is intentionally NOT a reported column (see FIX 3, 2026-05-28).
//
// SEC-007 re-audit (2026-09-04) — THE SHAPE MUST CARRY THE PROVENANCE.
// The API has split verified from unverified since 2026-09-04, but this
// interface omitted both fields, so the panel summed a single `total`, called
// it "measured", called it "the number you hand a sponsor", and exported it to
// a file named `proof-of-play-*.csv`. An anonymous browser beacon — anything
// that could reach a public board — was being presented to an operator as
// billable proof. Never drop `verified` / `unverified` / `evidence` from this
// type again: an omitted field here is a false claim on screen.
interface GameReportSponsorRow {
  sponsorId: string;
  name: string;
  board: number;
  ribbon: number;
  /** Everything reported, of any provenance. NOT proof — never label it so. */
  total: number;
  /** Reported by a screen that proved its credential. This is the evidence. */
  verified?: number;
  /** Reported anonymously or by a credential that could not be re-checked. */
  unverified?: number;
  capCompliant: boolean;
}
interface GameReportEvidence {
  verified?: number;
  unverified?: number;
  total?: number;
  /** What a sponsor-facing artifact is allowed to count. Server-declared. */
  basis?: string;
  /** Whether this deploy refuses unverified beacons at ingest. */
  requireVerifiedIngest?: boolean;
  note?: string;
}
interface GameReportData {
  gameId?: string;
  gameStartedAt?: string | null;
  gameDurationMin?: number;
  sponsors?: GameReportSponsorRow[];
  evidence?: GameReportEvidence;
}

/**
 * Split one report row into the two numbers the operator is allowed to read
 * differently.
 *
 * An older API (or a cached response) that carries only `total` returns
 * `verified: 0` — the honest reading, since a payload with no provenance
 * proves none. Never infer verified from total.
 */
function splitRow(s: GameReportSponsorRow): { verified: number; unverified: number } {
  const verified = Math.max(0, Math.min(Number(s.verified ?? 0) || 0, s.total));
  return { verified, unverified: Math.max(0, s.total - verified) };
}

/**
 * Neutralize CSV formula injection (a.k.a. CSV/Excel injection).
 *
 * This proof-of-play CSV is handed to EXTERNAL sponsors, who open it in
 * Excel / Google Sheets / LibreOffice. A cell whose value begins with
 * `=`, `+`, `-`, `@`, a TAB (`\t`) or a CR (`\r`) is interpreted by those
 * apps as a FORMULA — enabling data exfiltration or (via DDE) command
 * execution in the recipient's spreadsheet. Any operator-controlled field
 * that reaches a cell (sponsor name today, any future column) is a vector.
 *
 * The standard neutralizer: if the stringified value starts with a
 * dangerous leading character, prefix a single quote (`'`). Spreadsheets
 * treat the leading `'` as "this cell is text, not a formula" and do not
 * render it, so a legitimate value like `=SUM(...)` still SHOWS its text
 * while never EXECUTING. Non-dangerous values ("Acme Corp", `123`,
 * `2026-07-03`) pass through byte-for-byte unchanged.
 *
 * This does NOT do CSV quoting — that's `csvCell` (quoting must wrap the
 * ALREADY-neutralized value so the leading `'` lands inside the quotes).
 */
export function sanitizeCsvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  // Leading TAB/CR are treated as dangerous too — some apps strip
  // surrounding whitespace and then evaluate a leading `=`/`+`/`-`/`@`.
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/**
 * Escape a CSV cell: neutralize formula injection FIRST, then apply
 * standard CSV quoting (wrap in double-quotes + double any internal
 * double-quotes) whenever the value contains a comma, quote, or newline.
 * Order matters — the injection guard runs on the raw value so its
 * leading `'` sits inside the quotes, and quoting keeps commas/quotes/
 * newlines from corrupting the row/column structure.
 */
function csvCell(v: string | number): string {
  const s = sanitizeCsvCell(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * REAL per-game proof-of-play — counts the impressions the board and ribbon
 * logged during THIS game, per surface, with a cap-compliance flag.
 *
 * SEC-007 re-audit (2026-09-04) — TWO NUMBERS, NEVER ONE. This card used to
 * show a single `total` and describe it as "measured" and "the numbers you
 * hand a sponsor". It was neither: an impression beacon is a public HTTP POST,
 * and until the beacon capability shipped, anything that could reach a board
 * could inflate it. The counts are still real — the boards did report them —
 * but only the VERIFIED ones carry an attestation from a screen that proved
 * its credential at the moment it reported.
 *
 * So the card leads with the verified number and shows the unverified one
 * beside it, labelled for what it is. Player-reliability rule 10 governs every
 * string here: copy states what the evidence proves. "Verified impressions" is
 * a claim we can defend; "measured" was not.
 *
 * Reads gameId from the route (`[schoolId]/sports/[gameId]`) since the
 * panel is mounted without props.
 */
function GameProofOfPlay() {
  const params = useParams();
  const gameId = typeof params?.gameId === 'string' ? params.gameId : undefined;
  const { data, isLoading } = useSponsorGameReport(gameId);
  const [open, setOpen] = useState(false);

  const report = (data && typeof data === 'object' ? data : null) as GameReportData | null;
  const allRows = report?.sponsors || [];
  // Only sponsors that actually got at least one impression this game.
  const rows = allRows.filter((s) => s.total > 0);
  // THE CONTRACTUAL NUMBER. Prefer the server's own evidence block (it is the
  // authority and matches `basis: 'verified'`); fall back to summing the rows.
  const verifiedTotal =
    typeof report?.evidence?.verified === 'number'
      ? report.evidence.verified
      : rows.reduce((sum, s) => sum + splitRow(s).verified, 0);
  const reportedTotal =
    typeof report?.evidence?.total === 'number'
      ? report.evidence.total
      : rows.reduce((sum, s) => sum + s.total, 0);
  const unverifiedTotal = Math.max(0, reportedTotal - verifiedTotal);
  const durMin = report?.gameDurationMin || 0;
  const evidenceNote = report?.evidence?.note;

  const downloadCsv = () => {
    // The columns a sponsor reads. `Verified impressions` is the billable
    // one; `Unverified` is present so the file is complete and so nobody can
    // reconstruct a bigger number by assuming the file hid something.
    const header = [
      'Sponsor',
      'Board',
      'Ribbon',
      'Verified impressions',
      'Unverified impressions',
      'Total reported',
      'Within cap',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const s of rows) {
      const { verified, unverified } = splitRow(s);
      lines.push(
        [s.name, s.board, s.ribbon, verified, unverified, s.total, s.capCompliant ? 'yes' : 'OVER']
          .map(csvCell)
          .join(','),
      );
    }
    lines.push('');
    // Every line below starts with `#`, which `sanitizeCsvCell` leaves alone
    // (it is not one of the formula-trigger characters) and which spreadsheets
    // render as ordinary text.
    lines.push(`# Verified impressions (proof of play): ${verifiedTotal}`);
    lines.push(`# Unverified impressions (NOT proof of play): ${unverifiedTotal}`);
    lines.push('#');
    lines.push(
      '# A VERIFIED impression was reported by a screen that proved its own credential',
      '# to the server at the moment it reported. That is the number to bill from.',
      '# An UNVERIFIED impression was reported by a surface with no screen credential',
      '# (a browser-source overlay or an HDMI-driven board), was recorded before',
      '# impression attestation existed, or came from a screen whose credential could',
      '# not be re-checked at the time. Those counts are real, but they are not proof.',
    );
    lines.push('#');
    lines.push(`# Game duration: ${durMin} min`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proof-of-play-${(gameId || 'game').slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-3 rounded-xl border border-indigo-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-indigo-50 hover:bg-indigo-100 cursor-pointer text-left"
      >
        <BarChart3 className="h-4 w-4 text-indigo-600 shrink-0" />
        <span className="text-sm font-bold text-slate-800">Proof of play</span>
        {/*
          The collapsed headline is the ONE number an operator reads at a
          glance, so it is the verified one. The unverified count rides
          alongside, never inside it.
        */}
        <span className="text-[11px] text-indigo-500 font-semibold truncate">
          — {verifiedTotal.toLocaleString()} verified impression
          {verifiedTotal === 1 ? '' : 's'} this game
          {unverifiedTotal > 0 ? (
            <span className="text-amber-600">
              {' '}
              · {unverifiedTotal.toLocaleString()} unverified
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 ml-auto shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="px-3 py-3">
          {isLoading ? (
            <p className="text-[11px] text-slate-400 py-1">Loading proof of play…</p>
          ) : rows.length === 0 ? (
            <p className="text-[11px] text-slate-400">
              No impressions recorded for this game yet. Counts appear here once a
              sponsor look has shown on a live board or ribbon during the game.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <p className="text-[11px] text-slate-400">
                  {durMin} min of game time · airings per surface, split by what the
                  reporting screen could prove about itself.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0 h-7 text-[11px]"
                  onClick={downloadCsv}
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
              </div>

              {/*
                THE HONESTY BLOCK. Two figures, side by side, each saying what
                it is. The verified one is the only one described as evidence;
                the unverified one is never folded into it and never called
                proof. `evidence.note` is the server's own sentence — it knows
                which causes applied, so it is rendered rather than guessed at.
              */}
              <div className="mb-2.5 rounded-lg border border-slate-200 overflow-hidden">
                <div className="flex">
                  <div className="flex-1 px-2.5 py-2 border-r border-slate-200">
                    <div className="text-base font-black tabular-nums text-indigo-600">
                      {verifiedTotal.toLocaleString()}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Verified
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
                      Reported by a screen that proved its credential. Bill from this.
                    </div>
                  </div>
                  <div className="flex-1 px-2.5 py-2">
                    <div className="text-base font-black tabular-nums text-amber-600">
                      {unverifiedTotal.toLocaleString()}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Unverified
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
                      Counted, but nothing proves which screen reported it. Not proof
                      of play.
                    </div>
                  </div>
                </div>
                {evidenceNote ? (
                  <p className="text-[10px] text-slate-400 leading-snug px-2.5 py-1.5 bg-slate-50 border-t border-slate-200">
                    {evidenceNote}
                  </p>
                ) : null}
              </div>

              {/* header row */}
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 px-2.5 pb-1">
                <span className="flex-1">Sponsor</span>
                <span className="tabular-nums w-10 text-right">Board</span>
                <span className="tabular-nums w-10 text-right">Ribbon</span>
                <span className="tabular-nums w-14 text-right">Verified</span>
                <span className="tabular-nums w-14 text-right">Unverified</span>
                <span className="w-5" />
              </div>
              <div className="space-y-1.5">
                {rows.map((s) => {
                  const { verified, unverified } = splitRow(s);
                  return (
                    <div
                      key={s.sponsorId}
                      className="flex items-center gap-2 text-xs rounded-lg bg-slate-50 px-2.5 py-1.5"
                    >
                      <span className="font-semibold text-slate-700 truncate flex-1">
                        {s.name}
                      </span>
                      <span className="tabular-nums text-slate-500 w-10 text-right">
                        {s.board.toLocaleString()}
                      </span>
                      <span className="tabular-nums text-slate-500 w-10 text-right">
                        {s.ribbon.toLocaleString()}
                      </span>
                      <span
                        className="tabular-nums font-bold text-indigo-600 w-14 text-right"
                        title="Impressions reported by a screen that proved its credential"
                      >
                        {verified.toLocaleString()}
                      </span>
                      <span
                        className={`tabular-nums w-14 text-right ${
                          unverified > 0 ? 'text-amber-600 font-semibold' : 'text-slate-300'
                        }`}
                        title="Impressions with no proof of which screen reported them — not proof of play"
                      >
                        {unverified.toLocaleString()}
                      </span>
                      {s.capCompliant ? (
                        <CheckCircle2
                          className="h-3.5 w-3.5 text-green-500 shrink-0"
                          aria-label="Within frequency cap"
                        />
                      ) : (
                        <AlertTriangle
                          className="h-3.5 w-3.5 text-amber-500 shrink-0"
                          aria-label="Over the frequency cap for this game length"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {/*
                Cap compliance grades on EVERY reported impression, verified or
                not: "did this logo run more often than the contract allows" is
                a question about airings, not about evidence. Said out loud so
                the two columns above are not misread as the cap's input.
              */}
              <p className="text-[10px] text-slate-400 leading-snug mt-2 px-2.5">
                The cap flag counts every reported airing ({reportedTotal.toLocaleString()}{' '}
                this game), verified or not — over-delivery is a scheduling
                question, not an evidence one.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Lifetime ESTIMATE — arithmetic, not measurement. Rotation weight × live
 * game duration across every game the venue has run. No impression is counted
 * here and none is attested, so it is never proof of anything: it exists to
 * scope a conversation ("roughly this much exposure"), and the per-game
 * verified count above is what a renewal is argued from.
 */
function SponsorReport() {
  const { data } = useSponsorReport();
  const [open, setOpen] = useState(false);

  const report = (data && typeof data === 'object' ? data : null) as SponsorReportData | null;
  const rows = (report?.sponsors || []).filter((s) => s.active && s.estimatedSpots > 0);
  if (rows.length === 0) return null;

  const games = report?.totalGames || 0;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 cursor-pointer text-left"
      >
        <BarChart3 className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="text-sm font-bold text-slate-800">Lifetime estimate</span>
        <span className="text-[11px] text-slate-400 truncate">
          — rough exposure across all {games} game{games === 1 ? '' : 's'}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 ml-auto shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="px-3 py-3">
          <p className="text-[11px] text-slate-400 mb-2.5">
            {fmtDuration(report?.totalLiveSeconds || 0)} of live game time so far.
            Calculated from rotation weight and game duration — nothing here is
            counted or attested, so it is an estimate, not proof of play.
          </p>
          <div className="space-y-1.5">
            {rows.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 text-xs rounded-lg bg-slate-50 px-2.5 py-1.5"
              >
                <span className="font-semibold text-slate-700 truncate flex-1">
                  {s.name}
                  {s.tier ? (
                    <span className="ml-1.5 font-normal text-slate-400">{s.tier}</span>
                  ) : null}
                </span>
                <span className="tabular-nums font-bold text-indigo-600 shrink-0">
                  ~{s.estimatedSpots.toLocaleString()} spots
                </span>
                <span className="tabular-nums text-slate-400 shrink-0 w-14 text-right">
                  {fmtDuration(s.estimatedExposureSeconds)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

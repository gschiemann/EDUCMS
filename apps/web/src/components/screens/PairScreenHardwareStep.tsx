/**
 * PairScreenHardwareStep — the "What hardware do you have?" step that
 * runs BEFORE the pair-code entry in the Pair-a-Screen modal.
 *
 * Why this exists (2026-05-27): with the launch of the Goodview EP6N
 * as the canonical sports-vertical hardware target, the dashboard
 * should learn what hardware the operator is installing so it can:
 *
 *   1. Default-recommend the EP6N for sports tenants (with a one-click
 *      link to the spec / order doc).
 *   2. Persist the hardware model on Screen.hardwareModel (Agent A is
 *      adding the column — we cast through `any` so this lands cleanly
 *      regardless of whether the column exists in this worktree).
 *   3. Surface model-specific "while you're at it" I/O upsells once the
 *      operator picks the EP6N (fire-alarm dry contact, panic button,
 *      Stream Deck via RS232 #2, HDMI broadcast capture).
 *   4. Show the right wiring panel later in /[schoolId]/screens/[id]
 *      based on which hardware was paired (Agent B is building that —
 *      this step just records the model).
 *
 * This component is presentational + state-only. The parent Pair modal
 * passes the selection into the /screens/pair API call.
 */
'use client';

import { useMemo } from 'react';
import {
  HARDWARE_PRESENTATIONS,
  HARDWARE_MODELS,
  HardwareModel,
  HardwarePresentation,
  HARDWARE_IO_UPSELLS,
  upsellsForHardware,
  VERTICAL_RECOMMENDED_HARDWARE,
} from '@cms/api-types';
import {
  Cable,
  Cpu,
  ExternalLink,
  Monitor,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react';

interface PairScreenHardwareStepProps {
  /**
   * The current tenant vertical (drives the default recommendation).
   * Pass null/undefined when unknown — defaults to the operator picking
   * manually.
   */
  vertical?: string | null;
  /** Selected hardware model id, or null until the operator chooses. */
  value: HardwareModel | null;
  /** Setter — call with the picked model id. */
  onChange: (model: HardwareModel | null) => void;
  /**
   * Dismissed upsell ids — caller persists this to localStorage so
   * "Set up later" cards don't re-appear after the modal closes and
   * re-opens for a different screen.
   */
  dismissedUpsells?: string[];
  /** Notify caller when "Set up later" is clicked on an upsell card. */
  onDismissUpsell?: (id: string) => void;
}

export function PairScreenHardwareStep({
  vertical,
  value,
  onChange,
  dismissedUpsells = [],
  onDismissUpsell,
}: PairScreenHardwareStepProps) {
  // The vertical-recommended model (e.g. SPORTS → goodview-ep6n).
  const recommended: HardwareModel | null = useMemo(() => {
    if (!vertical) return null;
    return VERTICAL_RECOMMENDED_HARDWARE[vertical] || null;
  }, [vertical]);

  const recommendedDef: HardwarePresentation | null = useMemo(() => {
    if (!recommended) return null;
    return HARDWARE_PRESENTATIONS[recommended] || null;
  }, [recommended]);

  // The currently-selected model definition for the dropdown summary.
  const selectedDef: HardwarePresentation | null = useMemo(() => {
    if (!value) return null;
    return HARDWARE_PRESENTATIONS[value] || null;
  }, [value]);

  // Upsell cards shown ONLY when the selected hardware supports them
  // (currently EP6N-only) — and ONLY when the operator hasn't dismissed.
  const upsells = useMemo(() => {
    return upsellsForHardware(value).filter(
      (u) => !dismissedUpsells.includes(u.id),
    );
  }, [value, dismissedUpsells]);

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="hardware-model-select"
          className="block text-xs font-semibold text-slate-600 mb-1.5"
        >
          What hardware are you installing?
        </label>

        {/* Recommended-hardware card (appears when the vertical has a
            default recommendation). Operator can click to instantly
            pick it without scrolling the dropdown. */}
        {recommendedDef && (
          <RecommendedHardwareCard
            def={recommendedDef}
            isSelected={value === recommendedDef.id}
            onPick={() => onChange(recommendedDef.id)}
          />
        )}

        <select
          id="hardware-model-select"
          value={value || ''}
          onChange={(e) => {
            const next = e.target.value as HardwareModel | '';
            onChange(next || null);
          }}
          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">— Choose hardware (optional) —</option>
          {HARDWARE_MODELS.map((m) => {
            const def = HARDWARE_PRESENTATIONS[m];
            const isRec = m === recommended;
            return (
              <option key={m} value={m}>
                {def.name} {isRec ? '★ recommended for your vertical' : ''}
              </option>
            );
          })}
        </select>

        {/* Compact summary of the currently-selected hardware. Shows
            after the operator picks one — keeps the modal from feeling
            empty when they pick "Generic Android" or "Web." */}
        {selectedDef && selectedDef.id !== recommendedDef?.id && (
          <div className="mt-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="flex items-start gap-2">
              <Monitor className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-slate-800">
                  {selectedDef.name}
                  <span className="text-[10px] font-medium text-slate-400 ml-1.5">
                    by {selectedDef.manufacturer}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                  {selectedDef.blurb}
                </div>
                {selectedDef.caveats && selectedDef.caveats.length > 0 && (
                  <ul className="mt-1.5 text-[10px] text-amber-700 list-disc list-inside leading-snug">
                    {selectedDef.caveats.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        <p className="mt-1.5 text-[11px] text-slate-400">
          Recording this helps us route hardware-specific settings (GPIO,
          serial ports, etc.) to the right screen. You can change it
          later in the screen settings.
        </p>
      </div>

      {/* I/O upsell cards — appear when the picked hardware supports
          them (currently EP6N-only). Each is purely presentational:
          "Configure now" navigates to the screen settings page where
          Agent B's WiringPanel will live; "Set up later" dismisses. */}
      {upsells.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            While you have the {selectedDef?.name}, set up these
            integrations
          </div>
          <ul className="space-y-1.5">
            {upsells.map((u) => (
              <li
                key={u.id}
                className="flex items-start gap-2 p-2.5 bg-indigo-50/40 border border-indigo-100 rounded-lg"
              >
                <UpsellIcon id={u.id} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-slate-800 leading-tight">
                    {u.title}
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug mt-0.5">
                    {u.blurb}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5">
                    {u.configureHref ? (
                      <a
                        href={u.configureHref}
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 hover:text-indigo-900 hover:underline"
                      >
                        Configure now
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400"
                        title="Configuration UI coming soon — see the spec doc for now"
                      >
                        Configure later
                      </span>
                    )}
                    <a
                      href={u.docHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-800 hover:underline"
                    >
                      Spec sheet
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    {onDismissUpsell && (
                      <button
                        type="button"
                        onClick={() => onDismissUpsell(u.id)}
                        className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-700"
                        title="Hide this card for now — you can still set it up later from the screen settings"
                      >
                        Set up later
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The big "Recommended for your vertical" card that sits ABOVE the
 * dropdown. Reads as a real product recommendation — name, manufacturer
 * blurb, top-3 highlights, "Order this hardware" link.
 */
function RecommendedHardwareCard({
  def,
  isSelected,
  onPick,
}: {
  def: HardwarePresentation;
  isSelected: boolean;
  onPick: () => void;
}) {
  const priceLabel = def.approxPriceUsd
    ? `~$${def.approxPriceUsd}`
    : 'Pricing TBD';
  return (
    <div
      className={`mb-3 rounded-xl border-2 ${
        isSelected
          ? 'border-emerald-400 bg-emerald-50/50'
          : 'border-indigo-200 bg-indigo-50/40'
      } p-3.5 transition-colors`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-indigo-500 flex items-center justify-center">
          <Star className="w-5 h-5 text-white fill-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-white px-1.5 py-0.5 rounded">
              Recommended for sports
            </span>
            <span className="text-[10px] font-semibold text-slate-500">
              {priceLabel}
            </span>
          </div>
          <div className="mt-1 text-[14px] font-bold text-slate-900">
            {def.name}
          </div>
          <p className="text-[11.5px] text-slate-600 leading-snug mt-0.5">
            {def.blurb}
          </p>
          <ul className="mt-2 space-y-1">
            {def.highlights.slice(0, 4).map((h, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-[11px] text-slate-700"
              >
                <ShieldCheck className="w-3 h-3 text-emerald-600 mt-0.5 shrink-0" />
                <span className="leading-snug">{h}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={onPick}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg ${
                isSelected
                  ? 'bg-emerald-600 text-white cursor-default'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
              disabled={isSelected}
            >
              {isSelected ? 'Selected' : `Use ${def.name}`}
            </button>
            {def.orderHref && (
              <a
                href={def.orderHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50"
              >
                Order / spec sheet
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Quick icon resolver — picks a meaningful lucide glyph per upsell. */
function UpsellIcon({ id }: { id: string }) {
  const cls = 'w-4 h-4 text-indigo-600 shrink-0 mt-0.5';
  if (id === 'fire-alarm-dry-contact' || id === 'panic-button')
    return <ShieldCheck className={cls} />;
  if (id === 'broadcast-hdmi-in') return <Monitor className={cls} />;
  if (id === 'stream-deck-rs232' || id === 'cts-rs232-1')
    return <Cable className={cls} />;
  return <Cpu className={cls} />;
}

/** Default-export the catalog id list for callers that want to render
 *  outside this component — e.g., the onboarding wizard's "Recommended
 *  hardware" step. */
export { HARDWARE_IO_UPSELLS };

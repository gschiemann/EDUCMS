"use client";

/**
 * The "Make it live" control — Package D of the template-import program
 * (2026-09-15). Mounted by `PropertiesPanel`, inside the Zone card, directly
 * under the read-only Type row it exists to make changeable.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY IT IS SHAPED LIKE THIS AND NOT A TYPE DROPDOWN.
 *
 * A zone's widget type COULD be changed before this shipped, but only on a
 * different tab: select the zone, go to WIDGETS, arm the "Replace <zone>" mode
 * toggle, then click a tile. That is a widget-catalogue browse — the right
 * shape for "I want a different widget", the wrong one for "this text goes
 * stale". The operator looking at an imported text box is in PROPERTIES,
 * reading the copy, and there was nothing there. So this control lives where
 * the zone is already being edited, and it is framed by the OUTCOME ("make it
 * live") rather than by the mechanism ("change widget type").
 *
 * It does not replace that path, it feeds it: "Browse all widgets" opens the
 * widgets panel with REPLACE already armed for this zone, so the full
 * 385-variant library is one button away and the curated six are never the only
 * way to reach it. And once a zone IS live, the widgets panel's Restyle row
 * offers every look registered for its new type — the two controls compose.
 *
 * DESTRUCTIVE, DELIBERATE, REVERSIBLE:
 *   - `setZoneWidget` replaces `defaultConfig` wholesale, so the old widget's
 *     settings go. That is confirmed through `appConfirm`, quoting the exact
 *     copy that is about to be discarded.
 *   - Position, size, layer order and the zone's name all survive (the store
 *     only renames a zone whose name is still auto-generated).
 *   - It is ONE history entry, so Cmd/Ctrl+Z puts the old widget back intact.
 *
 * A11Y: a native disclosure (`aria-expanded` + `aria-controls`) over lists of
 * native buttons in DOM order — every option is a Tab stop and an Enter/Space
 * target with no roving-tabindex machinery to get wrong. Each button's
 * accessible name is the widget label; its blurb and reason are tied to it with
 * `aria-describedby` rather than being read as separate stops. Applying a
 * change collapses the disclosure and returns focus to the toggle, so a
 * keyboard operator is never dropped on `document.body` when the button they
 * pressed leaves the DOM.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Zap, ChevronDown, ChevronRight, X as XIcon, LayoutGrid } from 'lucide-react';
import { appConfirm } from '@/components/ui/app-dialog';
import { useBuilderStore } from './useBuilderStore';
import { widgetLabel } from './constants';
import type { Zone } from './types';
import {
  suggestLiveWidgets,
  shouldOfferLiveHint,
  liveHintDismissKey,
  zoneCopyPreview,
  openWidgetLibrary,
  type LiveWidget,
  type LiveSuggestion,
} from './make-it-live';

/** Never let a storage failure (private-mode Safari, blocked site data) throw. */
function readDismissed(key: string): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    /* a tip that reappears is not worth an error */
  }
}

export function MakeItLive({ zone }: { zone: Zone }) {
  const setZoneWidget = useBuilderStore((s) => s.setZoneWidget);
  const templateId = useBuilderStore((s) => s.templateId);
  const templateDescription = useBuilderStore((s) => s.meta.description);

  const [open, setOpen] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(true);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // Read storage in an effect, never during render: the server render and the
  // first client render must agree or the panel hydrates mismatched.
  useEffect(() => {
    setHintDismissed(readDismissed(liveHintDismissKey(templateId)));
  }, [templateId]);

  // A mode armed for one zone must never carry to the next one.
  useEffect(() => { setOpen(false); }, [zone.id]);

  const { suggested, others } = suggestLiveWidgets(zone);
  const showHint = !hintDismissed && shouldOfferLiveHint(zone, templateDescription);

  const dismissHint = useCallback(() => {
    setHintDismissed(true);
    writeDismissed(liveHintDismissKey(templateId));
  }, [templateId]);

  const apply = useCallback(
    async (w: LiveWidget) => {
      const losing = zoneCopyPreview(zone);
      const ok = await appConfirm({
        title: `Make this a ${w.label.toLowerCase()}?`,
        message:
          `${w.blurb}\n\n` +
          `This replaces the ${widgetLabel(zone.widgetType).toLowerCase()} in this zone. ` +
          (losing
            ? `Its settings — including the text “${losing}” — are discarded.`
            : 'Its current settings are discarded.') +
          `\n\nPosition, size, layer order and the layer name stay exactly as they are, and Undo puts the old widget back.`,
        tone: 'warn',
        confirmLabel: `Make it a ${w.label.toLowerCase()}`,
        cancelLabel: 'Keep it as it is',
      });
      if (!ok) return;
      setZoneWidget(zone.id, w.type);
      // The button just pressed leaves the DOM when the list re-renders without
      // the now-current type, so send focus somewhere real. A macrotask, so it
      // lands after React commits AND after the dialog's own focus-restore
      // effect has tried the detached node.
      setOpen(false);
      window.setTimeout(() => toggleRef.current?.focus(), 0);
    },
    [zone, setZoneWidget],
  );

  return (
    <div className="space-y-2">
      {showHint && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
          <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-px" aria-hidden />
          <p className="flex-1 text-[11px] leading-relaxed text-amber-900">
            This came in from an import and looks like it goes stale.{' '}
            <span className="font-semibold">Make it live</span> and it keeps itself right.
          </p>
          <button
            type="button"
            onClick={dismissHint}
            aria-label="Dismiss this tip"
            className="shrink-0 rounded p-0.5 text-amber-700 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <XIcon className="w-3 h-3" aria-hidden />
          </button>
        </div>
      )}

      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        className="w-full flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-2.5 py-2 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="flex-1 text-left">Make it live</span>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
          : <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden />}
      </button>

      <div id={listId} hidden={!open}>
        <p className="px-0.5 pb-2 text-[11px] leading-relaxed text-slate-500">
          Swap this zone for a widget that keeps itself current. It stays exactly
          where it is, at the same size.
        </p>

        {suggested.length > 0 && (
          <ul aria-label="Suggested for what this says" className="space-y-1.5">
            {suggested.map((w) => (
              <LiveOptionButton key={w.type} option={w} onPick={apply} suggested />
            ))}
          </ul>
        )}

        {others.length > 0 && (
          <>
            {suggested.length > 0 && (
              <p className="pt-3 pb-1.5 px-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Other live widgets
              </p>
            )}
            <ul aria-label="Other live widgets" className="space-y-1.5">
              {others.map((w) => (
                <LiveOptionButton key={w.type} option={w} onPick={apply} />
              ))}
            </ul>
          </>
        )}

        <button
          type="button"
          onClick={() => openWidgetLibrary(zone.id)}
          className="mt-2.5 w-full flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <LayoutGrid className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="flex-1 text-left">Browse all widgets instead</span>
        </button>
      </div>
    </div>
  );
}

function LiveOptionButton({
  option,
  onPick,
  suggested,
}: {
  option: LiveWidget | LiveSuggestion;
  onPick: (w: LiveWidget) => void;
  suggested?: boolean;
}) {
  const descId = useId();
  const because = (option as LiveSuggestion).because;
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(option)}
        // The whole card is the target (kinder to touch and to a D-pad remote),
        // but its ACCESSIBLE NAME has to be just the widget — without this the
        // name is the label plus both paragraphs run together, which is what a
        // screen reader would read out on focus. The blurb and the reason stay
        // announced, as the description.
        aria-label={option.label}
        aria-describedby={descId}
        className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
          suggested
            ? 'border-indigo-200 bg-indigo-50/60 hover:bg-indigo-50'
            : 'border-slate-200 bg-white hover:bg-slate-50'
        }`}
      >
        <span className="block text-[11px] font-bold text-slate-800">{option.label}</span>
        <span id={descId} className="block pt-0.5 text-[10px] leading-relaxed text-slate-500">
          {because ? <span className="block font-medium text-indigo-700">{because}</span> : null}
          {option.blurb}
        </span>
      </button>
    </li>
  );
}

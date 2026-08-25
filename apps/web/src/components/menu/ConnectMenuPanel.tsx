'use client';

/**
 * ConnectMenuPanel — self-serve "Connect your POS / paste your menu"
 * onboarding affordance (Integration-Concierge-aligned).
 * ──────────────────────────────────────────────────────────────────
 *
 * The 30-second on-ramp (CLAUDE.md §20 + AI Integration Concierge
 * vision): an operator with no menu yet gets two one-click paths —
 *
 *   1. Connect your POS  → /settings/pos (Square OAuth / custom webhook)
 *   2. Paste your menu   → a textarea; we parse it (text OR JSON),
 *      import it via the documented `POST /menu/import` ({menu:[...]},
 *      which wraps the custom-webhook ingest), and offer to auto-seed a
 *      Menu Board template pre-wired to the live catalog — one click and
 *      there's a working board on screen.
 *
 * Degrades honestly: if the import endpoint isn't deployed yet we still
 * seed the template (posSync on) and tell the operator to connect a POS
 * to go live — no silent failure, no stack trace.
 *
 * Dashboard-only → full modern visuals.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, Loader2, X, Sparkles, Store } from 'lucide-react';
import { appAlert } from '@/components/ui/app-dialog';
import { useCreateTemplate } from '@/hooks/use-api';
import {
  parseMenuText, importMenu, MenuApiUnavailable,
  type ParsedMenuItem,
} from '@/lib/menu/menu-console-api';

export function ConnectMenuPanel({ schoolId }: { schoolId: string }) {
  const [pasteOpen, setPasteOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href={`/${schoolId}/settings/pos`}
          className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 text-sm font-semibold transition-colors"
        >
          <Store className="w-4 h-4" /> Connect your POS
        </Link>
        <button
          type="button"
          onClick={() => setPasteOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 hover:border-orange-300 text-slate-700 px-4 py-2.5 text-sm font-semibold transition-colors"
        >
          <ClipboardPaste className="w-4 h-4" /> Paste your menu
        </button>
      </div>
      {pasteOpen && <PasteMenuModal schoolId={schoolId} onClose={() => setPasteOpen(false)} />}
    </>
  );
}

function PasteMenuModal({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const createTemplate = useCreateTemplate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = parseMenuText(text);

  const seedTemplate = async (): Promise<boolean> => {
    // Auto-seed a Menu Board template pre-wired to the live POS catalog.
    // Single full-bleed RESTAURANT_MENU_BOARD zone with posSync on, so
    // the moment a POS connects the board fills itself per location.
    try {
      await createTemplate.mutateAsync({
        name: 'Menu Board',
        description: 'Auto-created from your pasted menu — pulls live prices from your POS.',
        category: 'Restaurant',
        orientation: 'LANDSCAPE',
        screenWidth: 1920,
        screenHeight: 1080,
        zones: [
          {
            name: 'Menu',
            widgetType: 'RESTAURANT_MENU_BOARD',
            x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0,
            defaultConfig: { posSync: true, title: 'OUR MENU', columns: 3, theme: 'cream' },
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  };

  const handleImportAndSeed = async () => {
    if (parsed.length === 0) {
      await appAlert({ title: 'Nothing to import', message: 'Paste a few menu lines first — one item per line, price at the end (e.g. “Cheeseburger  $8.99”).', tone: 'info' });
      return;
    }
    setBusy(true);
    let importNote = '';
    try {
      const { imported } = await importMenu(parsed);
      importNote = `Imported ${imported} item${imported === 1 ? '' : 's'}.`;
    } catch (err) {
      if (err instanceof MenuApiUnavailable) {
        importNote =
          'Your menu is captured. Connect a POS (or the custom webhook) to push these live to your screens.';
      } else {
        setBusy(false);
        await appAlert({ title: 'Import failed', message: String((err as Error).message), tone: 'danger' });
        return;
      }
    }
    const seeded = await seedTemplate();
    setBusy(false);
    qc.invalidateQueries({ queryKey: ['menu-catalog'] });
    qc.invalidateQueries({ queryKey: ['templates'] });
    await appAlert({
      title: 'Menu ready',
      message: `${importNote}${seeded ? ' A “Menu Board” template is in your Templates — drop it on any screen.' : ''}`,
      tone: 'info',
    });
    onClose();
    if (seeded) router.push(`/${schoolId}/templates`);
  };

  return (
    // Backdrop — mouse-only convenience; the aria-label="Close" button
    // below is the keyboard/AT-accessible dismissal path.
    // a11y wave (2026-08-24).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <ClipboardPaste className="w-4 h-4 text-orange-600" /> Paste your menu
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">
            One item per line, price at the end. We&rsquo;ll create a Menu Board template for you and
            wire it to your live prices.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={'Classic Cheeseburger   $8.99\nSea Salt Fries   $3.49\nFountain Soda   $2.79'}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400 resize-y"
          />
          {parsed.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Preview — {parsed.length} item{parsed.length === 1 ? '' : 's'}
              </div>
              <ul className="space-y-1 max-h-32 overflow-y-auto">
                {parsed.slice(0, 8).map((it: ParsedMenuItem) => (
                  <li key={it.externalId} className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 truncate">{it.name}</span>
                    <span className="font-bold text-slate-500 tabular-nums">${(it.priceCents / 100).toFixed(2)}</span>
                  </li>
                ))}
                {parsed.length > 8 && <li className="text-[11px] text-slate-400">+ {parsed.length - 8} more…</li>}
              </ul>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImportAndSeed}
            disabled={busy || parsed.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Create my menu board
          </button>
        </div>
      </div>
    </div>
  );
}

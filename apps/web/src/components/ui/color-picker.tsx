"use client";

/**
 * ColorPickerField — app-themed HSV picker that REPLACES the OS-native
 * <input type="color">.
 *
 * Why we built our own:
 *   On Windows the system picker shows a hue bar and a gradient that
 *   are not synced with each other — clicking "red" on the bar lands
 *   the indicator near-black on the gradient. Operator reported this
 *   verbatim:
 *     "you pick red but it puts you in the almost black section of
 *      the color gradient picker, so the color bar picker isnt equal
 *      to the bigger gradient picker"
 *
 * Design:
 *   - Quick-swatch row (12-wide grid of standard + neutral colors).
 *     Clicking a swatch sets HSV to that exact color, so the SV plane
 *     and hue bar both jump to the right place — no more "I clicked
 *     red and the cursor is in the dark corner."
 *   - Hue bar: standard horizontal rainbow. Drag → sets the H of HSV
 *     and the SV plane re-paints to that hue's saturation/value plane.
 *   - SV plane: square gradient. White at top-left, hue at top-right,
 *     black at bottom. Drag the cursor anywhere to fine-tune S and V.
 *   - Hex input: paste any hex (#abc, #aabbcc) and the picker syncs.
 *
 * State trick:
 *   HSV is the source of truth, NOT hex. Reason: dragging value down
 *   to black is a destructive op for hue (RGB→HSV at v=0 has no hue
 *   info), so we'd lose the user's chosen hue every time they tested
 *   "what does this look like darker." Keeping HSV internally lets
 *   them slide back up and recover the same hue. Hex flows OUT to
 *   the consumer via onChange.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Check } from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────

/**
 * 24 quick-pick swatches — 6 neutrals + 18 hues following the Tailwind
 * core palette so they read as "standard colors" in the K-12 eye.
 * Picking any of these sets HSV exactly, so the cursor on the SV plane
 * lands on the swatch's saturation/value (vivid for the colored ones,
 * desaturated near-edges for the greys).
 */
const STANDARD_COLORS: string[] = [
  '#000000', '#1e293b', '#475569', '#94a3b8', '#cbd5e1', '#ffffff',
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#7c2d12',
];

interface HSV { h: number; s: number; v: number; }

// ─── Math (HSV ↔ RGB ↔ hex) ──────────────────────────────────────────

function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  s /= 100; v /= 100;
  const i = Math.floor(h / 60);
  const f = h / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (((i % 6) + 6) % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h, s, v };
}

function hexToHsv(hex: string): HSV | null {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return rgbToHsv(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
}

function hsvToHex(hsv: HSV): string {
  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ─── Public component ────────────────────────────────────────────────

export interface ColorPickerFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** When true, adds a "Clear" button that sets value to 'transparent'. */
  allowTransparent?: boolean;
}

/**
 * Drop-in replacement for the old <input type="color"> ColorField.
 * Same call signature; opens a popover instead of the OS picker.
 */
export function ColorPickerField({ label, value, onChange, allowTransparent }: ColorPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const isTransparent = !value || value === 'transparent';

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      {/* Section heading — NOT a <label> because the trigger is a
          button, not a form input. Uses aria-label on the button itself
          for screen-readers (label-has-associated-control rule). */}
      <div className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-slate-200 hover:border-indigo-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
      >
        <span
          className="w-6 h-6 rounded border border-slate-200 shrink-0"
          style={isTransparent ? {
            // Checkerboard for "transparent" so it reads visibly as no-color
            backgroundImage:
              'linear-gradient(45deg, #ddd 25%, transparent 25%), linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%), linear-gradient(-45deg, transparent 75%, #ddd 75%)',
            backgroundSize: '8px 8px',
            backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
          } : { background: value }}
        />
        <span className="text-xs font-mono text-slate-600 flex-1 text-left truncate">
          {isTransparent ? 'transparent' : value}
        </span>
      </button>
      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Color picker"
          className="absolute z-[10001] mt-1 left-0 w-[260px] bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 p-3 space-y-3"
        >
          <ColorPickerBody
            value={isTransparent ? '#3b82f6' : value}
            onChange={onChange}
          />
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
            {allowTransparent && (
              <button
                type="button"
                onClick={() => { onChange('transparent'); setOpen(false); }}
                className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded"
              >
                Clear
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1 text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Internal body (also exported for callers that want a custom trigger) ───

export function ColorPickerBody({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // HSV is the source of truth (see file header).
  const initialHsv = useMemo(
    () => hexToHsv(value) || { h: 0, s: 100, v: 100 },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [hsv, setHsv] = useState<HSV>(initialHsv);
  const [hexText, setHexText] = useState(value);

  // We track the last hex we emitted to the parent so an external value
  // change can be distinguished from our own onChange echo. Without this
  // every onChange would re-set HSV from the round-tripped hex (lossy at
  // v=0) and the picker would jitter.
  const lastEmittedRef = useRef<string>(value.toLowerCase());

  // Push hex up whenever HSV changes
  useEffect(() => {
    const hex = hsvToHex(hsv);
    setHexText(hex);
    if (hex.toLowerCase() !== lastEmittedRef.current) {
      lastEmittedRef.current = hex.toLowerCase();
      onChange(hex);
    }
  }, [hsv]); // eslint-disable-line react-hooks/exhaustive-deps

  // External value change (parent reset, swatch picked elsewhere, etc.)
  useEffect(() => {
    if (!value || value === lastEmittedRef.current) return;
    const next = hexToHsv(value);
    if (next) {
      lastEmittedRef.current = value.toLowerCase();
      setHsv(next);
      setHexText(value);
    }
  }, [value]);

  // ─── SV plane drag ─────────────────────────────────────────────────
  const svRef = useRef<HTMLDivElement>(null);
  const onSvPointer = (e: React.PointerEvent) => {
    const el = svRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const update = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const x = clamp(clientX - r.left, 0, r.width);
      const y = clamp(clientY - r.top, 0, r.height);
      setHsv(prev => ({ h: prev.h, s: (x / r.width) * 100, v: 100 - (y / r.height) * 100 }));
    };
    update(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // ─── Hue slider drag ───────────────────────────────────────────────
  const hueRef = useRef<HTMLDivElement>(null);
  const onHuePointer = (e: React.PointerEvent) => {
    const el = hueRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const update = (clientX: number) => {
      const r = el.getBoundingClientRect();
      const x = clamp(clientX - r.left, 0, r.width);
      setHsv(prev => ({ h: (x / r.width) * 360, s: prev.s, v: prev.v }));
    };
    update(e.clientX);
    const move = (ev: PointerEvent) => update(ev.clientX);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <>
      {/* Quick swatches — pick a standard color. The HSV jumps to that
          color exactly, so the SV cursor lands on the right point in
          the gradient (no more "I clicked red, cursor is in black corner"). */}
      <div className="grid grid-cols-12 gap-1">
        {STANDARD_COLORS.map(c => {
          const selected = hexText.toLowerCase() === c.toLowerCase();
          // Pick check-mark contrast based on swatch lightness
          const lightish = c === '#ffffff' || c === '#cbd5e1' || c === '#94a3b8' || c === '#eab308' || c === '#f59e0b' || c === '#84cc16';
          return (
            <button
              key={c}
              type="button"
              onClick={() => {
                const next = hexToHsv(c);
                if (next) setHsv(next);
              }}
              className="w-full aspect-square rounded-md border border-slate-200 hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-indigo-400 flex items-center justify-center"
              style={{ background: c }}
              aria-label={`Set color to ${c}`}
              aria-pressed={selected}
            >
              {selected && (
                <Check className={`w-3 h-3 ${lightish ? 'text-slate-700' : 'text-white'}`} aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      {/* SV plane — saturation horizontally, value vertically.
          Two-layer gradient: white→hue horizontally, transparent→black
          vertically. Re-paints whenever hue changes. */}
      <div
        ref={svRef}
        onPointerDown={onSvPointer}
        className="relative w-full h-32 rounded-md cursor-crosshair touch-none overflow-hidden border border-slate-200"
        style={{
          backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
        }}
        role="application"
        aria-label="Saturation and value picker"
      >
        <div
          className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow pointer-events-none"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            background: hsvToHex(hsv),
          }}
        />
      </div>

      {/* Hue slider — horizontal rainbow. Drag to pick base color. */}
      <div
        ref={hueRef}
        onPointerDown={onHuePointer}
        className="relative w-full h-3 rounded-full cursor-pointer touch-none border border-slate-200"
        style={{
          background:
            'linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))',
        }}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
      >
        <div
          className="absolute top-1/2 w-3.5 h-3.5 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow pointer-events-none"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            background: `hsl(${hsv.h}, 100%, 50%)`,
          }}
        />
      </div>

      {/* Hex input — type a hex code and the picker syncs. Invalid input
          is preserved in the text field but doesn't update HSV until it
          parses cleanly, so a half-typed "#3b" doesn't snap the picker. */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={hexText}
          onChange={(e) => {
            const v = e.target.value;
            setHexText(v);
            const next = hexToHsv(v);
            if (next) setHsv(next);
          }}
          spellCheck={false}
          className="flex-1 px-2 py-1 text-xs font-mono rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          aria-label="Hex color code"
        />
        <span
          className="w-7 h-7 rounded border border-slate-200 shrink-0"
          style={{ background: hsvToHex(hsv) }}
          aria-hidden
        />
      </div>
    </>
  );
}

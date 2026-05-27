'use client';

/**
 * WiringPanel — Goodview EP6N hardware-wiring editor.
 *
 * Visible only when `screen.hardwareModel === 'goodview-ep6n'` (the
 * call site gates this — the panel does NOT check on its own so the
 * test scaffolding can render it for any screen). The EP6N's I/O
 * ring exposes two native RS232 ports on a Phoenix terminal, one
 * RS485, two GPIO inputs (dry-contact) and two GPIO outputs (relay).
 * The operator picks what each lane carries; the player's CtsBridge
 * + the API's per-screen GPIO handler (Agent C) read this config and
 * route accordingly.
 *
 * Save flow: builds the full `wiring` object and PUTs to
 *   PUT /api/v1/screens/:id   body: { config: { wiring: {...} } }
 * The API's allow-list merges `wiring` into Screen.config and
 * publishes a SYNC over the signed pub/sub so the player picks up
 * the new wiring on the next manifest poll (< 10s).
 *
 * Storage shape (Screen.config.wiring):
 *   {
 *     rs232_1: 'cts' | 'streamdeck' | 'aux' | 'off',
 *     rs232_2: 'cts' | 'streamdeck' | 'aux' | 'off',
 *     rs485:   'daktronics' | 'nevco' | 'off',
 *     gpio_in:  { in1: 'fire' | 'panic' | 'door' | 'off',
 *                 in2: '…' },
 *     gpio_out: { out1: 'lamp' | 'horn' | 'door-strike' | 'off',
 *                 out2: '…' },
 *   }
 */

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api-client';

// ─── wiring value types ────────────────────────────────────────────
export type Rs232Role = 'cts' | 'streamdeck' | 'aux' | 'off';
export type Rs485Role = 'daktronics' | 'nevco' | 'off';
export type GpioInRole =
  | 'fire'       // fire-alarm dry contact
  | 'panic'      // hardware panic button
  | 'door'       // door sensor
  | 'off';
export type GpioOutRole =
  | 'lamp'        // lobby status lamp
  | 'horn'        // audible horn during emergency
  | 'door-strike' // door strike
  | 'off';

export type WiringConfig = {
  rs232_1?: Rs232Role;
  rs232_2?: Rs232Role;
  rs485?: Rs485Role;
  gpio_in?: { in1?: GpioInRole; in2?: GpioInRole };
  gpio_out?: { out1?: GpioOutRole; out2?: GpioOutRole };
};

const RS232_OPTIONS: Array<{ value: Rs232Role; label: string }> = [
  { value: 'cts', label: 'CTS Gen 6 console' },
  { value: 'streamdeck', label: 'Elgato Stream Deck' },
  { value: 'aux', label: 'Aux / debug-only' },
  { value: 'off', label: 'Off (unused)' },
];
const RS485_OPTIONS: Array<{ value: Rs485Role; label: string }> = [
  { value: 'daktronics', label: 'Daktronics All Sport' },
  { value: 'nevco', label: 'Nevco' },
  { value: 'off', label: 'Off (unused)' },
];
const GPIO_IN_OPTIONS: Array<{ value: GpioInRole; label: string }> = [
  { value: 'fire', label: 'Fire alarm dry contact' },
  { value: 'panic', label: 'Hardware panic button' },
  { value: 'door', label: 'Door sensor' },
  { value: 'off', label: 'Off (unused)' },
];
const GPIO_OUT_OPTIONS: Array<{ value: GpioOutRole; label: string }> = [
  { value: 'lamp', label: 'Lobby status lamp' },
  { value: 'horn', label: 'Audible horn (emergency)' },
  { value: 'door-strike', label: 'Door strike' },
  { value: 'off', label: 'Off (unused)' },
];

// Default wiring is "single CTS port like every existing install."
// Operator opts in to the other roles by changing dropdowns.
const DEFAULT_WIRING: Required<WiringConfig> = {
  rs232_1: 'cts',
  rs232_2: 'off',
  rs485: 'off',
  gpio_in: { in1: 'off', in2: 'off' },
  gpio_out: { out1: 'off', out2: 'off' },
};

function normalize(input: WiringConfig | null | undefined): Required<WiringConfig> {
  const w = input || {};
  return {
    rs232_1: w.rs232_1 ?? DEFAULT_WIRING.rs232_1,
    rs232_2: w.rs232_2 ?? DEFAULT_WIRING.rs232_2,
    rs485: w.rs485 ?? DEFAULT_WIRING.rs485,
    gpio_in: {
      in1: w.gpio_in?.in1 ?? 'off',
      in2: w.gpio_in?.in2 ?? 'off',
    },
    gpio_out: {
      out1: w.gpio_out?.out1 ?? 'off',
      out2: w.gpio_out?.out2 ?? 'off',
    },
  };
}

export interface WiringPanelProps {
  /** Screen id — used as the path param on the PUT save call. */
  screenId: string;
  /** Existing wiring config from `screen.config.wiring`. Pass null
   *  if the screen has never been configured — the panel seeds with
   *  the legacy single-CTS default. */
  initialWiring?: WiringConfig | null;
  /** Called after a successful save, with the persisted wiring. The
   *  parent typically uses this to optimistically update its cached
   *  screen object so the panel reflects "saved" state immediately. */
  onSaved?: (wiring: Required<WiringConfig>) => void;
}

export function WiringPanel({ screenId, initialWiring, onSaved }: WiringPanelProps) {
  const seed = useMemo(() => normalize(initialWiring), [initialWiring]);
  const [draft, setDraft] = useState<Required<WiringConfig>>(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-seed if the parent passes a fresh initial value (e.g. when the
  // operator picks a different screen in a list view).
  useEffect(() => {
    setDraft(seed);
  }, [seed]);

  // Guard: two ports can't BOTH be wired to 'cts'. The CtsParser is
  // a stateful protocol decoder and is not reentrant across two
  // independent feeds — if the operator tries this, we flag it and
  // disable the Save button until they fix it.
  const ctsConflict = draft.rs232_1 === 'cts' && draft.rs232_2 === 'cts';
  const canSave = !saving && !ctsConflict;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/screens/${screenId}`, {
        method: 'PUT',
        body: JSON.stringify({ config: { wiring: draft } }),
      });
      setSavedAt(Date.now());
      onSaved?.(draft);
    } catch (e) {
      setError((e as Error).message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="wiring-panel-heading"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2
            id="wiring-panel-heading"
            className="text-base font-semibold text-slate-900"
          >
            EP6N hardware wiring
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Pick what each port carries. Saves to <code>Screen.config.wiring</code>;
            the player picks up the change on the next manifest poll
            (about 10&nbsp;seconds).
          </p>
        </div>
        <PhoenixDiagram />
      </header>

      {ctsConflict && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Both RS232 ports are wired to CTS. Pick one CTS port and set the
          other to Stream Deck / Aux / Off.
        </p>
      )}

      {/* RS232 ports */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          RS232 ports (Phoenix terminal)
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Port 1 (pins 1-3)"
            value={draft.rs232_1}
            options={RS232_OPTIONS}
            onChange={(v) =>
              setDraft((d) => ({ ...d, rs232_1: v as Rs232Role }))
            }
          />
          <Select
            label="Port 2 (pins 4-6)"
            value={draft.rs232_2}
            options={RS232_OPTIONS}
            onChange={(v) =>
              setDraft((d) => ({ ...d, rs232_2: v as Rs232Role }))
            }
          />
        </div>
      </div>

      {/* RS485 */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          RS485 (pins 7-8, A/B)
        </h3>
        <Select
          label="Console protocol"
          value={draft.rs485}
          options={RS485_OPTIONS}
          onChange={(v) => setDraft((d) => ({ ...d, rs485: v as Rs485Role }))}
        />
      </div>

      {/* GPIO inputs */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          GPIO inputs (dry-contact)
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="IN1 (pins 9-10)"
            value={draft.gpio_in.in1 ?? 'off'}
            options={GPIO_IN_OPTIONS}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                gpio_in: { ...d.gpio_in, in1: v as GpioInRole },
              }))
            }
          />
          <Select
            label="IN2 (pins 11-12)"
            value={draft.gpio_in.in2 ?? 'off'}
            options={GPIO_IN_OPTIONS}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                gpio_in: { ...d.gpio_in, in2: v as GpioInRole },
              }))
            }
          />
        </div>
      </div>

      {/* GPIO outputs */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          GPIO outputs (relay)
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="OUT1 (pins 13-14)"
            value={draft.gpio_out.out1 ?? 'off'}
            options={GPIO_OUT_OPTIONS}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                gpio_out: { ...d.gpio_out, out1: v as GpioOutRole },
              }))
            }
          />
          <Select
            label="OUT2 (pins 15-16)"
            value={draft.gpio_out.out2 ?? 'off'}
            options={GPIO_OUT_OPTIONS}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                gpio_out: { ...d.gpio_out, out2: v as GpioOutRole },
              }))
            }
          />
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end">
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="mr-3 text-xs text-emerald-700">Saved</span>
        )}
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save wiring'}
        </button>
      </div>
    </section>
  );
}

// ─── tiny native-select wrapper ────────────────────────────────────
// We use a plain <select> rather than a popover combobox because the
// label / value contract is straightforward AND it dodges every
// known WebKit / Chromium-83 quirk that's bitten the player route.
function Select(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-700">
        {props.label}
      </span>
      <select
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─── Phoenix-terminal pinout diagram ───────────────────────────────
// A small SVG over the right corner of the panel header to remind
// the operator which physical pins each dropdown maps to. The labels
// match the EP6N's screen-printed silkscreen so a tech with a
// screwdriver can match the dashboard to the device by eye.
function PhoenixDiagram() {
  // 16-pin Phoenix terminal block: 4 groups of 4 pins each. Each
  // group is one logical channel (RS232-A, RS232-B, RS485, GPIO).
  const groups: Array<{
    label: string;
    pins: Array<{ n: number; lab: string }>;
    fill: string;
  }> = [
    {
      label: 'RS232 P1',
      pins: [
        { n: 1, lab: 'TX' },
        { n: 2, lab: 'RX' },
        { n: 3, lab: 'G' },
      ],
      fill: '#dbeafe',
    },
    {
      label: 'RS232 P2',
      pins: [
        { n: 4, lab: 'TX' },
        { n: 5, lab: 'RX' },
        { n: 6, lab: 'G' },
      ],
      fill: '#cffafe',
    },
    {
      label: 'RS485',
      pins: [
        { n: 7, lab: 'A' },
        { n: 8, lab: 'B' },
      ],
      fill: '#fae8ff',
    },
    {
      label: 'GPIO',
      pins: [
        { n: 9, lab: 'IN1' },
        { n: 10, lab: 'GND' },
        { n: 11, lab: 'IN2' },
        { n: 12, lab: 'GND' },
        { n: 13, lab: 'OUT1' },
        { n: 14, lab: '+5V' },
        { n: 15, lab: 'OUT2' },
        { n: 16, lab: '+5V' },
      ],
      fill: '#fef3c7',
    },
  ];
  return (
    <div
      aria-hidden="true"
      className="ml-4 hidden flex-col items-end text-[10px] text-slate-500 sm:flex"
    >
      <span className="mb-1 font-medium">Phoenix terminal</span>
      <svg
        width="220"
        height="40"
        viewBox="0 0 220 40"
        role="img"
        aria-label="Phoenix terminal pinout"
      >
        {(() => {
          let x = 0;
          const elements: React.ReactNode[] = [];
          groups.forEach((g, gi) => {
            const width = g.pins.length * 18;
            elements.push(
              <rect
                key={`g${gi}`}
                x={x}
                y={0}
                width={width}
                height={28}
                fill={g.fill}
                stroke="#94a3b8"
              />,
            );
            g.pins.forEach((p, pi) => {
              elements.push(
                <text
                  key={`p${gi}-${pi}-n`}
                  x={x + pi * 18 + 9}
                  y={12}
                  textAnchor="middle"
                  fontSize="8"
                  fill="#475569"
                >
                  {p.n}
                </text>,
              );
              elements.push(
                <text
                  key={`p${gi}-${pi}-l`}
                  x={x + pi * 18 + 9}
                  y={23}
                  textAnchor="middle"
                  fontSize="7"
                  fill="#334155"
                >
                  {p.lab}
                </text>,
              );
            });
            elements.push(
              <text
                key={`gl${gi}`}
                x={x + width / 2}
                y={38}
                textAnchor="middle"
                fontSize="8"
                fill="#1e293b"
              >
                {g.label}
              </text>,
            );
            x += width + 2;
          });
          return elements;
        })()}
      </svg>
    </div>
  );
}

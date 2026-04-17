"use client";

import { useId } from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignEndVertical, AlignVerticalJustifyCenter } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { widgetLabel } from './constants';

export function PropertiesPanel() {
  const { zones, selectedIds, updateZone, meta } = useBuilderStore();
  const nameId = useId();
  const xId = useId();
  const yId = useId();
  const wId = useId();
  const hId = useId();
  const configId = useId();

  if (selectedIds.length === 0) {
    return <TemplateProperties />;
  }

  if (selectedIds.length > 1) {
    return (
      <div className="p-4 text-xs text-slate-500 space-y-3">
        <div className="font-semibold text-slate-700">{selectedIds.length} zones selected</div>
        <p>Use the alignment buttons below to distribute the selection. Arrow keys nudge everything together (hold Shift for 10&times; steps).</p>
        <MultiAlignButtons />
      </div>
    );
  }

  const zone = zones.find(z => z.id === selectedIds[0]);
  if (!zone) return null;

  const canvasAspect = meta.screenWidth / meta.screenHeight;
  const pixelW = Math.round(zone.width / 100 * meta.screenWidth);
  const pixelH = Math.round(zone.height / 100 * meta.screenHeight);

  function set(patch: Parameters<typeof updateZone>[1]) {
    updateZone(zone!.id, patch, true);
  }

  const configString = zone.defaultConfig ? JSON.stringify(zone.defaultConfig, null, 2) : '';

  return (
    <div className="p-4 space-y-5 text-xs">
      <section>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Zone</h3>
        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">{widgetLabel(zone.widgetType)}</p>
        <label htmlFor={nameId} className="block text-[10px] font-semibold text-slate-500 mb-1">Name</label>
        <input
          id={nameId}
          type="text"
          value={zone.name}
          onChange={(e) => updateZone(zone.id, { name: e.target.value }, false)}
          onBlur={(e) => updateZone(zone.id, { name: e.target.value }, true)}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </section>

      <section>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Position &amp; size</h3>
        <div className="grid grid-cols-2 gap-2">
          <NumField id={xId} label="X (%)" value={zone.x} onChange={(v) => set({ x: v })} min={0} max={100} />
          <NumField id={yId} label="Y (%)" value={zone.y} onChange={(v) => set({ y: v })} min={0} max={100} />
          <NumField id={wId} label="Width (%)" value={zone.width} onChange={(v) => set({ width: v })} min={3} max={100} />
          <NumField id={hId} label="Height (%)" value={zone.height} onChange={(v) => set({ height: v })} min={3} max={100} />
        </div>
        <div className="text-[10px] text-slate-400 mt-2">
          Rendered size: ~{pixelW}&times;{pixelH}px at {meta.screenWidth}&times;{meta.screenHeight} ({canvasAspect.toFixed(2)}:1)
        </div>

        <div className="flex gap-1 mt-3">
          <IconBtn label="Align left edge" onClick={() => set({ x: 0 })}><AlignLeft className="w-3.5 h-3.5" aria-hidden /></IconBtn>
          <IconBtn label="Center horizontally" onClick={() => set({ x: (100 - zone.width) / 2 })}><AlignCenter className="w-3.5 h-3.5" aria-hidden /></IconBtn>
          <IconBtn label="Align right edge" onClick={() => set({ x: 100 - zone.width })}><AlignRight className="w-3.5 h-3.5" aria-hidden /></IconBtn>
          <div className="w-px bg-slate-200 mx-1" />
          <IconBtn label="Align top edge" onClick={() => set({ y: 0 })}><AlignStartVertical className="w-3.5 h-3.5" aria-hidden /></IconBtn>
          <IconBtn label="Center vertically" onClick={() => set({ y: (100 - zone.height) / 2 })}><AlignVerticalJustifyCenter className="w-3.5 h-3.5" aria-hidden /></IconBtn>
          <IconBtn label="Align bottom edge" onClick={() => set({ y: 100 - zone.height })}><AlignEndVertical className="w-3.5 h-3.5" aria-hidden /></IconBtn>
        </div>

        <div className="flex gap-1 mt-2">
          <button type="button"
            onClick={() => set({ x: 0, y: 0, width: 100, height: 100 })}
            className="flex-1 px-2 py-1.5 text-[10px] rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-600"
          >
            Fill canvas
          </button>
          <button type="button"
            onClick={() => set({ x: (100 - zone.height * canvasAspect) / 2, y: 0, width: zone.height * canvasAspect, height: 100 })}
            className="flex-1 px-2 py-1.5 text-[10px] rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-600"
          >
            Fit height
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Widget config</h3>
        <label htmlFor={configId} className="block text-[10px] font-semibold text-slate-500 mb-1">
          JSON overrides (optional)
        </label>
        <textarea
          id={configId}
          rows={6}
          defaultValue={configString}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              updateZone(zone.id, { defaultConfig: null }, true);
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              updateZone(zone.id, { defaultConfig: parsed }, true);
            } catch {
              // ignore parse error — keep previous value; a later Sprint can add inline validation
            }
          }}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
          placeholder='{ "fontSize": 48 }'
        />
        <p className="text-[10px] text-slate-400 mt-1">Leave blank to use widget defaults.</p>
      </section>
    </div>
  );
}

function TemplateProperties() {
  const { meta, setMeta } = useBuilderStore();
  const nameId = useId();
  const descId = useId();
  const widthId = useId();
  const heightId = useId();
  const bgColorId = useId();
  const bgGradientId = useId();
  const bgImageId = useId();

  return (
    <div className="p-4 space-y-4 text-xs">
      <div>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Template</h3>
        <label htmlFor={nameId} className="block text-[10px] font-semibold text-slate-500 mb-1">Name</label>
        <input
          id={nameId}
          type="text"
          value={meta.name}
          onChange={(e) => setMeta({ name: e.target.value })}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>
      <div>
        <label htmlFor={descId} className="block text-[10px] font-semibold text-slate-500 mb-1">Description</label>
        <textarea
          id={descId}
          rows={3}
          value={meta.description}
          onChange={(e) => setMeta({ description: e.target.value })}
          className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>
      <div>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Canvas</h3>
        <div className="grid grid-cols-2 gap-2">
          <NumField id={widthId} label="Width (px)" value={meta.screenWidth} onChange={(v) => setMeta({ screenWidth: Math.round(v) })} min={200} max={10000} step={10} />
          <NumField id={heightId} label="Height (px)" value={meta.screenHeight} onChange={(v) => setMeta({ screenHeight: Math.round(v) })} min={200} max={10000} step={10} />
        </div>
      </div>
      <div>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Background</h3>
        <label htmlFor={bgColorId} className="block text-[10px] font-semibold text-slate-500 mb-1">Color</label>
        <div className="flex gap-2 items-center">
          <input
            id={bgColorId}
            type="color"
            value={meta.bgColor || '#ffffff'}
            onChange={(e) => setMeta({ bgColor: e.target.value })}
            className="w-10 h-8 rounded border border-slate-200 cursor-pointer"
          />
          <input
            type="text"
            aria-label="Background color hex"
            value={meta.bgColor}
            onChange={(e) => setMeta({ bgColor: e.target.value })}
            placeholder="#ffffff"
            className="flex-1 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-xs font-mono"
          />
        </div>
        <label htmlFor={bgGradientId} className="block text-[10px] font-semibold text-slate-500 mb-1 mt-3">CSS gradient (optional)</label>
        <input
          id={bgGradientId}
          type="text"
          value={meta.bgGradient}
          onChange={(e) => setMeta({ bgGradient: e.target.value })}
          placeholder="linear-gradient(135deg, #4f46e5, #9333ea)"
          className="w-full px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-xs font-mono"
        />
        <label htmlFor={bgImageId} className="block text-[10px] font-semibold text-slate-500 mb-1 mt-3">Image URL (optional)</label>
        <input
          id={bgImageId}
          type="url"
          value={meta.bgImage}
          onChange={(e) => setMeta({ bgImage: e.target.value })}
          placeholder="https://..."
          className="w-full px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-xs"
        />
      </div>
    </div>
  );
}

function NumField({ id, label, value, onChange, min, max, step = 1 }: {
  id: string; label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-1">{label}</label>
      <input
        id={id}
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        min={min}
        max={max}
        step={step}
        className="w-full px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
    >
      {children}
    </button>
  );
}

function MultiAlignButtons() {
  const { zones, selectedIds, updateZones } = useBuilderStore();
  const selected = zones.filter(z => selectedIds.includes(z.id));
  if (selected.length < 2) return null;

  const leftMost = Math.min(...selected.map(z => z.x));
  const rightMost = Math.max(...selected.map(z => z.x + z.width));
  const topMost = Math.min(...selected.map(z => z.y));
  const bottomMost = Math.max(...selected.map(z => z.y + z.height));

  return (
    <div className="grid grid-cols-3 gap-1">
      <button type="button"
        onClick={() => updateZones(selectedIds, () => ({ x: leftMost }), true)}
        className="px-2 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-600"
      >Align left</button>
      <button type="button"
        onClick={() => updateZones(selectedIds, (z) => ({ x: (leftMost + rightMost) / 2 - z.width / 2 }), true)}
        className="px-2 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-600"
      >Center H</button>
      <button type="button"
        onClick={() => updateZones(selectedIds, (z) => ({ x: rightMost - z.width }), true)}
        className="px-2 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-600"
      >Align right</button>
      <button type="button"
        onClick={() => updateZones(selectedIds, () => ({ y: topMost }), true)}
        className="px-2 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-600"
      >Align top</button>
      <button type="button"
        onClick={() => updateZones(selectedIds, (z) => ({ y: (topMost + bottomMost) / 2 - z.height / 2 }), true)}
        className="px-2 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-600"
      >Center V</button>
      <button type="button"
        onClick={() => updateZones(selectedIds, (z) => ({ y: bottomMost - z.height }), true)}
        className="px-2 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-600"
      >Align bottom</button>
    </div>
  );
}

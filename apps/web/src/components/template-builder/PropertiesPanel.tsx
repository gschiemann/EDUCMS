"use client";

import { useId, useState, useEffect, useRef } from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignEndVertical, AlignVerticalJustifyCenter, ChevronDown, ChevronRight, X as XIcon } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { widgetLabel } from './constants';
import { useAssets, usePlaylists } from '@/hooks/use-api';

export function PropertiesPanel() {
  // Atomic selectors — the old `const { zones, selectedIds, updateZone,
  // meta } = useBuilderStore()` subscribed this component (1000+ lines,
  // 60+ form fields) to the ENTIRE store. Every keystroke in any input
  // called updateZone, which mutated zones, which re-rendered the whole
  // panel + BuilderCanvas + LayersPanel. Typing felt laggy. With atomic
  // selectors Zustand only re-renders when the specific slice changes.
  // Action refs (updateZone) are stable (created once in create()) so
  // they never trigger re-renders.
  const zones = useBuilderStore((s) => s.zones);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const updateZone = useBuilderStore((s) => s.updateZone);
  const meta = useBuilderStore((s) => s.meta);
  const nameId = useId();

  // Hotspot listener — when the AnimatedWelcomeWidget dispatches an
  // 'aw-edit-section' CustomEvent (user clicked a region in the
  // preview), scroll the matching section header to the top of its
  // scroll container + pulse pink. Retries up to 1.5s because the
  // zone selection re-renders the panel with new fields and the
  // target won't exist immediately.
  //
  // Walks up to find the actual scrollable ancestor (overflow auto/scroll
  // with vertical overflow) instead of relying on scrollIntoView, which
  // sometimes hits the wrong container in nested transformed layouts.
  useEffect(() => {
    const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
      let cur = node?.parentElement;
      while (cur) {
        const cs = window.getComputedStyle(cur);
        const oy = cs.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur;
        cur = cur.parentElement;
      }
      return document.scrollingElement as HTMLElement | null;
    };
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { section?: string } | undefined;
      const key = detail?.section;
      if (!key) return;
      let attempts = 0;
      const tryScroll = () => {
        const el = document.getElementById(`aw-section-${key}`);
        if (el) {
          const scroller = findScrollParent(el);
          if (scroller) {
            const elRect = el.getBoundingClientRect();
            const scRect = scroller.getBoundingClientRect();
            // Position the section ~16px below the scroller's top edge
            scroller.scrollTo({
              top: scroller.scrollTop + (elRect.top - scRect.top) - 16,
              behavior: 'smooth',
            });
          } else {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          el.classList.add('aw-section-flash');
          setTimeout(() => el.classList.remove('aw-section-flash'), 1400);
          return;
        }
        if (++attempts < 30) setTimeout(tryScroll, 50); // ≤1.5s total
      };
      tryScroll();
    };
    window.addEventListener('aw-edit-section', handler);
    return () => window.removeEventListener('aw-edit-section', handler);
  }, []);

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
      <div className="p-5 text-xs text-slate-500 space-y-4">
        <div className="px-3 py-2 bg-indigo-50/50 text-indigo-700 rounded-lg font-semibold flex items-center gap-2">
           <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
           {selectedIds.length} zones selected
        </div>
        <p className="leading-relaxed opacity-90">Use the alignment buttons below to distribute the selection. Arrow keys nudge everything together (hold <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[10px]">Shift</kbd> for 10&times; steps).</p>
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
    <div className="p-5 space-y-6 text-xs">
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Zone</h3>
        
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500">Type</span>
            <span className="px-2 py-1 bg-white rounded-md shadow-sm border border-slate-100 text-[10px] font-bold text-indigo-600">{widgetLabel(zone.widgetType)}</span>
          </div>
          
          <div>
            <label htmlFor={nameId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Layer Name</label>
            <input
              id={nameId}
              type="text"
              value={zone.name}
              onChange={(e) => updateZone(zone.id, { name: e.target.value }, false)}
              onBlur={(e) => updateZone(zone.id, { name: e.target.value }, true)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm inset-shadow-sm"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Widget Theme</label>
            <select
              value={(zone.defaultConfig?.theme as string) || 'default'}
              onChange={(e) => {
                const val = e.target.value;
                const newConfig = { ...(zone.defaultConfig || {}) };
                if (val === 'default') delete newConfig.theme;
                else newConfig.theme = val;
                updateZone(zone.id, { defaultConfig: newConfig }, true);
              }}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm inset-shadow-sm cursor-pointer"
            >
              <option value="default">Default / Base</option>
              <option value="seamless">Seamless (No Background)</option>
              <optgroup label="Elementary">
                <option value="rainbow-ribbon">🌈 Rainbow Ribbon</option>
                <option value="bulletin-board">📌 Bulletin Board</option>
                <option value="field-day">🏆 Field Day</option>
                <option value="storybook">📖 Storybook</option>
                <option value="scrapbook">📎 Scrapbook</option>
                <option value="track-day">🏃 Track Day</option>
              </optgroup>
              <optgroup label="Middle School">
                <option value="locker-hallway">🔐 Locker Hallway</option>
                <option value="spirit-rally">📣 Spirit Rally</option>
                <option value="stem-lab">🔬 STEM Lab</option>
                <option value="morning-news">📺 Morning News</option>
                <option value="art-studio">🎨 Art Studio</option>
                <option value="scorebug">📊 Scorebug Dashboard</option>
              </optgroup>
              <optgroup label="High School">
                <option value="varsity-athletic">🥇 Varsity Athletic</option>
                <option value="senior-countdown">🎓 Senior Countdown</option>
                <option value="news-studio-pro">🎬 News Studio Pro</option>
                <option value="campus-quad">🏛️ Campus Quad</option>
                <option value="achievement-hall">🏅 Achievement Hall</option>
                <option value="jumbotron-pro">🏟️ Jumbotron Pro</option>
              </optgroup>
              <optgroup label="Legacy">
                <option value="sunny-meadow">☀️ Sunny Meadow</option>
                <option value="back-to-school">🍎 Back to School</option>
                <option value="diner-chalkboard">🍽️ Diner Chalkboard</option>
                <option value="middle-school-hall">🏫 Middle School Hallway</option>
                <option value="bus-loop">🚌 Bus Loop</option>
                <option value="high-school-athletics">🏆 Athletics Jumbotron</option>
                <option value="library-quiet">📚 Library Quiet Zone</option>
                <option value="sunshine-academy">🌞 Sunshine Academy</option>
                <option value="final-chance">✨ Final Chance</option>
                <option value="principals-office">🎓 Principal's Office</option>
                <option value="office-dashboard">📊 Office Dashboard</option>
                <option value="gym-pe">💪 Gym / PE</option>
                <option value="music-arts">🎵 Music & Arts</option>
                <option value="stem-science">🔬 STEM & Science</option>
              </optgroup>
            </select>
            <p className="mt-1 text-[10px] text-slate-400">Tip: use the <strong>Widgets</strong> tab to swap themes visually with thumbnails.</p>
          </div>
        </div>
      </section>

      <ContentFields zone={zone} updateZone={updateZone} />

      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Geometry</h3>
        
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <NumField id={xId} label="X (%)" value={zone.x} onChange={(v) => set({ x: v })} min={0} max={100} />
            <NumField id={yId} label="Y (%)" value={zone.y} onChange={(v) => set({ y: v })} min={0} max={100} />
            <NumField id={wId} label="Width (%)" value={zone.width} onChange={(v) => set({ width: v })} min={3} max={100} />
            <NumField id={hId} label="Height (%)" value={zone.height} onChange={(v) => set({ height: v })} min={3} max={100} />
          </div>
          
          <div className="text-[10px] text-slate-400/80 font-medium text-center bg-white py-1.5 rounded-md border border-slate-100/50">
            Rendered: ~{pixelW}&times;{pixelH}px at {meta.screenWidth}&times;{meta.screenHeight}
          </div>

          <div className="pt-2 border-t border-slate-200/50 flex justify-center gap-1">
            <IconBtn label="Align left" onClick={() => set({ x: 0 })}><AlignLeft className="w-4 h-4" aria-hidden /></IconBtn>
            <IconBtn label="Center horz" onClick={() => set({ x: (100 - zone.width) / 2 })}><AlignCenter className="w-4 h-4" aria-hidden /></IconBtn>
            <IconBtn label="Align right" onClick={() => set({ x: 100 - zone.width })}><AlignRight className="w-4 h-4" aria-hidden /></IconBtn>
            <div className="w-px h-6 bg-slate-200/60 mx-1.5 self-center" />
            <IconBtn label="Align top" onClick={() => set({ y: 0 })}><AlignStartVertical className="w-4 h-4" aria-hidden /></IconBtn>
            <IconBtn label="Center vert" onClick={() => set({ y: (100 - zone.height) / 2 })}><AlignVerticalJustifyCenter className="w-4 h-4" aria-hidden /></IconBtn>
            <IconBtn label="Align bottom" onClick={() => set({ y: 100 - zone.height })}><AlignEndVertical className="w-4 h-4" aria-hidden /></IconBtn>
          </div>

          <div className="flex gap-2">
            <button type="button"
              onClick={() => set({ x: 0, y: 0, width: 100, height: 100 })}
              className="flex-1 px-2 py-2 text-[10px] rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 font-semibold text-slate-600 transition-all shadow-sm active:scale-95"
            >
              Fill Canvas
            </button>
            <button type="button"
              onClick={() => set({ x: (100 - zone.height * canvasAspect) / 2, y: 0, width: zone.height * canvasAspect, height: 100 })}
              className="flex-1 px-2 py-2 text-[10px] rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 font-semibold text-slate-600 transition-all shadow-sm active:scale-95"
            >
              Fit Height
            </button>
          </div>
        </div>
      </section>

      <AdvancedJson zone={zone} configString={configString} configId={configId} updateZone={updateZone} />
    </div>
  );
}

function TemplateProperties() {
  // Atomic selectors — see PropertiesPanel above.
  const meta = useBuilderStore((s) => s.meta);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const nameId = useId();
  const descId = useId();
  const widthId = useId();
  const heightId = useId();
  const bgColorId = useId();
  const bgGradientId = useId();
  const bgImageId = useId();

  return (
    <div className="p-5 space-y-6 text-xs">
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Template Info</h3>
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
          <div>
            <label htmlFor={nameId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Name</label>
            <input
              id={nameId}
              type="text"
              value={meta.name}
              onChange={(e) => setMeta({ name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm"
            />
          </div>
          <div>
            <label htmlFor={descId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Description</label>
            <textarea
              id={descId}
              rows={2}
              value={meta.description}
              onChange={(e) => setMeta({ description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm resize-y"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Canvas Resolution</h3>
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <NumField id={widthId} label="Width (px)" value={meta.screenWidth} onChange={(v) => setMeta({ screenWidth: Math.round(v) })} min={200} max={10000} step={10} />
            <NumField id={heightId} label="Height (px)" value={meta.screenHeight} onChange={(v) => setMeta({ screenHeight: Math.round(v) })} min={200} max={10000} step={10} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Backdrop</h3>
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
          <div>
            <label htmlFor={bgColorId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Solid Color</label>
            <div className="flex gap-2 items-center">
              <div className="relative w-9 h-9 rounded-lg shadow-sm border border-slate-200/60 overflow-hidden shrink-0">
                <input
                  id={bgColorId}
                  type="color"
                  value={meta.bgColor || '#ffffff'}
                  onChange={(e) => setMeta({ bgColor: e.target.value })}
                  className="absolute -inset-2 w-16 h-16 cursor-pointer"
                />
              </div>
              <input
                type="text"
                aria-label="Background color hex"
                value={meta.bgColor}
                onChange={(e) => setMeta({ bgColor: e.target.value })}
                placeholder="#ffffff"
                className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor={bgGradientId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">CSS Gradient</label>
            <input
              id={bgGradientId}
              type="text"
              value={meta.bgGradient}
              onChange={(e) => setMeta({ bgGradient: e.target.value })}
              placeholder="linear-gradient(...)"
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm"
            />
          </div>
          <div>
            <label htmlFor={bgImageId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Image URL</label>
            <input
              id={bgImageId}
              type="url"
              value={meta.bgImage}
              onChange={(e) => setMeta({ bgImage: e.target.value })}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function NumField({ id, label, value, onChange, min, max, step = 1 }: {
  id: string; label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
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
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-[11px] font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm inset-shadow-sm"
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
      className="p-2 rounded-lg hover:bg-white text-slate-500 hover:text-indigo-600 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all duration-200 active:scale-90"
    >
      {children}
    </button>
  );
}

function MultiAlignButtons() {
  const zones = useBuilderStore((s) => s.zones);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const updateZones = useBuilderStore((s) => s.updateZones);
  const selected = zones.filter(z => selectedIds.includes(z.id));
  if (selected.length < 2) return null;

  const leftMost = Math.min(...selected.map(z => z.x));
  const rightMost = Math.max(...selected.map(z => z.x + z.width));
  const topMost = Math.min(...selected.map(z => z.y));
  const bottomMost = Math.max(...selected.map(z => z.y + z.height));

  const btnClass = "flex-1 px-2 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-indigo-600 text-[10px] font-bold text-slate-600 transition-all shadow-sm active:scale-95";

  return (
    <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-2">
      <div className="flex gap-2">
        <button type="button" onClick={() => updateZones(selectedIds, () => ({ x: leftMost }), true)} className={btnClass}>Left</button>
        <button type="button" onClick={() => updateZones(selectedIds, (z) => ({ x: (leftMost + rightMost) / 2 - z.width / 2 }), true)} className={btnClass}>Center X</button>
        <button type="button" onClick={() => updateZones(selectedIds, (z) => ({ x: rightMost - z.width }), true)} className={btnClass}>Right</button>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => updateZones(selectedIds, () => ({ y: topMost }), true)} className={btnClass}>Top</button>
        <button type="button" onClick={() => updateZones(selectedIds, (z) => ({ y: (topMost + bottomMost) / 2 - z.height / 2 }), true)} className={btnClass}>Center Y</button>
        <button type="button" onClick={() => updateZones(selectedIds, (z) => ({ y: bottomMost - z.height }), true)} className={btnClass}>Bottom</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Content fields — friendly inputs based on widget type
// ─────────────────────────────────────────────────────────
function ContentFields({ zone, updateZone }: { zone: any; updateZone: any }) {
  const cfg = zone.defaultConfig || {};
  const setField = (patch: Record<string, any>) => {
    updateZone(zone.id, { defaultConfig: { ...cfg, ...patch } }, true);
  };

  // Shape-based themes bake their own palette + typography and ignore
  // generic style knobs like text color, font size, and background.
  // Hide those knobs for those themes so the panel never lies to the
  // user about controls that do nothing.
  const SHAPE_THEMES = new Set([
    // Elementary
    'rainbow-ribbon', 'bulletin-board', 'field-day', 'storybook', 'scrapbook', 'track-day',
    // Middle school
    'locker-hallway', 'spirit-rally', 'stem-lab', 'morning-news', 'art-studio', 'scorebug',
    // High school
    'varsity-athletic', 'senior-countdown', 'news-studio-pro', 'campus-quad', 'achievement-hall', 'jumbotron-pro',
  ]);
  const isShapeTheme = SHAPE_THEMES.has(cfg.theme);

  // Build a list of editable fields based on widget type
  const fields: React.ReactNode[] = [];

  switch (zone.widgetType) {
    case 'TEXT':
    case 'RICH_TEXT':
      fields.push(<TextAreaField key="content" label="Text" value={cfg.content || ''} placeholder="Your headline…" onChange={(v) => setField({ content: v })} rows={3} />);
      // Banner themes often use a subtitle too. Expose it for shape
      // themes where the widget renders both lines.
      if (isShapeTheme) {
        fields.push(<TextField key="subtitle" label="Subtitle (optional)" value={cfg.subtitle || ''} placeholder="Today is going to be amazing" onChange={(v) => setField({ subtitle: v })} />);
      }
      if (!isShapeTheme) {
        fields.push(<SelectField key="alignment" label="Alignment" value={cfg.alignment || 'center'} options={[['left','Left'],['center','Center'],['right','Right']]} onChange={(v) => setField({ alignment: v })} />);
        fields.push(<TextField key="fontSize" label="Font size (px, optional)" value={String(cfg.fontSize ?? '')} placeholder="48" onChange={(v) => setField({ fontSize: v ? parseInt(v) : undefined })} />);
        fields.push(<ColorField key="color" label="Text color" value={cfg.color || '#1e293b'} onChange={(v) => setField({ color: v })} />);
        fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      }
      if (zone.widgetType === 'RICH_TEXT') {
        fields.push(<TextAreaField key="html" label="HTML (advanced)" value={cfg.html || ''} placeholder="<p>Custom HTML…</p>" onChange={(v) => setField({ html: v })} rows={4} />);
      }
      break;
    case 'ANNOUNCEMENT':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Big news…" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextAreaField key="message" label="Message" value={cfg.message || cfg.body || ''} placeholder="Details…" onChange={(v) => setField({ message: v, body: undefined })} rows={3} />);
      if (!isShapeTheme) {
        fields.push(<TextField key="badge" label="Badge label" value={cfg.badgeLabel || ''} placeholder="📣 Today's Announcement" onChange={(v) => setField({ badgeLabel: v })} />);
        fields.push(<SelectField key="priority" label="Priority" value={cfg.priority || 'normal'} options={[['low','Low'],['normal','Normal'],['high','High'],['critical','Critical']]} onChange={(v) => setField({ priority: v })} />);
      }
      break;
    case 'STAFF_SPOTLIGHT':
      fields.push(<TextField key="staffName" label="Name" value={cfg.staffName || ''} placeholder="Mrs. Johnson" onChange={(v) => setField({ staffName: v })} />);
      fields.push(<TextField key="role" label="Role" value={cfg.role || ''} placeholder="Teacher of the Week" onChange={(v) => setField({ role: v })} />);
      fields.push(<TextAreaField key="bio" label="Bio" value={cfg.bio || ''} placeholder="One-liner about them…" onChange={(v) => setField({ bio: v })} rows={3} />);
      fields.push(<AssetPickerField key="photoUrl" label="Photo" value={cfg.photoUrl || ''} kind="image" onChange={(v) => setField({ photoUrl: v })} />);
      break;
    case 'COUNTDOWN': {
      const mode = (cfg.mode as 'date' | 'recurring') || 'date';
      fields.push(
        <SelectField
          key="mode"
          label="Countdown type"
          value={mode}
          options={[['date', 'Single date (e.g. Field Trip)'], ['recurring', 'Recurring schedule (e.g. Lunch periods)']]}
          onChange={(v) => setField({ mode: v })}
        />
      );
      if (mode === 'date') {
        fields.push(<TextField key="label" label="Label" value={cfg.label || ''} placeholder="Field Trip in" onChange={(v) => setField({ label: v })} />);
        fields.push(<TextField key="targetDate" label="Target date (YYYY-MM-DD or full ISO)" value={cfg.targetDate || ''} placeholder="2026-05-15" onChange={(v) => setField({ targetDate: v })} />);
      } else {
        fields.push(<TextField key="prefix" label="Prefix (optional)" value={cfg.prefix || ''} placeholder="Next lunch in" onChange={(v) => setField({ prefix: v })} />);
        fields.push(
          <PeriodsEditor
            key="periods"
            value={(cfg.periods || []) as Array<{ label: string; daysOfWeek: number[]; startTime: string }>}
            onChange={(periods) => setField({ periods })}
          />
        );
      }
      break;
    }
    case 'CLOCK':
      fields.push(<SelectField key="format" label="Format" value={cfg.format || '12h'} options={[['12h','12-hour'],['24h','24-hour']]} onChange={(v) => setField({ format: v })} />);
      fields.push(<TextField key="timezone" label="Timezone (optional)" value={cfg.timezone || ''} placeholder="America/Chicago" onChange={(v) => setField({ timezone: v })} />);
      if (!isShapeTheme) {
        // showSeconds / showDays / bgColor are ignored by shape
        // themes (clock face is baked into the SVG).
        fields.push(<ToggleField key="showSeconds" label="Show seconds" value={!!cfg.showSeconds} onChange={(v) => setField({ showSeconds: v })} />);
        fields.push(<ToggleField key="showDays" label="Show day & date" value={cfg.showDays !== false} onChange={(v) => setField({ showDays: v })} />);
        fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      }
      break;
    case 'WEATHER':
      fields.push(<TextField key="location" label="Location" value={cfg.location || ''} placeholder="Springfield" onChange={(v) => setField({ location: v })} />);
      fields.push(<SelectField key="units" label="Units" value={cfg.units || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ units: v })} />);
      fields.push(<TextField key="tempF" label={`Current temp (${cfg.units === 'metric' ? '°C' : '°F'})`} value={String(cfg.tempF ?? '')} placeholder="72" onChange={(v) => setField({ tempF: parseInt(v) || 0 })} />);
      fields.push(<TextField key="high" label="High" value={String(cfg.high ?? '')} placeholder="78" onChange={(v) => setField({ high: parseInt(v) || 0 })} />);
      fields.push(<TextField key="low" label="Low" value={String(cfg.low ?? '')} placeholder="64" onChange={(v) => setField({ low: parseInt(v) || 0 })} />);
      fields.push(<TextField key="condition" label="Condition" value={cfg.condition || ''} placeholder="Sunny" onChange={(v) => setField({ condition: v })} />);
      break;
    case 'TICKER': {
      const msgs = Array.isArray(cfg.messages) ? cfg.messages : [];
      const label = `Messages (one per line) — ${msgs.length} saved`;
      // Preserve blank lines while the user is actively typing (the
      // user needs an empty line to exist briefly when pressing Enter
      // before typing the next message). Filter happens only on save,
      // not on every keystroke. We keep trailing empty as-is too;
      // saving an all-empty doesn't hurt anything.
      fields.push(<TextAreaField key="messages" label={label} value={msgs.join('\n')} placeholder="Welcome back!" onChange={(v) => setField({ messages: v.split('\n') })} rows={6} />);
      fields.push(<SelectField key="speed" label="Speed" value={cfg.speed || 'medium'} options={[['slow','Slow'],['medium','Medium'],['fast','Fast']]} onChange={(v) => setField({ speed: v })} />);
      fields.push(<ToggleField key="scrollEnabled" label="Animate scroll" value={cfg.scrollEnabled !== false} onChange={(v) => setField({ scrollEnabled: v })} />);
      break;
    }
    case 'CALENDAR':
      fields.push(<TextAreaField key="events" label="Events (date | title — one per line)" value={(cfg.events || []).map((e: any) => `${e.date || ''} | ${e.title || ''}`).join('\n')} placeholder="Today | Spring Concert&#10;Tomorrow | PTA Meeting" onChange={(v) => setField({ events: v.split('\n').filter(Boolean).map(line => { const [date, title] = line.split('|').map(s => s.trim()); return { date, title }; }) })} rows={5} />);
      fields.push(<TextField key="maxEvents" label="Max events to show" value={String(cfg.maxEvents || 4)} placeholder="4" onChange={(v) => setField({ maxEvents: parseInt(v) || 4 })} />);
      break;
    case 'LUNCH_MENU':
      fields.push(<TextAreaField key="menu" label="Menu (Day: items — one per line)" value={cfg.menu || ''} placeholder="Monday: Pizza, Salad" onChange={(v) => setField({ menu: v, meals: undefined })} rows={6} />);
      break;
    case 'LOGO':
      fields.push(<TextField key="initials" label="Initials" value={cfg.initials || ''} placeholder="SE" onChange={(v) => setField({ initials: v })} />);
      fields.push(<TextField key="schoolName" label="School name (optional)" value={cfg.schoolName || ''} placeholder="Sunnyside Elementary" onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<AssetPickerField key="assetUrl" label="Logo image (optional)" value={cfg.assetUrl || ''} kind="image" onChange={(v) => setField({ assetUrl: v })} />);
      break;
    case 'IMAGE_CAROUSEL':
      fields.push(<TextField key="title" label="Caption" value={cfg.title || ''} placeholder="Photo Gallery" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="intervalMs" label="Rotate every (ms)" value={String(cfg.intervalMs || 5000)} placeholder="5000" onChange={(v) => setField({ intervalMs: parseInt(v) || 5000 })} />);
      fields.push(<SelectField key="fitMode" label="Image fit" value={cfg.fitMode || 'cover'} options={[['cover','Fill (crop)'],['contain','Fit (no crop)']]} onChange={(v) => setField({ fitMode: v })} />);
      fields.push(<AssetListPickerField key="urls" label="Photos" value={(cfg.urls || cfg.assetUrls || []) as string[]} kind="image" onChange={(v) => setField({ urls: v, assetUrls: undefined })} />);
      break;
    case 'IMAGE':
      fields.push(<AssetPickerField key="assetUrl" label="Image" value={cfg.assetUrl || cfg.imageUrl || ''} kind="image" onChange={(v) => setField({ assetUrl: v, imageUrl: undefined })} />);
      fields.push(<SelectField key="fitMode" label="Fit" value={cfg.fitMode || 'cover'} options={[['cover','Fill (crop)'],['contain','Fit (no crop)']]} onChange={(v) => setField({ fitMode: v })} />);
      fields.push(<TextField key="assetName" label="Alt text (for screen readers)" value={cfg.assetName || ''} placeholder="School logo" onChange={(v) => setField({ assetName: v })} />);
      break;
    case 'VIDEO':
      fields.push(<AssetPickerField key="assetUrl" label="Video" value={cfg.assetUrl || cfg.url || ''} kind="video" onChange={(v) => setField({ assetUrl: v, url: undefined })} />);
      fields.push(<ToggleField key="autoplay" label="Autoplay" value={cfg.autoplay !== false} onChange={(v) => setField({ autoplay: v })} />);
      fields.push(<ToggleField key="loop" label="Loop" value={cfg.loop !== false} onChange={(v) => setField({ loop: v })} />);
      fields.push(<ToggleField key="muted" label="Muted" value={cfg.muted !== false} onChange={(v) => setField({ muted: v })} />);
      break;
    case 'WEBPAGE':
      fields.push(<TextField key="url" label="Web page URL" value={cfg.url || cfg.embedUrl || ''} placeholder="https://example.com" onChange={(v) => setField({ url: v, embedUrl: undefined })} />);
      fields.push(<TextField key="refreshIntervalMs" label="Auto-refresh every (ms, 0 = never)" value={String(cfg.refreshIntervalMs ?? 0)} placeholder="0" onChange={(v) => setField({ refreshIntervalMs: parseInt(v) || 0 })} />);
      break;
    case 'BELL_SCHEDULE':
      fields.push(
        <BellScheduleEditor
          key="schedule"
          value={(cfg.schedule || []) as Array<{ label: string; start: string; end?: string }>}
          onChange={(schedule) => setField({ schedule })}
        />
      );
      break;
    case 'PLAYLIST':
      fields.push(<PlaylistPickerField key="playlistId" label="Playlist" value={cfg.playlistId || ''} onChange={(v) => setField({ playlistId: v })} />);
      break;
    case 'RSS_FEED':
      fields.push(<TextField key="url" label="RSS feed URL" value={cfg.url || ''} placeholder="https://example.com/rss.xml" onChange={(v) => setField({ url: v })} />);
      fields.push(<TextField key="maxItems" label="Max items" value={String(cfg.maxItems || 5)} placeholder="5" onChange={(v) => setField({ maxItems: parseInt(v) || 5 })} />);
      break;
    case 'SOCIAL_FEED':
      fields.push(<TextField key="url" label="Profile / feed URL" value={cfg.url || ''} placeholder="https://twitter.com/sunnyside_elem" onChange={(v) => setField({ url: v })} />);
      fields.push(<TextField key="maxItems" label="Max posts to show" value={String(cfg.maxItems || 5)} placeholder="5" onChange={(v) => setField({ maxItems: parseInt(v) || 5 })} />);
      break;
    case 'ANIMATED_WELCOME_MS':
    case 'ANIMATED_WELCOME_HS':
    case 'ANIMATED_WELCOME': {
      // All 3 ANIMATED_WELCOME variants share the same config shape —
      // Elementary / Middle / High School — so the editor + hotspot
      // section IDs can be reused verbatim. The widget component
      // picks the theme; the fields are identical.
      // Section headings double as scroll-into-view targets so when the
      // user clicks a hotspot in the rendered preview, the panel jumps
      // to the matching section. Each header carries an id like
      // 'aw-section-weather' that the AnimatedWelcomeWidget's hotspot
      // dispatches against. data-aw-section also enables the brief
      // pink-ring highlight pulse on activation.
      const SH = (key: string, label: string) => (
        <div
          key={`sh-${key}`}
          id={`aw-section-${key}`}
          data-aw-section={key}
          className="aw-section-header pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 scroll-mt-24 transition-shadow"
        >
          {label}
        </div>
      );
      fields.push(SH('header', 'Header'));
      fields.push(<AssetPickerField key="logoUrl" label="Logo (upload your school crest)" value={cfg.logoUrl || ''} kind="image" onChange={(v) => setField({ logoUrl: v })} />);
      fields.push(<TextField key="title" label="Big title" value={cfg.title || ''} placeholder="Welcome, Friends!" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="today is going to be amazing ✨" onChange={(v) => setField({ subtitle: v })} />);
      // Clock timezone — defaults to player's local timezone if blank.
      fields.push(
        <div key="clockTimeZone" className="space-y-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Clock timezone (blank = use player's local time)</label>
          <select
            value={cfg.clockTimeZone || ''}
            onChange={(e) => setField({ clockTimeZone: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="">Use player's local time (default)</option>
            <option value="America/New_York">Eastern (New York)</option>
            <option value="America/Chicago">Central (Chicago)</option>
            <option value="America/Denver">Mountain (Denver)</option>
            <option value="America/Phoenix">Arizona (no DST)</option>
            <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
            <option value="America/Anchorage">Alaska</option>
            <option value="Pacific/Honolulu">Hawaii</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
      );

      fields.push(SH('weather', 'Weather — auto-detected from the player'));
      fields.push(<TextField key="weatherLocation" label="ZIP code override (leave blank to auto-detect)" value={cfg.weatherLocation || ''} placeholder="auto-detect" onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<TextField key="weatherUnits" label="Units (imperial / metric)" value={cfg.weatherUnits || 'imperial'} placeholder="imperial" onChange={(v) => setField({ weatherUnits: (v.trim().toLowerCase() === 'metric' ? 'metric' : 'imperial') })} />);

      fields.push(SH('announcement', 'Big announcement (center cloud)'));
      fields.push(<TextField key="announcementLabel" label="Small label" value={cfg.announcementLabel || ''} placeholder="Big News" onChange={(v) => setField({ announcementLabel: v })} />);
      fields.push(<TextAreaField key="announcementMessage" label="Message" value={cfg.announcementMessage || ''} placeholder="Book Fair starts Monday!" onChange={(v) => setField({ announcementMessage: v })} />);

      fields.push(SH('countdown', 'Countdown — auto-counts down to a date'));
      fields.push(<TextField key="countdownLabel" label="Label (e.g. Spring Break in, Winter Break in, Graduation in)" value={cfg.countdownLabel || ''} placeholder="Field Trip in" onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(
        <div key="countdownDate" className="space-y-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Target date</label>
          <input
            type="date"
            value={cfg.countdownDate || ''}
            onChange={(e) => setField({ countdownDate: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      );

      fields.push(SH('teacher', 'Teacher of the Week (polaroid)'));
      fields.push(<TextField key="teacherRole" label="Caption above (the washi tape)" value={cfg.teacherRole || ''} placeholder="Teacher of the Week" onChange={(v) => setField({ teacherRole: v })} />);
      fields.push(<TextField key="teacherName" label="Name" value={cfg.teacherName || ''} placeholder="Mrs. Johnson" onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<AssetPickerField key="teacherPhotoUrl" label="Upload photo (recommended)" value={cfg.teacherPhotoUrl || ''} kind="image" onChange={(v) => setField({ teacherPhotoUrl: v })} />);
      fields.push(
        <div key="teacherGender" className="space-y-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Or pick an icon (used when no photo uploaded)</label>
          <div className="flex gap-2">
            {([
              { value: 'female', label: '👩‍🏫', name: 'She / Her' },
              { value: 'male',   label: '👨‍🏫', name: 'He / Him' },
            ] as const).map((opt) => {
              const selected = (cfg.teacherGender || 'female') === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setField({ teacherGender: opt.value })}
                  className={`flex-1 px-3 py-3 rounded-md border-2 transition flex flex-col items-center gap-1 ${selected ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                >
                  <span className="text-3xl leading-none">{opt.label}</span>
                  <span className="text-[11px] text-slate-600">{opt.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      );

      fields.push(SH('birthdays', 'Birthdays (balloon cluster)'));
      // Normalize to one-name-per-line for display so it's obvious how
      // to add another (just hit Enter). Save as a clean array.
      fields.push(
        <TextAreaField
          key="birthdayNames"
          label="Names — hit Enter to add another"
          value={(() => {
            const v = cfg.birthdayNames;
            if (Array.isArray(v)) return v.join('\n');
            if (typeof v === 'string') return v.split(/[\n,·]+/).map(s => s.trim()).filter(Boolean).join('\n');
            return '';
          })()}
          placeholder={'Maya\nEli\nSofia'}
          rows={5}
          onChange={(v) => setField({ birthdayNames: v.split(/[\n,·]+/).map((s: string) => s.trim()).filter(Boolean) })}
        />
      );

      fields.push(SH('ticker', 'Bottom ticker'));
      fields.push(<TextField key="tickerStamp" label="Pink label" value={cfg.tickerStamp || ''} placeholder="SCHOOL NEWS" onChange={(v) => setField({ tickerStamp: v })} />);
      fields.push(<TextAreaField key="tickerMessages" label="Scrolling messages (one per line)" value={Array.isArray(cfg.tickerMessages) ? cfg.tickerMessages.join('\n') : (cfg.tickerMessages || '')} placeholder="Welcome back, Stars!" rows={4} onChange={(v) => setField({ tickerMessages: v.split(/\n+/).filter(Boolean) })} />);
      break;
    }
    case 'ANIMATED_CAFETERIA': {
      // Cafeteria template editor. Same hotspot scroll-into-view
      // contract as ANIMATED_WELCOME (aw-section-* ids + flash on
      // activation) but with cafeteria-specific sections: Special,
      // Menu (5 day tabs, unlimited items per day), Chef, etc.
      const SH = (key: string, label: string) => (
        <div
          key={`sh-${key}`}
          id={`aw-section-${key}`}
          data-aw-section={key}
          className="aw-section-header pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 scroll-mt-24 transition-shadow"
        >
          {label}
        </div>
      );

      fields.push(SH('header', 'Header'));
      fields.push(<TextField key="title" label="Big title" value={cfg.title || ''} placeholder="LUNCH IS ON" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="~ freshly rolled every day ~" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(
        <div key="clockTimeZone" className="space-y-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Clock timezone (blank = use player's local time)</label>
          <select
            value={cfg.clockTimeZone || ''}
            onChange={(e) => setField({ clockTimeZone: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="">Use player's local time (default)</option>
            <option value="America/New_York">Eastern (New York)</option>
            <option value="America/Chicago">Central (Chicago)</option>
            <option value="America/Denver">Mountain (Denver)</option>
            <option value="America/Phoenix">Arizona (no DST)</option>
            <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
            <option value="America/Anchorage">Alaska</option>
            <option value="Pacific/Honolulu">Hawaii</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
      );

      fields.push(SH('special', "Today's Special"));
      fields.push(<TextField key="specialEmoji" label="Food emoji (🍕 🌮 🍔 🥪 🥗 🍝 🍗 🌯 🥨)" value={cfg.specialEmoji || ''} placeholder="🍕" onChange={(v) => setField({ specialEmoji: v })} />);
      fields.push(<TextField key="specialLabel" label="Small label" value={cfg.specialLabel || ''} placeholder="Pickup Special" onChange={(v) => setField({ specialLabel: v })} />);
      fields.push(<TextField key="specialName" label="Dish name" value={cfg.specialName || ''} placeholder="Cheesy Pepperoni" onChange={(v) => setField({ specialName: v })} />);

      fields.push(SH('menu', 'Weekly Menu'));
      fields.push(<WeekMenuEditor key="weekMenu" value={cfg.weekMenu} onChange={(weekMenu) => setField({ weekMenu })} />);

      fields.push(SH('countdown', 'Countdown'));
      fields.push(<TextField key="countdownEmoji" label="Event icon (🍕 🌮 🌶 🎂 🍗 etc)" value={cfg.countdownEmoji || ''} placeholder="🌮" onChange={(v) => setField({ countdownEmoji: v })} />);
      fields.push(<TextField key="countdownLabel" label="Label (e.g. Taco Tuesday in, Pizza Day in)" value={cfg.countdownLabel || ''} placeholder="Taco Tuesday in" onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(
        <div key="countdownDate" className="space-y-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Target date</label>
          <input
            type="date"
            value={cfg.countdownDate || ''}
            onChange={(e) => setField({ countdownDate: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      );

      fields.push(SH('chef', 'Lunch Chef'));
      fields.push(<TextField key="chefName" label="Chef name" value={cfg.chefName || ''} placeholder="Ms. Rodriguez" onChange={(v) => setField({ chefName: v })} />);
      fields.push(<TextField key="chefRole" label="Caption under name" value={cfg.chefRole || ''} placeholder="lunch hero of the week" onChange={(v) => setField({ chefRole: v })} />);
      fields.push(<AssetPickerField key="chefPhotoUrl" label="Upload photo (optional)" value={cfg.chefPhotoUrl || ''} kind="image" onChange={(v) => setField({ chefPhotoUrl: v })} />);
      fields.push(<TextField key="chefEmoji" label="…or pick an emoji (👩‍🍳 👨‍🍳 🧑‍🍳 🍳)" value={cfg.chefEmoji || ''} placeholder="👩‍🍳" onChange={(v) => setField({ chefEmoji: v })} />);

      fields.push(SH('birthdays', 'Birthdays'));
      fields.push(
        <TextAreaField
          key="birthdayNames"
          label="Names — hit Enter to add another"
          value={(() => {
            const v = cfg.birthdayNames;
            if (Array.isArray(v)) return v.join('\n');
            if (typeof v === 'string') return v.split(/[\n,·]+/).map(s => s.trim()).filter(Boolean).join('\n');
            return '';
          })()}
          placeholder={'Alex\nJordan\nSam'}
          rows={5}
          onChange={(v) => setField({ birthdayNames: v.split(/[\n,·]+/).map((s: string) => s.trim()).filter(Boolean) })}
        />
      );

      fields.push(SH('ticker', 'Bottom ticker'));
      fields.push(<TextField key="tickerStamp" label="Stamp text" value={cfg.tickerStamp || ''} placeholder="Café News" onChange={(v) => setField({ tickerStamp: v })} />);
      fields.push(<TextAreaField key="tickerMessages" label="Scrolling messages (one per line)" value={Array.isArray(cfg.tickerMessages) ? cfg.tickerMessages.join('\n') : (cfg.tickerMessages || '')} placeholder="Taco Tuesday tomorrow! $3.50 tacos all day" rows={4} onChange={(v) => setField({ tickerMessages: v.split(/\n+/).filter(Boolean) })} />);
      break;
    }
    default:
      // Unknown widget — fall through to JSON-only editing in Advanced
      return null;
  }

  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Content</h3>
      <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
        {fields}
      </div>
    </section>
  );
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input type="text" defaultValue={value} placeholder={placeholder}
        onBlur={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm" />
    </div>
  );
}

function TextAreaField({ label, value, placeholder, onChange, rows = 3 }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; rows?: number }) {
  // Controlled textarea — local state mirrors the incoming value so we
  // can honor external updates (undo/redo, zone switch, preset load)
  // while saving on every keystroke. Previous `defaultValue` +
  // `onBlur`-only was eating keystrokes when users clicked away via
  // keyboard shortcuts or window lost focus before blur fired, which
  // is exactly why "add a 4th line" appeared to do nothing.
  const [local, setLocal] = useState(value);
  // Sync when the prop changes (e.g. user selected a different zone).
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <textarea
        value={local}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm resize-y"
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: [string,string][]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm cursor-pointer">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Advanced — collapsible JSON Overrides (closed by default)
// ─────────────────────────────────────────────────────────
function AdvancedJson({ zone, configString, configId, updateZone }: { zone: any; configString: string; configId: string; updateZone: any }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 pl-1 text-[10px] font-bold text-slate-400/80 uppercase tracking-widest hover:text-slate-600">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced (JSON)
      </button>
      {open && (
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm">
          <p className="text-[10px] text-slate-400 mb-1.5">For power users — edit the raw config JSON. Most fields are available in the Content section above.</p>
          <textarea
            id={configId}
            rows={5}
            defaultValue={configString}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (!raw) { updateZone(zone.id, { defaultConfig: null }, true); return; }
              try {
                const parsed = JSON.parse(raw);
                updateZone(zone.id, { defaultConfig: parsed }, true);
              } catch { /* swallow */ }
            }}
            className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200/60 text-[11px] font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm resize-y"
            placeholder='{ "fontSize": 48 }'
          />
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────
// Recurring periods editor (for COUNTDOWN "lunch" mode)
// ─────────────────────────────────────────────────────────
type Period = { label: string; daysOfWeek: number[]; startTime: string };
const DOW = [
  { n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' },
  { n: 4, l: 'Th' }, { n: 5, l: 'F' }, { n: 6, l: 'Sa' }, { n: 0, l: 'Su' },
];

function PeriodsEditor({ value, onChange }: { value: Period[]; onChange: (next: Period[]) => void }) {
  const periods = value.length ? value : [];

  const update = (idx: number, patch: Partial<Period>) => {
    const next = periods.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const add = () => {
    onChange([...periods, { label: `Lunch ${periods.length + 1}`, daysOfWeek: [1, 2, 3, 4, 5], startTime: '11:30' }]);
  };
  const remove = (idx: number) => {
    onChange(periods.filter((_, i) => i !== idx));
  };
  const toggleDay = (idx: number, dow: number) => {
    const cur = periods[idx].daysOfWeek;
    const next = cur.includes(dow) ? cur.filter(d => d !== dow) : [...cur, dow].sort((a, b) => a - b);
    update(idx, { daysOfWeek: next });
  };

  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Lunch periods</label>
      <div className="space-y-2">
        {periods.length === 0 && (
          <p className="text-[11px] text-slate-400 italic px-1">No periods yet — add your first below.</p>
        )}
        {periods.map((p, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1.5 shadow-sm">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                defaultValue={p.label}
                onBlur={(e) => update(idx, { label: e.target.value })}
                placeholder="6th Grade Lunch"
                className="flex-1 px-2 py-1 text-xs font-semibold rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <input
                type="time"
                defaultValue={p.startTime}
                onBlur={(e) => update(idx, { startTime: e.target.value })}
                className="px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label="Remove period"
                className="w-7 h-7 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center text-xs"
              >
                ×
              </button>
            </div>
            <div className="flex gap-1">
              {DOW.map(({ n, l }) => {
                const active = p.daysOfWeek.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggleDay(idx, n)}
                    className={`flex-1 py-1 text-[10px] font-bold rounded transition-colors ${
                      active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-dashed border-indigo-200"
        >
          + Add period
        </button>
      </div>
      <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">
        The widget shows the time until the <strong>next upcoming period</strong>. Skips weekends if no day selected.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Toggle / Color / Asset / Playlist / BellSchedule field types
// ─────────────────────────────────────────────────────────
function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer">
      <span className="text-[10px] font-semibold text-slate-500">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-indigo-600' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  );
}

function ColorField({ label, value, onChange, allowTransparent }: { label: string; value: string; onChange: (v: string) => void; allowTransparent?: boolean }) {
  const isTransparent = value === 'transparent' || !value;
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={isTransparent ? '#ffffff' : value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-8 rounded border border-slate-200 cursor-pointer bg-white"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={allowTransparent ? 'transparent or #hex' : '#hex'}
          className="flex-1 px-2 py-1 text-xs font-mono rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        {allowTransparent && (
          <button
            type="button"
            onClick={() => onChange('transparent')}
            className="text-[10px] font-bold text-slate-500 hover:text-indigo-600 px-2 py-1 rounded border border-slate-200 hover:border-indigo-300"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// Single-asset picker — opens an inline modal of uploaded assets
function AssetPickerField({ label, value, onChange, kind }: { label: string; value: string; onChange: (v: string) => void; kind: 'image' | 'video' }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        {value ? (
          <div className="relative w-14 h-14 rounded border border-slate-200 overflow-hidden bg-slate-100 shrink-0">
            {kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveAssetUrl(value)} alt="" className="w-full h-full object-cover" />
            ) : (
              <video src={resolveAssetUrl(value)} className="w-full h-full object-cover" muted />
            )}
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center hover:bg-rose-600"
              aria-label="Clear"
            >×</button>
          </div>
        ) : (
          <div className="w-14 h-14 rounded border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] text-slate-400 shrink-0">
            None
          </div>
        )}
        <div className="flex-1 flex flex-col gap-1.5">
          <input
            type="text"
            defaultValue={value}
            onBlur={(e) => onChange(e.target.value)}
            placeholder="https://… or pick from library"
            className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="px-2 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-100"
            >
              Browse library
            </button>
            {/* Clear — reverts the widget to its default illustrated
                placeholder. Teachers kept getting stuck with a photo
                they couldn't remove; the tiny × corner badge wasn't
                discoverable enough, so this is the explicit escape. */}
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="px-2 py-1 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded border border-rose-100"
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
      </div>
      {open && (
        <AssetLibraryModal kind={kind} onPick={(url) => { onChange(url); setOpen(false); }} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

// Multi-asset list — used by IMAGE_CAROUSEL
function AssetListPickerField({ label, value, onChange, kind }: { label: string; value: string[]; onChange: (v: string[]) => void; kind: 'image' | 'video' }) {
  const [open, setOpen] = useState(false);
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = value.slice();
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="space-y-1.5">
        {value.length === 0 && <p className="text-[11px] text-slate-400 italic">No photos yet — add some below.</p>}
        {value.map((url, idx) => (
          <div key={idx} className="flex items-center gap-2 p-1.5 bg-white border border-slate-200 rounded">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolveAssetUrl(url)} alt="" className="w-10 h-10 object-cover rounded shrink-0 bg-slate-100" />
            <span className="flex-1 text-[10px] text-slate-500 truncate font-mono">{url.split('/').pop()}</span>
            <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0} className="text-[10px] text-slate-400 hover:text-indigo-600 disabled:opacity-30" aria-label="Move up">↑</button>
            <button type="button" onClick={() => remove(idx)} className="text-[10px] text-rose-500 hover:text-rose-700" aria-label="Remove">×</button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full py-1.5 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-dashed border-indigo-200"
        >
          + Add photo from library
        </button>
      </div>
      {open && (
        <AssetLibraryModal kind={kind} onPick={(url) => { onChange([...value, url]); setOpen(false); }} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function AssetLibraryModal({ kind, onPick, onClose }: { kind: 'image' | 'video'; onPick: (url: string) => void; onClose: () => void }) {
  const { data: assets, isLoading } = useAssets();
  const filtered = (assets || []).filter((a: any) => {
    const mt = (a.mimeType || '').toLowerCase();
    return kind === 'image' ? mt.startsWith('image/') : mt.startsWith('video/');
  });
  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">Pick {kind === 'image' ? 'an image' : 'a video'}</h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <XIcon className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="text-center text-xs text-slate-400 py-12">Loading library…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-12">
              No {kind === 'image' ? 'images' : 'videos'} in your library yet. Upload from <strong>Assets</strong> first.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {filtered.map((a: any) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onPick(a.fileUrl || a.url)}
                  className="group relative aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 transition-all"
                >
                  {kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveAssetUrl(a.fileUrl || a.url)} alt={a.originalName || ''} className="w-full h-full object-cover" />
                  ) : (
                    <video src={resolveAssetUrl(a.fileUrl || a.url)} className="w-full h-full object-cover" muted />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent text-white text-[9px] font-bold px-1.5 py-1 truncate">
                    {a.originalName || a.fileUrl}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function resolveAssetUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const base = (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_API_URL)
    ? process.env.NEXT_PUBLIC_API_URL.replace('/api/v1', '')
    : 'http://localhost:8080';
  return `${base}${url}`;
}

function PlaylistPickerField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { data: playlists, isLoading } = usePlaylists();
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm cursor-pointer"
      >
        <option value="">— Pick a playlist —</option>
        {(playlists || []).map((p: any) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {isLoading && <p className="text-[10px] text-slate-400 mt-1">Loading playlists…</p>}
      {!isLoading && (!playlists || playlists.length === 0) && (
        <p className="text-[10px] text-slate-400 mt-1">No playlists yet — create one in <strong>Playlists</strong>.</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Weekly cafeteria menu editor — 5 day tabs, unlimited items per day.
// Data shape: { monday: [{emoji,name,meta,price}], tuesday: [...], ... }
// The rendered cafeteria widget picks today's day via new Date().getDay()
// and shows that day's menu automatically.
// ─────────────────────────────────────────────────────────
type CafeItem = { emoji?: string; name?: string; meta?: string; price?: string };
type CafeWeek = Record<'monday'|'tuesday'|'wednesday'|'thursday'|'friday', CafeItem[]>;
const CAFE_DAYS: Array<{ key: keyof CafeWeek; label: string }> = [
  { key: 'monday',    label: 'MON' },
  { key: 'tuesday',   label: 'TUE' },
  { key: 'wednesday', label: 'WED' },
  { key: 'thursday',  label: 'THU' },
  { key: 'friday',    label: 'FRI' },
];

// Standard lunch-item emoji picker — one-click replacement for typing
// in an emoji by hand. Grouped by rough category so admins scan fast.
// Keep this list flat + readable; we can grow it by user request.
const LUNCH_EMOJI_GROUPS: Array<{ label: string; items: string[] }> = [
  { label: 'Mains',    items: ['🍕','🍔','🌮','🌯','🥪','🥙','🌭','🍝','🍜','🍣','🍱','🍗','🍖','🥘','🍲','🍛','🍳','🥚','🍞','🥖','🥐'] },
  { label: 'Sides',    items: ['🍟','🥗','🥙','🥣','🍚','🍜','🌽','🥔','🥦','🥕','🥒','🍅','🌶️','🌰','🧅','🫘','🥜','🫑'] },
  { label: 'Fruit',    items: ['🍎','🍏','🍌','🍓','🍇','🍉','🍊','🍋','🍑','🍒','🥝','🍍','🥭','🫐','🍈','🫒'] },
  { label: 'Drinks',   items: ['🥛','🧃','🧋','☕','🍵','🥤','💧'] },
  { label: 'Desserts', items: ['🍪','🧁','🎂','🍰','🍩','🍦','🍨','🍫','🍬','🍭','🥧','🍮','🍯'] },
];

// Small popover emoji+upload picker for a single item's emoji slot.
// Renders a button showing the current emoji (or a plate icon if unset)
// that toggles a 2-tab pop: pick from common lunch emojis, or upload an
// image. The cafeteria widget renders an <img> when the "emoji" field is
// a URL (starts with http or /), otherwise renders it as text — so both
// paths just write to the same `emoji` string on the item.
function LunchEmojiPicker({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const pickerRef = useRef<HTMLDivElement | null>(null);
  // Close on outside click so admins can click into the name field
  // without the picker sitting there eating focus.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = value || '';
  const isUrl = /^(https?:|\/)/i.test(current);

  return (
    <div className="relative" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-14 h-10 px-2 rounded border border-slate-200 bg-white text-center text-lg hover:border-indigo-300 hover:bg-indigo-50 transition flex items-center justify-center overflow-hidden"
        aria-label={isUrl ? 'Change uploaded image' : 'Pick food emoji or upload image'}
        title="Pick emoji / upload"
      >
        {isUrl
          ? <img src={current} alt="" className="w-full h-full object-contain" />
          : <span>{current || '🍽️'}</span>}
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 left-0 w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl p-2"
          role="dialog"
          aria-label="Food emoji / image picker"
        >
          <div className="flex gap-1 mb-2 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('emoji')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition ${
                tab === 'emoji' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              😀 Emoji
            </button>
            <button
              type="button"
              onClick={() => setTab('upload')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition ${
                tab === 'upload' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              🖼️ Upload image
            </button>
          </div>

          {tab === 'emoji' && (
            <div className="max-h-[320px] overflow-y-auto pr-1">
              {LUNCH_EMOJI_GROUPS.map((group) => (
                <div key={group.label} className="mb-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1 mb-1.5">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {group.items.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => { onChange(e); setOpen(false); }}
                        className={`text-2xl p-1 rounded-md transition ${
                          current === e ? 'bg-indigo-100 ring-2 ring-indigo-400' : 'hover:bg-slate-100'
                        }`}
                        aria-label={`Pick ${e}`}
                        title={e}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="border-t border-slate-100 pt-2 mt-1">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Or type any emoji / text</label>
                <input
                  type="text"
                  defaultValue={isUrl ? '' : current}
                  placeholder="🍱 or any emoji"
                  onBlur={(e) => onChange(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm text-center"
                />
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-2 p-1">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Upload a PNG, JPG, or SVG. Keep it square — it'll render at ~80px in the widget. Emojis still work; uploading replaces the emoji for this item only.
              </p>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  // Read as data URL so the preview updates instantly. In
                  // the production editor flow this would hand off to the
                  // existing AssetPickerField / presigned-upload endpoint;
                  // kept inline here so it works without an extra round-trip.
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = reader.result;
                    if (typeof result === 'string') {
                      onChange(result);
                      setOpen(false);
                    }
                  };
                  reader.readAsDataURL(file);
                }}
                className="w-full text-xs"
              />
              {isUrl && (
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <img src={current} alt="" className="w-10 h-10 object-contain rounded border border-slate-200" />
                  <button
                    type="button"
                    onClick={() => { onChange('🍽️'); setOpen(false); }}
                    className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold"
                  >
                    Remove image · back to emoji
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WeekMenuEditor({ value, onChange }: { value: Partial<CafeWeek> | undefined; onChange: (next: CafeWeek) => void }) {
  const [activeDay, setActiveDay] = useState<keyof CafeWeek>('monday');
  // Normalize to a full 5-day structure so we never fight undefineds.
  const week: CafeWeek = {
    monday:    value?.monday    || [],
    tuesday:   value?.tuesday   || [],
    wednesday: value?.wednesday || [],
    thursday:  value?.thursday  || [],
    friday:    value?.friday    || [],
  };
  const items = week[activeDay];

  const update = (idx: number, patch: Partial<CafeItem>) => {
    const next = { ...week, [activeDay]: week[activeDay].map((it, i) => i === idx ? { ...it, ...patch } : it) };
    onChange(next);
  };
  const add = () => {
    const next = { ...week, [activeDay]: [...week[activeDay], { emoji: '🍽️', name: '', meta: '', price: '' }] };
    onChange(next);
  };
  const remove = (idx: number) => {
    const next = { ...week, [activeDay]: week[activeDay].filter((_, i) => i !== idx) };
    onChange(next);
  };
  const copyMondayToWeek = () => {
    onChange({
      monday:    week.monday,
      tuesday:   week.monday.map(it => ({ ...it })),
      wednesday: week.monday.map(it => ({ ...it })),
      thursday:  week.monday.map(it => ({ ...it })),
      friday:    week.monday.map(it => ({ ...it })),
    });
  };

  return (
    <div className="space-y-2">
      {/* Day tabs */}
      <div className="flex gap-1">
        {CAFE_DAYS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setActiveDay(d.key)}
            className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-bold tracking-wider transition ${
              activeDay === d.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {d.label}
            <span className={`ml-1 text-[9px] opacity-70`}>({week[d.key].length})</span>
          </button>
        ))}
      </div>

      {items.length === 0 && (
        <div className="text-[11px] text-slate-400 italic px-1 py-3 text-center border border-dashed border-slate-200 rounded-md">
          No items yet. Click + Add below to start the {activeDay} menu.
        </div>
      )}

      {items.map((it, idx) => (
        <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5 shadow-sm">
          <div className="flex items-start gap-1.5">
            {/* Emoji picker: click to open a 2-tab popover (common lunch
                emojis grouped by category, or upload an image) — no more
                typing emoji by hand. The `emoji` field accepts a string
                OR a URL / data URL; the widget renders img if URL. */}
            <LunchEmojiPicker
              value={it.emoji}
              onChange={(emoji) => update(idx, { emoji })}
            />
            <input
              type="text"
              value={it.name || ''}
              placeholder="Dish name"
              onChange={(e) => update(idx, { name: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded border border-slate-200 text-xs font-semibold"
              aria-label="Dish name"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="px-2 py-1.5 rounded text-rose-500 hover:bg-rose-50 text-sm"
              aria-label={`Remove ${it.name || 'item'}`}
              title="Remove"
            >
              ×
            </button>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={it.meta || ''}
              placeholder="🌾 🧀 or veg · gf"
              onChange={(e) => update(idx, { meta: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded border border-slate-200 text-[11px]"
              aria-label="Allergens or dietary tag"
            />
            <input
              type="text"
              value={it.price || ''}
              placeholder="$3.25"
              onChange={(e) => update(idx, { price: e.target.value })}
              className="w-20 px-2 py-1.5 rounded border border-slate-200 text-[11px] text-right font-semibold"
              aria-label="Price"
            />
          </div>
        </div>
      ))}

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={add}
          className="flex-1 px-2 py-1.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold transition"
        >
          + Add item
        </button>
        {activeDay === 'monday' && week.monday.length > 0 && (
          <button
            type="button"
            onClick={copyMondayToWeek}
            className="px-2 py-1.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-semibold transition"
            title="Copy Monday's items to Tuesday through Friday"
          >
            Copy Mon → all week
          </button>
        )}
      </div>
    </div>
  );
}

function BellScheduleEditor({ value, onChange }: { value: Array<{ label: string; start: string; end?: string }>; onChange: (next: Array<{ label: string; start: string; end?: string }>) => void }) {
  const periods = value.length ? value : [];
  const update = (idx: number, patch: Partial<{ label: string; start: string; end?: string }>) => {
    const next = periods.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const add = () => onChange([...periods, { label: `Period ${periods.length + 1}`, start: '08:00', end: '08:50' }]);
  const remove = (idx: number) => onChange(periods.filter((_, i) => i !== idx));

  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Bell schedule</label>
      <div className="space-y-2">
        {periods.length === 0 && <p className="text-[11px] text-slate-400 italic px-1">No periods yet — add your first below.</p>}
        {periods.map((p, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2 flex items-center gap-1.5 shadow-sm">
            <input
              type="text"
              defaultValue={p.label}
              onBlur={(e) => update(idx, { label: e.target.value })}
              placeholder="Period 1"
              className="flex-1 px-2 py-1 text-xs font-semibold rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <input
              type="time"
              defaultValue={p.start}
              onBlur={(e) => update(idx, { start: e.target.value })}
              className="px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <span className="text-[10px] text-slate-400">→</span>
            <input
              type="time"
              defaultValue={p.end || ''}
              onBlur={(e) => update(idx, { end: e.target.value || undefined })}
              className="px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              aria-label="Remove period"
              className="w-7 h-7 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center text-xs"
            >×</button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-dashed border-indigo-200"
        >
          + Add period
        </button>
      </div>
    </div>
  );
}

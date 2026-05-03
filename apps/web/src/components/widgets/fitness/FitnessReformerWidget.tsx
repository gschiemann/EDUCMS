"use client";

/**
 * FitnessReformerWidget — 4K Pilates / Reformer studio scene, 3840x2160.
 *
 * APPROVED 2026-05-03 — matches scratch/design/fitness/12-reformer.html
 * Ported via HsStage transform:scale pattern. Every pixel size is
 * FIXED (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — boutique editorial pilates studio:
 *   - Cream #f5efe3 base + sage #8a9c7b + warm black #2a2620 + rose #c89a8a
 *   - Cormorant Garamond display + Inter body + JetBrains Mono labels
 *   - Header band with massive italic display logo + meta column
 *   - Today's flow card (left) — large heading + 9-step sequence grid
 *   - Right column: reformer assignments grid (5x2) + instructor card
 *   - Bottom ink strip with social tag + message
 *
 * Editable hotspots — every text element has a `data-field` attribute.
 * Field keys use dot notation:
 *   head.t1, head.t2, head.lab, head.v
 *   flow.pre, flow.t1, flow.t2, flow.sub, flow.n1..n9, flow.s1..s9, flow.m1..m9
 *   reformers.t1, reformers.t2, reformers.meta,
 *     reformers.n0..n9, reformers.w0..w9
 *   instr.lab, instr.ini, instr.t1, instr.t2, instr.quote
 *   foot.tag, foot.message
 */

import { useEffect, useState } from 'react';
import { HsStage } from '../hs/HsStage';

export interface FitnessReformerConfig {
  // Header
  'head.t1'?: string;
  'head.t2'?: string;
  'head.lab'?: string;
  'head.v'?: string;
  /** When true the header label auto-updates from the device clock every second. */
  liveClock?: boolean;
  // Flow
  'flow.pre'?: string;
  'flow.t1'?: string;
  'flow.t2'?: string;
  'flow.sub'?: string;
  'flow.n1'?: string;
  'flow.s1'?: string;
  'flow.m1'?: string;
  'flow.n2'?: string;
  'flow.s2'?: string;
  'flow.m2'?: string;
  'flow.n3'?: string;
  'flow.s3'?: string;
  'flow.m3'?: string;
  'flow.n4'?: string;
  'flow.s4'?: string;
  'flow.m4'?: string;
  'flow.n5'?: string;
  'flow.s5'?: string;
  'flow.m5'?: string;
  'flow.n6'?: string;
  'flow.s6'?: string;
  'flow.m6'?: string;
  'flow.n7'?: string;
  'flow.s7'?: string;
  'flow.m7'?: string;
  'flow.n8'?: string;
  'flow.s8'?: string;
  'flow.m8'?: string;
  'flow.n9'?: string;
  'flow.s9'?: string;
  'flow.m9'?: string;
  // Reformers
  'reformers.t1'?: string;
  'reformers.t2'?: string;
  'reformers.meta'?: string;
  'reformers.n0'?: string;
  'reformers.w0'?: string;
  'reformers.n1'?: string;
  'reformers.w1'?: string;
  'reformers.n2'?: string;
  'reformers.w2'?: string;
  'reformers.n3'?: string;
  'reformers.w3'?: string;
  'reformers.n4'?: string;
  'reformers.w4'?: string;
  'reformers.n5'?: string;
  'reformers.w5'?: string;
  'reformers.n6'?: string;
  'reformers.w6'?: string;
  'reformers.n7'?: string;
  'reformers.w7'?: string;
  'reformers.n8'?: string;
  'reformers.w8'?: string;
  'reformers.n9'?: string;
  'reformers.w9'?: string;
  // Instructor
  'instr.lab'?: string;
  'instr.ini'?: string;
  'instr.t1'?: string;
  'instr.t2'?: string;
  'instr.quote'?: string;
  // Foot
  'foot.tag'?: string;
  'foot.message'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  'head.t1':           'Reformer ',
  'head.t2':           '& Co.',
  'head.lab':          'TUESDAY · MARCH 18 · 6:14 AM',
  'head.v':            'Class begins at 6:30 sharp.',

  'flow.pre':          '▸ TODAY’S FLOW · CLASSICAL · 50 MIN',
  'flow.t1':           'Spine ',
  'flow.t2':           '& Stillness.',
  'flow.sub':          'A slow, articulating sequence focused on segmental control of the spine. Bring socks. Hydrate. We will work the springs lighter than you expect.',

  'flow.n1':           '01',
  'flow.s1':           'Footwork series',
  'flow.m1':           'SPRINGS · 3 RED',
  'flow.n2':           '02',
  'flow.s2':           'Hundred & coordination',
  'flow.m2':           'SPRINGS · 2 RED 1 BLUE',
  'flow.n3':           '03',
  'flow.s3':           'Short spine massage',
  'flow.m3':           'SPRINGS · 2 RED',
  'flow.n4':           '04',
  'flow.s4':           'Stomach massage',
  'flow.m4':           'SPRINGS · 3 RED 1 BLUE',
  'flow.n5':           '05',
  'flow.s5':           'Long box · pulling straps',
  'flow.m5':           'SPRINGS · 1 RED',
  'flow.n6':           '06',
  'flow.s6':           'Backstroke',
  'flow.m6':           'SPRINGS · 2 BLUE',
  'flow.n7':           '07',
  'flow.s7':           'Tendon stretch',
  'flow.m7':           'SPRINGS · 2 RED',
  'flow.n8':           '08',
  'flow.s8':           'Mermaid & closing',
  'flow.m8':           'SPRINGS · 1 BLUE',
  'flow.n9':           '09',
  'flow.s9':           'Standing roll-up',
  'flow.m9':           'OFF REFORMER',

  'reformers.t1':      'Studio ',
  'reformers.t2':      'A.',
  'reformers.meta':    '▸ 6:30 AM CLASS · 10/10 · WAITLIST 3',
  'reformers.n0':      '★ INSTR',
  'reformers.w0':      'Annika',
  'reformers.n1':      '01',
  'reformers.w1':      'Lia P.',
  'reformers.n2':      '02',
  'reformers.w2':      'Marcus B.',
  'reformers.n3':      '03',
  'reformers.w3':      'Hanna S.',
  'reformers.n4':      '04',
  'reformers.w4':      'Pia G.',
  'reformers.n5':      '05',
  'reformers.w5':      'Olu A.',
  'reformers.n6':      '06',
  'reformers.w6':      'Imani C.',
  'reformers.n7':      '07',
  'reformers.w7':      'Ravi T.',
  'reformers.n8':      '08',
  'reformers.w8':      'Maja D.',
  'reformers.n9':      '09',
  'reformers.w9':      '— hold',

  'instr.lab':         '★ TODAY’S TEACHER',
  'instr.ini':         'A',
  'instr.t1':          'Annika ',
  'instr.t2':          'Sand.',
  'instr.quote':       '"Move slowly. Breathe with the spring, not against it. The reformer is patient — be patient with yourself."',

  'foot.tag':          'SOCIAL',
  'foot.message':      'Tag the studio @reformerco — Friday’s reels feature member transformations · Late cancel cut-off is 12 hours · Thank you for being here.',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessReformerConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

function useLiveHeaderLabel(enabled: boolean, fallback: string): string {
  const [tick, setTick] = useState<string>(enabled ? formatHeaderLabel() : fallback);
  useEffect(() => {
    if (!enabled) {
      setTick(fallback);
      return;
    }
    setTick(formatHeaderLabel());
    const id = setInterval(() => setTick(formatHeaderLabel()), 1000);
    return () => clearInterval(id);
  }, [enabled, fallback]);
  return tick;
}

function formatHeaderLabel(): string {
  const d = new Date();
  const dow = d.toLocaleDateString([], { weekday: 'long' }).toUpperCase();
  const mon = d.toLocaleDateString([], { month: 'long' }).toUpperCase();
  const dom = d.getDate();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  return `★ ${dow} · ${mon} ${dom} · ${time}`;
}

export function FitnessReformerWidget({ config }: { config?: FitnessReformerConfig }) {
  const liveOn = config?.liveClock === true;
  const headerLabel = useLiveHeaderLabel(liveOn, pick(config, 'head.lab'));

  return (
    <HsStage
      stageClassName="fz-stage"
      stageStyle={{ background: '#f5efe3', color: '#2a2620', fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <style>{CSS}</style>

      {/* Header band */}
      <div className="fz-head">
        <div className="fz-lg">
          <span data-field="head.t1">{pick(config, 'head.t1')}</span>
          <em data-field="head.t2">{pick(config, 'head.t2')}</em>
        </div>
        <div className="fz-meta">
          <div className="fz-lab" data-field="head.lab">{liveOn ? headerLabel : pick(config, 'head.lab')}</div>
          <div className="fz-v" data-field="head.v">{pick(config, 'head.v')}</div>
        </div>
      </div>

      {/* Flow card (left) */}
      <div className="fz-flow">
        <div className="fz-pre" data-field="flow.pre">{pick(config, 'flow.pre')}</div>
        <h1 className="fz-h1">
          <span data-field="flow.t1">{pick(config, 'flow.t1')}</span>
          <em data-field="flow.t2">{pick(config, 'flow.t2')}</em>
        </h1>
        <div className="fz-sub" data-field="flow.sub">{pick(config, 'flow.sub')}</div>

        <div className="fz-seq">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <div className="fz-item" key={i}>
              <div className="fz-num" data-field={`flow.n${i}`}>{pick(config, `flow.n${i}` as keyof typeof DEFAULTS)}</div>
              <div className="fz-nm" data-field={`flow.s${i}`}>{pick(config, `flow.s${i}` as keyof typeof DEFAULTS)}</div>
              <div className="fz-item-meta" data-field={`flow.m${i}`}>{pick(config, `flow.m${i}` as keyof typeof DEFAULTS)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right column */}
      <div className="fz-rt">
        <div className="fz-reformers">
          <div className="fz-rh">
            <h2 className="fz-rh-h2">
              <span data-field="reformers.t1">{pick(config, 'reformers.t1')}</span>
              <em data-field="reformers.t2">{pick(config, 'reformers.t2')}</em>
            </h2>
            <div className="fz-rh-meta" data-field="reformers.meta">{pick(config, 'reformers.meta')}</div>
          </div>
          <div className="fz-grid">
            <div className="fz-r fz-host">
              <div className="fz-r-n" data-field="reformers.n0">{pick(config, 'reformers.n0')}</div>
              <div className="fz-r-who" data-field="reformers.w0">{pick(config, 'reformers.w0')}</div>
            </div>
            <div className="fz-r fz-taken">
              <div className="fz-r-n" data-field="reformers.n1">{pick(config, 'reformers.n1')}</div>
              <div className="fz-r-who" data-field="reformers.w1">{pick(config, 'reformers.w1')}</div>
            </div>
            <div className="fz-r fz-taken">
              <div className="fz-r-n" data-field="reformers.n2">{pick(config, 'reformers.n2')}</div>
              <div className="fz-r-who" data-field="reformers.w2">{pick(config, 'reformers.w2')}</div>
            </div>
            <div className="fz-r fz-taken">
              <div className="fz-r-n" data-field="reformers.n3">{pick(config, 'reformers.n3')}</div>
              <div className="fz-r-who" data-field="reformers.w3">{pick(config, 'reformers.w3')}</div>
            </div>
            <div className="fz-r fz-taken">
              <div className="fz-r-n" data-field="reformers.n4">{pick(config, 'reformers.n4')}</div>
              <div className="fz-r-who" data-field="reformers.w4">{pick(config, 'reformers.w4')}</div>
            </div>
            <div className="fz-r fz-taken">
              <div className="fz-r-n" data-field="reformers.n5">{pick(config, 'reformers.n5')}</div>
              <div className="fz-r-who" data-field="reformers.w5">{pick(config, 'reformers.w5')}</div>
            </div>
            <div className="fz-r fz-taken">
              <div className="fz-r-n" data-field="reformers.n6">{pick(config, 'reformers.n6')}</div>
              <div className="fz-r-who" data-field="reformers.w6">{pick(config, 'reformers.w6')}</div>
            </div>
            <div className="fz-r fz-taken">
              <div className="fz-r-n" data-field="reformers.n7">{pick(config, 'reformers.n7')}</div>
              <div className="fz-r-who" data-field="reformers.w7">{pick(config, 'reformers.w7')}</div>
            </div>
            <div className="fz-r fz-taken">
              <div className="fz-r-n" data-field="reformers.n8">{pick(config, 'reformers.n8')}</div>
              <div className="fz-r-who" data-field="reformers.w8">{pick(config, 'reformers.w8')}</div>
            </div>
            <div className="fz-r fz-empty">
              <div className="fz-r-n" data-field="reformers.n9">{pick(config, 'reformers.n9')}</div>
              <div className="fz-r-who" data-field="reformers.w9">{pick(config, 'reformers.w9')}</div>
            </div>
          </div>
        </div>

        <div className="fz-instr">
          <div className="fz-instr-lab" data-field="instr.lab">{pick(config, 'instr.lab')}</div>
          <div className="fz-instr-row">
            <div className="fz-ph" data-field="instr.ini">{pick(config, 'instr.ini')}</div>
            <div>
              <div className="fz-instr-nm">
                <span data-field="instr.t1">{pick(config, 'instr.t1')}</span>
                <em data-field="instr.t2">{pick(config, 'instr.t2')}</em>
              </div>
              <div className="fz-instr-quote" data-field="instr.quote">{pick(config, 'instr.quote')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Foot */}
      <div className="fz-foot">
        <div className="fz-foot-tag" data-field="foot.tag">{pick(config, 'foot.tag')}</div>
        <div data-field="foot.message">{pick(config, 'foot.message')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

.fz-stage {
  background: #f5efe3;
}
.fz-stage::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(circle at 80% 10%, rgba(138,156,123,.10), transparent 50%),
    radial-gradient(circle at 10% 90%, rgba(200,154,138,.08), transparent 50%);
}

/* Header band */
.fz-head {
  position: absolute; top: 0; left: 0; right: 0; height: 280px;
  padding: 50px 120px; display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 2px solid #2a2620;
}
.fz-lg {
  font-family: 'Cormorant Garamond'; font-size: 140px; line-height: .85; letter-spacing: -.02em;
}
.fz-lg em { font-style: italic; color: #5e6e51; }
.fz-meta { text-align: right; }
.fz-lab {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .32em; color: #7a6e5c;
}
.fz-v {
  font-family: 'Cormorant Garamond'; font-style: italic; font-size: 60px; color: #2a2620;
}

/* Flow card (left) */
.fz-flow { position: absolute; top: 340px; left: 120px; width: 1900px; }
.fz-pre {
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .36em; color: #5e6e51;
}
.fz-h1 {
  font-family: 'Cormorant Garamond'; font-size: 300px; line-height: .85; letter-spacing: -.04em;
  margin: 30px 0 0; font-weight: 400;
}
.fz-h1 em { font-style: italic; color: #5e6e51; }
.fz-sub {
  font-family: 'Cormorant Garamond'; font-style: italic; font-size: 64px;
  color: #7a6e5c; margin-top: 40px; max-width: 1700px; line-height: 1.2;
}

.fz-seq {
  margin-top: 60px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px 50px;
}
.fz-item { border-top: 2px solid #2a2620; padding: 18px 4px 0; }
.fz-num {
  font-family: 'JetBrains Mono'; font-size: 28px; letter-spacing: .18em; color: #5e6e51;
}
.fz-nm {
  font-family: 'Cormorant Garamond'; font-size: 60px; line-height: .95; margin-top: 6px;
}
.fz-item-meta {
  font-family: 'JetBrains Mono'; font-size: 24px; color: #7a6e5c;
  margin-top: 8px; letter-spacing: .1em;
}

/* Right column */
.fz-rt {
  position: absolute; top: 340px; right: 120px; width: 1500px;
  display: flex; flex-direction: column; gap: 36px;
}

.fz-reformers {
  background: #fff; border: 2px solid #2a2620; padding: 40px 48px;
}
.fz-rh {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid #2a2620; padding-bottom: 14px; margin-bottom: 20px;
}
.fz-rh-h2 {
  font-family: 'Cormorant Garamond'; font-size: 74px; margin: 0; line-height: .9;
}
.fz-rh-h2 em { font-style: italic; color: #5e6e51; }
.fz-rh-meta {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .18em; color: #7a6e5c;
}
.fz-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px;
}
.fz-r {
  aspect-ratio: 4 / 5; border: 2px solid #2a2620; padding: 14px;
  position: relative; display: flex; flex-direction: column; justify-content: space-between;
}
.fz-r-n {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .18em; color: #7a6e5c;
}
.fz-r-who {
  font-family: 'Cormorant Garamond'; font-size: 36px; line-height: .95;
}
.fz-r.fz-taken { background: #8a9c7b; color: #fff; border-color: #5e6e51; }
.fz-r.fz-taken .fz-r-n { color: rgba(255,255,255,.8); }
.fz-r.fz-empty { background: #e8dcc4; border-style: dashed; }
.fz-r.fz-empty .fz-r-who { font-style: italic; color: #7a6e5c; font-size: 30px; }
.fz-r.fz-host { background: #2a2620; color: #f5efe3; border-color: #2a2620; }
.fz-r.fz-host .fz-r-n { color: #c89a8a; }

.fz-instr {
  background: #2a2620; color: #f5efe3; padding: 40px 48px;
}
.fz-instr-lab {
  font-family: 'JetBrains Mono'; font-size: 26px; letter-spacing: .32em; color: #c89a8a;
}
.fz-instr-row {
  display: flex; gap: 32px; align-items: center; margin-top: 20px;
}
.fz-ph {
  width: 200px; height: 200px; border-radius: 50%; background: #c89a8a; flex: none;
  display: grid; place-items: center;
  font-family: 'Cormorant Garamond'; font-size: 130px; color: #2a2620; font-style: italic;
}
.fz-instr-nm {
  font-family: 'Cormorant Garamond'; font-size: 90px; line-height: .85;
}
.fz-instr-nm em { font-style: italic; color: #c89a8a; }
.fz-instr-quote {
  font-family: 'Cormorant Garamond'; font-style: italic; font-size: 38px;
  line-height: 1.3; margin-top: 20px; color: #e8dcc4;
}

/* Foot */
.fz-foot {
  position: absolute; left: 0; right: 0; bottom: 0; height: 140px;
  background: #2a2620; color: #f5efe3;
  display: flex; align-items: center; padding: 0 120px; gap: 60px;
  font-family: 'Cormorant Garamond'; font-size: 54px; font-style: italic; letter-spacing: -.01em;
}
.fz-foot-tag {
  background: #c89a8a; color: #2a2620; padding: 10px 24px;
  font-family: 'JetBrains Mono'; font-size: 28px; letter-spacing: .3em; font-style: normal;
}
`;

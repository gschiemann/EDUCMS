"use client";

/**
 * FitnessTelemetryWidget - 4K performance-lab telemetry scene, 3840x2160.
 *
 * Source: scratch/design/fitness/08-telemetry.html
 * Ported via HsStage transform:scale pattern. Every pixel size is FIXED
 * (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA - sports-science / data-monitor aesthetic:
 *   - Phosphor green #3effa3 on near-black #020a06 base
 *   - 80px grid + 4px scanline overlay
 *   - JetBrains Mono body + Archivo Black display
 *   - Top status ribbon (logo + crumbs + blinking clock cursor)
 *   - Athlete profile card top-left (1100x760)
 *   - 2x2 live readout grid right (HR/POWER/CADENCE/VO2)
 *   - 5-zone training-zones bar above bottom log
 *   - Bottom 6-column event log
 *
 * Editable hotspots use dot-notation `data-field` keys matching the HTML:
 *   top.t1, top.t2, top.crumbs, top.clk
 *   ath.lab, ath.id, ath.ini, ath.t1, ath.t2, ath.meta
 *   ath.l1..l6, ath.v1..v6, ath.u1..u6
 *   live.l1..l4, live.v1..v4, live.u1..u4
 *   zones.t1, zones.t2, zones.meta, zones.l1..l5,
 *     zones.n1..n5, zones.r1..r5, zones.now, zones.key
 *   log.h, log.t1..t6, log.m1..m6
 */

import { useEffect, useState } from 'react';
import { HsStage } from '../hs/HsStage';

export interface FitnessTelemetryConfig {
  // Top bar
  'top.t1'?: string;
  'top.t2'?: string;
  'top.crumbs'?: string;
  'top.clk'?: string;
  /** When true the clock auto-updates from the device clock every second. */
  liveClock?: boolean;
  // Athlete profile
  'ath.lab'?: string;
  'ath.id'?: string;
  'ath.ini'?: string;
  'ath.t1'?: string;
  'ath.t2'?: string;
  'ath.meta'?: string;
  'ath.l1'?: string;
  'ath.v1'?: string;
  'ath.u1'?: string;
  'ath.l2'?: string;
  'ath.v2'?: string;
  'ath.u2'?: string;
  'ath.l3'?: string;
  'ath.v3'?: string;
  'ath.u3'?: string;
  'ath.l4'?: string;
  'ath.v4'?: string;
  'ath.u4'?: string;
  'ath.l5'?: string;
  'ath.v5'?: string;
  'ath.u5'?: string;
  'ath.l6'?: string;
  'ath.v6'?: string;
  'ath.u6'?: string;
  // Live readouts
  'live.l1'?: string;
  'live.v1'?: string;
  'live.u1'?: string;
  'live.l2'?: string;
  'live.v2'?: string;
  'live.u2'?: string;
  'live.l3'?: string;
  'live.v3'?: string;
  'live.u3'?: string;
  'live.l4'?: string;
  'live.v4'?: string;
  'live.u4'?: string;
  // Zones
  'zones.t1'?: string;
  'zones.t2'?: string;
  'zones.meta'?: string;
  'zones.l1'?: string;
  'zones.n1'?: string;
  'zones.r1'?: string;
  'zones.l2'?: string;
  'zones.n2'?: string;
  'zones.r2'?: string;
  'zones.l3'?: string;
  'zones.n3'?: string;
  'zones.r3'?: string;
  'zones.l4'?: string;
  'zones.n4'?: string;
  'zones.r4'?: string;
  'zones.l5'?: string;
  'zones.n5'?: string;
  'zones.r5'?: string;
  'zones.now'?: string;
  'zones.key'?: string;
  // Event log
  'log.h'?: string;
  'log.t1'?: string;
  'log.m1'?: string;
  'log.t2'?: string;
  'log.m2'?: string;
  'log.t3'?: string;
  'log.m3'?: string;
  'log.t4'?: string;
  'log.m4'?: string;
  'log.t5'?: string;
  'log.m5'?: string;
  'log.t6'?: string;
  'log.m6'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  'top.t1':       'tele',
  'top.t2':       '_metry',
  'top.crumbs':   '▸ LAB 04 · TEST VO2_MAX_RAMP · OPERATOR DR. OKAFOR',
  'top.clk':      '06:14:22',

  'ath.lab':      '▸ ATHLETE_PROFILE',
  'ath.id':       'SUBJ_0488 · CLEARED',
  'ath.ini':      'JT',
  'ath.t1':       'JOSE_',
  'ath.t2':       'TRAN',
  'ath.meta':     '▸ AGE 27 · SEX M · 178cm · 71.4kg | ▸ EVENT 5K · CLUB NORTHGATE TC | ▸ LAST_TEST 2024-11-08 · NOTES Z2 BUILD WK 7/12',
  'ath.l1':       'RESTING_HR',
  'ath.v1':       '42',
  'ath.u1':       'BPM',
  'ath.l2':       'LACTATE_THR',
  'ath.v2':       '168',
  'ath.u2':       'BPM @ 4mmol',
  'ath.l3':       'VO2_MAX',
  'ath.v3':       '62.4',
  'ath.u3':       'ml/kg/min',
  'ath.l4':       'FTP',
  'ath.v4':       '298',
  'ath.u4':       'W',
  'ath.l5':       '5K_PR',
  'ath.v5':       '17:08',
  'ath.u5':       '2024-08',
  'ath.l6':       'SLEEP_AVG',
  'ath.v6':       '7.4',
  'ath.u6':       'HR · 7D',

  'live.l1':      '▸ HEART_RATE · LIVE',
  'live.v1':      '164',
  'live.u1':      'BPM · ZONE 4 · CLIMBING',
  'live.l2':      '▸ POWER · 30S_AVG',
  'live.v2':      '312',
  'live.u2':      'W · 1.05 IF · STAGE 7/10',
  'live.l3':      '▸ CADENCE',
  'live.v3':      '94',
  'live.u3':      'RPM · TARGET 90–95',
  'live.l4':      '▸ VO2 · LIVE',
  'live.v4':      '58.7',
  'live.u4':      'ml/kg/min · 94% PEAK',

  'zones.t1':     'TRAINING_',
  'zones.t2':     'ZONES.',
  'zones.meta':   '▸ HR_BASED · MAX 192 BPM · UPDATED 2024-11-08',
  'zones.l1':     'Z1 · RECOVERY',
  'zones.n1':     'EASY',
  'zones.r1':     '96–115',
  'zones.l2':     'Z2 · ENDURANCE',
  'zones.n2':     'AEROBIC',
  'zones.r2':     '115–138',
  'zones.l3':     'Z3 · TEMPO',
  'zones.n3':     'STEADY',
  'zones.r3':     '138–158',
  'zones.l4':     'Z4 · THRESHOLD',
  'zones.n4':     'HARD',
  'zones.r4':     '158–175',
  'zones.l5':     'Z5 · VO2 MAX',
  'zones.n5':     'MAX',
  'zones.r5':     '175–192',
  'zones.now':    '▸ NOW',
  'zones.key':    '▸ TIME-IN-ZONE · TODAY · Z1 8m / Z2 12m / Z3 18m / Z4 11m / Z5 4m',

  'log.h':        '▸ EVENT_LOG · LAST_60_MIN',
  'log.t1':       '06:11:42',
  'log.m1':       'stage_8 → RAMP+25W',
  'log.t2':       '06:09:18',
  'log.m2':       'lactate sample 4 · 3.8 mmol',
  'log.t3':       '06:06:55',
  'log.m3':       'RPE prompt → subj 16/20',
  'log.t4':       '06:04:01',
  'log.m4':       'stage_7 → RAMP+25W',
  'log.t5':       '06:00:30',
  'log.m5':       'mask seal verified · OK',
  'log.t6':       '05:58:12',
  'log.m6':       'test_start → VO2_RAMP',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessTelemetryConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

function useLiveClock(enabled: boolean): string | null {
  const [tick, setTick] = useState<string | null>(() => (enabled ? formatLiveClock() : null));
  useEffect(() => {
    if (!enabled) return;
    setTick(formatLiveClock());
    const id = setInterval(() => setTick(formatLiveClock()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return tick;
}

function formatLiveClock(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function FitnessTelemetryWidget({ config }: { config?: FitnessTelemetryConfig }) {
  const liveClk = useLiveClock(config?.liveClock !== false);
  const clkText = liveClk ?? pick(config, 'top.clk');

  return (
    <HsStage
      stageClassName="ft-stage"
      stageStyle={{ background: '#020a06', color: '#9bff9b', fontFamily: "'JetBrains Mono', monospace" }}
    >
      <style>{CSS}</style>

      {/* Top status bar */}
      <div className="ft-top">
        <div className="ft-lg">
          <span data-field="top.t1">{pick(config, 'top.t1')}</span>
          <em data-field="top.t2">{pick(config, 'top.t2')}</em>
        </div>
        <div className="ft-crumbs" data-field="top.crumbs">{pick(config, 'top.crumbs')}</div>
        <div className="ft-clk">
          <span data-field="top.clk">{clkText}</span>
          <span className="ft-blink">_</span>
        </div>
      </div>

      {/* Athlete profile (left) */}
      <div className="ft-ath">
        <div className="ft-ath-hd">
          <div className="ft-ath-lab" data-field="ath.lab">{pick(config, 'ath.lab')}</div>
          <div className="ft-ath-id" data-field="ath.id">{pick(config, 'ath.id')}</div>
        </div>
        <div className="ft-ath-row">
          <div className="ft-ph">
            <span className="ft-corn ft-tl" />
            <span className="ft-corn ft-tr" />
            <span className="ft-corn ft-bl" />
            <span className="ft-corn ft-br" />
            <span className="ft-ini" data-field="ath.ini">{pick(config, 'ath.ini')}</span>
          </div>
          <div className="ft-info">
            <div className="ft-nm">
              <span data-field="ath.t1">{pick(config, 'ath.t1')}</span>
              <em data-field="ath.t2">{pick(config, 'ath.t2')}</em>
            </div>
            <div className="ft-meta" data-field="ath.meta">{pick(config, 'ath.meta')}</div>
          </div>
        </div>
        <div className="ft-grid">
          <div className="ft-c">
            <div className="ft-c-l" data-field="ath.l1">{pick(config, 'ath.l1')}</div>
            <div className="ft-c-v" data-field="ath.v1">{pick(config, 'ath.v1')}</div>
            <div className="ft-c-u" data-field="ath.u1">{pick(config, 'ath.u1')}</div>
          </div>
          <div className="ft-c">
            <div className="ft-c-l" data-field="ath.l2">{pick(config, 'ath.l2')}</div>
            <div className="ft-c-v" data-field="ath.v2">{pick(config, 'ath.v2')}</div>
            <div className="ft-c-u" data-field="ath.u2">{pick(config, 'ath.u2')}</div>
          </div>
          <div className="ft-c">
            <div className="ft-c-l" data-field="ath.l3">{pick(config, 'ath.l3')}</div>
            <div className="ft-c-v" data-field="ath.v3">{pick(config, 'ath.v3')}</div>
            <div className="ft-c-u" data-field="ath.u3">{pick(config, 'ath.u3')}</div>
          </div>
          <div className="ft-c">
            <div className="ft-c-l" data-field="ath.l4">{pick(config, 'ath.l4')}</div>
            <div className="ft-c-v" data-field="ath.v4">{pick(config, 'ath.v4')}</div>
            <div className="ft-c-u" data-field="ath.u4">{pick(config, 'ath.u4')}</div>
          </div>
          <div className="ft-c">
            <div className="ft-c-l" data-field="ath.l5">{pick(config, 'ath.l5')}</div>
            <div className="ft-c-v" data-field="ath.v5">{pick(config, 'ath.v5')}</div>
            <div className="ft-c-u" data-field="ath.u5">{pick(config, 'ath.u5')}</div>
          </div>
          <div className="ft-c">
            <div className="ft-c-l" data-field="ath.l6">{pick(config, 'ath.l6')}</div>
            <div className="ft-c-v" data-field="ath.v6">{pick(config, 'ath.v6')}</div>
            <div className="ft-c-u" data-field="ath.u6">{pick(config, 'ath.u6')}</div>
          </div>
        </div>
      </div>

      {/* Live readouts (right grid) */}
      <div className="ft-live">
        <div className="ft-met ft-hr">
          <div className="ft-met-l" data-field="live.l1">{pick(config, 'live.l1')}</div>
          <div className="ft-met-v" data-field="live.v1">{pick(config, 'live.v1')}</div>
          <div className="ft-met-u" data-field="live.u1">{pick(config, 'live.u1')}</div>
          <div className="ft-wave" />
        </div>
        <div className="ft-met ft-pw">
          <div className="ft-met-l" data-field="live.l2">{pick(config, 'live.l2')}</div>
          <div className="ft-met-v" data-field="live.v2">{pick(config, 'live.v2')}</div>
          <div className="ft-met-u" data-field="live.u2">{pick(config, 'live.u2')}</div>
        </div>
        <div className="ft-met ft-ca">
          <div className="ft-met-l" data-field="live.l3">{pick(config, 'live.l3')}</div>
          <div className="ft-met-v" data-field="live.v3">{pick(config, 'live.v3')}</div>
          <div className="ft-met-u" data-field="live.u3">{pick(config, 'live.u3')}</div>
        </div>
        <div className="ft-met ft-vo">
          <div className="ft-met-l" data-field="live.l4">{pick(config, 'live.l4')}</div>
          <div className="ft-met-v" data-field="live.v4">{pick(config, 'live.v4')}</div>
          <div className="ft-met-u" data-field="live.u4">{pick(config, 'live.u4')}</div>
        </div>
      </div>

      {/* Training zones */}
      <div className="ft-zones">
        <div className="ft-zones-h">
          <div className="ft-zones-ti">
            <span data-field="zones.t1">{pick(config, 'zones.t1')}</span>
            <em data-field="zones.t2">{pick(config, 'zones.t2')}</em>
          </div>
          <div className="ft-zones-meta" data-field="zones.meta">{pick(config, 'zones.meta')}</div>
        </div>
        <div className="ft-zones-row">
          <div className="ft-z">
            <div className="ft-z-lab" data-field="zones.l1">{pick(config, 'zones.l1')}</div>
            <div className="ft-z-nm" data-field="zones.n1">{pick(config, 'zones.n1')}</div>
            <div className="ft-z-rng" data-field="zones.r1">{pick(config, 'zones.r1')}</div>
          </div>
          <div className="ft-z">
            <div className="ft-z-lab" data-field="zones.l2">{pick(config, 'zones.l2')}</div>
            <div className="ft-z-nm" data-field="zones.n2">{pick(config, 'zones.n2')}</div>
            <div className="ft-z-rng" data-field="zones.r2">{pick(config, 'zones.r2')}</div>
          </div>
          <div className="ft-z">
            <div className="ft-z-lab" data-field="zones.l3">{pick(config, 'zones.l3')}</div>
            <div className="ft-z-nm" data-field="zones.n3">{pick(config, 'zones.n3')}</div>
            <div className="ft-z-rng" data-field="zones.r3">{pick(config, 'zones.r3')}</div>
          </div>
          <div className="ft-z ft-z-hot">
            <div className="ft-z-lab" data-field="zones.l4">{pick(config, 'zones.l4')}</div>
            <div className="ft-z-nm" data-field="zones.n4">{pick(config, 'zones.n4')}</div>
            <div className="ft-z-rng" data-field="zones.r4">{pick(config, 'zones.r4')}</div>
            <div className="ft-z-now" data-field="zones.now">{pick(config, 'zones.now')}</div>
          </div>
          <div className="ft-z">
            <div className="ft-z-lab" data-field="zones.l5">{pick(config, 'zones.l5')}</div>
            <div className="ft-z-nm" data-field="zones.n5">{pick(config, 'zones.n5')}</div>
            <div className="ft-z-rng" data-field="zones.r5">{pick(config, 'zones.r5')}</div>
          </div>
        </div>
        <div className="ft-bar">
          <span className="ft-b1" />
          <span className="ft-b2" />
          <span className="ft-b3" />
          <span className="ft-b4" />
          <span className="ft-b5" />
        </div>
        <div className="ft-key" data-field="zones.key">{pick(config, 'zones.key')}</div>
      </div>

      {/* Bottom event log */}
      <div className="ft-log">
        <div className="ft-log-h" data-field="log.h">{pick(config, 'log.h')}</div>
        <div className="ft-e">
          <b data-field="log.t1">{pick(config, 'log.t1')}</b>
          <span data-field="log.m1">{pick(config, 'log.m1')}</span>
        </div>
        <div className="ft-e">
          <b data-field="log.t2">{pick(config, 'log.t2')}</b>
          <span data-field="log.m2">{pick(config, 'log.m2')}</span>
        </div>
        <div className="ft-e">
          <b data-field="log.t3">{pick(config, 'log.t3')}</b>
          <span data-field="log.m3">{pick(config, 'log.m3')}</span>
        </div>
        <div className="ft-e">
          <b data-field="log.t4">{pick(config, 'log.t4')}</b>
          <span data-field="log.m4">{pick(config, 'log.m4')}</span>
        </div>
        <div className="ft-e">
          <b data-field="log.t5">{pick(config, 'log.t5')}</b>
          <span data-field="log.m5">{pick(config, 'log.m5')}</span>
        </div>
        <div className="ft-e">
          <b data-field="log.t6">{pick(config, 'log.t6')}</b>
          <span data-field="log.m6">{pick(config, 'log.m6')}</span>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@400;700;900&display=swap');

.ft-stage {
  background: #020a06;
  color: #9bff9b;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
}
.ft-stage::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(0deg, rgba(62,255,163,.12) 0 1px, transparent 1px 80px),
    linear-gradient(90deg, rgba(62,255,163,.12) 0 1px, transparent 1px 80px);
}
.ft-stage::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 2px, transparent 2px 4px);
  mix-blend-mode: multiply;
}

.ft-top {
  position: absolute; top: 0; left: 0; right: 0; height: 140px;
  border-bottom: 2px solid #3effa3;
  padding: 0 80px;
  display: flex; align-items: center; gap: 48px;
  background: rgba(2,10,6,.8);
}
.ft-lg {
  font-family: 'Archivo Black'; font-size: 80px;
  color: #3effa3; letter-spacing: -.02em; line-height: 1;
}
.ft-lg em { font-style: normal; color: #9bff9b; }
.ft-crumbs { font-size: 30px; letter-spacing: .18em; color: #3e7a52; }
.ft-clk {
  margin-left: auto;
  font-family: 'Archivo Black'; font-size: 90px;
  color: #3effa3; line-height: 1; letter-spacing: -.02em;
}
.ft-blink { animation: ft-blink 1s step-end infinite; }
@keyframes ft-blink { 50% { opacity: 0; } }

/* Athlete profile */
.ft-ath {
  position: absolute; top: 180px; left: 80px;
  width: 1100px; height: 760px;
  border: 2px solid #3effa3;
  padding: 40px 50px;
  background: rgba(10,58,24,.2);
}
.ft-ath-hd {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 2px solid #3effa3; padding-bottom: 14px;
}
.ft-ath-lab { font-size: 28px; letter-spacing: .3em; }
.ft-ath-id { font-size: 28px; color: #ffb74d; letter-spacing: .18em; }
.ft-ath-row { display: flex; gap: 36px; margin-top: 30px; align-items: flex-start; }
.ft-ph {
  width: 280px; height: 280px;
  border: 3px solid #3effa3; flex: none;
  position: relative; background: #0a3a18;
  display: grid; place-items: center;
}
.ft-ini {
  font-family: 'Archivo Black'; font-size: 130px; color: #3effa3;
}
.ft-corn {
  position: absolute; width: 30px; height: 30px;
  border: 3px solid #9bff9b;
}
.ft-corn.ft-tl { top: -3px; left: -3px; border-right: 0; border-bottom: 0; }
.ft-corn.ft-tr { top: -3px; right: -3px; border-left: 0; border-bottom: 0; }
.ft-corn.ft-bl { bottom: -3px; left: -3px; border-right: 0; border-top: 0; }
.ft-corn.ft-br { bottom: -3px; right: -3px; border-left: 0; border-top: 0; }
.ft-info { flex: 1; }
.ft-nm {
  font-family: 'Archivo Black'; font-size: 90px;
  line-height: .9; letter-spacing: -.02em; color: #9bff9b;
}
.ft-nm em { font-style: normal; color: #3effa3; }
.ft-meta {
  font-size: 28px; letter-spacing: .15em;
  color: #3e7a52; margin-top: 14px; line-height: 1.5;
}
.ft-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 18px; margin-top: 30px;
}
.ft-c { border: 1px solid #3effa3; padding: 14px 18px; }
.ft-c-l { font-size: 22px; letter-spacing: .22em; color: #3e7a52; }
.ft-c-v {
  font-family: 'Archivo Black'; font-size: 60px;
  line-height: .9; color: #3effa3; margin-top: 4px;
}
.ft-c-u { font-size: 20px; color: #3e7a52; letter-spacing: .15em; }

/* Live readouts */
.ft-live {
  position: absolute; top: 180px; right: 80px;
  width: 1380px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
}
.ft-met {
  border: 2px solid #3effa3; padding: 30px 38px;
  background: rgba(10,58,24,.2); position: relative;
}
.ft-met-l { font-size: 26px; letter-spacing: .28em; color: #3e7a52; }
.ft-met-v {
  font-family: 'Archivo Black'; font-size: 200px;
  line-height: .85; letter-spacing: -.04em; margin-top: 8px;
}
.ft-met-u { font-size: 28px; letter-spacing: .18em; color: #9bff9b; }
.ft-hr .ft-met-v { color: #ff5050; }
.ft-pw .ft-met-v { color: #3effa3; }
.ft-ca .ft-met-v { color: #ffb74d; }
.ft-vo .ft-met-v { color: #9bff9b; }

/* Heart wave under HR */
.ft-wave {
  position: absolute; left: 0; right: 0; bottom: 0; height: 6px;
  background: #0a3a18;
}
.ft-wave::after {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 30%;
  background: #ff5050; animation: ft-pulse 1.6s ease-in-out infinite;
}
@keyframes ft-pulse {
  0%, 100% { width: 30%; }
  50% { width: 75%; }
}

/* Zones */
.ft-zones {
  position: absolute; left: 80px; right: 80px; bottom: 280px;
  height: 320px;
  border: 2px solid #3effa3; padding: 30px 40px;
  background: rgba(10,58,24,.2);
}
.ft-zones-h {
  display: flex; justify-content: space-between; align-items: baseline;
}
.ft-zones-ti {
  font-family: 'Archivo Black'; font-size: 60px;
  color: #9bff9b; letter-spacing: -.02em;
}
.ft-zones-ti em { font-style: normal; color: #3effa3; }
.ft-zones-meta { font-size: 26px; letter-spacing: .22em; color: #3e7a52; }
.ft-zones-row {
  display: grid; grid-template-columns: repeat(5, 1fr);
  gap: 14px; margin-top: 24px;
}
.ft-z { padding: 18px 22px; border: 1px solid #3effa3; position: relative; }
.ft-z-lab { font-size: 24px; letter-spacing: .22em; color: #3e7a52; }
.ft-z-nm {
  font-family: 'Archivo Black'; font-size: 42px;
  color: #9bff9b; margin-top: 6px; line-height: .95;
}
.ft-z-rng {
  font-size: 30px; color: #3effa3; letter-spacing: .1em;
  margin-top: 8px; font-weight: 700;
}
.ft-z.ft-z-hot {
  background: rgba(255,80,80,.16); border-color: #ff5050;
}
.ft-z.ft-z-hot .ft-z-nm,
.ft-z.ft-z-hot .ft-z-rng { color: #ff5050; }
.ft-z-now {
  position: absolute; top: 14px; right: 14px;
  font-size: 22px; letter-spacing: .22em;
  padding: 4px 10px; background: #ff5050; color: #000;
}
.ft-bar {
  margin-top: 24px; height: 50px;
  background: #0a1f12; border: 1px solid #3effa3;
  display: flex;
}
.ft-bar span { display: block; }
.ft-b1 { width: 14%; background: #7a8aa8; }
.ft-b2 { width: 22%; background: #3effa3; }
.ft-b3 { width: 34%; background: #ffb74d; }
.ft-b4 { width: 22%; background: #ff5050; }
.ft-b5 { width: 8%;  background: #fff; }
.ft-key {
  display: flex; gap: 30px; margin-top: 14px;
  font-size: 24px; letter-spacing: .18em; color: #3e7a52;
}

/* Event log */
.ft-log {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: 240px;
  background: rgba(10,58,24,.5);
  border-top: 2px solid #3effa3;
  padding: 20px 80px;
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 24px;
}
.ft-log-h {
  grid-column: 1 / -1;
  font-size: 26px; letter-spacing: .28em; color: #3effa3;
  border-bottom: 1px solid #3effa3; padding-bottom: 8px;
}
.ft-e {
  font-size: 24px; letter-spacing: .1em; line-height: 1.5;
  color: #9bff9b;
}
.ft-e b {
  color: #3effa3; display: block;
  font-size: 22px; letter-spacing: .18em;
}
.ft-e i { font-style: normal; color: #ffb74d; }
`;

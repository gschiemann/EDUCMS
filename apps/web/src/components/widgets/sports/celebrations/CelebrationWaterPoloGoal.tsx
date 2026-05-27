'use client';

/**
 * CelebrationWaterPoloGoal — Canvas2D port of the design-day water-
 * polo GOAL cinematic (scratch/design/celebration-waterpolo-goal-v1.html).
 *
 * The IIFE from the HTML file is preserved verbatim in `runCinematic`
 * below — same timings, same particle math, same draw routines. Only
 * change is the React shell that owns the canvas + cleans up on unmount.
 *
 * Renders at 1920×1080 NATIVE, CSS-scales to fill the parent container.
 * The ribbon zone is much shorter than the design canvas (250-300px
 * tall vs 1080px), so the scene reads as letterboxed but still
 * recognizable — the same way `transform: scale()` works for every
 * other VenueOS scoreboard widget. For full-screen scoreboard cue use
 * the scene fills naturally.
 *
 * Auto-plays once on mount + auto-stops at end (~4.3s total). Caller is
 * expected to unmount the component after the hold; the parent
 * CueOverlay already does this via its `cueTimer` ref.
 *
 * Props:
 *   team       — hex color for team accent (default cyan)
 *   homeName   — score line home label (default "HOME")
 *   awayName   — score line away label (default "AWAY")
 *   homeScore  — number for the score line (default 0)
 *   awayScore  — number (default 0)
 *   segmentLabel — "4TH" / "Q2" / etc (default "")
 *   width / height — measured by parent; canvas internal stays 1920×1080
 */

import { useEffect, useRef } from 'react';

export interface CelebrationWaterPoloGoalProps {
  team?: string;
  homeName?: string;
  awayName?: string;
  homeScore?: number;
  awayScore?: number;
  segmentLabel?: string;
  /** When set, hide the scoreline band entirely (useful on ribbon
   *  zones where the scoreboard widget already shows the score). */
  hideScoreline?: boolean;
}

export function CelebrationWaterPoloGoal({
  team = '#21e6ff',
  homeName = 'HOME',
  awayName = 'AWAY',
  homeScore = 0,
  awayScore = 0,
  segmentLabel = '',
  hideScoreline = false,
}: CelebrationWaterPoloGoalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const W = 1920;
    const H = 1080;
    let rafId = 0;
    let startMs = 0;
    let prevMs = 0;
    let firedBurst = false;
    let cancelled = false;

    // ─── Verbatim port of the celebration-waterpolo-goal-v1.html IIFE ─
    let TEAM = team;
    function hexToRgb(h: string): [number, number, number] {
      h = h.replace('#', '');
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function rgba(c: [number, number, number], a: number) {
      return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    }
    function lighten(c: [number, number, number], f: number): [number, number, number] {
      return [
        Math.min(255, c[0] + (255 - c[0]) * f) | 0,
        Math.min(255, c[1] + (255 - c[1]) * f) | 0,
        Math.min(255, c[2] + (255 - c[2]) * f) | 0,
      ];
    }
    let TRGB = hexToRgb(TEAM);
    let TLT = lighten(TRGB, 0.5);
    const FOAM: [number, number, number] = [223, 246, 255];

    function clamp(v: number, a: number, b: number) {
      return v < a ? a : v > b ? b : v;
    }
    function lerp(a: number, b: number, t: number) {
      return a + (b - a) * t;
    }
    function easeOutCubic(t: number) {
      return 1 - Math.pow(1 - t, 3);
    }
    function easeOutQuad(t: number) {
      return 1 - (1 - t) * (1 - t);
    }
    function seg(t: number, a: number, b: number) {
      return clamp((t - a) / (b - a), 0, 1);
    }

    const T = {
      fadeIn: 450,
      flightStart: 340,
      impact: 1520,
      typeIn: 1540,
      hold: 3300,
      end: 4300,
    };
    const WATER = 612;
    const GOAL = { x: 1120, y: WATER - 187, w: 624, h: 187 };
    const IMPACT = { x: GOAL.x + GOAL.w * 0.3, y: GOAL.y + GOAL.h * 0.46 };
    const SURF = { x: IMPACT.x, y: WATER };

    interface Drop { x: number; y: number; vx: number; vy: number; life: number; r: number; col: string }
    interface Spray { x: number; y: number; vx: number; vy: number; life: number; r: number }
    interface Ripple { x: number; y: number; t0: number }

    let drops: Drop[] = [];
    let spray: Spray[] = [];
    const ballTrail: Array<{ x: number; y: number }> = [];
    let ballSpin = 0;
    const ball = { x: 0, y: 0, r: 42 };
    let ripples: Ripple[] = [];

    function drawBall(t: number) {
      if (t > T.impact + 150) return;
      const flying = t >= T.flightStart;
      const x = ball.x, y = ball.y, r = ball.r;
      if (flying) {
        ctx!.globalCompositeOperation = 'lighter';
        for (let i = 0; i < ballTrail.length; i++) {
          const p = ballTrail[i]!;
          const a = i / ballTrail.length;
          ctx!.fillStyle = `rgba(255,210,40,${a * 0.22})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, r * 0.4 * a + 2, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.globalCompositeOperation = 'source-over';
      }
      ctx!.save();
      ctx!.shadowColor = 'rgba(255,210,40,0.7)';
      ctx!.shadowBlur = flying ? 16 : 10;
      const g = ctx!.createRadialGradient(x - r * 0.3, y - r * 0.34, r * 0.1, x, y, r);
      g.addColorStop(0, '#fff7cf');
      g.addColorStop(0.5, '#ffd21a');
      g.addColorStop(0.85, '#f0ab00');
      g.addColorStop(1, '#c98a00');
      ctx!.fillStyle = g;
      ctx!.beginPath();
      ctx!.arc(x, y, r, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
      ctx!.save();
      ctx!.beginPath();
      ctx!.arc(x, y, r, 0, Math.PI * 2);
      ctx!.clip();
      ctx!.strokeStyle = 'rgba(150,96,8,0.55)';
      ctx!.lineWidth = Math.max(2, r * 0.05);
      for (let k = 0; k < 3; k++) {
        const rx = r * (0.3 + k * 0.34);
        ctx!.save();
        ctx!.translate(x, y);
        ctx!.rotate(ballSpin * 0.4);
        ctx!.beginPath();
        ctx!.ellipse(0, 0, rx, r * 0.98, 0, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.restore();
      }
      ctx!.save();
      ctx!.translate(x, y);
      ctx!.rotate(ballSpin * 0.4);
      ctx!.beginPath();
      ctx!.ellipse(0, 0, r * 0.98, r * 0.34, 0, 0, Math.PI * 2);
      ctx!.stroke();
      ctx!.restore();
      ctx!.restore();
      ctx!.save();
      ctx!.globalCompositeOperation = 'lighter';
      const hx = x - r * 0.32, hy = y - r * 0.36;
      const hg = ctx!.createRadialGradient(hx, hy, 1, hx, hy, r * 0.4);
      hg.addColorStop(0, 'rgba(255,255,255,0.7)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx!.fillStyle = hg;
      ctx!.beginPath();
      ctx!.arc(hx, hy, r * 0.4, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }
    function updateBall(t: number, dt: number) {
      const bt = seg(t, T.flightStart, T.impact);
      const sx = -160, sy = WATER + 70;
      ball.x = lerp(sx, IMPACT.x, easeOutQuad(bt));
      ball.y = lerp(sy, IMPACT.y, bt) - Math.sin(Math.PI * bt) * 150;
      ball.r = lerp(52, 30, bt);
      ballSpin += dt * 9;
      if (t >= T.flightStart && t <= T.impact) {
        ballTrail.push({ x: ball.x, y: ball.y });
        if (ballTrail.length > 16) ballTrail.shift();
      }
    }

    function L(a: [number, number], b: [number, number]) {
      ctx!.beginPath();
      ctx!.moveTo(a[0], a[1]);
      ctx!.lineTo(b[0], b[1]);
      ctx!.stroke();
    }
    function meshQuad(a: [number, number], b: [number, number], c: [number, number], d: [number, number], nu: number, nv: number) {
      function P(u: number, v: number): [number, number] {
        const tx = a[0] + (b[0] - a[0]) * u;
        const ty = a[1] + (b[1] - a[1]) * u;
        const bx = d[0] + (c[0] - d[0]) * u;
        const by = d[1] + (c[1] - d[1]) * u;
        return [tx + (bx - tx) * v, ty + (by - ty) * v];
      }
      let i: number, j: number, p: [number, number];
      for (i = 0; i <= nu; i++) {
        ctx!.beginPath();
        for (j = 0; j <= nv; j++) {
          p = P(i / nu, j / nv);
          if (j) ctx!.lineTo(p[0], p[1]); else ctx!.moveTo(p[0], p[1]);
        }
        ctx!.stroke();
      }
      for (j = 0; j <= nv; j++) {
        ctx!.beginPath();
        for (i = 0; i <= nu; i++) {
          p = P(i / nu, j / nv);
          if (i) ctx!.lineTo(p[0], p[1]); else ctx!.moveTo(p[0], p[1]);
        }
        ctx!.stroke();
      }
    }
    function netBulge(t: number) {
      if (t < T.impact) return 0;
      const e = t - T.impact;
      if (e > 820) return 0;
      return Math.exp(-e / 240) * Math.sin(e * 0.028) * 26;
    }
    function corners(t: number) {
      const x = GOAL.x, y = GOAL.y, w = GOAL.w, h = GOAL.h, bz = netBulge(t);
      const dTopX = 46, dTopY = -16, dBotX = 60, dBotY = -6;
      return {
        FTL: [x, y] as [number, number],
        FTR: [x + w, y] as [number, number],
        FBL: [x, y + h] as [number, number],
        FBR: [x + w, y + h] as [number, number],
        BTL: [x + dTopX + bz, y + dTopY] as [number, number],
        BTR: [x + w + dTopX + bz, y + dTopY] as [number, number],
        BBL: [x + dBotX + bz, y + h + dBotY] as [number, number],
        BBR: [x + w + dBotX + bz, y + h + dBotY] as [number, number],
      };
    }
    function drawGoal(t: number) {
      const reveal = easeOutCubic(seg(t, 150, 1100));
      ctx!.save();
      ctx!.globalAlpha = reveal;
      ctx!.lineCap = 'round';
      const C = corners(t);
      ctx!.strokeStyle = 'rgba(236,246,255,0.42)';
      ctx!.lineWidth = 1.4;
      meshQuad(C.FTL, C.FTR, C.BTR, C.BTL, 18, 3);
      meshQuad(C.FBL, C.FBR, C.BBR, C.BBL, 18, 3);
      meshQuad(C.FTL, C.BTL, C.BBL, C.FBL, 3, 7);
      meshQuad(C.FTR, C.BTR, C.BBR, C.FBR, 3, 7);
      meshQuad(C.BTL, C.BTR, C.BBR, C.BBL, 18, 7);
      ctx!.strokeStyle = 'rgba(205,222,236,0.6)';
      ctx!.lineWidth = 4;
      L(C.BTL, C.BTR); L(C.FTL, C.BTL); L(C.FTR, C.BTR);
      ctx!.strokeStyle = 'rgba(245,250,255,0.96)';
      ctx!.lineWidth = 11;
      ctx!.shadowColor = TEAM;
      ctx!.shadowBlur = 26;
      L(C.FTL, C.FBL); L(C.FTR, C.FBR); L(C.FTL, C.FTR);
      ctx!.shadowBlur = 0;
      ctx!.fillStyle = 'rgba(245,250,255,0.95)';
      ctx!.shadowColor = TEAM;
      ctx!.shadowBlur = 16;
      ctx!.beginPath();
      ctx!.ellipse(C.FBL[0], C.FBL[1], 20, 9, 0, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.beginPath();
      ctx!.ellipse(C.FBR[0], C.FBR[1], 20, 9, 0, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.shadowBlur = 0;
      ctx!.restore();
    }

    function burst(x: number, y: number) {
      for (let i = 0; i < 320; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const sp = 8 + Math.random() * 30;
        const col = Math.random() < 0.55 ? '#ffffff' : (Math.random() < 0.6 ? rgba(FOAM, 1) : rgba(TLT, 1));
        drops.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 7, life: 0.7 + Math.random() * 0.7, r: 2 + Math.random() * 6, col });
      }
      for (let i = 0; i < 70; i++) {
        const sp2 = 18 + Math.random() * 30;
        drops.push({ x: x + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 5, vy: -sp2, life: 0.8 + Math.random() * 0.6, r: 3 + Math.random() * 7, col: Math.random() < 0.5 ? '#ffffff' : rgba(FOAM, 1) });
      }
      for (let i = 0; i < 46; i++) {
        const a3 = Math.random() * Math.PI * 2;
        const sp3 = 1 + Math.random() * 5;
        spray.push({ x, y, vx: Math.cos(a3) * sp3, vy: Math.sin(a3) * sp3 - 3, life: 1 + Math.random() * 0.6, r: 16 + Math.random() * 26 });
      }
      ripples.push({ x: SURF.x, y: SURF.y, t0: 0 });
      ripples.push({ x: SURF.x, y: SURF.y, t0: -0.12 });
    }
    function stepParticles(dt: number) {
      const g = 0.55;
      for (let i = drops.length - 1; i >= 0; i--) {
        const p = drops[i]!;
        p.vy += g; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.life -= dt * 0.8;
        if (p.life <= 0 || p.y > H + 20) drops.splice(i, 1);
      }
      for (let i = spray.length - 1; i >= 0; i--) {
        const p = spray[i]!;
        p.vy -= 0.05; p.vx *= 0.96; p.vy *= 0.97; p.r += 20 * dt;
        p.life -= dt * 0.7; p.x += p.vx; p.y += p.vy;
        if (p.life <= 0) spray.splice(i, 1);
      }
      for (let i = 0; i < ripples.length; i++) ripples[i]!.t0 += dt;
    }
    function drawParticles() {
      ctx!.globalCompositeOperation = 'lighter';
      for (let i = 0; i < spray.length; i++) {
        const p = spray[i]!;
        const pa = clamp(p.life, 0, 1) * 0.16;
        const grd = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        grd.addColorStop(0, `rgba(235,250,255,${pa})`);
        grd.addColorStop(1, 'rgba(180,230,255,0)');
        ctx!.fillStyle = grd;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      for (let i = 0; i < drops.length; i++) {
        const p = drops[i]!;
        ctx!.globalAlpha = clamp(p.life, 0, 1);
        ctx!.fillStyle = p.col;
        ctx!.shadowColor = rgba(FOAM, 1);
        ctx!.shadowBlur = 10;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r * clamp(p.life + 0.2, 0, 1.2), 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      ctx!.shadowBlur = 0;
      ctx!.globalCompositeOperation = 'source-over';
    }
    function drawRipples() {
      for (let i = 0; i < ripples.length; i++) {
        const rp = ripples[i]!;
        if (rp.t0 <= 0) continue;
        const p = clamp(rp.t0 / 0.8, 0, 1);
        if (p >= 1) continue;
        const R = easeOutCubic(p) * 620;
        ctx!.strokeStyle = rgba(FOAM, (1 - p) * 0.5);
        ctx!.lineWidth = 6 * (1 - p) + 1;
        ctx!.beginPath();
        ctx!.ellipse(rp.x, rp.y, R, R * 0.22, 0, 0, Math.PI * 2);
        ctx!.stroke();
      }
    }

    function drawBackground(t: number) {
      const g = ctx!.createLinearGradient(0, 0, 0, WATER);
      g.addColorStop(0, '#040d18');
      g.addColorStop(1, '#06182b');
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, W, WATER);
      ctx!.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const lx = (i + 0.5) * (W / 7);
        const ly = 70 + ((i * 37) % 120);
        const gg = ctx!.createRadialGradient(lx, ly, 0, lx, ly, 120);
        gg.addColorStop(0, 'rgba(180,225,255,0.10)');
        gg.addColorStop(1, 'rgba(180,225,255,0)');
        ctx!.fillStyle = gg;
        ctx!.beginPath();
        ctx!.arc(lx, ly, 120, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalCompositeOperation = 'source-over';
      const wg = ctx!.createLinearGradient(0, WATER, 0, H);
      wg.addColorStop(0, '#0e5a86');
      wg.addColorStop(0.5, '#093f63');
      wg.addColorStop(1, '#04121f');
      ctx!.fillStyle = wg;
      ctx!.fillRect(0, WATER, W, H - WATER);
      ctx!.globalCompositeOperation = 'lighter';
      for (let c = 0; c < 12; c++) {
        const yy = WATER + 18 + c * ((H - WATER) / 12);
        const amp = 7 + c * 1.3;
        const ph = t * 0.0012 * (0.5 + c * 0.12) + c;
        ctx!.strokeStyle = `rgba(190,235,255,${0.05 + 0.035 * Math.sin(ph * 2)})`;
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        for (let x = 0; x <= W; x += 26) {
          const yo = Math.sin(x * 0.012 + ph * 3) * amp;
          if (x === 0) ctx!.moveTo(x, yy + yo); else ctx!.lineTo(x, yy + yo);
        }
        ctx!.stroke();
      }
      ctx!.globalCompositeOperation = 'source-over';
      ctx!.strokeStyle = rgba(lighten(FOAM, 0), 0.5);
      ctx!.lineWidth = 2;
      ctx!.shadowColor = TEAM;
      ctx!.shadowBlur = 14;
      ctx!.beginPath();
      ctx!.moveTo(0, WATER);
      ctx!.lineTo(W, WATER);
      ctx!.stroke();
      ctx!.shadowBlur = 0;
      ctx!.globalCompositeOperation = 'lighter';
      [GOAL.x, GOAL.x + GOAL.w].forEach((px) => {
        const rg = ctx!.createLinearGradient(px, WATER, px, WATER + 150);
        rg.addColorStop(0, rgba(TLT, 0.25));
        rg.addColorStop(1, rgba(TLT, 0));
        ctx!.fillStyle = rg;
        ctx!.fillRect(px - 8, WATER, 16, 150);
      });
      ctx!.globalCompositeOperation = 'source-over';
    }

    function drawShockwave(t: number) {
      if (t < T.impact || t > T.impact + 700) return;
      ctx!.globalCompositeOperation = 'lighter';
      const cp = seg(t, T.impact, T.impact + 240);
      const coreR = lerp(10, 180, easeOutCubic(cp)) * (1 - cp * 0.4);
      const cg = ctx!.createRadialGradient(IMPACT.x, IMPACT.y, 0, IMPACT.x, IMPACT.y, coreR);
      cg.addColorStop(0, `rgba(255,255,255,${1 - cp})`);
      cg.addColorStop(0.4, rgba(FOAM, (1 - cp) * 0.8));
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx!.fillStyle = cg;
      ctx!.beginPath();
      ctx!.arc(IMPACT.x, IMPACT.y, coreR, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.globalCompositeOperation = 'source-over';
    }
    function drawType(t: number) {
      if (t < T.typeIn) return;
      const p = seg(t, T.typeIn, T.typeIn + 420);
      const s = lerp(1.7, 1.0, 1 - Math.pow(1 - p, 3));
      const glitch = t < T.typeIn + 320 ? (Math.random() - 0.5) * 10 : 0;
      ctx!.save();
      ctx!.translate(W / 2 + glitch, 300);
      ctx!.scale(s, s);
      ctx!.textAlign = 'center';
      ctx!.textBaseline = 'middle';
      ctx!.font = '900 260px "Arial Black", Arial, sans-serif';
      ctx!.globalCompositeOperation = 'lighter';
      ctx!.fillStyle = 'rgba(255,40,80,0.85)';
      ctx!.fillText('GOAL!', -8, 0);
      ctx!.fillStyle = rgba(TRGB, 0.9);
      ctx!.fillText('GOAL!', 8, 0);
      ctx!.fillStyle = '#fff';
      ctx!.shadowColor = TEAM;
      ctx!.shadowBlur = 42;
      ctx!.fillText('GOAL!', 0, 0);
      ctx!.globalCompositeOperation = 'source-over';
      ctx!.restore();
      if (hideScoreline) { ctx!.shadowBlur = 0; return; }
      const lp = seg(t, T.typeIn + 260, T.typeIn + 640);
      if (lp > 0) {
        ctx!.save();
        ctx!.globalAlpha = lp;
        const bandY = 820, bandH = 170;
        const bg = ctx!.createLinearGradient(0, bandY, 0, bandY + bandH);
        bg.addColorStop(0, 'rgba(3,12,22,0)');
        bg.addColorStop(0.32, 'rgba(3,12,22,0.86)');
        bg.addColorStop(0.7, 'rgba(3,12,22,0.86)');
        bg.addColorStop(1, 'rgba(3,12,22,0)');
        ctx!.fillStyle = bg;
        ctx!.fillRect(0, bandY, W, bandH);
        ctx!.strokeStyle = rgba(TLT, 0.7);
        ctx!.lineWidth = 3;
        ctx!.shadowColor = TEAM;
        ctx!.shadowBlur = 12;
        ctx!.beginPath();
        ctx!.moveTo(W / 2 - 380, bandY + 34);
        ctx!.lineTo(W / 2 + 380, bandY + 34);
        ctx!.stroke();
        ctx!.shadowBlur = 0;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'alphabetic';
        const ty = bandY + 96 + (1 - easeOutCubic(lp)) * 26;
        ctx!.font = '800 60px Arial';
        ctx!.fillStyle = '#eaf6ff';
        ctx!.shadowColor = 'rgba(0,0,0,0.85)';
        ctx!.shadowBlur = 14;
        ctx!.fillText(`${homeName.toUpperCase()}  ${homeScore}  —  ${awayScore}  ${awayName.toUpperCase()}`, W / 2, ty);
        if (segmentLabel) {
          ctx!.font = '700 30px Arial';
          ctx!.fillStyle = rgba(TLT, 0.95);
          ctx!.shadowBlur = 0;
          ctx!.fillText(`${segmentLabel}  ·  GOAL`, W / 2, ty + 42);
        }
        ctx!.restore();
      }
      ctx!.shadowBlur = 0;
    }
    function drawFlash(t: number) {
      let f = 0;
      if (t >= T.impact && t < T.impact + 200) f = 1 - (t - T.impact) / 200;
      if (f > 0) {
        ctx!.fillStyle = `rgba(220,245,255,${f * 0.7})`;
        ctx!.fillRect(0, 0, W, H);
      }
    }

    function frame(ms: number) {
      if (cancelled) return;
      if (!startMs) { startMs = ms; prevMs = ms; }
      const t = ms - startMs;
      const dt = Math.min(0.05, (ms - prevMs) / 1000);
      prevMs = ms;
      const shake = (t >= T.impact && t < T.impact + 500) ? (1 - (t - T.impact) / 500) * 20 : 0;
      const ox = (Math.random() - 0.5) * shake;
      const oy = (Math.random() - 0.5) * shake;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, W, H);
      ctx!.save();
      ctx!.translate(ox, oy);
      drawBackground(t);
      drawGoal(t);
      if (t >= T.impact && !firedBurst) { firedBurst = true; burst(IMPACT.x, IMPACT.y); }
      updateBall(t, dt);
      drawBall(t);
      drawShockwave(t);
      drawRipples();
      stepParticles(dt);
      drawParticles();
      drawType(t);
      if (t < T.fadeIn) {
        ctx!.fillStyle = `rgba(4,8,16,${1 - t / T.fadeIn})`;
        ctx!.fillRect(-50, -50, W + 100, H + 100);
      }
      if (t > T.hold) {
        const fo = seg(t, T.hold, T.end);
        ctx!.fillStyle = `rgba(4,8,16,${fo})`;
        ctx!.fillRect(-50, -50, W + 100, H + 100);
      }
      drawFlash(t);
      ctx!.restore();
      if (t < T.end) rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [team, homeName, awayName, homeScore, awayScore, segmentLabel, hideScoreline]);

  // Outer: position absolute fill, center the canvas at native 1920×1080
  // and CSS-scale to fit. Letterboxes on ribbon zones (much shorter than
  // 1080) but preserves the scene's intended proportions everywhere.
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: '#04060b',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        width={1920}
        height={1080}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </div>
  );
}

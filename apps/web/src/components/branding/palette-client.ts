/**
 * Client-side copy of the server palette derivation. Used by the demo
 * page (which doesn't have auth to call /derive-palette). Keep in
 * sync with apps/api/src/branding/color-utils.ts — pure math, no deps.
 */

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));

function hexToRgb(hex: string): RGB { const h = hex.replace('#',''); return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) }; }
function rgbToHex({ r, g, b }: RGB) { const to = (n: number) => Math.round(clamp(n,0,255)).toString(16).padStart(2,'0'); return `#${to(r)}${to(g)}${to(b)}`; }

function rgbToHsl({ r, g, b }: RGB): HSL {
  const r1 = r/255, g1 = g/255, b1 = b/255;
  const max = Math.max(r1,g1,b1), min = Math.min(r1,g1,b1);
  let h=0, s=0; const l=(max+min)/2;
  if (max!==min) {
    const d=max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) { case r1: h=(g1-b1)/d + (g1<b1?6:0); break; case g1: h=(b1-r1)/d + 2; break; case b1: h=(r1-g1)/d + 4; break; }
    h *= 60;
  }
  return { h, s: s*100, l: l*100 };
}
function hslToRgb({ h, s, l }: HSL): RGB {
  const s1=s/100, l1=l/100;
  const c=(1-Math.abs(2*l1-1))*s1; const hp=h/60; const x=c*(1-Math.abs((hp%2)-1));
  let r1=0,g1=0,b1=0;
  if (hp<1)[r1,g1,b1]=[c,x,0]; else if (hp<2)[r1,g1,b1]=[x,c,0]; else if (hp<3)[r1,g1,b1]=[0,c,x]; else if (hp<4)[r1,g1,b1]=[0,x,c]; else if (hp<5)[r1,g1,b1]=[x,0,c]; else [r1,g1,b1]=[c,0,x];
  const m=l1-c/2;
  return { r:(r1+m)*255, g:(g1+m)*255, b:(b1+m)*255 };
}
const hexToHsl = (hex: string) => rgbToHsl(hexToRgb(hex));
const hslToHex = (hsl: HSL) => rgbToHex(hslToRgb(hsl));
const darken = (hex: string, a: number) => { const h = hexToHsl(hex); return hslToHex({ ...h, l: clamp(h.l - a) }); };
const lighten = (hex: string, a: number) => { const h = hexToHsl(hex); return hslToHex({ ...h, l: clamp(h.l + a) }); };
function channel(c: number) { const s=c/255; return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055, 2.4); }
function luminance(hex: string) { const {r,g,b}=hexToRgb(hex); return 0.2126*channel(r)+0.7152*channel(g)+0.0722*channel(b); }
function contrast(a: string, b: string) { const la=luminance(a), lb=luminance(b); const [L1,L2]=la>lb?[la,lb]:[lb,la]; return (L1+0.05)/(L2+0.05); }
const bestTextOn = (bg: string) => contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111';

export function derivePaletteClient(primary: string, accent?: string) {
  const p = hexToHsl(primary);
  const autoAccent = accent || hslToHex({ h: (p.h + 180) % 360, s: clamp(p.s, 40, 85), l: clamp(p.l, 40, 65) });
  return {
    primary,
    primaryHover: hslToHex({ ...p, l: clamp(p.l - 8, 20, 55) }),
    primaryActive: hslToHex({ ...p, l: clamp(p.l - 16, 15, 45) }),
    primarySoft: hslToHex({ ...p, s: clamp(p.s * 0.55, 15, 55), l: 94 }),
    primaryInk: bestTextOn(primary),
    accent: autoAccent,
    accentHover: darken(autoAccent, 8),
    accentSoft: lighten(autoAccent, 38),
    accentInk: bestTextOn(autoAccent),
    ink: '#0f172a',
    inkMuted: '#475569',
    surface: '#ffffff',
    surfaceAlt: hslToHex({ ...p, s: clamp(p.s * 0.5, 10, 40), l: 97 }),
    border: '#e2e8f0',
    success: '#16a34a',
    warn: '#f59e0b',
    danger: '#dc2626',
  };
}

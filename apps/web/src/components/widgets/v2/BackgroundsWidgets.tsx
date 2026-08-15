"use client";
/**
 * VenueOS · Backgrounds widgets — drop-in template backgrounds.
 *
 * Ported from scratch/incoming/edu-cms-7/industry-widget-pack/lib/widgets-backgrounds.jsx.
 * Each background is its own previewable widget. In the source they share an
 * `exportName` (BACKGROUND_PRESETS / AnimatedBackgroundWidget) because they
 * collapse into preset arrays at the integration layer; here they are distinct
 * React components so the registry can preview each one. See the metadata
 * table in the port notes for the original `exportName` per widget.
 *
 * This is a 1:1 visual port — colors, gradients, SVGs, shapes preserved.
 */
import React from 'react';
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';
import { sceneCss } from '../scene-css';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* All backgrounds are landscape aspect → 1080 canvas. */
const CANVAS = 1080;

/** Caption label, bottom-left, JetBrains-Mono — matches the source BgWrap. */
function bgLabel(text: string, height: number): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${(60 / 1920) * 100}%`,
        bottom: `${(60 / CANVAS) * 100}%`,
        color: 'rgba(255,255,255,0.7)',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: px(height, 24 / CANVAS),
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {text}
    </div>
  );
}

/* ════════════════ GRADIENT BACKGROUNDS ════════════════ */

export interface BgGradientCfg extends BaseCfg {
  bgGradient?: string;
  scope?: 'template' | 'zone';
}

function GradientBg({
  defaultCss,
  label,
  config,
  height,
}: {
  defaultCss: string;
  label: string;
  config?: BgGradientCfg;
  height: number;
}): React.ReactElement {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  const css = c.bgGradient ?? defaultCss;
  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: css }} />
      {bgLabel(label, height)}
    </div>
  );
}

export function BgIndigoMidnight({ config, live = true, height = 480 }: WidgetProps<BgGradientCfg>) {
  return <GradientBg defaultCss="linear-gradient(135deg, #0a0e2a 0%, #1a1042 50%, #3a2766 100%)" label="Indigo midnight" config={config} height={height} />;
}

export function BgAurora({ config, live = true, height = 480 }: WidgetProps<BgGradientCfg>) {
  return <GradientBg defaultCss="linear-gradient(135deg, #0f2027 0%, #203a43 35%, #2c5364 70%, #5d4cc1 100%)" label="Aurora" config={config} height={height} />;
}

export function BgGoldenHour({ config, live = true, height = 480 }: WidgetProps<BgGradientCfg>) {
  return <GradientBg defaultCss="linear-gradient(180deg, #f6b04c 0%, #f08344 50%, #c14d39 100%)" label="Golden hour" config={config} height={height} />;
}

export function BgForestDeep({ config, live = true, height = 480 }: WidgetProps<BgGradientCfg>) {
  return <GradientBg defaultCss="linear-gradient(135deg, #0d1f1c 0%, #15403a 50%, #1f5d4f 100%)" label="Forest deep" config={config} height={height} />;
}

export function BgPeachCream({ config, live = true, height = 480 }: WidgetProps<BgGradientCfg>) {
  return <GradientBg defaultCss="linear-gradient(135deg, #fff7ee 0%, #f6d3b3 50%, #efa890 100%)" label="Peach cream" config={config} height={height} />;
}

export function BgOceanBlue({ config, live = true, height = 480 }: WidgetProps<BgGradientCfg>) {
  return <GradientBg defaultCss="linear-gradient(180deg, #022a5d 0%, #0a4a8a 50%, #1280c5 100%)" label="Ocean blue" config={config} height={height} />;
}

/* ════════════════ MESH GRADIENT (multi-blob) ════════════════ */

export interface BgMeshCfg extends BaseCfg {
  kind?: string;
  palette?: string[];
  scope?: 'template' | 'zone';
}

function MeshBg({ palette, height }: { palette: string[]; height: number }): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: '-20%', left: '-10%', width: '80%', height: '80%', background: palette[2], filter: `blur(${px(height, 140 / CANVAS)}px)`, borderRadius: '50%', opacity: 0.65 }} />
      <div style={{ position: 'absolute', bottom: '-30%', right: '-20%', width: '90%', height: '90%', background: palette[3], filter: `blur(${px(height, 160 / CANVAS)}px)`, borderRadius: '50%', opacity: 0.5 }} />
      <div style={{ position: 'absolute', top: '30%', right: '10%', width: '40%', height: '40%', background: palette[4], filter: `blur(${px(height, 120 / CANVAS)}px)`, borderRadius: '50%', opacity: 0.6 }} />
    </div>
  );
}

function MeshFrame({
  defaultPalette,
  label,
  config,
  height,
}: {
  defaultPalette: string[];
  label: string;
  config?: BgMeshCfg;
  height: number;
}): React.ReactElement {
  const c = config ?? {};
  const palette = c.palette && c.palette.length >= 5 ? c.palette : defaultPalette;
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: palette[1], ...c.style });
  return (
    <div style={frameStyle(r)}>
      <MeshBg palette={palette} height={height} />
      {bgLabel(label, height)}
    </div>
  );
}

export function BgMeshViolet({ config, live = true, height = 480 }: WidgetProps<BgMeshCfg>) {
  return <MeshFrame defaultPalette={['#1a1042', '#7b5cff', '#ff6b7a', '#ffd54a', '#22d39b']} label="Mesh · violet plum" config={config} height={height} />;
}

export function BgMeshOcean({ config, live = true, height = 480 }: WidgetProps<BgMeshCfg>) {
  return <MeshFrame defaultPalette={['#0d1018', '#0a4a8a', '#22d39b', '#7b5cff', '#ffd54a']} label="Mesh · ocean glow" config={config} height={height} />;
}

export function BgMeshDesert({ config, live = true, height = 480 }: WidgetProps<BgMeshCfg>) {
  return <MeshFrame defaultPalette={['#1a1410', '#a87432', '#dc6a1d', '#5b2a4a', '#ffd54a']} label="Mesh · desert dusk" config={config} height={height} />;
}

/* ════════════════ DIAMOND TILE ════════════════ */

export interface BgDiamondTileCfg extends BaseCfg {
  kind?: string;
  tone1?: string;
  tone2?: string;
  tileSize?: number;
  scope?: 'template' | 'zone';
}

export function BgDiamondTile({ config, live = true, height = 480 }: WidgetProps<BgDiamondTileCfg>) {
  const c = config ?? {};
  const tone1 = c.tone1 ?? '#0a0e2a';
  const tone2 = c.tone2 ?? '#7b5cff';
  const tile = px(height, (c.tileSize ?? 60) / CANVAS);
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  return (
    <div style={frameStyle(r)}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: tone1,
          backgroundImage:
            `radial-gradient(circle at 25% 25%, ${tone2}55 0%, transparent 35%),` +
            `radial-gradient(circle at 75% 75%, ${tone2}55 0%, transparent 35%),` +
            `linear-gradient(45deg, ${tone2}22 25%, transparent 25%, transparent 75%, ${tone2}22 75%),` +
            `linear-gradient(45deg, ${tone2}22 25%, transparent 25%, transparent 75%, ${tone2}22 75%)`,
          backgroundSize: `100% 100%, 100% 100%, ${tile}px ${tile}px, ${tile}px ${tile}px`,
          backgroundPosition: `0 0, 0 0, 0 0, ${tile / 2}px ${tile / 2}px`,
        }}
      />
      {bgLabel('Diamond tile', height)}
    </div>
  );
}

/* ════════════════ DOTS GRID ════════════════ */

export interface BgDotsGridCfg extends BaseCfg {
  kind?: string;
  base?: string;
  dot?: string;
  spacing?: number;
  scope?: 'template' | 'zone';
}

export function BgDotsGrid({ config, live = true, height = 480 }: WidgetProps<BgDotsGridCfg>) {
  const c = config ?? {};
  const base = c.base ?? '#f7f7f5';
  const dot = c.dot ?? '#0b0c0e22';
  const spacing = px(height, (c.spacing ?? 32) / CANVAS);
  const dotR = Math.max(1, px(height, 1.5 / CANVAS));
  const r = resolveStyle({ bgColor: '#f7f7f5', textColor: '#0b0c0e', accentColor: '#3955d1', ...c.style });
  return (
    <div style={frameStyle(r)}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: base,
          backgroundImage: `radial-gradient(circle, ${dot} ${dotR}px, transparent ${dotR}px)`,
          backgroundSize: `${spacing}px ${spacing}px`,
        }}
      />
      {bgLabel('Dots grid', height)}
    </div>
  );
}

/* ════════════════ TOPOGRAPHIC LINES ════════════════ */

export interface BgTopoLinesCfg extends BaseCfg {
  kind?: string;
  base?: string;
  line?: string;
  density?: number;
  scope?: 'template' | 'zone';
}

export function BgTopoLines({ config, live = true, height = 480 }: WidgetProps<BgTopoLinesCfg>) {
  const c = config ?? {};
  const base = c.base ?? '#0d2226';
  const line = c.line ?? '#13a6ad';
  const density = Math.max(6, Math.min(36, c.density ?? 18));
  const r = resolveStyle({ bgColor: '#0d2226', textColor: '#fff', accentColor: '#13a6ad', ...c.style });
  return (
    <div style={frameStyle(r)}>
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%', background: base }}
      >
        {Array.from({ length: density }).map((_, i) => (
          <path
            key={i}
            d={`M0,${100 + i * 52} C480,${60 + i * 52} 960,${140 + i * 52} 1920,${80 + i * 52}`}
            fill="none"
            stroke={line}
            strokeWidth="1.2"
            opacity={0.5}
          />
        ))}
      </svg>
      {bgLabel('Topographic lines', height)}
    </div>
  );
}

/* ════════════════ ANIMATED FLOW ════════════════ */

export interface BgAnimatedFlowCfg extends BaseCfg {
  kind?: string;
  palette?: string[];
  speed?: number;
  scope?: 'template' | 'zone';
}

export function BgAnimatedFlow({ config, live = true, height = 480 }: WidgetProps<BgAnimatedFlowCfg>) {
  const c = config ?? {};
  const palette = c.palette && c.palette.length >= 3 ? c.palette : ['#7b5cff', '#22d39b', '#ff6b7a'];
  const speed = c.speed && c.speed > 0 ? c.speed : 1;
  const r = resolveStyle({ bgColor: '#0b0c14', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  // Source durations: 14s / 18s / 22s — slower at lower speed multiplier.
  const d1 = (14 / speed).toFixed(2);
  const d2 = (18 / speed).toFixed(2);
  const d3 = (22 / speed).toFixed(2);
  return (
    <div style={frameStyle(r)}>
      <style>{sceneCss(`
@keyframes bgflow_flow1 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(60px,40px); } }
@keyframes bgflow_flow2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-50px,60px); } }
@keyframes bgflow_flow3 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(40px,-40px); } }
`)}</style>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: '#0b0c14', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: '10%',
            left: '5%',
            width: '40%',
            height: '60%',
            background: palette[0],
            filter: `blur(${px(height, 120 / CANVAS)}px)`,
            borderRadius: '50%',
            opacity: 0.5,
            animation: live ? `bgflow_flow1 ${d1}s ease-in-out infinite` : undefined,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '30%',
            right: '5%',
            width: '45%',
            height: '70%',
            background: palette[1],
            filter: `blur(${px(height, 140 / CANVAS)}px)`,
            borderRadius: '50%',
            opacity: 0.45,
            animation: live ? `bgflow_flow2 ${d2}s ease-in-out infinite` : undefined,
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-10%',
            left: '30%',
            width: '50%',
            height: '70%',
            background: palette[2],
            filter: `blur(${px(height, 150 / CANVAS)}px)`,
            borderRadius: '50%',
            opacity: 0.4,
            animation: live ? `bgflow_flow3 ${d3}s ease-in-out infinite` : undefined,
          }}
        />
      </div>
      {bgLabel('Animated flow', height)}
    </div>
  );
}

/* ════════════════ PHOTOGRAPHIC PLACEHOLDER ════════════════ */

export interface BgPhotoCfg extends BaseCfg {
  kind?: string;
  tint?: string;
  bgImage?: string | null;
  overlay?: number;
  scope?: 'template' | 'zone';
}

function PhotoPlaceholder({
  defaultTint,
  caption,
  label,
  config,
  height,
}: {
  defaultTint: string;
  caption: string;
  label: string;
  config?: BgPhotoCfg;
  height: number;
}): React.ReactElement {
  const c = config ?? {};
  const tint = c.tint ?? defaultTint;
  const r = resolveStyle({ bgColor: '#1a1a1a', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: tint }}>
        {/* diagonal stripes texture (source used a `.stripes` utility class) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            opacity: 0.5,
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0, rgba(255,255,255,0.06) 2px, transparent 2px, transparent 22px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: `${(30 / CANVAS) * 100}%`,
            left: `${(30 / 1920) * 100}%`,
            color: '#fff',
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 700,
            fontSize: px(height, 22 / CANVAS),
            letterSpacing: '0.08em',
          }}
        >
          ● PLACEHOLDER · {caption}
        </div>
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)',
            fontSize: px(height, 200 / CANVAS),
          }}
        >
          ⌖
        </div>
      </div>
      {bgLabel(label, height)}
    </div>
  );
}

export function BgPhotoLobbyWarm({ config, live = true, height = 480 }: WidgetProps<BgPhotoCfg>) {
  return <PhotoPlaceholder defaultTint="#3a2a1a" caption="WARM LOBBY · UPLOAD YOUR HERO" label="Hotel lobby (warm)" config={config} height={height} />;
}

export function BgPhotoCampus({ config, live = true, height = 480 }: WidgetProps<BgPhotoCfg>) {
  return <PhotoPlaceholder defaultTint="#1f3a5f" caption="CAMPUS · UPLOAD YOUR PHOTO" label="Campus quad" config={config} height={height} />;
}

export function BgPhotoHospital({ config, live = true, height = 480 }: WidgetProps<BgPhotoCfg>) {
  return <PhotoPlaceholder defaultTint="#0d2226" caption="ATRIUM · UPLOAD YOUR HERO" label="Hospital atrium" config={config} height={height} />;
}

export function BgPhotoRetail({ config, live = true, height = 480 }: WidgetProps<BgPhotoCfg>) {
  return <PhotoPlaceholder defaultTint="#2a1a3a" caption="RETAIL · UPLOAD YOUR HERO" label="Retail interior" config={config} height={height} />;
}

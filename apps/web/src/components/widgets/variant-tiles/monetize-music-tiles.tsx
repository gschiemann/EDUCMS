'use client';

/**
 * Tile thumbnails for the HOUSE_AD_BANNER + MUSIC_PLAYER variants
 * registered in variants-register.ts. Both are previewOnly:true so
 * these tiles only paint in the widget palette; the real
 * HouseAdsBannerWidget / MusicPlayerWidget take over on the canvas.
 *
 * Added 2026-05-25 (monetize-audit + music-overhaul).
 *
 * Tailwind classes use long-hand `top-0 right-0 bottom-0 left-0`
 * (NOT `inset-0`) per CLAUDE.md rule #10 — Chromium 83 NovaStar
 * Taurus support.
 */

export function HouseAdsBannerTile() {
  return (
    <div
      className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #475569 50%, #0f172a 100%)',
        color: '#f8fafc',
        overflow: 'hidden',
      }}
    >
      <div style={{ textAlign: 'center', padding: 8 }}>
        <div style={{ fontSize: '2em', marginBottom: 4 }}>🏠</div>
        <div style={{ fontWeight: 800, fontSize: '0.85em', letterSpacing: '0.04em' }}>HOUSE ADS</div>
        <div style={{ fontSize: '0.65em', opacity: 0.8, marginTop: 2 }}>Your own sponsor rotation</div>
        <div
          style={{
            display: 'inline-block',
            marginTop: 6,
            padding: '2px 8px',
            background: '#10b981',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '0.65em',
            letterSpacing: '0.06em',
            borderRadius: 4,
          }}
        >
          Sponsored
        </div>
      </div>
    </div>
  );
}

export function MusicPlayerTile() {
  return (
    <div
      className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #0b0f1a 0%, #1e1b4b 50%, #1e293b 100%)',
        color: '#cbd5e1',
        overflow: 'hidden',
      }}
    >
      <div style={{ textAlign: 'center', padding: 8 }}>
        <div style={{ fontSize: '2em', marginBottom: 4 }}>🎵</div>
        <div style={{ fontWeight: 800, fontSize: '0.85em', color: '#f8fafc' }}>MUSIC PLAYER</div>
        <div style={{ fontSize: '0.65em', opacity: 0.7, marginTop: 2, lineHeight: 1.3 }}>
          SomaFM · NPR · NTS · custom
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            paddingLeft: 3,
            marginTop: 6,
            padding: '2px 8px',
            background: 'rgba(16, 185, 129, 0.15)',
            color: '#34d399',
            fontWeight: 700,
            fontSize: '0.65em',
            letterSpacing: '0.06em',
            borderRadius: 4,
            border: '1px solid rgba(52, 211, 153, 0.3)',
          }}
        >
          <span style={{ width: 4, height: 4, background: '#34d399', borderRadius: '50%' }} />
          NOW PLAYING
        </div>
      </div>
    </div>
  );
}

const fs = require('fs');

const stemSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1920" y2="1080" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#020617" />
      <stop offset="50%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <pattern id="hex" x="0" y="0" width="100" height="173.2" patternUnits="userSpaceOnUse">
      <path d="M50 0L100 28.86v57.74L50 115.47L0 86.6V28.86z M50 173.2L100 202.06v57.74L50 288.67L0 259.8V202.06z" stroke="#1e293b" stroke-width="2" fill="none" />
      <path d="M0 173.2L50 202.06v57.74L0 288.67L-50 259.8V202.06z" stroke="#1e293b" stroke-width="2" fill="none" />
      <path d="M100 173.2L150 202.06v57.74L100 288.67L50 259.8V202.06z" stroke="#1e293b" stroke-width="2" fill="none" />
    </pattern>
    <radialGradient id="glow1" cx="20%" cy="20%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="glow2" cx="80%" cy="80%" r="50%">
      <stop offset="0%" stop-color="#818cf8" stop-opacity="0.1" />
      <stop offset="100%" stop-color="#818cf8" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)" />
  <rect width="1920" height="1080" fill="url(#hex)" opacity="0.6" />
  <rect width="1920" height="1080" fill="url(#glow1)" />
  <rect width="1920" height="1080" fill="url(#glow2)" />
  
  <g opacity="0.3">
    <!-- Tech nodes -->
    <circle cx="200" cy="150" r="4" fill="#38bdf8" />
    <circle cx="450" cy="300" r="3" fill="#38bdf8" />
    <circle cx="800" cy="100" r="5" fill="#818cf8" />
    <circle cx="1600" cy="400" r="4" fill="#38bdf8" />
    <circle cx="1400" cy="800" r="6" fill="#818cf8" />
    <circle cx="300" cy="700" r="3" fill="#38bdf8" />
    <!-- Connecting lines -->
    <path d="M200 150 L450 300 L800 100" stroke="#38bdf8" stroke-width="1" fill="none" opacity="0.5" />
    <path d="M1600 400 L1400 800" stroke="#818cf8" stroke-width="1" fill="none" opacity="0.5" />
  </g>
</svg>`;

const libSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1920" y2="1080" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#f5f0eb" />
      <stop offset="100%" stop-color="#e6dfd5" />
    </linearGradient>
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
      <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.05 0" />
    </filter>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)" />
  <rect width="1920" height="1080" style="pointer-events:none;" filter="url(#noise)" />
  
  <g opacity="0.03" stroke="#3e2723" stroke-width="4" fill="none" stroke-linecap="round">
    <!-- Abstract book / shelf outlines -->
    <rect x="100" y="200" width="400" height="600" rx="10" />
    <rect x="120" y="220" width="360" height="560" rx="5" />
    <line x1="160" y1="200" x2="160" y2="800" />
    <line x1="460" y1="200" x2="460" y2="800" />
    
    <rect x="1400" y="300" width="350" height="500" rx="10" />
    <rect x="1420" y="320" width="310" height="460" rx="5" />
    <line x1="1460" y1="300" x2="1460" y2="800" />
    <line x1="1710" y1="300" x2="1710" y2="800" />
    
    <path d="M700 850 Q 960 950 1220 850" stroke-width="2" />
    <path d="M700 870 Q 960 970 1220 870" stroke-width="2" />
  </g>
</svg>`;

const musicSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1920" y2="1080" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1e102f" />
      <stop offset="50%" stop-color="#0a0515" />
      <stop offset="100%" stop-color="#120822" />
    </linearGradient>
    <radialGradient id="spotlight1" cx="10%" cy="0%" r="80%" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#c026d3" stop-opacity="0.2" />
      <stop offset="100%" stop-color="#c026d3" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="spotlight2" cx="90%" cy="100%" r="80%" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)" />
  <rect width="1920" height="1080" fill="url(#spotlight1)" />
  <rect width="1920" height="1080" fill="url(#spotlight2)" />
  
  <g opacity="0.1" stroke-linecap="round" stroke-linejoin="round">
    <!-- Abstract audio waveforms -->
    <path d="M0 600 Q 200 500 400 600 T 800 600 T 1200 600 T 1600 600 T 2000 600" fill="none" stroke="#c026d3" stroke-width="4" />
    <path d="M0 650 Q 200 400 400 650 T 800 650 T 1200 650 T 1600 650 T 2000 650" fill="none" stroke="#3b82f6" stroke-width="2" />
    <path d="M0 700 Q 200 600 400 700 T 800 700 T 1200 700 T 1600 700 T 2000 700" fill="none" stroke="#db2777" stroke-width="1" />
  </g>
</svg>`;

console.log('STEM_LAB_BG:\\n' + "url('data:image/svg+xml;base64," + Buffer.from(stemSvg).toString('base64') + "')\\n");
console.log('LIBRARY_QUIET_BG:\\n' + "url('data:image/svg+xml;base64," + Buffer.from(libSvg).toString('base64') + "')\\n");
console.log('MUSIC_ARTS_BG:\\n' + "url('data:image/svg+xml;base64," + Buffer.from(musicSvg).toString('base64') + "')\\n");

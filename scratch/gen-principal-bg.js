const fs = require('fs');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <!-- Rich Mahogany Wood Base -->
    <linearGradient id="woodBase" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1e110a" />
      <stop offset="25%" stop-color="#3a2215" />
      <stop offset="50%" stop-color="#2a180f" />
      <stop offset="75%" stop-color="#422718" />
      <stop offset="100%" stop-color="#1e110a" />
    </linearGradient>

    <!-- Wood Grain Texture -->
    <filter id="woodGrain">
      <feTurbulence type="fractalNoise" baseFrequency="0.01 0.5" numOctaves="4" result="noise" />
      <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.15 0" in="noise" result="coloredNoise" />
      <feBlend in="SourceGraphic" in2="coloredNoise" mode="multiply" />
    </filter>

    <!-- Gold Foil Frame -->
    <linearGradient id="goldFrame" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE08B" />
      <stop offset="20%" stop-color="#D4AF37" />
      <stop offset="50%" stop-color="#FFFAEF" />
      <stop offset="80%" stop-color="#AA7C11" />
      <stop offset="100%" stop-color="#FDE08B" />
    </linearGradient>

    <!-- Subtle Vignette -->
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="50%" stop-color="rgba(0,0,0,0)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.7)" />
    </radialGradient>
  </defs>

  <!-- Base Wood Panel -->
  <rect width="1920" height="1080" fill="url(#woodBase)" />
  <rect width="1920" height="1080" fill="url(#woodBase)" filter="url(#woodGrain)" />

  <!-- Vertical Paneling Grooves -->
  <path d="M 320 0 V 1080 M 640 0 V 1080 M 960 0 V 1080 M 1280 0 V 1080 M 1600 0 V 1080" stroke="rgba(0,0,0,0.4)" stroke-width="6" />
  <path d="M 322 0 V 1080 M 642 0 V 1080 M 962 0 V 1080 M 1282 0 V 1080 M 1602 0 V 1080" stroke="rgba(255,255,255,0.03)" stroke-width="2" />

  <!-- Vignette -->
  <rect width="1920" height="1080" fill="url(#vignette)" />

  <!-- Outer Gold Frame Overlay -->
  <rect x="20" y="20" width="1880" height="1040" fill="none" stroke="url(#goldFrame)" stroke-width="4" rx="4" />
  <rect x="28" y="28" width="1864" height="1024" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" rx="2" />
  <rect x="18" y="18" width="1884" height="1044" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="4" rx="6" />
</svg>`;

const b64 = Buffer.from(svg).toString('base64');
const dataUrl = 'data:image/svg+xml;base64,' + b64;

fs.writeFileSync('principal-bg.txt', dataUrl);
console.log('Saved to principal-bg.txt');

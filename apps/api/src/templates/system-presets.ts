const STEM_LAB_BG = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIHZpZXdCb3g9IjAgMCAxOTIwIDEwODAiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMTkyMCIgeTI9IjEwODAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzAyMDYxNyIgLz4KICAgICAgPHN0b3Agb2Zmc2V0PSI1MCUiIHN0b3AtY29sb3I9IiMwZjE3MmEiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzAyMDYxNyIgLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8cGF0dGVybiBpZD0iaGV4IiB4PSIwIiB5PSIwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjE3My4yIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHBhdGggZD0iTTUwIDBMMTAwIDI4Ljg2djU3Ljc0TDUwIDExNS40N0wwIDg2LjZWMjguODZ6IE01MCAxNzMuMkwxMDAgMjAyLjA2djU3Ljc0TDUwIDI4OC42N0wwIDI1OS44VjIwMi4wNnoiIHN0cm9rZT0iIzFlMjkzYiIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIiAvPgogICAgICA8cGF0aCBkPSJNMCAxNzMuMkw1MCAyMDIuMDZ2NTcuNzRMMCAyODguNjdMLTUwIDI1OS44VjIwMi4wNnoiIHN0cm9rZT0iIzFlMjkzYiIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIiAvPgogICAgICA8cGF0aCBkPSJNMTAwIDE3My4yTDE1MCAyMDIuMDZ2NTcuNzRMMTAwIDI4OC42N0w1MCAyNTkuOFYyMDIuMDZ6IiBzdHJva2U9IiMxZTI5M2IiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIgLz4KICAgIDwvcGF0dGVybj4KICAgIDxyYWRpYWxHcmFkaWVudCBpZD0iZ2xvdzEiIGN4PSIyMCUiIGN5PSIyMCUiIHI9IjUwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiMzOGJkZjgiIHN0b3Atb3BhY2l0eT0iMC4xNSIgLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjMzhiZGY4IiBzdG9wLW9wYWNpdHk9IjAiIC8+CiAgICA8L3JhZGlhbEdyYWRpZW50PgogICAgPHJhZGlhbEdyYWRpZW50IGlkPSJnbG93MiIgY3g9IjgwJSIgY3k9IjgwJSIgcj0iNTAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzgxOGNmOCIgc3RvcC1vcGFjaXR5PSIwLjEiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzgxOGNmOCIgc3RvcC1vcGFjaXR5PSIwIiAvPgogICAgPC9yYWRpYWxHcmFkaWVudD4KICA8L2RlZnM+CiAgPHJlY3Qgd2lkdGg9IjE5MjAiIGhlaWdodD0iMTA4MCIgZmlsbD0idXJsKCNiZykiIC8+CiAgPHJlY3Qgd2lkdGg9IjE5MjAiIGhlaWdodD0iMTA4MCIgZmlsbD0idXJsKCNoZXgpIiBvcGFjaXR5PSIwLjYiIC8+CiAgPHJlY3Qgd2lkdGg9IjE5MjAiIGhlaWdodD0iMTA4MCIgZmlsbD0idXJsKCNnbG93MSkiIC8+CiAgPHJlY3Qgd2lkdGg9IjE5MjAiIGhlaWdodD0iMTA4MCIgZmlsbD0idXJsKCNnbG93MikiIC8+CiAgCiAgPGcgb3BhY2l0eT0iMC4zIj4KICAgIDwhLS0gVGVjaCBub2RlcyAtLT4KICAgIDxjaXJjbGUgY3g9IjIwMCIgY3k9IjE1MCIgcj0iNCIgZmlsbD0iIzM4YmRmOCIgLz4KICAgIDxjaXJjbGUgY3g9IjQ1MCIgY3k9IjMwMCIgcj0iMyIgZmlsbD0iIzM4YmRmOCIgLz4KICAgIDxjaXJjbGUgY3g9IjgwMCIgY3k9IjEwMCIgcj0iNSIgZmlsbD0iIzgxOGNmOCIgLz4KICAgIDxjaXJjbGUgY3g9IjE2MDAiIGN5PSI0MDAiIHI9IjQiIGZpbGw9IiMzOGJkZjgiIC8+CiAgICA8Y2lyY2xlIGN4PSIxNDAwIiBjeT0iODAwIiByPSI2IiBmaWxsPSIjODE4Y2Y4IiAvPgogICAgPGNpcmNsZSBjeD0iMzAwIiBjeT0iNzAwIiByPSIzIiBmaWxsPSIjMzhiZGY4IiAvPgogICAgPCEtLSBDb25uZWN0aW5nIGxpbmVzIC0tPgogICAgPHBhdGggZD0iTTIwMCAxNTAgTDQ1MCAzMDAgTDgwMCAxMDAiIHN0cm9rZT0iIzM4YmRmOCIgc3Ryb2tlLXdpZHRoPSIxIiBmaWxsPSJub25lIiBvcGFjaXR5PSIwLjUiIC8+CiAgICA8cGF0aCBkPSJNMTYwMCA0MDAgTDE0MDAgODAwIiBzdHJva2U9IiM4MThjZjgiIHN0cm9rZS13aWR0aD0iMSIgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMC41IiAvPgogIDwvZz4KPC9zdmc+')";
const LIBRARY_QUIET_BG = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIHZpZXdCb3g9IjAgMCAxOTIwIDEwODAiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMTkyMCIgeTI9IjEwODAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI2Y1ZjBlYiIgLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjZTZkZmQ1IiAvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxmaWx0ZXIgaWQ9Im5vaXNlIj4KICAgICAgPGZlVHVyYnVsZW5jZSB0eXBlPSJmcmFjdGFsTm9pc2UiIGJhc2VGcmVxdWVuY3k9IjAuNjUiIG51bU9jdGF2ZXM9IjMiIHN0aXRjaFRpbGVzPSJzdGl0Y2giIC8+CiAgICAgIDxmZUNvbG9yTWF0cml4IHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIxIDAgMCAwIDAsIDAgMSAwIDAgMCwgMCAwIDEgMCAwLCAwIDAgMCAwLjA1IDAiIC8+CiAgICA8L2ZpbHRlcj4KICA8L2RlZnM+CiAgPHJlY3Qgd2lkdGg9IjE5MjAiIGhlaWdodD0iMTA4MCIgZmlsbD0idXJsKCNiZykiIC8+CiAgPHJlY3Qgd2lkdGg9IjE5MjAiIGhlaWdodD0iMTA4MCIgc3R5bGU9InBvaW50ZXItZXZlbnRzOm5vbmU7IiBmaWx0ZXI9InVybCgjbm9pc2UpIiAvPgogIAogIDxnIG9wYWNpdHk9IjAuMDMiIHN0cm9rZT0iIzNlMjcyMyIgc3Ryb2tlLXdpZHRoPSI0IiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiPgogICAgPCEtLSBBYnN0cmFjdCBib29rIC8gc2hlbGYgb3V0bGluZXMgLS0+CiAgICA8cmVjdCB4PSIxMDAiIHk9IjIwMCIgd2lkdGg9IjQwMCIgaGVpZ2h0PSI2MDAiIHJ4PSIxMCIgLz4KICAgIDxyZWN0IHg9IjEyMCIgeT0iMjIwIiB3aWR0aD0iMzYwIiBoZWlnaHQ9IjU2MCIgcng9IjUiIC8+CiAgICA8bGluZSB4MT0iMTYwIiB5MT0iMjAwIiB4Mj0iMTYwIiB5Mj0iODAwIiAvPgogICAgPGxpbmUgeDE9IjQ2MCIgeTE9IjIwMCIgeDI9IjQ2MCIgeTI9IjgwMCIgLz4KICAgIAogICAgPHJlY3QgeD0iMTQwMCIgeT0iMzAwIiB3aWR0aD0iMzUwIiBoZWlnaHQ9IjUwMCIgcng9IjEwIiAvPgogICAgPHJlY3QgeD0iMTQyMCIgeT0iMzIwIiB3aWR0aD0iMzEwIiBoZWlnaHQ9IjQ2MCIgcng9IjUiIC8+CiAgICA8bGluZSB4MT0iMTQ2MCIgeTE9IjMwMCIgeDI9IjE0NjAiIHkyPSI4MDAiIC8+CiAgICA8bGluZSB4MT0iMTcxMCIgeTE9IjMwMCIgeDI9IjE3MTAiIHkyPSI4MDAiIC8+CiAgICAKICAgIDxwYXRoIGQ9Ik03MDAgODUwIFEgOTYwIDk1MCAxMjIwIDg1MCIgc3Ryb2tlLXdpZHRoPSIyIiAvPgogICAgPHBhdGggZD0iTTcwMCA4NzAgUSA5NjAgOTcwIDEyMjAgODcwIiBzdHJva2Utd2lkdGg9IjIiIC8+CiAgPC9nPgo8L3N2Zz4=')";
const MUSIC_ARTS_BG = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIHZpZXdCb3g9IjAgMCAxOTIwIDEwODAiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMTkyMCIgeTI9IjEwODAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzFlMTAyZiIgLz4KICAgICAgPHN0b3Agb2Zmc2V0PSI1MCUiIHN0b3AtY29sb3I9IiMwYTA1MTUiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzEyMDgyMiIgLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8cmFkaWFsR3JhZGllbnQgaWQ9InNwb3RsaWdodDEiIGN4PSIxMCUiIGN5PSIwJSIgcj0iODAlIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNjMDI2ZDMiIHN0b3Atb3BhY2l0eT0iMC4yIiAvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNjMDI2ZDMiIHN0b3Atb3BhY2l0eT0iMCIgLz4KICAgIDwvcmFkaWFsR3JhZGllbnQ+CiAgICA8cmFkaWFsR3JhZGllbnQgaWQ9InNwb3RsaWdodDIiIGN4PSI5MCUiIGN5PSIxMDAlIiByPSI4MCUiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzNiODJmNiIgc3RvcC1vcGFjaXR5PSIwLjE1IiAvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiMzYjgyZjYiIHN0b3Atb3BhY2l0eT0iMCIgLz4KICAgIDwvcmFkaWFsR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIGZpbGw9InVybCgjYmcpIiAvPgogIDxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIGZpbGw9InVybCgjc3BvdGxpZ2h0MSkiIC8+CiAgPHJlY3Qgd2lkdGg9IjE5MjAiIGhlaWdodD0iMTA4MCIgZmlsbD0idXJsKCNzcG90bGlnaHQyKSIgLz4KICAKICA8ZyBvcGFjaXR5PSIwLjEiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+CiAgICA8IS0tIEFic3RyYWN0IGF1ZGlvIHdhdmVmb3JtcyAtLT4KICAgIDxwYXRoIGQ9Ik0wIDYwMCBRIDIwMCA1MDAgNDAwIDYwMCBUIDgwMCA2MDAgVCAxMjAwIDYwMCBUIDE2MDAgNjAwIFQgMjAwMCA2MDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2MwMjZkMyIgc3Ryb2tlLXdpZHRoPSI0IiAvPgogICAgPHBhdGggZD0iTTAgNjUwIFEgMjAwIDQwMCA0MDAgNjUwIFQgODAwIDY1MCBUIDEyMDAgNjUwIFQgMTYwMCA2NTAgVCAyMDAwIDY1MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjM2I4MmY2IiBzdHJva2Utd2lkdGg9IjIiIC8+CiAgICA8cGF0aCBkPSJNMCA3MDAgUSAyMDAgNjAwIDQwMCA3MDAgVCA4MDAgNzAwIFQgMTIwMCA3MDAgVCAxNjAwIDcwMCBUIDIwMDAgNzAwIiBmaWxsPSJub25lIiBzdHJva2U9IiNkYjI3NzciIHN0cm9rZS13aWR0aD0iMSIgLz4KICA8L2c+Cjwvc3ZnPg==')";

/**
 * System Template Presets — built-in, ready-to-use screen layouts
 * designed specifically for schools. Teachers pick a preset, and the
 * zones are pre-configured with the right widget types for each location.
 *
 * All coordinates are percentage-based (0–100) so they scale to any
 * screen resolution or aspect ratio. The player renders zones as
 * position:absolute CSS divs inside a 100% × 100% container.
 *
 * These are the STARTING POINTS — teachers can duplicate and customize.
 */

export interface SystemPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  orientation: string;
  screenWidth?: number;
  screenHeight?: number;
  // School level filter — Elementary, Middle, High, or Universal. Drives
  // the filter chips on /templates. Optional; defaults to 'UNIVERSAL'.
  schoolLevel?: 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'UNIVERSAL';
  // Optional background applied template-wide. Any of these can be set;
  // the player layers them as:  bgImage on top of bgGradient on top of bgColor.
  bgColor?: string;       // solid color fallback — e.g. '#ffffff'
  bgGradient?: string;    // any valid CSS `background:` value (supports layered backgrounds + SVG data URIs)
  bgImage?: string;       // URL to a single background image
  zones: Array<{
    name: string;
    widgetType: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex?: number;
    sortOrder?: number;
    defaultConfig?: Record<string, any>;
  }>;
}

// The Sunny Meadow / Elementary Welcome preset was retired — only the
// shape-based Rainbow Ribbon stack is approved for elementary. The SVG
// background constant below would produce a TS unused-const warning, so
// we keep it gated behind a never-referenced IIFE. If we ever need it
// back, just wire it into a preset's bgGradient field.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _RETIRED_SUNNY_MEADOW_BG = (() => {
  // Two-layer background: full-canvas sky scene (sun, clouds, rainbow,
  // flying kite) + foreground meadow with rolling hills and flowers.
  // Sized to the 3840×2160 template so every element reads cleanly on
  // a 4K classroom lobby display.
  const sceneSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='none'>
    <defs>
      <radialGradient id='sunGlow' cx='50%' cy='50%' r='50%'>
        <stop offset='0%' stop-color='#FFF4B8' stop-opacity='0.95'/>
        <stop offset='55%' stop-color='#FFE066' stop-opacity='0.5'/>
        <stop offset='100%' stop-color='#FFE066' stop-opacity='0'/>
      </radialGradient>
    </defs>

    <!-- Big happy sun with rays -->
    <g transform='translate(1620 180)'>
      <circle r='220' fill='url(#sunGlow)'/>
      <g stroke='#FFD166' stroke-width='14' stroke-linecap='round' opacity='0.85'>
        <line x1='0' y1='-190' x2='0' y2='-250'/>
        <line x1='135' y1='-135' x2='180' y2='-180'/>
        <line x1='190' y1='0' x2='250' y2='0'/>
        <line x1='135' y1='135' x2='180' y2='180'/>
        <line x1='0' y1='190' x2='0' y2='250'/>
        <line x1='-135' y1='135' x2='-180' y2='180'/>
        <line x1='-190' y1='0' x2='-250' y2='0'/>
        <line x1='-135' y1='-135' x2='-180' y2='-180'/>
      </g>
      <circle r='100' fill='#FFD166'/>
      <!-- smiley face -->
      <circle cx='-34' cy='-12' r='7' fill='#3A2E2A'/>
      <circle cx='34' cy='-12' r='7' fill='#3A2E2A'/>
      <path d='M -30 22 Q 0 48 30 22' stroke='#3A2E2A' stroke-width='5' fill='none' stroke-linecap='round'/>
      <ellipse cx='-52' cy='16' rx='10' ry='6' fill='#FF8FAB' opacity='0.7'/>
      <ellipse cx='52' cy='16' rx='10' ry='6' fill='#FF8FAB' opacity='0.7'/>
    </g>

    <!-- Fluffy clouds -->
    <g fill='#FFFFFF' opacity='0.95'>
      <g transform='translate(260 160)'>
        <ellipse cx='0' cy='0' rx='90' ry='40'/>
        <ellipse cx='55' cy='-18' rx='56' ry='34'/>
        <ellipse cx='-50' cy='-10' rx='46' ry='30'/>
      </g>
      <g transform='translate(880 110) scale(0.82)'>
        <ellipse cx='0' cy='0' rx='100' ry='42'/>
        <ellipse cx='62' cy='-20' rx='58' ry='36'/>
        <ellipse cx='-58' cy='-14' rx='50' ry='32'/>
      </g>
      <g transform='translate(1150 260) scale(0.68)'>
        <ellipse cx='0' cy='0' rx='80' ry='36'/>
        <ellipse cx='50' cy='-18' rx='48' ry='30'/>
        <ellipse cx='-46' cy='-10' rx='42' ry='28'/>
      </g>
    </g>

    <!-- Rainbow arc, top-left -->
    <g transform='translate(140 40)' fill='none' stroke-width='18' stroke-linecap='round'>
      <path d='M 0 200 A 200 200 0 0 1 400 200' stroke='#FF6B8B'/>
      <path d='M 20 200 A 180 180 0 0 1 380 200' stroke='#FFA05A'/>
      <path d='M 40 200 A 160 160 0 0 1 360 200' stroke='#FFD166'/>
      <path d='M 60 200 A 140 140 0 0 1 340 200' stroke='#8CE99A'/>
      <path d='M 80 200 A 120 120 0 0 1 320 200' stroke='#66C4FF'/>
      <path d='M 100 200 A 100 100 0 0 1 300 200' stroke='#C58CFF'/>
    </g>

    <!-- Flying kite (accent) -->
    <g transform='translate(730 460) rotate(-18)'>
      <polygon points='0,-40 30,0 0,40 -30,0' fill='#FF8FAB' stroke='#3A2E2A' stroke-width='3'/>
      <line x1='0' y1='-40' x2='0' y2='40' stroke='#3A2E2A' stroke-width='2'/>
      <line x1='-30' y1='0' x2='30' y2='0' stroke='#3A2E2A' stroke-width='2'/>
      <path d='M 0 40 Q 18 70 8 98 Q -12 130 12 160' stroke='#3A2E2A' stroke-width='2' fill='none'/>
      <g stroke='#FFD166' stroke-width='4' stroke-linecap='round'>
        <line x1='5' y1='60' x2='18' y2='72'/>
        <line x1='2' y1='100' x2='-12' y2='112'/>
        <line x1='10' y1='140' x2='24' y2='150'/>
      </g>
    </g>

    <!-- Meadow hills (bottom third) -->
    <g transform='translate(0 700)'>
      <!-- distant hills -->
      <path d='M0,160 C320,90 640,210 960,130 C1280,70 1600,210 1920,120 L1920,380 L0,380 Z' fill='#86E09B' opacity='0.9'/>
      <!-- mid hills -->
      <path d='M0,240 C240,190 520,290 820,220 C1160,150 1480,280 1920,210 L1920,380 L0,380 Z' fill='#5BB36C'/>
      <!-- front hills -->
      <path d='M0,320 C300,280 620,350 960,310 C1280,275 1600,350 1920,305 L1920,380 L0,380 Z' fill='#4A9D5C'/>
      <!-- yellow flowers -->
      <g fill='#FFD166'>
        <circle cx='140' cy='340' r='9'/><circle cx='360' cy='360' r='8'/><circle cx='580' cy='335' r='9'/>
        <circle cx='820' cy='365' r='8'/><circle cx='1080' cy='340' r='9'/><circle cx='1320' cy='360' r='8'/>
        <circle cx='1560' cy='338' r='9'/><circle cx='1800' cy='365' r='8'/>
      </g>
      <!-- pink flowers -->
      <g fill='#FF8FAB'>
        <circle cx='230' cy='365' r='7'/><circle cx='490' cy='350' r='7'/><circle cx='720' cy='370' r='6'/>
        <circle cx='980' cy='358' r='7'/><circle cx='1220' cy='348' r='6'/><circle cx='1460' cy='365' r='7'/>
        <circle cx='1700' cy='350' r='6'/>
      </g>
      <!-- white flowers -->
      <g fill='#FFFFFF' opacity='0.9'>
        <circle cx='300' cy='348' r='6'/><circle cx='660' cy='355' r='6'/><circle cx='1020' cy='368' r='6'/>
        <circle cx='1400' cy='348' r='6'/><circle cx='1640' cy='372' r='6'/>
      </g>
    </g>
  </svg>`;
  const encoded = sceneSvg
    .replace(/\n/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/#/g, '%23')
    .replace(/"/g, "'");
  // Base sky gradient underneath the scene SVG for extra depth.
  return `url("data:image/svg+xml;utf8,${encoded}") no-repeat center / 100% 100%, linear-gradient(180deg, #9FDCFF 0%, #BFE8FF 30%, #FFF1B8 65%, #FFD8A8 100%)`;
})();

export const SYSTEM_TEMPLATE_PRESETS: SystemPreset[] = [
  // ════════════════════════════════════════════════════════════════
  // 2026-04-20 cleanup — removed 18 legacy theme-based presets so the
  // gallery only shows the curated animated full-screen scenes. The
  // theme widget COMPONENTS (RainbowRibbonText, BulletinBoardLogo,
  // etc.) stay in the codebase as fallbacks for any custom template a
  // tenant has built referencing them; only the system presets that
  // shipped them are gone. ensure-system-presets.ts archives any DB
  // row whose id no longer appears here.
  // ════════════════════════════════════════════════════════════════
    {
    id: "preset-lobby-animated-rainbow",
    name: "🎉 Animated Rainbow · Welcome",
    description: "Full-screen ANIMATED elementary welcome — confetti rain, spinning sun, drifting clouds, wiggling clock, floating balloons, scrolling birthday marquee. Live weather auto-detected from the player. Date-driven countdown.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#BFE8FF",
    bgGradient: "linear-gradient(180deg,#BFE8FF 0%,#FFE0EC 55%,#FFD8A8 100%)",
    zones: [
      {
        "name": "Animated Welcome Scene",
        "widgetType": "ANIMATED_WELCOME",
        "x": 0, "y": 0, "width": 100, "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "logoEmoji": "🍎",
          "title": "Welcome, Friends!",
          "subtitle": "today is going to be amazing ✨",
          "weatherLocation": "",
          "weatherUnits": "imperial",
          "announcementLabel": "Big News",
          "announcementMessage": "Book Fair starts Monday! 📚 Come find your new favorite story.",
          "countdownLabel": "Field Trip in",
          "countdownDate": "2026-05-30",
          "teacherGender": "female",
          "teacherName": "Mrs. Johnson",
          "teacherRole": "Teacher of the Week",
          "birthdayNames": "Maya · Eli · Sofia",
          "tickerStamp": "SCHOOL NEWS",
          "tickerMessages": [
            "Welcome back, Stars! ⭐",
            "Picture day is Friday 📸",
            "Reading Challenge: 20 minutes a day 📖",
            "Parent-teacher conferences next Tuesday 👨‍👩‍👧"
          ]
        }
      }
    ],
  },
  {
    id: "preset-lobby-animated-middle",
    name: "🏟️ Animated Middle School · Welcome",
    description: "Full-screen ANIMATED middle-school welcome — stadium spotlights, pennant bunting, hanging scoreboard clock, varsity-patch teacher, megaphone announcement, stopwatch countdown, layered cake with candles, LED ticker. Live weather auto-detected.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0f172a",
    bgGradient: "linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0f172a 100%)",
    zones: [
      {
        "name": "Animated Welcome Scene (Middle School)",
        "widgetType": "ANIMATED_WELCOME_MS",
        "x": 0, "y": 0, "width": 100, "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "logoEmoji": "🦅",
          "title": "GO EAGLES",
          "subtitle": "~ welcome back, Eagles ~",
          "weatherLocation": "",
          "weatherUnits": "imperial",
          "announcementLabel": "Big News",
          "announcementMessage": "Pep Rally Friday at 2:30 — be in the gym, bring your loudest!",
          "countdownLabel": "Homecoming in",
          "countdownDate": "2026-05-02",
          "teacherGender": "male",
          "teacherName": "Mr. Rivera",
          "teacherRole": "Teacher of the Week",
          "birthdayNames": "Jordan · Tyler · Alex",
          "tickerStamp": "EAGLE NEWS",
          "tickerMessages": [
            "Varsity 28 — Central 14 🦅",
            "Cheer tryouts Monday 3 PM",
            "Yearbook orders due Friday",
            "Student council elections next week"
          ]
        }
      }
    ],
  },
  {
    id: "preset-lobby-animated-high",
    name: "🎓 Animated High School · Welcome",
    description: "Full-screen ANIMATED high-school welcome — bright sunset palette, grad-cap logo, neon-sign title, sunburst clock, trophy countdown, yearbook-page teacher, confetti-burst birthdays, speech-bubble announcement, confetti rain. Live weather auto-detected.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#fce7f3",
    bgGradient: "linear-gradient(180deg,#fce7f3 0%,#ffe4e6 30%,#fef3c7 70%,#fed7aa 100%)",
    zones: [
      {
        "name": "Animated Welcome Scene (High School)",
        "widgetType": "ANIMATED_WELCOME_HS",
        "x": 0, "y": 0, "width": 100, "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "title": "Class of 2026",
          "subtitle": "make it count",
          "weatherLocation": "",
          "weatherUnits": "imperial",
          "announcementLabel": "Announcement",
          "announcementMessage": "Senior portraits next week — sign up in the office.",
          "countdownLabel": "Graduation in",
          "countdownDate": "2026-06-05",
          "teacherGender": "male",
          "teacherName": "Mr. Patel",
          "teacherRole": "Teacher of the Week",
          "birthdayNames": "Alex · Jordan · Sam",
          "tickerStamp": "CAMPUS NEWS",
          "tickerMessages": [
            "FINAL · VARSITY 28, CENTRAL 14",
            "FAFSA workshop Tuesday 6PM",
            "Yearbook orders due Friday",
            "College fair Thursday",
            "Senior trip sign-ups close Friday"
          ]
        }
      }
    ],
  },
  {
    id: "preset-cafeteria-animated-elementary",
    name: "🚚 Animated Cafeteria · Food Truck",
    description: "Full-screen ANIMATED cafeteria menu board in food-truck theme. Food-truck logo, sunset palette, string lights, weekly menu editor (Mon-Fri tabs) with auto-picked today's day, swappable food emojis, container-query auto-sizing menu items (4 big, 10 compact), dotted-leader pricing, lunch chef polaroid, layered cake birthdays, allergen ticker.",
    category: "CAFETERIA",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#fce7f3",
    bgGradient: "linear-gradient(180deg,#fce7f3 0%,#ffe4e6 35%,#fef3c7 75%,#fed7aa 100%)",
    zones: [
      {
        "name": "Animated Cafeteria Scene",
        "widgetType": "ANIMATED_CAFETERIA",
        "x": 0, "y": 0, "width": 100, "height": 100,
        "zIndex": 1,
        "sortOrder": 0,
        "defaultConfig": {
          "title": "LUNCH IS ON",
          "subtitle": "~ freshly rolled every day ~",
          "specialEmoji": "🍕",
          "specialLabel": "Pickup Special",
          "specialName": "Cheesy Pepperoni",
          "weekMenu": {
            "monday": [
              { "emoji": "🍕", "name": "Pepperoni Pizza",         "meta": "🌾 🧀",      "price": "$3.25" },
              { "emoji": "🥗", "name": "Build-a-Salad Bar",       "meta": "veg",         "price": "$2.95" },
              { "emoji": "🍟", "name": "Crispy Fries",            "meta": "veg · gf",    "price": "$1.75" },
              { "emoji": "🍎", "name": "Fresh Fruit Cup",         "meta": "veg · gf",    "price": "$1.50" },
              { "emoji": "🥛", "name": "Milk · White or Chocolate","meta": "🧀",          "price": "$0.75" }
            ],
            "tuesday": [
              { "emoji": "🌮", "name": "Street Tacos",            "meta": "🌾 🧀",      "price": "$3.50" },
              { "emoji": "🍚", "name": "Cilantro Lime Rice",      "meta": "veg · gf",    "price": "$1.50" },
              { "emoji": "🌽", "name": "Corn on the Cob",         "meta": "veg · gf",    "price": "$1.25" },
              { "emoji": "🍎", "name": "Fresh Fruit Cup",         "meta": "veg · gf",    "price": "$1.50" },
              { "emoji": "🥛", "name": "Milk · White or Chocolate","meta": "🧀",          "price": "$0.75" }
            ],
            "wednesday": [
              { "emoji": "🍝", "name": "Spaghetti & Meatballs",   "meta": "🌾 🧀",      "price": "$3.50" },
              { "emoji": "🥖", "name": "Garlic Breadstick",       "meta": "🌾 🧀",      "price": "$1.00" },
              { "emoji": "🥗", "name": "Caesar Salad",            "meta": "🌾 🧀",      "price": "$2.50" },
              { "emoji": "🍎", "name": "Fresh Fruit Cup",         "meta": "veg · gf",    "price": "$1.50" },
              { "emoji": "🥛", "name": "Milk · White or Chocolate","meta": "🧀",          "price": "$0.75" }
            ],
            "thursday": [
              { "emoji": "🍔", "name": "Classic Burger",          "meta": "🌾 🧀",      "price": "$3.25" },
              { "emoji": "🍟", "name": "Crispy Fries",            "meta": "veg · gf",    "price": "$1.75" },
              { "emoji": "🥒", "name": "Pickle Spear",            "meta": "veg · gf",    "price": "$0.50" },
              { "emoji": "🍎", "name": "Fresh Fruit Cup",         "meta": "veg · gf",    "price": "$1.50" },
              { "emoji": "🥛", "name": "Milk · White or Chocolate","meta": "🧀",          "price": "$0.75" }
            ],
            "friday": [
              { "emoji": "🍕", "name": "Pizza Friday!",           "meta": "🌾 🧀",      "price": "$3.25" },
              { "emoji": "🥗", "name": "Build-a-Salad Bar",       "meta": "veg",         "price": "$2.95" },
              { "emoji": "🍪", "name": "Chocolate Chip Cookie",   "meta": "🌾 🥜 🧀",    "price": "$1.00" },
              { "emoji": "🍎", "name": "Fresh Fruit Cup",         "meta": "veg · gf",    "price": "$1.50" },
              { "emoji": "🥛", "name": "Milk · White or Chocolate","meta": "🧀",          "price": "$0.75" }
            ]
          },
          "countdownEmoji": "🌮",
          "countdownLabel": "Taco Tuesday in",
          "countdownDate": "",
          "chefName": "Ms. Rodriguez",
          "chefRole": "lunch hero of the week",
          "chefEmoji": "👩‍🍳",
          "birthdayNames": "Alex · Jordan · Sam",
          "tickerStamp": "Café News",
          "tickerMessages": [
            "TACO TUESDAY tomorrow — $3.50 tacos all day",
            "Free water refills at the salad bar",
            "PIZZA FRIDAY returns — $3.25 slices",
            "Reload your lunch card in the main office",
            "Allergen key: 🌾 gluten · 🥜 nuts · 🧀 dairy · 🥚 egg"
          ]
        }
      }
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 16 templates ported from scratch/design/*.html (2026-04-20).
  // Each is a single full-canvas zone; the widget carries every
  // visual (transform:scale 1920x1080 internal). Admins edit the
  // zone's defaultConfig via the PropertiesPanel; live scheduling
  // pushes config changes to paired screens immediately.
  // ────────────────────────────────────────────────────────────────

  {
    id: 'preset-cafeteria-animated-middle',
    name: '🏟️ Animated Cafeteria · Middle School',
    description: 'Varsity / stadium-styled cafeteria menu board — pennants, scoreboard, weekly menu, chef polaroid, birthdays, allergen ticker.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_CAFETERIA_MS', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-cafeteria-animated-high',
    name: '☕ Animated Cafeteria · High School',
    description: 'Neon-sunset café menu board — steaming coffee cup logo, weekly menu, trophy + yearbook accents, allergen ticker.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#111827',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_CAFETERIA_HS', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-cafeteria-chalkboard',
    name: '🌿 Animated Cafeteria · Chalkboard',
    description: 'Green-chalkboard menu board — chalk-textured text, erased highlights, wooden frame, weekly menu editor.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#1f3b2a',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_CAFETERIA_CHALKBOARD', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-cafeteria-foodtruck',
    name: '🚚 Animated Cafeteria · Food Truck (Classic)',
    description: 'Food-truck service window — striped awning, order-window frame, chalkboard menu, weekly menu editor.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fef3c7',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_CAFETERIA_FOODTRUCK', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-bus-board',
    name: '🚌 Animated Bus Route Board',
    description: 'School-bus route board — driving-bus graphic, animated road, route rows with ETAs, late warnings, next-bus countdown.',
    category: 'INFO', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fde68a',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_BUS_BOARD', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-main-entrance',
    name: '🏛️ Animated Main Entrance Welcome',
    description: 'Grand-entrance welcome board — marquee bulbs, heraldic crests, three info tiles, balloon cluster, ticker.',
    category: 'ENTRY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#1e1b4b',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_MAIN_ENTRANCE', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-hallway-schedule',
    name: '📘 Animated Hallway Schedule',
    description: 'Notebook-paper hallway schedule — class periods list, current-period auto-highlight, weather + announcement cards, ticker.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fef3c7',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_HALLWAY_SCHEDULE', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-bell-schedule',
    name: '🔔 Animated Bell Schedule',
    description: 'Live bell-schedule board — current period highlighted, countdown to next bell, progress bar, period timeline.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_BELL_SCHEDULE', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-morning-news',
    name: '📺 Animated Morning News',
    description: 'TV-newsroom daily digest — breaking-news stories with time chips, REC indicator, anchor desk feel.',
    category: 'LOBBY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0b1220',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_MORNING_NEWS', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-achievement-showcase',
    name: '🏆 Animated Achievement Showcase',
    description: 'Award ceremony scene — medals, honor-roll columns, stats, student-of-the-week spotlight with citation.',
    category: 'LOBBY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fef3c7',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_ACHIEVEMENT_SHOWCASE', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-scrapbook-hallway',
    name: '📸 Scrapbook · Hallway',
    description: 'Scrapbook hallway board — polaroids, washi tape, handwritten fonts, attendance, announcements, ticker.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fff7ed',
    zones: [{ name: 'Scene', widgetType: 'SCRAPBOOK_HALLWAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-scrapbook-cafeteria',
    name: '📸 Scrapbook · Cafeteria',
    description: 'Scrapbook cafeteria menu — polaroid plate, washi-tape menu cards, handwritten allergen notes.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fff7ed',
    zones: [{ name: 'Scene', widgetType: 'SCRAPBOOK_CAFETERIA', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-storybook-hallway',
    name: '📖 Storybook · Hallway',
    description: 'Open-book hallway layout — center spine, illuminated drop cap, parchment pages, schedule + attendance, page numbers.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f5f0dc',
    zones: [{ name: 'Scene', widgetType: 'STORYBOOK_HALLWAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-storybook-cafeteria',
    name: '📖 Storybook · Cafeteria',
    description: 'Open-book cafeteria menu — parchment pages, illuminated drop cap, chef’s note, multi-period countdown.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f5f0dc',
    zones: [{ name: 'Scene', widgetType: 'STORYBOOK_CAFETERIA', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-bulletin-hallway',
    name: '📌 Bulletin Board · Hallway',
    description: 'Cork-board hallway layout — pinned index cards, washi tape corners, schedule rows, attendance pin.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#c08457',
    zones: [{ name: 'Scene', widgetType: 'BULLETIN_HALLWAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-bulletin-cafeteria',
    name: '📌 Bulletin Board · Cafeteria',
    description: 'Cork-board cafeteria menu — pinned plate polaroid, index-card menu items, chef’s memo card.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#c08457',
    zones: [{ name: 'Scene', widgetType: 'BULLETIN_CAFETERIA', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
];

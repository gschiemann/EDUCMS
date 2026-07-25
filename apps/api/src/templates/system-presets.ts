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

const RAW_SYSTEM_PRESETS: SystemPreset[] = [
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
    id: "preset-lobby-animated-rainbow-portrait",
    name: "🌈 Animated Rainbow · Portrait",
    description: "Portrait-mounted version of the Rainbow welcome scene. Same content editor as the landscape original (title, weather, countdown, announcement, teacher-of-the-week, birthdays, ticker), re-flowed vertically for 1080\u00d71920 design canvas — scales to full native 4K portrait (2160\u00d73840) or any custom LED matrix via transform:scale.",
    category: "LOBBY",
    orientation: 'PORTRAIT',
    schoolLevel: "ELEMENTARY",
    screenWidth: 2160,
    screenHeight: 3840,
    bgColor: "#BFE8FF",
    bgGradient: "linear-gradient(180deg,#BFE8FF 0%,#FFE0EC 55%,#FFD8A8 100%)",
    zones: [
      {
        name: 'Scene',
        widgetType: 'ANIMATED_WELCOME_PORTRAIT',
        x: 0, y: 0, width: 100, height: 100,
        zIndex: 1,
        sortOrder: 0,
        defaultConfig: {
          title: 'Welcome, Friends!',
          subtitle: 'Today is going to be amazing \u2728',
          logoEmoji: '\ud83c\udf4e',
          weatherLocation: 'Chardon, OH',
          announcementLabel: 'Big News',
          announcementMessage: 'Book Fair starts Monday! Come find your new favorite story \ud83d\udcda',
          countdownLabel: 'Field Trip in',
          countdownNumber: 41,
          countdownUnit: 'days',
          teacherName: 'Mrs. Johnson',
          teacherRole: 'Inspires kids every day',
          teacherEmoji: '\ud83d\udc69\u200d\ud83c\udfeb',
          birthdayLabel: '\ud83c\udf82 Today\u2019s Birthdays',
          birthdayNames: 'Maya \u00b7 Eli \u00b7 Sofia',
          tickerStamp: 'SCHOOL NEWS',
          tickerMessages: [
            'Welcome back, Stars! \u2b50',
            'Picture day is Friday \ud83d\udcf8',
            'Reading Challenge: 20 minutes a day \ud83d\udcd6',
            'Parent-teacher conferences next Tuesday',
          ],
        },
      },
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
  // ── Claude-designed HS lobby pack (2026-04-23) ──────────────────
  // Eight 4K themes (Varsity first; Broadcast, Yearbook, Terminal,
  // Transit, Gallery, Blueprint, Zine follow in subsequent commits
  // once each React port ships). Each theme is a single full-screen
  // scene widget rendered via HsStage transform:scale.
  {
    id: 'preset-hs-varsity',
    name: '🏟️ Varsity — Athletic Department',
    description: 'Stadium jumbotron lobby: LED scoreboard header, big game-of-the-week VS matchup with team crests, LED records strip, athlete-of-the-week spotlight (photo), sponsor strip, PA-system ticker.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0d1b3d',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/varsity.html' } }],
  },
  {
    id: 'preset-hs-broadcast',
    name: '📺 Broadcast — Campus News Desk',
    description: 'Broadcast graphics package: network bug + pulsing ON AIR + timecode, signature lower-third headline graphic, teacher-of-the-week guest card (photo), breaking-news box, clock + forecast bugs, bottom news crawl.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0b1025',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/broadcast.html' } }],
  },
  {
    id: 'preset-hs-yearbook',
    name: '📰 Yearbook — Editorial Magazine',
    description: 'Editorial magazine spread: serif masthead + issue folio, big cover-story photo with caption overlay, drop-cap italic lede, oversized pull-quote, featured portrait + masthead credits, wire ticker.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f7f3ea',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/yearbook.html' } }],
  },
  {
    id: 'preset-hs-terminal',
    name: '💻 Terminal — CRT / Phosphor',
    description: 'CRT monitor lobby: phosphor-green monospace, scanlines, whoami teacher card, cron events log, /var/log/syslog ticker, VT323 banner with blinking cursor.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#060f06',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/terminal.html' } }],
  },
  {
    id: 'preset-hs-transit',
    name: '✈️ Transit — Airport Departure Board',
    description: 'Solari split-flap departure board: amber-on-black flap rows, today\'s classes as departures with room-as-gate and a live status column (ON TIME / BOARDING / DEPARTED), split-flap clock, PA ticker. The live row flips. 4K, both orientations.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#080808',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/hall-wayfinder.html' } }],
  },
  {
    id: 'preset-hs-gallery',
    name: '🏛️ Gallery — Museum Wall Labels',
    description: 'Museum wall labels: cream gallery wall, EB Garamond / Cormorant italic, Roman numerals, hairline rules and generous margins, one large framed feature with a photo slot + wall label, "Also on view" plaques, a Docent\'s Note. Quiet and elegant. 4K, both orientations.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f1ece1',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/gallery.html' } }],
  },
  {
    id: 'preset-hs-blueprint',
    name: '📐 Blueprint — Technical Drawing',
    description: 'Architect\'s blueprint: cyan grid paper, white technical line-work, a real engineering title-block header (project / sheet / scale / drawn-by), a dimensioned current-period callout with leaders + corner brackets, the day\'s schedule as a drawing index, revision-log ticker. 4K, both orientations.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0b3a78',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/blueprint.html' } }],
  },
  {
    id: 'preset-hs-zine',
    name: '✂️ Zine — Cut & Paste Student Rag',
    description: 'DIY photocopied student zine: toner-speckled paper, halftone dots, a ransom-letter cut-out masthead, rotated taped panels, marker scrawl, a taped polaroid with a photo slot, a highlighter blurb, a xeroxwire ticker. 4K, both orientations.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#efe9da',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/zine.html' } }],
  },

  // ─── HS District Pack — 8 lobby/cafeteria/classroom/athletics templates (2026-05-07) ───
  // Approved 2026-05-07. Each ports a 3840×2160 HTML mockup from
  // scratch/design/hs-district/hs-district-pack/. Operators use these
  // for athletics game-day boards, cafeteria menu screens, classroom
  // now/next agendas, substitute self-running plans, hallway corkboard
  // bulletins, and airport-style transition-period wayfinders.
  {
    id: 'preset-hs-ath-gameday',
    name: '🏟️ Athletics — Game Day Hub',
    description: 'Stadium board for game day: matchup helmets + records, kickoff countdown, all-team contests, fan info (tickets/theme/gates/concessions/stream), PA-system ticker. Bebas Neue + Oswald + Archivo. 4K landscape.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0a0e1a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/ath-gameday.html' } }],
  },
  {
    id: 'preset-hs-ath-standings',
    name: '🏆 Athletics — Standings & AOTW',
    description: 'Always-on athletics board: league table, athlete-of-the-week spotlight, school records ladder. Bold numerals, sportsbook-style typography. 4K landscape.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0a0e1a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/ath-standings.html' } }],
  },
  {
    id: 'preset-hs-ath-biggame',
    name: '🏟️ Athletics — Big Game',
    description: 'Single-matchup hype board: giant auto-fit team names, team-color split wash, live countdown to kickoff, records/streak + venue/tickets strip. Auto-fit text, portrait + landscape. 4K.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0a0e1a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/ath-biggame.html' } }],
  },
  {
    id: 'preset-hs-ath-broadcast',
    name: '📺 Athletics — Broadcast Desk',
    description: 'Broadcast-style athletics board: lower-third score strip, matchup panel, anchor/player spotlight, live ticker crawl. Auto-fit text, portrait + landscape. 4K.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0a0e1a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/ath-broadcast.html' } }],
  },
  // ── Sprint 13 — Main Scoreboard. THE real game board, as a template.
  // 2026-05-19: the operator called the earlier multi-zone primitive
  // preset "useless, nothing like the final scoreboard we created." Fixed
  // — this preset is a single full-scene zone rendering MainScoreboardWidget,
  // a faithful pixel reproduction of the actual BoardScene that
  // /board/[gameId] pushes (team color panels + logos, 264px scores with
  // winning glow, 188px amber live clock, period, possession, status pill,
  // VENUEOS wordmark). It reads live game state from the GameStateProvider
  // CustomScoreboardScene wraps the template in, so binding a game to it
  // shows the real board with live score/clock/period.
  //
  // Canvas: 1920×1080 — the widget's transform:scale fits any LED wall.
  // Operator clicks Customize → sets their real pixel dimensions (e.g.
  // 960×1080 narrow gym LED) → the board scales to fit, pixel-faithful.
  // For per-element layout control, the SPORTS widget palette still has
  // the Home Score / Away Score / Game Clock / Period / Game Stat
  // primitives to build a custom board from scratch.
  // 2026-05-19 — NEW ID (was preset-std-scoreboard). The old id's DB
  // row was tagged K12 (the seed's default vertical) AND carried 7 stale
  // zones from the original generic layout, mangled to widgetType
  // SCOREBOARD by the zone-sync — so the SPORTS "dodgers" tenant saw
  // nothing and a K12 view would render 6 junk zones. A fresh id forces
  // the boot seed to CREATE a clean single-zone row tagged SPORTS (see
  // PRESET_VERTICAL override in ensure-system-presets.ts); the old
  // preset-std-scoreboard drops out of source and gets archived.
  // ── Main Scoreboard (2026-05-20 — now ELEMENT-BASED). Operator: "i
  // cant drag and drop any of the widgets … it does nothing we
  // discussed." It used to be ONE monolith zone (a single full-bleed
  // SCOREBOARD widget) — so on a custom canvas it letterboxed to a 16:9
  // block in the middle with nothing to move. NOW it opens as ~13
  // INDIVIDUAL element widgets — each its own zone the operator drags,
  // resizes, restyles, brands (the logo zones take a logo URL in
  // Properties), adds to, or deletes. Percentage-positioned, so it
  // reflows at any custom LED size (960×1080, ultrawide, etc.). The
  // one-piece board is still available below as "Quick Scoreboard".
  {
    id: 'preset-sb-main',
    name: '🏟️ Main Scoreboard',
    description: 'Fully editable board — every piece (home/away logo + name + score, game clock, period, shot clock, possession, timeouts, status) is its own widget you can drag, resize, restyle, brand and remove. Bind a game; resize for any LED.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#05070d',
    zones: [
      { name: 'Status', widgetType: 'SCOREBOARD', x: 43, y: 3, width: 14, height: 7, zIndex: 3, sortOrder: 0, defaultConfig: { variant: 'sb-status', fontSize: 34 } },
      { name: 'Home Logo', widgetType: 'SCOREBOARD', x: 6, y: 12, width: 18, height: 22, zIndex: 2, sortOrder: 1, defaultConfig: { variant: 'sb-team-logo-home', team: 'home' } },
      { name: 'Home Name', widgetType: 'SCOREBOARD', x: 2, y: 36, width: 26, height: 9, zIndex: 2, sortOrder: 2, defaultConfig: { variant: 'sb-team-name-home', team: 'home', fontSize: 54 } },
      { name: 'Home Score', widgetType: 'SCORE_HOME', x: 4, y: 46, width: 22, height: 40, zIndex: 2, sortOrder: 3, defaultConfig: { variant: 'score-home', color: '#ffffff', fontWeight: 900, fontSize: 300, align: 'center' } },
      { name: 'Home Timeouts', widgetType: 'SCOREBOARD', x: 7, y: 88, width: 16, height: 6, zIndex: 2, sortOrder: 4, defaultConfig: { variant: 'sb-timeouts-home', team: 'home', fontSize: 40 } },
      { name: 'Game Clock', widgetType: 'GAME_CLOCK', x: 35, y: 16, width: 30, height: 26, zIndex: 2, sortOrder: 5, defaultConfig: { variant: 'game-clock', color: '#fbbf24', fontWeight: 900, fontSize: 190, align: 'center' } },
      { name: 'Period', widgetType: 'GAME_SEGMENT', x: 38, y: 44, width: 24, height: 9, zIndex: 2, sortOrder: 6, defaultConfig: { variant: 'game-segment', color: '#ffffff', fontWeight: 700, fontSize: 64, align: 'center' } },
      { name: 'Shot Clock', widgetType: 'SCOREBOARD', x: 40, y: 56, width: 20, height: 16, zIndex: 2, sortOrder: 7, defaultConfig: { variant: 'sb-shot-clock', fontSize: 96 } },
      { name: 'Possession', widgetType: 'SCOREBOARD', x: 44, y: 74, width: 12, height: 8, zIndex: 2, sortOrder: 8, defaultConfig: { variant: 'sb-possession-arrow', fontSize: 48 } },
      { name: 'Away Logo', widgetType: 'SCOREBOARD', x: 76, y: 12, width: 18, height: 22, zIndex: 2, sortOrder: 9, defaultConfig: { variant: 'sb-team-logo-away', team: 'away' } },
      { name: 'Away Name', widgetType: 'SCOREBOARD', x: 72, y: 36, width: 26, height: 9, zIndex: 2, sortOrder: 10, defaultConfig: { variant: 'sb-team-name-away', team: 'away', fontSize: 54 } },
      { name: 'Away Score', widgetType: 'SCORE_AWAY', x: 74, y: 46, width: 22, height: 40, zIndex: 2, sortOrder: 11, defaultConfig: { variant: 'score-away', color: '#ffffff', fontWeight: 900, fontSize: 300, align: 'center' } },
      { name: 'Away Timeouts', widgetType: 'SCOREBOARD', x: 77, y: 88, width: 16, height: 6, zIndex: 2, sortOrder: 12, defaultConfig: { variant: 'sb-timeouts-away', team: 'away', fontSize: 40 } },
    ],
  },
  // ── Quick Scoreboard (one-piece). The single ready-made board widget
  // (MainScoreboardWidget) for an operator who just wants to drop one
  // thing and go — NOT individually editable. Use "Main Scoreboard"
  // above to customize element-by-element.
  {
    id: 'preset-sb-quick',
    name: '⚡ Quick Scoreboard (one-piece)',
    description: 'A single ready-made live board — drop it and go. The whole board is one widget (not individually editable). For full customization use Main Scoreboard.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#05070d',
    zones: [
      { name: 'Scoreboard', widgetType: 'SCOREBOARD', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0,
        defaultConfig: { variant: 'scoreboard-main' } },
    ],
  },
  // ── Main Ribbon (2026-05-19, NEW id — was preset-std-ribbon, a generic
  // 8-zone SCORE_HOME layout the operator called trash). Single full-bleed
  // zone rendering RibbonScoreboardWidget: a live score-follow anchor +
  // rotating sponsor/message reel that fills any ribbon pixel-chain. Old
  // id drops from source → archived. SPORTS-tagged in ensure-system-presets.
  {
    id: 'preset-main-ribbon',
    name: '🎗️ Main Ribbon',
    description: 'Perimeter ribbon board — live score-follow anchor (teams, score, clock, period) plus a rotating sponsor / message reel. Bind a game; resize for any panel chain (1920×192 → 11520×192).',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 1920, screenHeight: 192, bgColor: '#05070d',
    zones: [
      { name: 'Ribbon', widgetType: 'SCOREBOARD', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0,
        defaultConfig: { variant: 'ribbon-main' } },
    ],
  },
  // ── Main Scorebug (2026-05-19, NEW id — was preset-std-scorebug). Single
  // full-bleed zone rendering ScorebugWidget: compact transparent broadcast
  // overlay for OBS / streaming. 760×150 natural; transparent bg so it
  // composites over a video feed.
  {
    id: 'preset-main-scorebug',
    name: '📺 Main Scorebug',
    description: 'Broadcast / streaming overlay — compact team blocks + clock + period + per-sport situational line, transparent background. Drop into OBS as a browser source.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 800, screenHeight: 160, bgColor: 'transparent',
    zones: [
      { name: 'Scorebug', widgetType: 'SCOREBOARD', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0,
        defaultConfig: { variant: 'scorebug-main' } },
    ],
  },
  // ════════════════════════════════════════════════════════════════
  // 2026-05-20 — THREE genuinely-different scoreboard tiers (HS /
  // College / Pro). Operator: "the highschool college and pro
  // templates you have for scoreboard are identical." These are NOT
  // palette swaps — each is a distinct LAYOUT + typography + treatment
  // (designed by the design agent, positions measured from the live
  // mockups), and each is ELEMENT-BASED so every piece is individually
  // editable / draggable / brandable. Fonts fall back gracefully if not
  // loaded. SPORTS-tagged in ensure-system-presets.
  // ════════════════════════════════════════════════════════════════
  // HIGH SCHOOL — Friday-night gym. Big team blocks, chunky rounded
  // type, amber clock, high contrast.
  {
    id: 'preset-sb-hs',
    name: '🏀 Scoreboard · High School',
    description: 'Friday-night gym board — big team color blocks, chunky rounded type, bright amber clock. Every element editable. Bind a game; resize for any LED.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#0a1628',
    zones: [
      { name: 'Home Logo', widgetType: 'SCOREBOARD', x: 10, y: 9, width: 12, height: 21, zIndex: 2, sortOrder: 0, defaultConfig: { variant: 'sb-team-logo-home', team: 'home' } },
      { name: 'Home Name', widgetType: 'SCOREBOARD', x: 0, y: 33, width: 32, height: 8, zIndex: 2, sortOrder: 1, defaultConfig: { variant: 'sb-team-name-home', team: 'home', fontFamily: "'Baloo 2', sans-serif", fontWeight: 800, fontSize: 60 } },
      { name: 'Home Score', widgetType: 'SCORE_HOME', x: 0, y: 50, width: 32, height: 36, zIndex: 2, sortOrder: 2, defaultConfig: { variant: 'score-home', color: '#ffffff', fontWeight: 900, fontSize: 420, fontFamily: "'Baloo 2', sans-serif", align: 'center' } },
      { name: 'Away Logo', widgetType: 'SCOREBOARD', x: 78, y: 9, width: 12, height: 21, zIndex: 2, sortOrder: 3, defaultConfig: { variant: 'sb-team-logo-away', team: 'away' } },
      { name: 'Away Name', widgetType: 'SCOREBOARD', x: 68, y: 33, width: 32, height: 8, zIndex: 2, sortOrder: 4, defaultConfig: { variant: 'sb-team-name-away', team: 'away', fontFamily: "'Baloo 2', sans-serif", fontWeight: 800, fontSize: 60 } },
      { name: 'Away Score', widgetType: 'SCORE_AWAY', x: 68, y: 50, width: 32, height: 36, zIndex: 2, sortOrder: 5, defaultConfig: { variant: 'score-away', color: '#ffffff', fontWeight: 900, fontSize: 420, fontFamily: "'Baloo 2', sans-serif", align: 'center' } },
      { name: 'Period', widgetType: 'GAME_SEGMENT', x: 40, y: 17, width: 20, height: 9, zIndex: 2, sortOrder: 6, defaultConfig: { variant: 'game-segment', color: '#fde68a', fontWeight: 800, fontSize: 70, fontFamily: "'Baloo 2', sans-serif", align: 'center' } },
      { name: 'Clock', widgetType: 'GAME_CLOCK', x: 35, y: 29, width: 29, height: 27, zIndex: 2, sortOrder: 7, defaultConfig: { variant: 'game-clock', color: '#fbbf24', fontWeight: 900, fontSize: 200, fontFamily: "'Baloo 2', sans-serif", align: 'center' } },
      { name: 'Shot Clock', widgetType: 'SCOREBOARD', x: 56, y: 27, width: 10, height: 16, zIndex: 2, sortOrder: 8, defaultConfig: { variant: 'sb-shot-clock', color: '#ef4444', fontSize: 90 } },
      { name: 'Possession', widgetType: 'SCOREBOARD', x: 35, y: 60, width: 29, height: 8, zIndex: 2, sortOrder: 9, defaultConfig: { variant: 'sb-possession-arrow', accentColor: '#fbbf24', fontSize: 44 } },
      { name: 'Home Timeouts', widgetType: 'SCOREBOARD', x: 4, y: 88, width: 18, height: 7, zIndex: 2, sortOrder: 10, defaultConfig: { variant: 'sb-timeouts-home', team: 'home', fontSize: 40 } },
      { name: 'Away Timeouts', widgetType: 'SCOREBOARD', x: 78, y: 88, width: 18, height: 7, zIndex: 2, sortOrder: 11, defaultConfig: { variant: 'sb-timeouts-away', team: 'away', fontSize: 40 } },
    ],
  },
  // COLLEGE — ESPN broadcast. Centered clock-tower, condensed type,
  // possession arrows, full-width bottom stat strip.
  {
    id: 'preset-sb-college',
    name: '🎓 Scoreboard · College',
    description: 'Broadcast-style — centered clock tower, condensed type, possession arrows, bottom stat strip. Every element editable. Bind a game; resize for any LED.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#11151c',
    zones: [
      { name: 'Status', widgetType: 'SCOREBOARD', x: 34, y: 7, width: 32, height: 6, zIndex: 3, sortOrder: 0, defaultConfig: { variant: 'sb-status', fontSize: 34 } },
      { name: 'Clock', widgetType: 'GAME_CLOCK', x: 34, y: 14, width: 32, height: 20, zIndex: 2, sortOrder: 1, defaultConfig: { variant: 'game-clock', color: '#f8fafc', fontWeight: 700, fontSize: 200, fontFamily: "'Saira', 'Oswald', sans-serif", align: 'center' } },
      { name: 'Quarter', widgetType: 'GAME_SEGMENT', x: 34, y: 35, width: 32, height: 6, zIndex: 2, sortOrder: 2, defaultConfig: { variant: 'game-segment', color: '#94a3b8', fontWeight: 600, fontSize: 48, fontFamily: "'Saira', 'Oswald', sans-serif", align: 'center' } },
      { name: 'Shot Clock', widgetType: 'SCOREBOARD', x: 45, y: 43, width: 10, height: 12, zIndex: 2, sortOrder: 3, defaultConfig: { variant: 'sb-shot-clock', fontSize: 80 } },
      { name: 'Home Logo', widgetType: 'SCOREBOARD', x: 5, y: 14, width: 8, height: 14, zIndex: 2, sortOrder: 4, defaultConfig: { variant: 'sb-team-logo-home', team: 'home' } },
      { name: 'Home Name', widgetType: 'SCOREBOARD', x: 14, y: 16, width: 19, height: 7, zIndex: 2, sortOrder: 5, defaultConfig: { variant: 'sb-team-name-home', team: 'home', fontFamily: "'Saira', 'Oswald', sans-serif", fontWeight: 700, fontSize: 52, align: 'left' } },
      { name: 'Home Score', widgetType: 'SCORE_HOME', x: 4, y: 32, width: 31, height: 24, zIndex: 2, sortOrder: 6, defaultConfig: { variant: 'score-home', color: '#ffffff', fontWeight: 700, fontSize: 280, fontFamily: "'Saira', 'Oswald', sans-serif", align: 'center' } },
      { name: 'Home Possession', widgetType: 'SCOREBOARD', x: 24, y: 23, width: 5, height: 8, zIndex: 3, sortOrder: 7, defaultConfig: { variant: 'sb-possession-ball-home', team: 'home', fontSize: 40 } },
      { name: 'Away Logo', widgetType: 'SCOREBOARD', x: 87, y: 14, width: 8, height: 14, zIndex: 2, sortOrder: 8, defaultConfig: { variant: 'sb-team-logo-away', team: 'away' } },
      { name: 'Away Name', widgetType: 'SCOREBOARD', x: 67, y: 16, width: 19, height: 7, zIndex: 2, sortOrder: 9, defaultConfig: { variant: 'sb-team-name-away', team: 'away', fontFamily: "'Saira', 'Oswald', sans-serif", fontWeight: 700, fontSize: 52, align: 'right' } },
      { name: 'Away Score', widgetType: 'SCORE_AWAY', x: 65, y: 32, width: 31, height: 24, zIndex: 2, sortOrder: 10, defaultConfig: { variant: 'score-away', color: '#ffffff', fontWeight: 700, fontSize: 280, fontFamily: "'Saira', 'Oswald', sans-serif", align: 'center' } },
      { name: 'Away Possession', widgetType: 'SCOREBOARD', x: 71, y: 23, width: 5, height: 8, zIndex: 3, sortOrder: 11, defaultConfig: { variant: 'sb-possession-ball-away', team: 'away', fontSize: 40 } },
      { name: 'Home Fouls', widgetType: 'SCOREBOARD', x: 12, y: 86, width: 14, height: 10, zIndex: 2, sortOrder: 12, defaultConfig: { variant: 'sb-fouls-home', team: 'home', fontSize: 44 } },
      { name: 'Home Timeouts', widgetType: 'SCOREBOARD', x: 28, y: 87, width: 16, height: 7, zIndex: 2, sortOrder: 13, defaultConfig: { variant: 'sb-timeouts-home', team: 'home', fontSize: 36 } },
      { name: 'Away Timeouts', widgetType: 'SCOREBOARD', x: 56, y: 87, width: 16, height: 7, zIndex: 2, sortOrder: 14, defaultConfig: { variant: 'sb-timeouts-away', team: 'away', fontSize: 36 } },
      { name: 'Away Fouls', widgetType: 'SCOREBOARD', x: 74, y: 86, width: 14, height: 10, zIndex: 2, sortOrder: 15, defaultConfig: { variant: 'sb-fouls-away', team: 'away', fontSize: 44 } },
    ],
  },
  // PRO — jumbotron. Near-black, thin elegant type, glass scorebar with
  // a clock pod floating above, lower stat ribbon + sponsor slot.
  {
    id: 'preset-sb-pro',
    name: '🏆 Scoreboard · Pro',
    description: 'Jumbotron-grade — near-black, thin elegant type, glass scorebar with a floating clock pod, lower stat ribbon + sponsor slot. Every element editable. Bind a game; resize for any LED.',
    category: 'EVENTS', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#06080d',
    zones: [
      { name: 'Clock', widgetType: 'GAME_CLOCK', x: 37, y: 11, width: 26, height: 18, zIndex: 3, sortOrder: 0, defaultConfig: { variant: 'game-clock', color: '#e2f6ff', fontWeight: 500, fontSize: 170, fontFamily: "'Rajdhani', 'Exo 2', sans-serif", align: 'center' } },
      { name: 'Period', widgetType: 'GAME_SEGMENT', x: 37, y: 29, width: 26, height: 5, zIndex: 3, sortOrder: 1, defaultConfig: { variant: 'game-segment', color: '#67e8f9', fontWeight: 600, fontSize: 40, fontFamily: "'Rajdhani', 'Exo 2', sans-serif", align: 'center' } },
      { name: 'Shot Clock', widgetType: 'SCOREBOARD', x: 64, y: 11, width: 7, height: 12, zIndex: 3, sortOrder: 2, defaultConfig: { variant: 'sb-shot-clock', color: '#67e8f9', fontSize: 80 } },
      { name: 'Home Logo', widgetType: 'SCOREBOARD', x: 8, y: 42, width: 9, height: 16, zIndex: 2, sortOrder: 3, defaultConfig: { variant: 'sb-team-logo-home', team: 'home' } },
      { name: 'Home Name', widgetType: 'SCOREBOARD', x: 18, y: 41, width: 16, height: 6, zIndex: 2, sortOrder: 4, defaultConfig: { variant: 'sb-team-name-home', team: 'home', fontFamily: "'Rajdhani', 'Exo 2', sans-serif", fontWeight: 600, fontSize: 46, align: 'left' } },
      { name: 'Home Score', widgetType: 'SCORE_HOME', x: 34, y: 40, width: 14, height: 18, zIndex: 2, sortOrder: 5, defaultConfig: { variant: 'score-home', color: '#ffffff', fontWeight: 500, fontSize: 220, fontFamily: "'Rajdhani', 'Exo 2', sans-serif", align: 'center' } },
      { name: 'Away Logo', widgetType: 'SCOREBOARD', x: 83, y: 42, width: 9, height: 16, zIndex: 2, sortOrder: 6, defaultConfig: { variant: 'sb-team-logo-away', team: 'away' } },
      { name: 'Away Name', widgetType: 'SCOREBOARD', x: 66, y: 41, width: 16, height: 6, zIndex: 2, sortOrder: 7, defaultConfig: { variant: 'sb-team-name-away', team: 'away', fontFamily: "'Rajdhani', 'Exo 2', sans-serif", fontWeight: 600, fontSize: 46, align: 'right' } },
      { name: 'Away Score', widgetType: 'SCORE_AWAY', x: 52, y: 40, width: 14, height: 18, zIndex: 2, sortOrder: 8, defaultConfig: { variant: 'score-away', color: '#ffffff', fontWeight: 500, fontSize: 220, fontFamily: "'Rajdhani', 'Exo 2', sans-serif", align: 'center' } },
      { name: 'Home Timeouts', widgetType: 'SCOREBOARD', x: 8, y: 76, width: 18, height: 7, zIndex: 2, sortOrder: 9, defaultConfig: { variant: 'sb-timeouts-home', team: 'home', accentColor: '#67e8f9', fontSize: 34 } },
      { name: 'Possession', widgetType: 'SCOREBOARD', x: 44, y: 75, width: 12, height: 8, zIndex: 2, sortOrder: 10, defaultConfig: { variant: 'sb-possession-arrow', accentColor: '#67e8f9', fontSize: 40 } },
      { name: 'Away Timeouts', widgetType: 'SCOREBOARD', x: 74, y: 76, width: 18, height: 7, zIndex: 2, sortOrder: 11, defaultConfig: { variant: 'sb-timeouts-away', team: 'away', accentColor: '#67e8f9', fontSize: 34 } },
      { name: 'Sponsor', widgetType: 'SCOREBOARD', x: 30, y: 91, width: 40, height: 8, zIndex: 2, sortOrder: 12, defaultConfig: { variant: 'sb-sponsor', label: 'PRESENTED BY', fontSize: 34 } },
    ],
  },
  {
    id: 'preset-hs-caf-today',
    name: '🍴 Cafeteria — Today + Tomorrow',
    description: 'Live lunch-block countdown, rotating Special / Tomorrow / Harvest spotlight, per-dish dietary chips + photo thumbnails, safe ticker. Auto-fit text, portrait + landscape. 4K.',
    category: 'CAFETERIA_MENU', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0b1220',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/caf-today.html' } }],
  },
  {
    id: 'preset-hs-caf-counter',
    name: '🍽️ Cafeteria — Counter Plate',
    description: 'Single-line cafeteria counter: today\'s plate hero photo card, 5-day rotation strip, allergen badges. Restaurant-menu polish. 4K landscape.',
    category: 'CAFETERIA_MENU', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fef9f2',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/caf-counter.html' } }],
  },
  {
    id: 'preset-hs-caf-week',
    name: '🍱 Cafeteria — This Week',
    description: 'Week-at-a-glance menu grid: five day columns with per-day entrées + dietary chips, today highlighted, rotating spotlight. Auto-fit text, portrait + landscape. 4K.',
    category: 'CAFETERIA_MENU', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0b1220',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/caf-week.html' } }],
  },
  {
    id: 'preset-hs-caf-market',
    name: '🥗 Cafeteria — Food-Hall Market',
    description: '5-station food-hall directory: per-station chef + plate + price + allergen badges, week outlook strip, allergen ticker. Modern food-hall aesthetic. 4K landscape.',
    category: 'CAFETERIA_MENU', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#faf6f0',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/caf-market.html' } }],
  },
  {
    id: 'preset-hs-class-nownext',
    name: '📚 Classroom — Now / Next Agenda',
    description: 'In-room display for HS classrooms: current activity hero, period agenda timeline, do-now/exit-ticket cards. Editorial classroom aesthetic. 4K landscape.',
    category: 'CLASSROOM', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fafaf7',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/class-nownext.html' } }],
  },
  {
    id: 'preset-hs-class-subday',
    name: '🧑‍🏫 Classroom — Substitute Self-Running Plan',
    description: 'Substitute teacher self-running display: sub intro + photo, 5-step timed plan, 6 classroom rules, 4 ask-the-class prompts. Reads like a worksheet. 4K landscape.',
    category: 'CLASSROOM', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fffaf0',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/class-subday.html' } }],
  },
  {
    id: 'preset-hs-hall-bulletin',
    name: '📌 Bulletin Board · Hallway',
    description: 'A real cork board in a wooden frame: speckled cork, pinned index cards with push-pins + washi-tape corners + slight rotation, one big spotlight card, a photo card with a photo slot, an announcement note, a live "today\'s bells" strip, a paper-banner ticker. 4K, both orientations.',
    category: 'HALLWAY_DISPLAY', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#b6863f',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/hall-bulletin.html' } }],
  },
  {
    id: 'preset-hs-hall-wayfinder',
    name: '🛫 Hallway — Departures Board',
    description: 'Solari split-flap departures for transition periods: amber-on-black flap rows, classes as departures with room-as-gate and a live status column (ON TIME / BOARDING / DEPARTED), split-flap clock, PA ticker. 4K, both orientations.',
    category: 'HALLWAY_DISPLAY', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#080808',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/hall-wayfinder.html' } }],
  },
  // ─── MS Pack — Arcade + Atlas (more in pipeline) ───────────────
  // Approved 2026-04-25 — matches scratch/design/arcade-ms-v2.html.
  // React widget at apps/web/src/components/widgets/ms/MsArcadeWidget.tsx.
  // Five more (fieldnotes, greenhouse, homeroom, paper, playlist,
  // studio) are still HTML mockups awaiting React port.
  {
    id: 'preset-ms-arcade',
    name: '🕹️ Arcade — Quest Log & Leaderboard',
    description: 'Retro game-HUD lobby — pixel borders, chunky 8-bit type, quest-log agenda, XP bar countdown, top-scores leaderboard, BOSS BATTLE × news ticker bottom bar. Press Start 2P + VT323 + Space Grotesk.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0d0d1a',
    zones: [{ name: 'Scene', widgetType: 'MS_ARCADE', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  // Approved 2026-04-25 — matches scratch/design/atlas-ms-v2.html.
  // React widget at apps/web/src/components/widgets/ms/MsAtlasWidget.tsx.
  {
    id: 'preset-ms-atlas',
    name: '🗺️ Atlas — Travel Poster & Subway Lines',
    description: 'Premium travel-poster lobby — paper-and-ink cartography, compass rose, campus map with numbered pins, four transit-style route cards (Morning / Afternoon / Lunch / Clubs), destination spotlight, scrolling news ticker. Work Sans + Playfair Display + DM Mono.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f4ecd8',
    zones: [{ name: 'Scene', widgetType: 'MS_ATLAS', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  // Approved 2026-04-25 — matches scratch/design/fieldnotes-ms-v2.html.
  {
    id: 'preset-ms-fieldnotes',
    name: '🪶 Field Notes — Naturalist Journal',
    description: 'Field-journal lobby — kraft-paper sketchbook with hand-drawn observations, watercolor specimen swatches, naturalist diagrams, log entries with compass bearings, daily species spotlight. Caveat + IM Fell + Work Sans.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#efe6d2',
    zones: [{ name: 'Scene', widgetType: 'MS_FIELDNOTES', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  // Approved 2026-04-25 — matches scratch/design/greenhouse-ms-v2.html.
  {
    id: 'preset-ms-greenhouse',
    name: '🌿 Greenhouse — Herbarium Specimen Plate',
    description: 'Botanical herbarium lobby — pressed-specimen plate with seed-packet club cards, brass instrument gauges, terracotta announcement notice, almanac countdown, signposts. Cormorant Garamond + IM Fell English + Caveat.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f3ead4',
    zones: [{ name: 'Scene', widgetType: 'MS_GREENHOUSE', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  // Approved 2026-04-25 — matches scratch/design/homeroom-ms-v2.html.
  {
    id: 'preset-ms-homeroom',
    name: '🏫 Homeroom — Classroom Bulletin',
    description: 'Classroom-bulletin lobby — slate chalkboard, sticky notes pinned to corkboard, student-of-the-week polaroid, tabbed binder agenda, rubber-band tape lab schedule, school-spirit pennant. Work Sans + Caveat + Source Code Pro.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f6f3ec',
    zones: [{ name: 'Scene', widgetType: 'MS_HOMEROOM', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  // Approved 2026-04-25 — matches scratch/design/paper-ms-v2.html.
  {
    id: 'preset-ms-paper',
    name: '📰 Paper — Daily Broadsheet',
    description: 'Vintage broadsheet lobby — newspaper masthead, three-column lead story with drop cap and pullquote, halftone photo card, agenda index sidebar, departments band (Dining / After 3 / Seen Today), stop-press bulletin ticker. Playfair Display + Old Standard + Work Sans.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f7f1e3',
    zones: [{ name: 'Scene', widgetType: 'MS_PAPER', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  // Approved 2026-04-25 — matches scratch/design/playlist-ms-v2.html.
  {
    id: 'preset-ms-playlist',
    name: '🎧 Playlist — Spotify-Style Now Playing',
    description: 'Music-app lobby — dark Spotify aesthetic with album-cover queue, "now playing" hero card, today\'s rotation as a track list, equalizer bars, social proof "listening now," genre chips. Inter + Outfit + JetBrains Mono.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f0f12',
    zones: [{ name: 'Scene', widgetType: 'MS_PLAYLIST', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  // Approved 2026-04-25 — matches scratch/design/studio-ms-v2.html.
  {
    id: 'preset-ms-studio',
    name: '🎙️ Studio — On-Air Radio Booth',
    description: 'Radio-station lobby — ON AIR sign, cassette spool cassette art, vintage VU meters, console fader strip, today\'s playlist queue, caller queue, weather + clock tiles. Space Grotesk + JetBrains Mono + Bricolage Grotesque.',
    category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#1b1410',
    zones: [{ name: 'Scene', widgetType: 'MS_STUDIO', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },

  // ─── MS pack — portrait variants (2160×3840) ───────────────────
  // Each landscape preset has a portrait sibling with id pattern
  // `<landscape-id>-portrait`. The /templates gallery filters out
  // -portrait suffixes from the main grid and surfaces them only via
  // the landscape card's orientation toggle.
  {
    id: 'preset-ms-arcade-portrait',
    name: '🕹️ Arcade — Portrait',
    description: 'Vertical 4K portrait of the Arcade lobby. Same retro game-HUD aesthetic, redesigned for portrait reading — single-column quest log, vertical leaderboard, BOSS BATTLE × news ticker bottom bar.',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0d0d1a',
    zones: [{ name: 'Scene', widgetType: 'MS_ARCADE_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-ms-atlas-portrait',
    name: '🗺️ Atlas — Portrait',
    description: 'Vertical 4K portrait of the Atlas lobby. Travel-poster cartography redesigned for portrait — full-width hero poster, almanac, four transit cards stacked vertically.',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#f4ecd8',
    zones: [{ name: 'Scene', widgetType: 'MS_ATLAS_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-ms-fieldnotes-portrait',
    name: '🪶 Field Notes — Portrait',
    description: 'Vertical 4K portrait of the Field Notes lobby. Naturalist field-journal aesthetic redesigned for portrait — full-width specimen card, agenda as tall column, P.S. ribbon ticker.',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#efe6d2',
    zones: [{ name: 'Scene', widgetType: 'MS_FIELDNOTES_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-ms-greenhouse-portrait',
    name: '🌿 Greenhouse — Portrait',
    description: 'Vertical 4K portrait of the Greenhouse lobby. Botanical herbarium aesthetic redesigned for portrait — large herbarium plate hero, vertical specimen index, three seed-packet club cards.',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#f3ead4',
    zones: [{ name: 'Scene', widgetType: 'MS_GREENHOUSE_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-ms-homeroom-portrait',
    name: '🏫 Homeroom — Portrait',
    description: 'Vertical 4K portrait of the Homeroom lobby. Classroom-bulletin aesthetic redesigned for portrait — chalkboard hero, tall corkboard agenda with 7 pinned index cards, manila folder clubs.',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#f6f3ec',
    zones: [{ name: 'Scene', widgetType: 'MS_HOMEROOM_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-ms-paper-portrait',
    name: '📰 Paper — Portrait',
    description: 'Vertical 4K portrait of the Paper lobby. Vintage broadsheet (real broadsheets ARE portrait) — full masthead, lead story column with drop-cap, halftone photo card, departments band, stop-press ticker.',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#f7f1e3',
    zones: [{ name: 'Scene', widgetType: 'MS_PAPER_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-ms-playlist-portrait',
    name: '🎧 Playlist — Portrait',
    description: 'Vertical 4K portrait of the Playlist lobby. Spotify mobile-app aesthetic — large square album cover, transport controls, vertical Up Next queue, alert + ticker bottom.',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0f0f12',
    zones: [{ name: 'Scene', widgetType: 'MS_PLAYLIST_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-ms-studio-portrait',
    name: '🎙️ Studio — Portrait',
    description: 'Vertical 4K portrait of the Studio lobby. Radio-booth aesthetic — turntable + VU meter side-by-side, mixer console, 4 cassettes stacked vertically, single combined footer bar.',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#1b1410',
    zones: [{ name: 'Scene', widgetType: 'MS_STUDIO_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
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
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fef3c7',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_CAFETERIA_FOODTRUCK', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-bus-board',
    name: '🚌 Animated Bus Route Board',
    description: 'School-bus route board — driving-bus graphic, animated road, route rows with ETAs, late warnings, next-bus countdown.',
    category: 'INFO', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fde68a',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_BUS_BOARD', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-main-entrance',
    name: '🏛️ Animated Main Entrance Welcome',
    description: 'Grand-entrance welcome board — marquee bulbs, heraldic crests, three info tiles, balloon cluster, ticker.',
    category: 'ENTRY', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#1e1b4b',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_MAIN_ENTRANCE', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-hallway-schedule',
    name: '📘 Animated Hallway Schedule',
    description: 'Notebook-paper hallway schedule — class periods list, current-period auto-highlight, weather + announcement cards, ticker.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fef3c7',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_HALLWAY_SCHEDULE', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  // 🔔/📺/🏆 — converted to flagship EXTERNAL_HTML (2026-06-08 designer batch).
  // Were React widgets (ANIMATED_BELL_SCHEDULE / _MORNING_NEWS /
  // _ACHIEVEMENT_SHOWCASE); rebuilt as self-contained 3840×2160 boards under
  // public/templates/hs/ with the V6 click-to-edit shim, canonical brand tokens,
  // auto-fit (≥50px floor), photo slots, and the §4a live schedule engine
  // (bell-schedule + morning-news). The orphaned React widgets are left in place
  // (out of scope) but no preset points at them anymore. Matching `— Portrait`
  // presets still use the React portrait widgets (left as-is).
  {
    id: 'preset-bell-schedule',
    name: '🔔 Animated Bell Schedule',
    description: 'Live bell-schedule board — big NOW clock, current-period hero with live countdown to the next bell + progress bar, full-day period timeline that lights the live period.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0b1224',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/bell-schedule.html' } }],
  },
  {
    id: 'preset-morning-news',
    name: '📺 Animated Morning News',
    description: 'TV-newsroom daily digest — REC studio bar, breaking banner, top-story hero with photo slot, live "Today\'s Rundown" with time chips, forecast strip, news crawl.',
    category: 'LOBBY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#070c1e',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/morning-news.html' } }],
  },
  {
    id: 'preset-achievement-showcase',
    name: '🏆 Animated Achievement Showcase',
    description: 'Award-ceremony wall of fame — gold/silver/bronze podium, student-of-the-week hero with photo slot + citation, honor-roll columns, stat chips, ovation ticker.',
    category: 'LOBBY', orientation: 'LANDSCAPE', schoolLevel: 'UNIVERSAL',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#1a1206',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/hs/achievement.html' } }],
  },
  // Scrapbook + Storybook retagged ELEMENTARY (was UNIVERSAL) —
  // polaroid/washi-tape and illuminated-drop-cap aesthetics read as
  // clearly elementary, and the user reported them showing up under
  // the High School filter ("Story Time is elementary"). UNIVERSAL
  // templates appear in every filter (filter allows UNIVERSAL + the
  // selected level), so these were visible under MS and HS which is
  // the wrong default. Operators who want to use them at HS can still
  // pick them from the All-ages view.
  {
    id: 'preset-scrapbook-hallway',
    name: '📸 Scrapbook · Hallway',
    description: 'Scrapbook hallway board — polaroids, washi tape, handwritten fonts, attendance, announcements, ticker.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fff7ed',
    zones: [{ name: 'Scene', widgetType: 'SCRAPBOOK_HALLWAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-scrapbook-cafeteria',
    name: '📸 Scrapbook · Cafeteria',
    description: 'Scrapbook cafeteria menu — polaroid plate, washi-tape menu cards, handwritten allergen notes.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fff7ed',
    zones: [{ name: 'Scene', widgetType: 'SCRAPBOOK_CAFETERIA', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-storybook-hallway',
    name: '📖 Storybook · Hallway',
    description: 'Open-book hallway layout — center spine, illuminated drop cap, parchment pages, schedule + attendance, page numbers.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f5f0dc',
    zones: [{ name: 'Scene', widgetType: 'STORYBOOK_HALLWAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-storybook-cafeteria',
    name: '📖 Storybook · Cafeteria',
    description: 'Open-book cafeteria menu — parchment pages, illuminated drop cap, chef’s note, multi-period countdown.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f5f0dc',
    zones: [{ name: 'Scene', widgetType: 'STORYBOOK_CAFETERIA', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-bulletin-hallway',
    name: '📌 Bulletin Board · Hallway',
    description: 'Cork-board hallway layout — pinned index cards, washi tape corners, schedule rows, attendance pin.',
    category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#c08457',
    zones: [{ name: 'Scene', widgetType: 'BULLETIN_HALLWAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-bulletin-cafeteria',
    name: '📌 Bulletin Board · Cafeteria',
    description: 'Cork-board cafeteria menu — pinned plate polaroid, index-card menu items, chef’s memo card.',
    category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#c08457',
    zones: [{ name: 'Scene', widgetType: 'BULLETIN_CAFETERIA', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-achievement-showcase-portrait',
    name: '🏆 Animated Achievement Showcase — Portrait',
    description: 'Award ceremony scene built FOR portrait — medal stack hero, full-width student-of-the-week, two-column honor roll, 4-up stats, trophy ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY', orientation: 'PORTRAIT', schoolLevel: 'UNIVERSAL',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#fef3c7',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_ACHIEVEMENT_SHOWCASE_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-bell-schedule-portrait',
    name: '🔔 Animated Bell Schedule — Portrait',
    description: 'Bell schedule built FOR portrait — gradient title centered, NOW clock pinned below, full-width current-period hero with bell-in countdown, full-width period timeline, ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'HALLWAY', orientation: 'PORTRAIT', schoolLevel: 'UNIVERSAL',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_BELL_SCHEDULE_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-bulletin-cafeteria-portrait',
    name: '📌 Bulletin Board · Cafeteria — Portrait',
    description: 'Cork-board cafeteria menu built FOR portrait — pinned banner header, polaroid plate hero, 2x3 index-card menu grid with allergen badges, chef\'s memo card on yellow lined paper, allergen ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'CAFETERIA', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#c08457',
    zones: [{ name: 'Scene', widgetType: 'BULLETIN_CAFETERIA_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-bulletin-hallway-portrait',
    name: '📌 Bulletin Board · Hallway — Portrait',
    description: 'Cork-board hallway layout built FOR portrait — pinned banner + 3-pin row, 7 index-card schedule rows with notebook lines, oversized attendance polaroid, sticky-note announcement + countdown ticket two-up, "HALLWAY NEWS" ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'HALLWAY', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#c08457',
    zones: [{ name: 'Scene', widgetType: 'BULLETIN_HALLWAY_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-bus-board-portrait',
    name: '🚌 Animated Bus Route Board — Portrait',
    description: 'Bus route board built FOR portrait — driving-bus header, full-width animated road, 7 route rows with ETAs, next-bus countdown hero, weather pill, late-bus ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'INFO', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#fde68a',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_BUS_BOARD_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-cafeteria-animated-high-portrait',
    name: '☕ Animated Cafeteria · High School — Portrait',
    description: 'Neon-sunset HS café menu board built FOR portrait — steaming coffee cup + neon CAFÉ sign + clock pill header, full-width featured-of-the-day hero, tilted weekly receipt-style menu, trophy + yearbook two-up, allergen icon strip, magenta-violet ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'CAFETERIA', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#111827',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_CAFETERIA_HS_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-cafeteria-animated-middle-portrait',
    name: '🏟️ Animated Cafeteria · Middle School — Portrait',
    description: 'Varsity / stadium-styled cafeteria menu board built FOR portrait — pennant bunting + varsity-letter logo, scoreboard hero with bulb perimeter, Mon-Fri tab strip + featured menu, chef polaroid + birthdays two-up, allergen icons strip, PA-system ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'CAFETERIA', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_CAFETERIA_MS_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-cafeteria-chalkboard-portrait',
    name: '🌿 Animated Cafeteria · Chalkboard — Portrait',
    description: 'Green-chalkboard menu board built FOR portrait — wooden frame border, chalk-textured "TODAY\'S MENU" headline with chalk-streak underline, dashed-frame featured hero, 5-row weekly board with "TODAY" pill, tilted chef\'s note, eraser-streak nutrition strip, ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'CAFETERIA', orientation: 'PORTRAIT', schoolLevel: 'UNIVERSAL',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#1f3b2a',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_CAFETERIA_CHALKBOARD_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-cafeteria-foodtruck-portrait',
    name: '🚚 Animated Cafeteria · Food Truck — Portrait',
    description: 'Food-truck cafeteria built FOR portrait — string lights across the top, truck + neon BUNGEE board + giant clock, full-width pickup-special banner, tall chalkboard menu, full-width countdown burst, chef + birthdays two-up, ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'CAFETERIA', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#fef3c7',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_CAFETERIA_FOODTRUCK_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-hallway-schedule-portrait',
    name: '📘 Animated Hallway Schedule — Portrait',
    description: 'Notebook-paper hallway schedule built FOR portrait — title band on top, full-width period notebook, attendance hero card, clock + weather two-up, countdown, announcement, ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'HALLWAY', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#fef3c7',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_HALLWAY_SCHEDULE_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-hs-blueprint-portrait',
    name: '📐 Blueprint — Portrait',
    description: 'Architect blueprint lobby built FOR portrait — cyan grid paper, title-block header, vertical floor-plan elevation with dimensioned callouts, schedule-as-drawings table, revision-log ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0f3a7a',
    zones: [{ name: 'Scene', widgetType: 'HS_BLUEPRINT_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-hs-broadcast-portrait',
    name: '📺 Broadcast — Portrait',
    description: 'Newsroom lower-thirds lobby built FOR portrait — ON AIR red lamp + station clock header, full-width featured-guest hero with anchor CSS-art + lower-third banner, breaking-story card, 2-up forecast + coming-up panel, bottom news crawl. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0b1025',
    zones: [{ name: 'Scene', widgetType: 'HS_BROADCAST_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-hs-gallery-portrait',
    name: '🏛️ Gallery — Portrait',
    description: 'Museum-catalog lobby built FOR portrait — italic EB Garamond plaque header, gilt-bordered featured frame + acquisition card, Roman-numeral programme list, artist-statement quote, Curator\'s Note advisory, docent ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#f5f1e8',
    zones: [{ name: 'Scene', widgetType: 'HS_GALLERY_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-hs-terminal-portrait',
    name: '💻 Terminal — Portrait',
    description: 'CRT monitor lobby built FOR portrait — VT323 host:path banner with blinking cursor + uptime pill, whoami teacher card, full-width crontab events log, tail -f announcements alert, uname -a facts strip, syslog ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#060f06',
    zones: [{ name: 'Scene', widgetType: 'HS_TERMINAL_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-hs-transit-portrait',
    name: '✈️ Transit — Portrait',
    description: 'Departure-board lobby built FOR portrait — airport mast header, FLIGHT INFO TODAY featured-flight card with giant gate plinth, 7-row split-flap departures table, today\'s crew teacher spotlight, advisory + countdown, PA ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0a0f1c',
    zones: [{ name: 'Scene', widgetType: 'HS_TRANSIT_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-hs-varsity-portrait',
    name: '🏟️ Varsity — Portrait',
    description: 'Game-day scoreboard lobby built FOR portrait — pennant bunting, hex-shield crest, full-width scoreboard hero, athlete-of-the-week trading card, 5-row schedule, highlight ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0d1b3d',
    zones: [{ name: 'Scene', widgetType: 'HS_VARSITY_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-hs-yearbook-portrait',
    name: '📰 Yearbook — Portrait',
    description: 'Magazine-spread lobby built FOR portrait — Playfair masthead with EST. flags, halftone featured-photo article, illuminated drop-cap lede in 2 columns, pull-quote portrait card, calendar folio, wire ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#f7f3ea',
    zones: [{ name: 'Scene', widgetType: 'HS_YEARBOOK_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-hs-zine-portrait',
    name: '✂️ Zine — Portrait',
    description: 'DIY student-zine lobby built FOR portrait — ransom-letter banner on washi tape, photocopy sheet with marker headline + highlighter swipe, 2x2 polaroid grid with washi corners, WHO\'S WHO featured-student polaroid with marker callouts, ransom alert, XEROXWIRE ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY_WELCOME', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#f2ecd9',
    zones: [{ name: 'Scene', widgetType: 'HS_ZINE_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-main-entrance-portrait',
    name: '🏛️ Animated Main Entrance Welcome — Portrait',
    description: 'Grand-entrance welcome board built FOR portrait — hanging WELCOME sign with chains, three full-width info tiles (bell time / weather / coming up), hexagonal crests, ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'ENTRY', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#1e1b4b',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_MAIN_ENTRANCE_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-morning-news-portrait',
    name: '📺 Animated Morning News — Portrait',
    description: 'TV-newsroom daily digest built FOR portrait — LIVE/ON-AIR header, full-width anchor desk CSS-art, weather + lunch two-up, pledge card, full-width ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY', orientation: 'PORTRAIT', schoolLevel: 'UNIVERSAL',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0b1220',
    zones: [{ name: 'Scene', widgetType: 'ANIMATED_MORNING_NEWS_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-scrapbook-cafeteria-portrait',
    name: '📸 Scrapbook · Cafeteria — Portrait',
    description: 'Scrapbook cafeteria menu built FOR portrait — washi-taped header polaroids, full-width photo polaroid hero, 2x3 washi-taped menu card grid with allergen badges, lined-paper note with countdown, handwritten ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'CAFETERIA', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#fff7ed',
    zones: [{ name: 'Scene', widgetType: 'SCRAPBOOK_CAFETERIA_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-scrapbook-hallway-portrait',
    name: '📸 Scrapbook · Hallway — Portrait',
    description: 'Scrapbook hallway board built FOR portrait — washi-taped HALLWAY banner + day/clock polaroids, 7 lined-paper polaroid schedule rows, oversized attendance polaroid with SVG checkmark, dashed-amber announcement + pink countdown polaroid two-up, double-bordered ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'HALLWAY', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#fff7ed',
    zones: [{ name: 'Scene', widgetType: 'SCRAPBOOK_HALLWAY_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-storybook-cafeteria-portrait',
    name: '📖 Storybook · Cafeteria — Portrait',
    description: 'Open-book cafeteria menu built FOR portrait — parchment page with double border + corner flourishes + ribbon bookmark, illuminated TODAY\'S FEAST title with drop-cap halo, full-width chapter card, dotted-leader weekly TOC with today highlight, wax-sealed chef\'s note. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'CAFETERIA', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#f5f0dc',
    zones: [{ name: 'Scene', widgetType: 'STORYBOOK_CAFETERIA_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
{
    id: 'preset-storybook-hallway-portrait',
    name: '📖 Storybook · Hallway — Portrait',
    description: 'Open-book hallway layout built FOR portrait — single tall illuminated parchment page, double-border gold/brown frame, scrollwork corners, ribbon bookmark, illuminated drop-cap title, period chapter list with roman-numeral medallions, illuminated attendance card, hourglass countdown, page-numbered ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'HALLWAY', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#f5f0dc',
    zones: [{ name: 'Scene', widgetType: 'STORYBOOK_HALLWAY_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-lobby-animated-middle-portrait',
    name: '🏟️ Animated Middle School · Welcome — Portrait',
    description: 'Full-screen ANIMATED middle-school welcome built FOR portrait — stadium spotlights + pennant bunting, scoreboard clock with bulb perimeter, varsity teacher polaroid + megaphone announcement two-up, stopwatch countdown, layered birthdays cake, LED ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY', orientation: 'PORTRAIT', schoolLevel: 'MIDDLE',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#0f172a',
    bgGradient: 'linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#0f172a 100%)',
    zones: [{ name: 'Animated Welcome Scene (Middle School)', widgetType: 'ANIMATED_WELCOME_MS_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-lobby-animated-high-portrait',
    name: '🎓 Animated High School · Welcome — Portrait',
    description: 'Full-screen ANIMATED high-school welcome built FOR portrait — sunset palette, grad-cap logo with animated tassel, neon WELCOME banner, sunburst clock + sun-disc weather, yearbook teacher polaroid + speech-bubble announcement, golden trophy countdown, confetti birthdays, sunset ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'LOBBY', orientation: 'PORTRAIT', schoolLevel: 'HIGH',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#fce7f3',
    bgGradient: 'linear-gradient(180deg,#fce7f3 0%,#ffe4e6 30%,#fef3c7 70%,#fed7aa 100%)',
    zones: [{ name: 'Animated Welcome Scene (High School)', widgetType: 'ANIMATED_WELCOME_HS_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },
  {
    id: 'preset-cafeteria-animated-elementary-portrait',
    name: '🍽️ Animated Cafeteria · Elementary — Portrait',
    description: 'Elementary cafeteria menu board built FOR portrait — neon TODAY\'S LUNCH header with marquee bulbs, Mon-Fri tab strip, swinging Pickup Special banner, chalkboard 2x3 food card grid, chef polaroid + sunburst countdown, birthdays ribbon, allergen ticker. Real vertical layout, not letterboxed. · 4K portrait',
    category: 'CAFETERIA', orientation: 'PORTRAIT', schoolLevel: 'ELEMENTARY',
    screenWidth: 2160, screenHeight: 3840, bgColor: '#fce7f3',
    bgGradient: 'linear-gradient(180deg,#fce7f3 0%,#ffe4e6 35%,#fef3c7 75%,#fed7aa 100%)',
    zones: [{ name: 'Animated Cafeteria Scene', widgetType: 'ANIMATED_CAFETERIA_PORTRAIT', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
  },

  // ───────────────────────────────────────────────────────────────
  // HOLIDAY PACK — 18 templates (6 holidays × 3 grade levels).
  // Imported from the holiday HTML zip. Each renders a full-canvas
  // designed scene from /public/holiday-templates/*.html via the
  // HolidayWidget iframe. Operator picks the matching grade level
  // and holiday in the templates page sub-filter.
  //
  // The user said "these need a ton of work" — these are the v1 import.
  // Real design polish per template lands as individual iteration loops
  // post-launch (per CLAUDE.md "no batching" rule).
  // ───────────────────────────────────────────────────────────────

  // ─── Halloween (October) ─────────────────────────────────────────
  {
    id: 'preset-holiday-halloween-es',
    name: '🎃 Halloween — Elementary',
    description: 'Spooky-but-friendly Halloween lobby — pumpkins, friendly ghosts, candy stripes. Designed for elementary lobbies in October.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#1a0a2a',
    zones: [{ name: 'Halloween Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'halloween', gradeLevel: 'es' } }],
  },
  {
    id: 'preset-holiday-halloween-ms',
    name: '🎃 Halloween — Middle School',
    description: 'Halloween lobby tuned for middle school — cooler palette, less cartoony, more design-savvy. October install.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f0a1a',
    zones: [{ name: 'Halloween Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'halloween', gradeLevel: 'ms' } }],
  },
  {
    id: 'preset-holiday-halloween-hs',
    name: '🎃 Halloween — High School',
    description: 'Editorial-grade Halloween lobby — typographic, vintage poster aesthetic, monster movie vibe.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0a0a0a',
    zones: [{ name: 'Halloween Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'halloween', gradeLevel: 'hs' } }],
  },

  // ─── Thanksgiving (November) ─────────────────────────────────────
  {
    id: 'preset-holiday-thanksgiving-es',
    name: '🦃 Thanksgiving — Elementary',
    description: 'Warm autumn Thanksgiving lobby for elementary — turkeys, fall leaves, gratitude messages.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#5a2a0a',
    zones: [{ name: 'Thanksgiving Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'thanksgiving', gradeLevel: 'es' } }],
  },
  {
    id: 'preset-holiday-thanksgiving-ms',
    name: '🦃 Thanksgiving — Middle School',
    description: 'Thanksgiving lobby for middle school — harvest table aesthetic, autumn typography.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#3a1a0a',
    zones: [{ name: 'Thanksgiving Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'thanksgiving', gradeLevel: 'ms' } }],
  },
  {
    id: 'preset-holiday-thanksgiving-hs',
    name: '🦃 Thanksgiving — High School',
    description: 'Vintage-magazine Thanksgiving lobby — hand-letterpress feel, deep amber palette.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#2a1208',
    zones: [{ name: 'Thanksgiving Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'thanksgiving', gradeLevel: 'hs' } }],
  },

  // ─── Christmas (December) ────────────────────────────────────────
  {
    id: 'preset-holiday-christmas-es',
    name: '🎄 Christmas — Elementary',
    description: 'North Pole workshop lobby — candy stripes, snowfall, advent calendar countdown, friendly trees.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#1a2840',
    zones: [{ name: 'Christmas Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'christmas', gradeLevel: 'es' } }],
  },
  {
    id: 'preset-holiday-christmas-ms',
    name: '🎄 Christmas — Middle School',
    description: 'Holiday lobby with middle-school energy — playful but polished, festive without being saccharine.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0e2a40',
    zones: [{ name: 'Christmas Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'christmas', gradeLevel: 'ms' } }],
  },
  {
    id: 'preset-holiday-christmas-hs',
    name: '🎄 Christmas — High School',
    description: 'Vintage department-store / varsity letter-jacket Christmas lobby — Bebas + Fraunces, deep green & cream.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0e3a26',
    zones: [{ name: 'Christmas Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'christmas', gradeLevel: 'hs' } }],
  },

  // ─── Valentine's Day (February) ──────────────────────────────────
  {
    id: 'preset-holiday-valentines-es',
    name: "💝 Valentine's Day — Elementary",
    description: "Pink-and-red Valentine's lobby for elementary — heart confetti, friendship messages, candy palette.",
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fdf2f8',
    zones: [{ name: "Valentine's Scene", widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'valentines', gradeLevel: 'es' } }],
  },
  {
    id: 'preset-holiday-valentines-ms',
    name: "💝 Valentine's Day — Middle School",
    description: "Valentine's lobby for middle school — kindness-week framing, heart motifs, paper-craft aesthetic.",
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fce7f3',
    zones: [{ name: "Valentine's Scene", widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'valentines', gradeLevel: 'ms' } }],
  },
  {
    id: 'preset-holiday-valentines-hs',
    name: "💝 Valentine's Day — High School",
    description: "Editorial Valentine's lobby — magazine-cover typography, deep crimson palette, sparing heart motifs.",
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#7a1a26',
    zones: [{ name: "Valentine's Scene", widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'valentines', gradeLevel: 'hs' } }],
  },

  // ─── St. Patrick's Day (March) ───────────────────────────────────
  {
    id: 'preset-holiday-stpatricks-es',
    name: "☘️ St. Patrick's Day — Elementary",
    description: "Lucky shamrocks + rainbow + leprechaun-friendly St. Patrick's lobby for elementary.",
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#1a4020',
    zones: [{ name: "St. Patrick's Scene", widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'stpatricks', gradeLevel: 'es' } }],
  },
  {
    id: 'preset-holiday-stpatricks-ms',
    name: "☘️ St. Patrick's Day — Middle School",
    description: "Irish-pub-meets-spirit-day St. Patrick's lobby — flag green palette, varsity-script title.",
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#143a1c',
    zones: [{ name: "St. Patrick's Scene", widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'stpatricks', gradeLevel: 'ms' } }],
  },
  {
    id: 'preset-holiday-stpatricks-hs',
    name: "☘️ St. Patrick's Day — High School",
    description: "Editorial St. Patrick's lobby — Celtic knotwork accents, deep emerald, cream serifs.",
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f3018',
    zones: [{ name: "St. Patrick's Scene", widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'stpatricks', gradeLevel: 'hs' } }],
  },

  // ─── Easter (April) ──────────────────────────────────────────────
  {
    id: 'preset-holiday-easter-es',
    name: '🐰 Easter — Elementary',
    description: 'Pastel Easter lobby for elementary — bunnies, decorated eggs, spring florals, soft palette.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fef9e7',
    zones: [{ name: 'Easter Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'easter', gradeLevel: 'es' } }],
  },
  {
    id: 'preset-holiday-easter-ms',
    name: '🐰 Easter — Middle School',
    description: 'Spring Easter lobby for middle school — confident pastels, paper-craft eggs, garden vibe.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#fce8f0',
    zones: [{ name: 'Easter Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'easter', gradeLevel: 'ms' } }],
  },
  {
    id: 'preset-holiday-easter-hs',
    name: '🐰 Easter — High School',
    description: 'Editorial Easter / spring lobby — typographic, sage + rose palette, restrained botanical motifs.',
    category: 'HOLIDAYS', orientation: 'LANDSCAPE', schoolLevel: 'HIGH',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#f4ede0',
    zones: [{ name: 'Easter Scene', widgetType: 'HOLIDAY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { variant: 'easter', gradeLevel: 'hs' } }],
  },

  // ════════════════════════════════════════════════════════════════
  // SANDBOX — exact copy of Animated Rainbow Welcome for safe iteration
  // ════════════════════════════════════════════════════════════════
  // 2026-05-14 — Operator: "your sample test teamplate is garbage,
  // just make a copy of the animated rainbow and lets use that as
  // our test teamplate". Exact duplicate of preset-lobby-animated-
  // rainbow (single ANIMATED_WELCOME zone, full canvas, same config)
  // with a new id + 🧪 emoji so we can iterate on widget / layout /
  // canvas changes against the same rendering pipeline the live
  // Rainbow template uses — without risking breakage to the live
  // preset. When we're confident in a change, we promote it back
  // into preset-lobby-animated-rainbow.
  {
    id: 'preset-sandbox-rainbow',
    name: '🧪 Sandbox · Rainbow Welcome (test)',
    description: 'Exact copy of Animated Rainbow Welcome for iterating on layout / canvas / widget experiments without touching the live preset. Identical widget + config; safe to break. Promote tested changes back into preset-lobby-animated-rainbow when ready.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: 'UNIVERSAL',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#BFE8FF',
    bgGradient: 'linear-gradient(180deg,#BFE8FF 0%,#FFE0EC 55%,#FFD8A8 100%)',
    zones: [
      {
        name: 'Animated Welcome Scene',
        widgetType: 'ANIMATED_WELCOME',
        x: 0, y: 0, width: 100, height: 100,
        zIndex: 1,
        sortOrder: 0,
        defaultConfig: {
          logoEmoji: '🍎',
          title: 'Welcome, Friends!',
          subtitle: 'today is going to be amazing ✨',
          weatherLocation: '',
          weatherUnits: 'imperial',
          announcementLabel: 'Big News',
          announcementMessage: 'Book Fair starts Monday! 📚 Come find your new favorite story.',
          countdownLabel: 'Field Trip in',
          countdownDate: '2026-05-30',
          teacherGender: 'female',
          teacherName: 'Mrs. Johnson',
          teacherRole: 'Teacher of the Week',
          birthdayNames: 'Maya · Eli · Sofia',
          tickerStamp: 'SCHOOL NEWS',
          tickerMessages: [
            'Welcome back, Stars! ⭐',
            'Picture day is Friday 📸',
            'Reading Challenge: 20 minutes a day 📖',
            'Parent-teacher conferences next Tuesday 👨‍👩‍👧',
          ],
        },
      },
    ],
  },
  // ─── Industry signage pack — 70 self-contained HTML templates ───
  // 2026-05-16 — bar / corporate / fashion / healthcare / hospitality /
  // menus-pos / qsr. Each is a 3840×2160 self-contained HTML doc under
  // /public/templates/signage/, rendered via the EXTERNAL_HTML widget
  // (one sandboxed iframe — a bad template can't reach the dashboard).
  {
    id: 'preset-sig-bar-01',
    name: "Bar · Tap List",
    description: "Tap List — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/01-tap-list-flagship.html' } }],
  },
  {
    id: 'preset-sig-bar-02',
    name: "Bar · Cocktails",
    description: "Cocktails — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/02-cocktail-menu.html' } }],
  },
  {
    id: 'preset-sig-bar-03',
    name: "Bar · Bottle List",
    description: "Bottle List — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/03-bottle-list.html' } }],
  },
  {
    id: 'preset-sig-bar-04',
    name: "Bar · Happy Hour",
    description: "Happy Hour — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/04-happy-hour.html' } }],
  },
  {
    id: 'preset-sig-bar-05',
    name: "Bar · Now Pouring",
    description: "Now Pouring — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/05-now-pouring.html' } }],
  },
  {
    id: 'preset-sig-bar-06',
    name: "Bar · Tonight",
    description: "Tonight — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/06-tonight-live.html' } }],
  },
  {
    id: 'preset-sig-bar-07',
    name: "Bar · Bottle Service",
    description: "Bottle Service — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/07-bottle-service.html' } }],
  },
  {
    id: 'preset-sig-bar-08',
    name: "Bar · Game Day",
    description: "Game Day — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/08-game-day.html' } }],
  },
  {
    id: 'preset-sig-bar-09',
    name: "Bar · Hours",
    description: "Hours — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/09-hours-location.html' } }],
  },
  {
    id: 'preset-sig-bar-10',
    name: "Bar · Hiring",
    description: "Hiring — 3840×2160 industry digital-signage template.",
    category: 'BAR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/bar/10-now-hiring.html' } }],
  },
  {
    id: 'preset-sig-corporate-01',
    name: "Corporate · Lobby",
    description: "Lobby — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/01-lobby-welcome-flagship.html' } }],
  },
  {
    id: 'preset-sig-corporate-02',
    name: "Corporate · Conference",
    description: "Conference — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/02-conference-room.html' } }],
  },
  {
    id: 'preset-sig-corporate-03',
    name: "Corporate · KPI Dashboard",
    description: "KPI Dashboard — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/03-kpi-dashboard.html' } }],
  },
  {
    id: 'preset-sig-corporate-04',
    name: "Corporate · New Hires",
    description: "New Hires — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/04-new-hires.html' } }],
  },
  {
    id: 'preset-sig-corporate-05',
    name: "Corporate · Floor Directory",
    description: "Floor Directory — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/05-floor-directory.html' } }],
  },
  {
    id: 'preset-sig-corporate-06',
    name: "Corporate · All Hands",
    description: "All Hands — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/06-all-hands.html' } }],
  },
  {
    id: 'preset-sig-corporate-07',
    name: "Corporate · Cafeteria",
    description: "Cafeteria — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/07-cafeteria.html' } }],
  },
  {
    id: 'preset-sig-corporate-08',
    name: "Corporate · Shuttle",
    description: "Shuttle — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/08-shuttle-board.html' } }],
  },
  {
    id: 'preset-sig-corporate-09',
    name: "Corporate · Events",
    description: "Events — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/09-events-week.html' } }],
  },
  {
    id: 'preset-sig-corporate-10',
    name: "Corporate · Emergency",
    description: "Emergency — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/10-emergency-info.html' } }],
  },
  {
    id: 'preset-sig-corporate-11',
    name: "Corporate · Signal",
    description: "Cinematic brand moment and event wayfinding board — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#05070d',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/11-corporate-signal.html' } }],
  },
  {
    // Codex 2026-07-23 release: a SEPARATE Corporate Signal option (Ribbon
    // Edition), kept alongside the newer 11-signal-beacon direction.
    id: 'preset-sig-corporate-12',
    name: "Corporate · Signal (Ribbon)",
    description: "Cinematic brand moment — Ribbon Edition — 3840×2160 industry digital-signage template.",
    category: 'CORPORATE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#05070d',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/12-signal-ribbon.html' } }],
  },
  {
    id: 'preset-sig-fashion-01',
    name: "Fashion · Lookbook",
    description: "Lookbook — 3840×2160 industry digital-signage template.",
    category: 'LOOKBOOK', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/01-lookbook-flagship.html' } }],
  },
  {
    id: 'preset-sig-fashion-02',
    name: "Fashion · Editorial",
    description: "Editorial — 3840×2160 industry digital-signage template.",
    category: 'LOOKBOOK', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/02-editorial.html' } }],
  },
  {
    id: 'preset-sig-fashion-03',
    name: "Fashion · Sale",
    description: "Sale — 3840×2160 industry digital-signage template.",
    category: 'PROMO', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/03-sale.html' } }],
  },
  {
    id: 'preset-sig-fashion-04',
    name: "Fashion · New Arrivals",
    description: "New Arrivals — 3840×2160 industry digital-signage template.",
    category: 'LOOKBOOK', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/04-new-arrivals.html' } }],
  },
  {
    id: 'preset-sig-fashion-05',
    name: "Fashion · Event",
    description: "Event — 3840×2160 industry digital-signage template.",
    category: 'PROMO', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/05-event-trunkshow.html' } }],
  },
  {
    id: 'preset-sig-fashion-06',
    name: "Fashion · Fitting",
    description: "Fitting — 3840×2160 industry digital-signage template.",
    category: 'LOBBY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/06-fitting-room.html' } }],
  },
  {
    id: 'preset-sig-fashion-07',
    name: "Fashion · Window",
    description: "Window — 3840×2160 industry digital-signage template.",
    category: 'LOOKBOOK', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/07-shoppable-window.html' } }],
  },
  {
    id: 'preset-sig-fashion-08',
    name: "Fashion · Campaign",
    description: "Campaign — 3840×2160 industry digital-signage template.",
    category: 'LOOKBOOK', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/08-campaign.html' } }],
  },
  {
    id: 'preset-sig-fashion-09',
    name: "Fashion · Hours",
    description: "Hours — 3840×2160 industry digital-signage template.",
    category: 'LOBBY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/09-hours-story.html' } }],
  },
  {
    id: 'preset-sig-fashion-10',
    name: "Fashion · Members",
    description: "Members — 3840×2160 industry digital-signage template.",
    category: 'PROMO', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/fashion/10-loyalty-member.html' } }],
  },
  // Store (retail) redesign set — codex 2026-07-23 release. 1920×1080 boards
  // (storefront / end-cap / wayfinding). Self-contained, editor-ready (baked
  // shim). Tagged RETAIL|FASHION via PRESET_VERTICALS so they show under both
  // Store and Boutique, like the fashion boards.
  {
    id: 'preset-sig-retail-01',
    name: "Store · Storefront — Gallery",
    description: "Storefront welcome — 1920×1080 industry digital-signage template.",
    category: 'LOBBY', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#f0ebe1',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/retail/01-storefront-gallery-threshold.html' } }],
  },
  {
    id: 'preset-sig-retail-02',
    name: "Store · Storefront — Aperture",
    description: "Storefront welcome — 1920×1080 industry digital-signage template.",
    category: 'LOBBY', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a0c',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/retail/02-storefront-aperture.html' } }],
  },
  {
    id: 'preset-sig-retail-03',
    name: "Store · End-Cap — Kinetic",
    description: "Featured end-cap — 1920×1080 industry digital-signage template.",
    category: 'PROMO', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#03060c',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/retail/03-endcap-kinetic.html' } }],
  },
  {
    id: 'preset-sig-retail-04',
    name: "Store · End-Cap — Object Study",
    description: "Featured end-cap — 1920×1080 industry digital-signage template.",
    category: 'PROMO', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#eee9df',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/retail/04-endcap-object-study.html' } }],
  },
  {
    id: 'preset-sig-retail-05',
    name: "Store · End-Cap — Drop Signal",
    description: "Featured end-cap — 1920×1080 industry digital-signage template.",
    category: 'PROMO', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#0a0a0a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/retail/05-endcap-drop-signal.html' } }],
  },
  {
    id: 'preset-sig-retail-06',
    name: "Store · Wayfinding — Signal",
    description: "Store directory / wayfinding — 1920×1080 industry digital-signage template.",
    category: 'LOBBY', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#07090c',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/retail/06-wayfinding-signal.html' } }],
  },
  {
    id: 'preset-sig-retail-07',
    name: "Store · Wayfinding — Daylight",
    description: "Store directory / wayfinding — 1920×1080 industry digital-signage template.",
    category: 'LOBBY', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#ffffff',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/retail/07-wayfinding-daylight.html' } }],
  },
  {
    id: 'preset-sig-retail-08',
    name: "Store · Wayfinding — Monolith",
    description: "Store directory / wayfinding — 1920×1080 industry digital-signage template.",
    category: 'LOBBY', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#080a0d',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/retail/08-wayfinding-monolith.html' } }],
  },
  // ── Worship redesign set (codex, 2026-07-24) — 8 jobs x 3 directions.
  //    Self-contained 1920x1080 boards (shared church-*-core runtime inlined),
  //    fully editable via the baked educms protocol. Replaces the older
  //    React-zone worship-* presets once verified live.
  {
    id: 'preset-sig-worship-01',
    name: 'Worship · Welcome — Common Ground',
    description: 'Welcome — Common Ground. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/welcome-v1-common-ground.html' } }],
  },
  {
    id: 'preset-sig-worship-02',
    name: 'Worship · Welcome — Sacred Light',
    description: 'Welcome — Sacred Light. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/welcome-v2-sacred-light.html' } }],
  },
  {
    id: 'preset-sig-worship-03',
    name: 'Worship · Welcome — Open Door',
    description: 'Welcome — Open Door. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/welcome-v3-open-door.html' } }],
  },
  {
    id: 'preset-sig-worship-04',
    name: 'Worship · Service Times — Now / Next / Later',
    description: 'Service Times — Now / Next / Later. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/service-v1-now-next.html' } }],
  },
  {
    id: 'preset-sig-worship-05',
    name: 'Worship · Service Times — Campus Threshold',
    description: 'Service Times — Campus Threshold. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/service-v2-campus-threshold.html' } }],
  },
  {
    id: 'preset-sig-worship-06',
    name: 'Worship · Service Times — Ceremonial Countdown',
    description: 'Service Times — Ceremonial Countdown. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/service-v3-ceremonial.html' } }],
  },
  {
    id: 'preset-sig-worship-07',
    name: 'Worship · Sermon Series — Deep Root',
    description: 'Sermon Series — Deep Root. 1920×1080 worship signage board.',
    category: 'SERMON', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/sermon-v1-deep-root.html' } }],
  },
  {
    id: 'preset-sig-worship-08',
    name: 'Worship · Sermon Series — Field Notes',
    description: 'Sermon Series — Field Notes. 1920×1080 worship signage board.',
    category: 'SERMON', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/sermon-v2-field-notes.html' } }],
  },
  {
    id: 'preset-sig-worship-09',
    name: 'Worship · Sermon Series — Confluence',
    description: 'Sermon Series — Confluence. 1920×1080 worship signage board.',
    category: 'SERMON', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/sermon-v3-confluence.html' } }],
  },
  {
    id: 'preset-sig-worship-10',
    name: 'Worship · Song Board — Sunday Record',
    description: 'Song Board — Sunday Record. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/song-v1-sunday-record.html' } }],
  },
  {
    id: 'preset-sig-worship-11',
    name: 'Worship · Song Board — The New Hymnal',
    description: 'Song Board — The New Hymnal. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/song-v2-new-hymnal.html' } }],
  },
  {
    id: 'preset-sig-worship-12',
    name: 'Worship · Song Board — Sacred Frequency',
    description: 'Song Board — Sacred Frequency. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/song-v3-sacred-frequency.html' } }],
  },
  {
    id: 'preset-sig-worship-13',
    name: 'Worship · Weekly Events — One Invitation',
    description: 'Weekly Events — One Invitation. 1920×1080 worship signage board.',
    category: 'EVENTS', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/weekly-v1-one-invitation.html' } }],
  },
  {
    id: 'preset-sig-worship-14',
    name: 'Worship · Weekly Events — Weekline',
    description: 'Weekly Events — Weekline. 1920×1080 worship signage board.',
    category: 'EVENTS', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/weekly-v2-weekline.html' } }],
  },
  {
    id: 'preset-sig-worship-15',
    name: 'Worship · Weekly Events — Three Ways In',
    description: 'Weekly Events — Three Ways In. 1920×1080 worship signage board.',
    category: 'EVENTS', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/weekly-v3-three-ways-in.html' } }],
  },
  {
    id: 'preset-sig-worship-16',
    name: 'Worship · Giving — Measured Future',
    description: 'Giving — Measured Future. 1920×1080 worship signage board.',
    category: 'GIVING', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/giving-v1-measured-future.html' } }],
  },
  {
    id: 'preset-sig-worship-17',
    name: 'Worship · Giving — Light the Window',
    description: 'Giving — Light the Window. 1920×1080 worship signage board.',
    category: 'GIVING', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/giving-v2-light-window.html' } }],
  },
  {
    id: 'preset-sig-worship-18',
    name: 'Worship · Giving — One More Seat',
    description: 'Giving — One More Seat. 1920×1080 worship signage board.',
    category: 'GIVING', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/giving-v3-one-more-seat.html' } }],
  },
  {
    id: 'preset-sig-worship-19',
    name: 'Worship · Verse of the Day — Daybreak',
    description: 'Verse of the Day — Daybreak. 1920×1080 worship signage board.',
    category: 'SERMON', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090909',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/verse-v1-daybreak.html' } }],
  },
  {
    id: 'preset-sig-worship-20',
    name: 'Worship · Verse of the Day — The Word Stands',
    description: 'Verse of the Day — The Word Stands. 1920×1080 worship signage board.',
    category: 'SERMON', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090909',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/verse-v2-word-stands.html' } }],
  },
  {
    id: 'preset-sig-worship-21',
    name: 'Worship · Verse of the Day — Open Sky',
    description: 'Verse of the Day — Open Sky. 1920×1080 worship signage board.',
    category: 'SERMON', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090909',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/verse-v3-open-sky.html' } }],
  },
  {
    id: 'preset-sig-worship-22',
    name: 'Worship · Lobby Hub — The Foyer Edit',
    description: 'Lobby Hub — The Foyer Edit. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/lobby-v1-foyer-edit.html' } }],
  },
  {
    id: 'preset-sig-worship-23',
    name: 'Worship · Lobby Hub — Campus Line',
    description: 'Lobby Hub — Campus Line. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/lobby-v2-campus-line.html' } }],
  },
  {
    id: 'preset-sig-worship-24',
    name: 'Worship · Lobby Hub — Live Commons',
    description: 'Lobby Hub — Live Commons. 1920×1080 worship signage board.',
    category: 'SERVICE', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/lobby-v3-live-commons.html' } }],
  },
  // ── QSR redesign set (codex, 2026-07-24) — 4 menu jobs x 3 directions.
  {
    id: 'preset-sig-qsr-12',
    name: 'QSR · Drive-Thru — Lane One',
    description: 'Drive-Thru menu board — Lane One. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-drive-thru-v1-lane-one.html' } }],
  },
  {
    id: 'preset-sig-qsr-13',
    name: 'QSR · Drive-Thru — Market Board',
    description: 'Drive-Thru menu board — Market Board. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-drive-thru-v2-market-board.html' } }],
  },
  {
    id: 'preset-sig-qsr-14',
    name: 'QSR · Drive-Thru — Order Logic',
    description: 'Drive-Thru menu board — Order Logic. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-drive-thru-v3-order-logic.html' } }],
  },
  {
    id: 'preset-sig-qsr-15',
    name: 'QSR · Counter Order — The Pass',
    description: 'Counter Order menu board — The Pass. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-counter-v1-the-pass.html' } }],
  },
  {
    id: 'preset-sig-qsr-16',
    name: 'QSR · Counter Order — Market Mosaic',
    description: 'Counter Order menu board — Market Mosaic. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-counter-v2-market-mosaic.html' } }],
  },
  {
    id: 'preset-sig-qsr-17',
    name: 'QSR · Counter Order — Menu Folio',
    description: 'Counter Order menu board — Menu Folio. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-counter-v3-menu-folio.html' } }],
  },
  {
    id: 'preset-sig-qsr-18',
    name: "QSR · Coffee Shop — Roaster's Ledger",
    description: "Coffee Shop menu board — Roaster's Ledger. 1920×1080 quick-service signage board.",
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-coffee-v1-roasters-ledger.html' } }],
  },
  {
    id: 'preset-sig-qsr-19',
    name: 'QSR · Coffee Shop — Morning Window',
    description: 'Coffee Shop menu board — Morning Window. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-coffee-v2-morning-window.html' } }],
  },
  {
    id: 'preset-sig-qsr-20',
    name: 'QSR · Coffee Shop — Ceramic Shelf',
    description: 'Coffee Shop menu board — Ceramic Shelf. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-coffee-v3-ceramic-shelf.html' } }],
  },
  {
    id: 'preset-sig-qsr-21',
    name: 'QSR · Pizza Shop — Slice Signal',
    description: 'Pizza Shop menu board — Slice Signal. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-pizza-v1-slice-signal.html' } }],
  },
  {
    id: 'preset-sig-qsr-22',
    name: 'QSR · Pizza Shop — Oven No. 7',
    description: 'Pizza Shop menu board — Oven No. 7. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-pizza-v2-oven-no7.html' } }],
  },
  {
    id: 'preset-sig-qsr-23',
    name: 'QSR · Pizza Shop — House Press',
    description: 'Pizza Shop menu board — House Press. 1920×1080 quick-service signage board.',
    category: 'MENU', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-pizza-v3-house-press.html' } }],
  },
  // Portrait siblings (id + '-portrait') — the gallery auto-pairs them with
  // their landscape preset. These boards ship a TRUE native portrait
  // composition (not a letterboxed landscape); ?orientation=portrait forces it.
  {
    id: 'preset-sig-worship-01-portrait',
    name: 'Worship · Welcome — Common Ground — Portrait',
    description: 'Welcome — Common Ground. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/welcome-v1-common-ground.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-02-portrait',
    name: 'Worship · Welcome — Sacred Light — Portrait',
    description: 'Welcome — Sacred Light. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/welcome-v2-sacred-light.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-03-portrait',
    name: 'Worship · Welcome — Open Door — Portrait',
    description: 'Welcome — Open Door. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/welcome-v3-open-door.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-04-portrait',
    name: 'Worship · Service Times — Now / Next / Later — Portrait',
    description: 'Service Times — Now / Next / Later. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/service-v1-now-next.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-05-portrait',
    name: 'Worship · Service Times — Campus Threshold — Portrait',
    description: 'Service Times — Campus Threshold. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/service-v2-campus-threshold.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-06-portrait',
    name: 'Worship · Service Times — Ceremonial Countdown — Portrait',
    description: 'Service Times — Ceremonial Countdown. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/service-v3-ceremonial.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-07-portrait',
    name: 'Worship · Sermon Series — Deep Root — Portrait',
    description: 'Sermon Series — Deep Root. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERMON', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/sermon-v1-deep-root.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-08-portrait',
    name: 'Worship · Sermon Series — Field Notes — Portrait',
    description: 'Sermon Series — Field Notes. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERMON', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/sermon-v2-field-notes.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-09-portrait',
    name: 'Worship · Sermon Series — Confluence — Portrait',
    description: 'Sermon Series — Confluence. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERMON', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/sermon-v3-confluence.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-10-portrait',
    name: 'Worship · Song Board — Sunday Record — Portrait',
    description: 'Song Board — Sunday Record. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/song-v1-sunday-record.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-11-portrait',
    name: 'Worship · Song Board — The New Hymnal — Portrait',
    description: 'Song Board — The New Hymnal. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/song-v2-new-hymnal.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-12-portrait',
    name: 'Worship · Song Board — Sacred Frequency — Portrait',
    description: 'Song Board — Sacred Frequency. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#080908',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/song-v3-sacred-frequency.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-13-portrait',
    name: 'Worship · Weekly Events — One Invitation — Portrait',
    description: 'Weekly Events — One Invitation. 1920×1080 worship signage board. Portrait composition.',
    category: 'EVENTS', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/weekly-v1-one-invitation.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-14-portrait',
    name: 'Worship · Weekly Events — Weekline — Portrait',
    description: 'Weekly Events — Weekline. 1920×1080 worship signage board. Portrait composition.',
    category: 'EVENTS', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/weekly-v2-weekline.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-15-portrait',
    name: 'Worship · Weekly Events — Three Ways In — Portrait',
    description: 'Weekly Events — Three Ways In. 1920×1080 worship signage board. Portrait composition.',
    category: 'EVENTS', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/weekly-v3-three-ways-in.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-16-portrait',
    name: 'Worship · Giving — Measured Future — Portrait',
    description: 'Giving — Measured Future. 1920×1080 worship signage board. Portrait composition.',
    category: 'GIVING', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/giving-v1-measured-future.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-17-portrait',
    name: 'Worship · Giving — Light the Window — Portrait',
    description: 'Giving — Light the Window. 1920×1080 worship signage board. Portrait composition.',
    category: 'GIVING', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/giving-v2-light-window.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-18-portrait',
    name: 'Worship · Giving — One More Seat — Portrait',
    description: 'Giving — One More Seat. 1920×1080 worship signage board. Portrait composition.',
    category: 'GIVING', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/giving-v3-one-more-seat.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-19-portrait',
    name: 'Worship · Verse of the Day — Daybreak — Portrait',
    description: 'Verse of the Day — Daybreak. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERMON', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090909',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/verse-v1-daybreak.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-20-portrait',
    name: 'Worship · Verse of the Day — The Word Stands — Portrait',
    description: 'Verse of the Day — The Word Stands. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERMON', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090909',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/verse-v2-word-stands.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-21-portrait',
    name: 'Worship · Verse of the Day — Open Sky — Portrait',
    description: 'Verse of the Day — Open Sky. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERMON', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090909',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/verse-v3-open-sky.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-22-portrait',
    name: 'Worship · Lobby Hub — The Foyer Edit — Portrait',
    description: 'Lobby Hub — The Foyer Edit. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/lobby-v1-foyer-edit.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-23-portrait',
    name: 'Worship · Lobby Hub — Campus Line — Portrait',
    description: 'Lobby Hub — Campus Line. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/lobby-v2-campus-line.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-worship-24-portrait',
    name: 'Worship · Lobby Hub — Live Commons — Portrait',
    description: 'Lobby Hub — Live Commons. 1920×1080 worship signage board. Portrait composition.',
    category: 'SERVICE', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/worship/lobby-v3-live-commons.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-12-portrait',
    name: 'QSR · Drive-Thru — Lane One — Portrait',
    description: 'Drive-Thru menu board — Lane One. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-drive-thru-v1-lane-one.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-13-portrait',
    name: 'QSR · Drive-Thru — Market Board — Portrait',
    description: 'Drive-Thru menu board — Market Board. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-drive-thru-v2-market-board.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-14-portrait',
    name: 'QSR · Drive-Thru — Order Logic — Portrait',
    description: 'Drive-Thru menu board — Order Logic. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-drive-thru-v3-order-logic.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-15-portrait',
    name: 'QSR · Counter Order — The Pass — Portrait',
    description: 'Counter Order menu board — The Pass. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-counter-v1-the-pass.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-16-portrait',
    name: 'QSR · Counter Order — Market Mosaic — Portrait',
    description: 'Counter Order menu board — Market Mosaic. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-counter-v2-market-mosaic.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-17-portrait',
    name: 'QSR · Counter Order — Menu Folio — Portrait',
    description: 'Counter Order menu board — Menu Folio. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-counter-v3-menu-folio.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-18-portrait',
    name: "QSR · Coffee Shop — Roaster's Ledger — Portrait",
    description: "Coffee Shop menu board — Roaster's Ledger. 1920×1080 quick-service signage board. Portrait composition.",
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-coffee-v1-roasters-ledger.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-19-portrait',
    name: 'QSR · Coffee Shop — Morning Window — Portrait',
    description: 'Coffee Shop menu board — Morning Window. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-coffee-v2-morning-window.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-20-portrait',
    name: 'QSR · Coffee Shop — Ceramic Shelf — Portrait',
    description: 'Coffee Shop menu board — Ceramic Shelf. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-coffee-v3-ceramic-shelf.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-21-portrait',
    name: 'QSR · Pizza Shop — Slice Signal — Portrait',
    description: 'Pizza Shop menu board — Slice Signal. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-pizza-v1-slice-signal.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-22-portrait',
    name: 'QSR · Pizza Shop — Oven No. 7 — Portrait',
    description: 'Pizza Shop menu board — Oven No. 7. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-pizza-v2-oven-no7.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-qsr-23-portrait',
    name: 'QSR · Pizza Shop — House Press — Portrait',
    description: 'Pizza Shop menu board — House Press. 1920×1080 quick-service signage board. Portrait composition.',
    category: 'MENU', orientation: 'PORTRAIT',
    screenWidth: 1080, screenHeight: 1920, bgColor: '#090a09',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/redesign-pizza-v3-house-press.html?orientation=portrait' } }],
  },
  {
    id: 'preset-sig-healthcare-01',
    name: "Healthcare · Waiting Room",
    description: "Waiting Room — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/01-waiting-room-flagship.html' } }],
  },
  {
    id: 'preset-sig-healthcare-02',
    name: "Healthcare · Physicians",
    description: "Physicians — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/02-physician-directory.html' } }],
  },
  {
    id: 'preset-sig-healthcare-03',
    name: "Healthcare · Now Serving",
    description: "Now Serving — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/03-now-serving.html' } }],
  },
  {
    id: 'preset-sig-healthcare-04',
    name: "Healthcare · Vaccines",
    description: "Vaccines — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/04-vaccine-clinic.html' } }],
  },
  {
    id: 'preset-sig-healthcare-05',
    name: "Healthcare · Hours",
    description: "Hours — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/05-hours-closures.html' } }],
  },
  {
    id: 'preset-sig-healthcare-06',
    name: "Healthcare · Patient Education",
    description: "Patient Education — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/06-patient-education.html' } }],
  },
  {
    id: 'preset-sig-healthcare-07',
    name: "Healthcare · MyChart",
    description: "MyChart — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/07-mychart-signup.html' } }],
  },
  {
    id: 'preset-sig-healthcare-08',
    name: "Healthcare · Pharmacy",
    description: "Pharmacy — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/08-pharmacy-pickup.html' } }],
  },
  {
    id: 'preset-sig-healthcare-09',
    name: "Healthcare · Clinical Trial",
    description: "Clinical Trial — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/09-clinical-trial.html' } }],
  },
  {
    id: 'preset-sig-healthcare-10',
    name: "Healthcare · Thanks",
    description: "Thanks — 3840×2160 industry digital-signage template.",
    category: 'HEALTHCARE', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/healthcare/10-thanks-leave.html' } }],
  },
  {
    id: 'preset-sig-hospitality-01',
    name: "Hospitality · Lobby · Welcome",
    description: "Lobby · Welcome — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/01-lobby-welcome-flagship.html' } }],
  },
  {
    id: 'preset-sig-hospitality-02',
    name: "Hospitality · Concierge · Tonight in town",
    description: "Concierge · Tonight in town — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/02-concierge-board.html' } }],
  },
  {
    id: 'preset-sig-hospitality-03',
    name: "Hospitality · Today's Events",
    description: "Today's Events — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/03-events-board.html' } }],
  },
  {
    id: 'preset-sig-hospitality-04',
    name: "Hospitality · Pool · Spa · Today",
    description: "Pool · Spa · Today — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/04-pool-spa-day.html' } }],
  },
  {
    id: 'preset-sig-hospitality-05',
    name: "Hospitality · Dining Tonight",
    description: "Dining Tonight — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/05-dining-tonight.html' } }],
  },
  {
    id: 'preset-sig-hospitality-06',
    name: "Hospitality · Wayfinder",
    description: "Wayfinder — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/06-wayfinder.html' } }],
  },
  {
    id: 'preset-sig-hospitality-07',
    name: "Hospitality · Group Welcome",
    description: "Group Welcome — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/07-group-welcome.html' } }],
  },
  {
    id: 'preset-sig-hospitality-08',
    name: "Hospitality · Check-in",
    description: "Check-in — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/08-checkin-status.html' } }],
  },
  {
    id: 'preset-sig-hospitality-09',
    name: "Hospitality · Outlook",
    description: "Outlook — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/09-outlook.html' } }],
  },
  {
    id: 'preset-sig-hospitality-10',
    name: "Hospitality · Brand Story",
    description: "Brand Story — 3840×2160 industry digital-signage template.",
    category: 'HOSPITALITY', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/hospitality/10-brand-story.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-01',
    name: "Menu · Menu",
    description: "Menu — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/01-fullservice-menu.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-02',
    name: "Menu · Wine List",
    description: "Wine List — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/02-wine-list.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-03',
    name: "Menu · Daily Specials",
    description: "Daily Specials — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/03-daily-special.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-04',
    name: "Menu · Cocktails",
    description: "Cocktails — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/04-cocktail-program.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-05',
    name: "Menu · POS 86 Board",
    description: "POS 86 Board — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/05-86-board.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-06',
    name: "Menu · Brunch Menu",
    description: "Brunch Menu — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/06-brunch.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-07',
    name: "Menu · Prix Fixe",
    description: "Prix Fixe — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/07-prix-fixe.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-08',
    name: "Menu · Tasting Progress",
    description: "Tasting Progress — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/08-tasting-progress.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-09',
    name: "Menu · Reservations",
    description: "Reservations — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/09-reservations.html' } }],
  },
  {
    id: 'preset-sig-menus-pos-10',
    name: "Menu · Takeaway",
    description: "Takeaway — 3840×2160 industry digital-signage template.",
    category: 'MENUS_POS', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/menus-pos/10-takeaway-pickup.html' } }],
  },
  {
    id: 'preset-sig-qsr-01',
    name: "QSR · Drive-Thru · Menu Board",
    description: "Drive-Thru · Menu Board — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/01-drive-thru-flagship.html' } }],
  },
  {
    id: 'preset-sig-qsr-02',
    name: "QSR · Counter Menu",
    description: "Counter Menu — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/02-counter-menu.html' } }],
  },
  {
    id: 'preset-sig-qsr-03',
    name: "QSR · Order Ready",
    description: "Order Ready — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/03-order-ready.html' } }],
  },
  {
    id: 'preset-sig-qsr-04',
    name: "QSR · LTO Promo",
    description: "LTO Promo — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/04-lto-promo.html' } }],
  },
  {
    id: 'preset-sig-qsr-05',
    name: "QSR · Combos & Deals",
    description: "Combos & Deals — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/05-combos-deals.html' } }],
  },
  {
    id: 'preset-sig-qsr-06',
    name: "QSR · Beverages",
    description: "Beverages — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/06-beverages.html' } }],
  },
  {
    id: 'preset-sig-qsr-07',
    name: "QSR · Mobile Pickup",
    description: "Mobile Pickup — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/07-mobile-pickup.html' } }],
  },
  {
    id: 'preset-sig-qsr-08',
    name: "QSR · Rewards",
    description: "Rewards — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/08-rewards.html' } }],
  },
  {
    id: 'preset-sig-qsr-09',
    name: "QSR · Hours",
    description: "Hours — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/09-hours-location.html' } }],
  },
  {
    id: 'preset-sig-qsr-10',
    name: "QSR · Now Hiring",
    description: "Now Hiring — 3840×2160 industry digital-signage template.",
    category: 'QSR', orientation: 'LANDSCAPE',
    screenWidth: 3840, screenHeight: 2160, bgColor: '#0f172a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/10-now-hiring.html' } }],
  },

  // ── New-industry signage (2026-06-08 designer handoff) ───────────────────
  // veterinary / gym / real-estate / museum / office / clinic. Each a
  // single-file EXTERNAL_HTML board (V6 click-to-edit shim, Taurus-safe,
  // landscape + portrait, every [data-field]/[data-imgslot] editable).
  //
  // 2026-06-27 — the 10 `preset-sig-church-*` EXTERNAL_HTML worship costumes
  // were REMOVED here. WORSHIP now ships the fully-editable React-zone pack
  // (`WORSHIP_TEMPLATE_PRESETS` in worship-presets.ts, wired via
  // ensure-system-presets.ts) so a church gets boards where every word,
  // image, and color is operator-editable in PropertiesPanel — instead of a
  // sandboxed-iframe board they can only nudge through the shim. Shipping
  // both produced a duplicate WORSHIP gallery (beta finding P1 #2 + #10), so
  // the costumes are dropped; the boot-time archive pass in
  // ensure-system-presets.ts (matches DB rows whose id is no longer in
  // ALL_PRESETS) marks any already-seeded `preset-sig-church-*` rows
  // ARCHIVED — gallery-hidden, existing playlists preserved.
  { id: 'preset-sig-veterinary-01', name: "Veterinary · Waiting Room", description: "Pet-of-the-day + live in-care board + care tip — 3840×2160 vet signage.", category: 'VETERINARY', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#f6efe6', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/veterinary/01-waiting-room-flagship.html' } }] },
  { id: 'preset-sig-veterinary-02', name: "Veterinary · Adoptable Pets", description: "Adoptable-pets photo-card gallery — 3840×2160 vet signage.", category: 'VETERINARY', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#f3ede2', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/veterinary/02-adopt-gallery.html' } }] },
  { id: 'preset-sig-gym-01', name: "Gym · Floor Board", description: "Live occupancy ring + today's classes — 3840×2160 gym signage.", category: 'GYM', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#0c0e12', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/gym/01-floor-board-flagship.html' } }] },
  { id: 'preset-sig-gym-02', name: "Gym · Leaderboard", description: "Champion spotlight + ranked member leaderboard — 3840×2160 gym signage.", category: 'GYM', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#0a0b0e', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/gym/02-leaderboard.html' } }] },
  // New-member welcome boards — APPROVED 2026-07-02 by Greg, matches
  // docs/design/approved/2026-07-02-gym-welcome/. DO NOT regress.
  { id: 'preset-sig-gym-03', name: "Gym · Welcome Poster", description: "New-member welcome poster — name hero, first-week checklist, trainer card, today's classes, free-intro CTA. 3840×2160 gym signage.", category: 'GYM', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#0c0e12', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/gym/03-welcome-poster.html' } }] },
  { id: 'preset-sig-gym-04', name: "Gym · Welcome Split-Duo", description: "New-member welcome — member | coach diagonal seam, first-week checklist, trainer bio + hours + free-session CTA, class ticker. 3840×2160 gym signage.", category: 'GYM', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#0b0d11', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/gym/04-welcome-split-duo.html' } }] },
  { id: 'preset-sig-gym-05', name: "Gym · Welcome Locker Room", description: "New-member welcome — open member locker with welcome kit + taped trainer polaroid / schedule / motto poster on neighbor lockers. 3840×2160 gym signage.", category: 'GYM', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#14161c', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/gym/05-welcome-locker-room.html' } }] },
  { id: 'preset-sig-real-estate-01', name: "Real Estate · Availability", description: "Featured residence + now-leasing list — 3840×2160 real-estate signage.", category: 'REAL_ESTATE', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#0f1216', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/real-estate/01-availability-flagship.html' } }] },
  { id: 'preset-sig-museum-01', name: "Museum · Today", description: "Current exhibition hero + program timeline — 3840×2160 museum signage.", category: 'MUSEUM', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#120f1a', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/museum/01-today-flagship.html' } }] },
  { id: 'preset-sig-office-01', name: "Office · Room Grid", description: "Live meeting-room status tile wall — 3840×2160 office signage.", category: 'OFFICE', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#eef1f6', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/office/01-room-grid-flagship.html' } }] },
  { id: 'preset-sig-clinic-01', name: "Clinic · Campaign", description: "Health-campaign poster + live queue strip — 3840×2160 clinic signage.", category: 'CLINIC', orientation: 'LANDSCAPE', screenWidth: 3840, screenHeight: 2160, bgColor: '#0e3a3a', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/clinic/01-campaign-flagship.html' } }] },

  // ── Interactive Touch Kiosks (2026-06-03) ───────────────────────────────
  // Self-contained interactive touch experiences (Claude-design intake), each
  // a single inlined HTML under /public/templates/kiosk/ hosted by the
  // EXTERNAL_HTML sandboxed iframe. They carry their own screen router, idle/
  // attract reset, and touch handling — fully interactive inside the iframe.
  // Resolution-independent (--u=1vmin) so the same file is balanced landscape
  // OR portrait; the declared 1920×1080 is just the gallery design canvas.
  {
    id: 'preset-kiosk-realestate',
    name: '🏢 Touch Kiosk — Commercial Leasing',
    description: 'Interactive leasing kiosk: building overview + stats, filterable suite inventory (size/availability), suite detail with gallery, specs, in-suite amenities + floor plan, you-are-here wayfinding, and a schedule-a-tour flow. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#11151c',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/real-estate.html' } }],
  },
  {
    id: 'preset-kiosk-museum',
    name: '🏛️ Touch Kiosk — Museum / Exhibits',
    description: 'Interactive exhibit kiosk: guided tour intro, numbered station stories with facts + audio-guide + video, a hall map with you-are-here, and related stations. Editorial charcoal/amber theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#0c0b0a',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/museum.html' } }],
  },
  {
    id: 'preset-kiosk-food',
    name: '🥗 Touch Kiosk — Self-Order (QSR)',
    description: 'Interactive self-order kiosk: category browse, item detail with priced option groups (required/single/multi), quantity stepper, cart with upsell, order summary + tax, and an order-confirmation screen (POS hand-off ready). Fresh cream/paprika theme. Touch-driven, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#fbf6ee',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/food.html' } }],
  },
  {
    id: 'preset-kiosk-office',
    name: '🏢 Touch Kiosk — Workplace / Lobby',
    description: 'Interactive workplace hub: visitor welcome, building/floor wayfinding, room & desk availability, company directory, today’s meetings and announcements. Clean corporate theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#f6f7f9',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/office.html' } }],
  },
  {
    id: 'preset-kiosk-gym',
    name: '🏋️ Touch Kiosk — Fitness Club',
    description: 'Interactive fitness-club kiosk: live club capacity, class schedule + sign-up, trainer spotlights, amenities and member info. Bold dark athletic theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#0b0d10',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/gym.html' } }],
  },
  {
    id: 'preset-kiosk-school',
    name: '🎓 Touch Kiosk — Campus Hub',
    description: 'Interactive campus hub: bell schedule, today’s events, building wayfinding, staff/dept directory, athletics and announcements. Spirited school theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#f4f6fb',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/school.html' } }],
  },
  {
    id: 'preset-kiosk-qsr',
    name: '🍔 Touch Kiosk — Fast-Food Self-Order',
    description: 'Fast-food self-order kiosk: value-deal combos, a “make it a combo” meal builder with priced modifiers, rewards/points, cart with upsell, order summary + tax, and POS hand-off. Warm appetite-forward theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#171210',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/qsr.html' } }],
  },
  {
    id: 'preset-kiosk-bar',
    name: '🍸 Touch Kiosk — Bar & Tap House',
    description: 'Cocktail & tap-house kiosk: age-gate entry, live happy-hour countdown, on-tap list with keg levels, cocktail menu with build notes, events, and a running tab → send to bar. Moody backbar theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#120f17',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/bar.html' } }],
  },
  {
    id: 'preset-kiosk-clinic',
    name: '🩺 Touch Kiosk — Patient Check-In',
    description: 'Healthcare self-service kiosk: patient self check-in (appointment lookup → confirm → copay → queue), live wait board, provider directory, and department wayfinding. Calm, accessible clinical theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#eef4f4',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/clinic.html' } }],
  },
  {
    id: 'preset-kiosk-qsr-pickup',
    name: '🥡 Touch Kiosk — Order Pickup & Curbside',
    description: 'Fast-food pickup/curbside board: live order-status tracker (preparing → ready), name/number lookup, “I’m here” curbside arrival, and a ready-for-pickup display. Pairs with the self-order kiosk. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#171210',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/qsr-pickup.html' } }],
  },
  {
    id: 'preset-kiosk-office-room',
    name: '🚪 Touch Kiosk — Meeting Room Panel',
    description: 'Door-mounted meeting-room panel: live free/busy status, current + next bookings, one-tap book-now / extend / end, and a room finder for nearby spaces. Calm workplace theme. Touch-driven, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#0f1115',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/office-room-panel.html' } }],
  },
  {
    id: 'preset-kiosk-realestate-models',
    name: '🏠 Touch Kiosk — Model Homes Gallery',
    description: 'New-home sales gallery: model-home showcase with floor plans, interactive community site map, plan compare, and live lot/quick-move-in availability. Premium real-estate theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#14110d',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/real-estate-models.html' } }],
  },
  {
    id: 'preset-kiosk-realestate-resident',
    name: '🏢 Touch Kiosk — Resident Concierge',
    description: 'Multifamily resident lobby concierge: amenity booking, maintenance request, package room, community events, and resident perks. Branded apartment theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#12100e',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/real-estate-resident.html' } }],
  },
  {
    id: 'preset-kiosk-food-nutrition',
    name: '🥗 Touch Kiosk — Nutrition & Allergens',
    description: 'Menu nutrition + allergen lookup: per-dish calories/macros, allergen and dietary filters (veg/GF/etc.), and ingredient detail. Pairs with the menu/self-order boards. Touch-driven, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#fbf6ee',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/food-nutrition.html' } }],
  },
  {
    id: 'preset-kiosk-museum-quest',
    name: '🧭 Touch Kiosk — Explorer Quest',
    description: 'Kids’ museum scavenger quest: pick a quest, follow the quest map, check in at exhibit stops to earn stamps, and a finish/reward screen. Playful, accessible. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#0c1a24',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/museum-quest.html' } }],
  },
  {
    id: 'preset-kiosk-gym-workout',
    name: '🏋️ Touch Kiosk — Guided Training',
    description: 'Guided workout display: pick a session, preview exercises, a big interval/rest timer with set tracking, and a finish summary. Energetic fitness theme. Touch-driven, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#0e1014',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/gym-workout.html' } }],
  },
  {
    id: 'preset-kiosk-bar-jukebox',
    name: '🎵 Touch Kiosk — Jukebox',
    description: 'Bar/tap-house jukebox: pick a vibe, browse + queue songs, see now-playing and the up-next queue. Moody backbar theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#120f17',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/bar-jukebox.html' } }],
  },
  {
    id: 'preset-kiosk-school-frontoffice',
    name: '🏫 Touch Kiosk — Front Office Check-In',
    description: 'School front-office self check-in: visitor sign-in, student late-arrival / early-dismissal, reason + destination, and a staff notification. Spirited school theme. Touch-driven, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#f4f6fb',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/school-front-office.html' } }],
  },
  {
    id: 'preset-kiosk-vet',
    name: '🐾 Touch Kiosk — Veterinary Check-In',
    description: 'Veterinary self check-in: appointment lookup → confirm → queue, live waiting-room board, Rx + food refill pickup, provider/tech directory, and department wayfinding. Calm, compassionate clinical theme. Touch-driven, attract loop, reflows landscape/portrait.',
    category: 'KIOSK', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080, bgColor: '#eef4f1',
    zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/kiosk/vet.html' } }],
  },
];

// ─── Modern K-12 school boards (2026-06-07) ──────────────────────────────
// EXTERNAL_HTML rebuilds that REPLACE the legacy skeuomorphic React themed
// presets (Animated / Storybook / Scrapbook hallway+cafeteria + the MS lobby
// pack). Big type, 60px auto-fit floor, generous whitespace, full brand-token
// theming, click-to-edit hot-zones (V5 shim). One file handles both
// orientations via ?o=. The originals they replace are filtered out below.
const MODERN_SCHOOL_PRESETS: SystemPreset[] = [
  // Elementary — Today's Schedule (replaces Animated/Storybook/Scrapbook Hallway)
  { id: 'preset-school-elem-schedule-1', name: '📅 Daily Schedule — Color Blocks', description: 'Modern elementary daily schedule — bold color-block period rows, oversized type, live current-period highlight, clock + weather + attendance tiles. Bright, playful, legible from across the hall.', category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY', screenWidth: 3840, screenHeight: 2160, bgColor: '#4338ca', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/school/elem-schedule-v1.html' } }] },
  { id: 'preset-school-elem-schedule-2', name: '📅 Daily Schedule — Soft Cards', description: 'Modern elementary daily schedule — soft rounded cards on a light airy canvas, pastel accents, numbered periods, gentle current-period halo. Calm and friendly.', category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY', screenWidth: 3840, screenHeight: 2160, bgColor: '#f1f5ff', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/school/elem-schedule-v2.html' } }] },
  { id: 'preset-school-elem-schedule-3', name: '📅 Daily Schedule — Editorial Rail', description: 'Modern elementary daily schedule — strong color side-rail with clock/weather/attendance, clean editorial schedule list, floating current-period card. Crisp and confident.', category: 'HALLWAY', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY', screenWidth: 3840, screenHeight: 2160, bgColor: '#ffffff', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/school/elem-schedule-v3.html' } }] },
  // Elementary — Today's Lunch (replaces Animated Food Truck / Storybook / Scrapbook Cafeteria)
  { id: 'preset-school-elem-lunch-1', name: "🍱 Today's Lunch — Confetti Pop", description: 'Fun elementary lunch board — giant entrée photo in a confetti sunburst, bouncy headline, colorful side bubbles, swappable dish photos, allergen key. Joyful and BIG.', category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY', screenWidth: 3840, screenHeight: 2160, bgColor: '#fef3c7', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/school/elem-lunch-v1.html' } }] },
  { id: 'preset-school-elem-lunch-2', name: "🍱 Today's Lunch — Lunch Buddies", description: 'Fun elementary lunch board — a friendly waving mascot introduces the menu from a speech bubble, bold color-block menu cards, this-week strip with today auto-highlighted. Swappable dish photos.', category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY', screenWidth: 3840, screenHeight: 2160, bgColor: '#ffffff', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/school/elem-lunch-v2.html' } }] },
  { id: 'preset-school-elem-lunch-3', name: "🍱 Today's Lunch — Lunch Tray", description: 'Fun elementary lunch board — a bright top-down cafeteria tray with compartment wells holding each dish photo, live "lunch bell in __" countdown. Swappable dish photos + allergen key.', category: 'CAFETERIA', orientation: 'LANDSCAPE', schoolLevel: 'ELEMENTARY', screenWidth: 3840, screenHeight: 2160, bgColor: '#faf7ef', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/school/elem-lunch-v3.html' } }] },
  // Middle School — Lobby Welcome (replaces Paper/Homeroom/Greenhouse/Field Notes/Atlas/Arcade)
  { id: 'preset-school-ms-lobby-1', name: '🎒 Lobby Welcome — Bold', description: 'Modern middle-school lobby — vibrant full-bleed hero, giant WELCOME, day/date chip, announcement ribbon, color-tabbed club cards, lunch tile, live clock. Energetic school spirit.', category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE', screenWidth: 3840, screenHeight: 2160, bgColor: '#1e40af', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/school/ms-lobby-v1.html' } }] },
  { id: 'preset-school-ms-lobby-2', name: '🎒 Lobby Welcome — Light', description: 'Modern middle-school lobby — airy light canvas, huge WELCOME, soft white club cards with accent tabs, announcement band, full-width lunch hero. Clean and premium.', category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE', screenWidth: 3840, screenHeight: 2160, bgColor: '#eef2ff', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/school/ms-lobby-v2.html' } }] },
  { id: 'preset-school-ms-lobby-3', name: '🎒 Lobby Welcome — Dark', description: 'Modern middle-school lobby — confident near-black canvas with a vivid lime accent, date-forward hero, numbered club cards, bold lunch tile. Cool and contemporary.', category: 'LOBBY_WELCOME', orientation: 'LANDSCAPE', schoolLevel: 'MIDDLE', screenWidth: 3840, screenHeight: 2160, bgColor: '#0a0a0a', zones: [{ name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/school/ms-lobby-v3.html' } }] },
];

// Legacy skeuomorphic React themed presets the modern boards above replace —
// filtered OUT of the shipped catalog (operator: "total disasters, redo them").
// The widget code remains (harmless); only the gallery presets are retired.
// NOT retired (separate next batch): MS_PLAYLIST/STUDIO + the HS themed lobby
// pack (HS_ZINE/HS_BLUEPRINT/HS_YEARBOOK).
const RETIRED_LEGACY_WIDGET_TYPES = new Set<string>([
  'ANIMATED_HALLWAY_SCHEDULE', 'ANIMATED_HALLWAY_SCHEDULE_PORTRAIT',
  'STORYBOOK_HALLWAY', 'STORYBOOK_HALLWAY_PORTRAIT',
  'SCRAPBOOK_HALLWAY', 'SCRAPBOOK_HALLWAY_PORTRAIT',
  'ANIMATED_CAFETERIA_FOODTRUCK', 'ANIMATED_CAFETERIA_FOODTRUCK_PORTRAIT',
  'STORYBOOK_CAFETERIA', 'STORYBOOK_CAFETERIA_PORTRAIT',
  'SCRAPBOOK_CAFETERIA', 'SCRAPBOOK_CAFETERIA_PORTRAIT',
  'MS_PAPER', 'MS_PAPER_PORTRAIT', 'MS_HOMEROOM', 'MS_HOMEROOM_PORTRAIT',
  'MS_GREENHOUSE', 'MS_GREENHOUSE_PORTRAIT', 'MS_FIELDNOTES', 'MS_FIELDNOTES_PORTRAIT',
  'MS_ATLAS', 'MS_ATLAS_PORTRAIT', 'MS_ARCADE', 'MS_ARCADE_PORTRAIT',
]);

export const SYSTEM_TEMPLATE_PRESETS: SystemPreset[] = [
  ...RAW_SYSTEM_PRESETS.filter((p) => !(p.zones || []).some((z) => RETIRED_LEGACY_WIDGET_TYPES.has(z.widgetType))),
  ...MODERN_SCHOOL_PRESETS,
];

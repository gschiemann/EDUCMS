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
  // ─────────────────────────────────────────────────────
  // ★ 🌈 RAINBOW RIBBON — shape-based elementary lobby
  // Ported from design-lab/opus/03-rainbow-ribbon.html. Every widget
  // renders as a real SVG shape (ribbon banner, speech bubbles, cloud
  // cutout, starburst, polaroid, pennant bunting). No rectangles.
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-rainbow-ribbon',
    name: '🌈 Rainbow Ribbon',
    description: 'Big pink ribbon banner, cloud-cutout weather, speech-bubble announcement, starburst countdown, polaroid Teacher of the Week, pennant ticker — every widget is a real shape, not a box.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: 'ELEMENTARY',
    screenWidth: 3840,
    screenHeight: 2160,
    bgGradient: 'linear-gradient(180deg,#BFE8FF 0%,#FFE0EC 55%,#FFD8A8 100%)',
    bgColor: '#BFE8FF',
    zones: [
      {
        name: 'School Rosette',
        widgetType: 'LOGO',
        x: 2, y: 2, width: 8, height: 13,
        zIndex: 5, sortOrder: 0,
        defaultConfig: { theme: 'rainbow-ribbon' },
      },
      {
        name: 'Welcome Ribbon',
        widgetType: 'TEXT',
        x: 10, y: 4, width: 80, height: 18,
        zIndex: 3, sortOrder: 1,
        defaultConfig: {
          theme: 'rainbow-ribbon',
          content: 'Welcome Back, Friends!',
          subtitle: 'Today is going to be amazing',
        },
      },
      {
        name: 'Cloud Weather',
        widgetType: 'WEATHER',
        x: 3, y: 28, width: 20, height: 26,
        zIndex: 2, sortOrder: 2,
        defaultConfig: { theme: 'rainbow-ribbon', location: 'Springfield', units: 'imperial' },
      },
      {
        name: 'Sun Clock',
        widgetType: 'CLOCK',
        x: 77, y: 28, width: 20, height: 26,
        zIndex: 2, sortOrder: 3,
        defaultConfig: { theme: 'rainbow-ribbon', format: '12h' },
      },
      {
        name: "Today's News Bubble",
        widgetType: 'ANNOUNCEMENT',
        x: 23, y: 30, width: 54, height: 22,
        zIndex: 10, sortOrder: 4,
        defaultConfig: {
          theme: 'rainbow-ribbon',
          message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.',
          priority: 'normal',
        },
      },
      {
        name: 'Teacher Polaroid',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 2, y: 56, width: 30, height: 28,
        zIndex: 3, sortOrder: 5,
        defaultConfig: {
          theme: 'rainbow-ribbon',
          staffName: 'Mrs. Johnson',
          role: 'Teacher of the Week',
          bio: 'Inspiring 3rd graders every day!',
        },
      },
      {
        name: 'Upcoming Events Pills',
        widgetType: 'CALENDAR',
        x: 34, y: 56, width: 42, height: 28,
        zIndex: 2, sortOrder: 6,
        defaultConfig: { theme: 'rainbow-ribbon', daysToShow: 7, maxEvents: 3 },
      },
      {
        name: 'Field Trip Countdown',
        widgetType: 'COUNTDOWN',
        x: 78, y: 55, width: 20, height: 30,
        zIndex: 4, sortOrder: 7,
        defaultConfig: { theme: 'rainbow-ribbon', label: 'Field Trip in', targetDate: '' },
      },
      {
        name: 'Pennant Ticker',
        widgetType: 'TICKER',
        x: 0, y: 83, width: 100, height: 17,
        zIndex: 6, sortOrder: 8,
        defaultConfig: {
          theme: 'rainbow-ribbon',
          speed: 'medium',
          messages: [
            'Welcome back, Sunnyside Stars! ⭐',
            'Picture day is this Friday — wear your school colors!',
            'Parent-teacher conferences next Tuesday 🍎',
            'Reading Challenge: 20 minutes a day! 📖',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // ★ 🌈 RAINBOW RIBBON — PORTRAIT variant (2160×3840)
  // Same shape-based widgets as the landscape preset, restacked for
  // vertical signs (hallway doorways, entry-foyer totems, portrait
  // tablets). Banner spans full width up top; clock + weather pair
  // below it; announcement + teacher own the middle; countdown +
  // calendar split the bottom over the pennant ticker.
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-rainbow-ribbon-portrait',
    name: '🌈 Rainbow Ribbon — Portrait',
    description: 'Portrait remix of Rainbow Ribbon. Same cheerful shape-based widgets (ribbon banner, cloud weather, starburst countdown, polaroid teacher, pennant ticker), restacked for vertical displays.',
    category: 'LOBBY',
    orientation: 'PORTRAIT',
    schoolLevel: 'ELEMENTARY',
    screenWidth: 2160,
    screenHeight: 3840,
    bgGradient: 'linear-gradient(180deg,#BFE8FF 0%,#FFE0EC 55%,#FFD8A8 100%)',
    bgColor: '#BFE8FF',
    zones: [
      // Row 1 — welcome banner (full width, top)
      {
        name: 'Welcome Ribbon',
        widgetType: 'TEXT',
        x: 4, y: 2, width: 92, height: 10,
        zIndex: 3, sortOrder: 0,
        defaultConfig: {
          theme: 'rainbow-ribbon',
          content: 'Welcome Back, Friends!',
          subtitle: 'Today is going to be amazing',
        },
      },
      // School rosette logo — centered beneath banner
      {
        name: 'School Rosette',
        widgetType: 'LOGO',
        x: 38, y: 13, width: 24, height: 9,
        zIndex: 5, sortOrder: 1,
        defaultConfig: { theme: 'rainbow-ribbon' },
      },
      // Row 2 — clock + weather (split half-and-half horizontally)
      {
        name: 'Cloud Weather',
        widgetType: 'WEATHER',
        x: 4, y: 24, width: 44, height: 12,
        zIndex: 2, sortOrder: 2,
        defaultConfig: { theme: 'rainbow-ribbon', location: 'Springfield', units: 'imperial' },
      },
      {
        name: 'Sun Clock',
        widgetType: 'CLOCK',
        x: 52, y: 24, width: 44, height: 12,
        zIndex: 2, sortOrder: 3,
        defaultConfig: { theme: 'rainbow-ribbon', format: '12h' },
      },
      // Row 3 — hero announcement bubble
      {
        name: "Today's News Bubble",
        widgetType: 'ANNOUNCEMENT',
        x: 4, y: 38, width: 92, height: 16,
        zIndex: 10, sortOrder: 4,
        defaultConfig: {
          theme: 'rainbow-ribbon',
          message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.',
          priority: 'normal',
        },
      },
      // Row 4 — Teacher of the Week (wide polaroid)
      {
        name: 'Teacher Polaroid',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 4, y: 56, width: 92, height: 14,
        zIndex: 3, sortOrder: 5,
        defaultConfig: {
          theme: 'rainbow-ribbon',
          staffName: 'Mrs. Johnson',
          role: 'Teacher of the Week',
          bio: 'Inspiring 3rd graders every day!',
        },
      },
      // Row 5 — countdown + calendar side-by-side
      {
        name: 'Field Trip Countdown',
        widgetType: 'COUNTDOWN',
        x: 4, y: 72, width: 30, height: 17,
        zIndex: 4, sortOrder: 6,
        defaultConfig: { theme: 'rainbow-ribbon', label: 'Field Trip in', targetDate: '' },
      },
      {
        name: 'Upcoming Events Pills',
        widgetType: 'CALENDAR',
        x: 36, y: 72, width: 60, height: 17,
        zIndex: 2, sortOrder: 7,
        defaultConfig: { theme: 'rainbow-ribbon', daysToShow: 7, maxEvents: 3 },
      },
      // Pennant ticker at the bottom
      {
        name: 'Pennant Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        zIndex: 6, sortOrder: 8,
        defaultConfig: {
          theme: 'rainbow-ribbon',
          speed: 'medium',
          messages: [
            'Welcome back, Sunnyside Stars! ⭐',
            'Picture day is this Friday — wear your school colors!',
            'Parent-teacher conferences next Tuesday 🍎',
            'Reading Challenge: 20 minutes a day! 📖',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // ★ 📌 BULLETIN BOARD — classroom-cork paper-craft aesthetic
  // Every widget looks like something a teacher stapled up: polaroids
  // with tape, sticky notes, construction-paper letter banners,
  // pushpins, torn paper. Warm tan cork texture background.
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-bulletin-board',
    name: '📌 Bulletin Board',
    description: 'Classroom cork board with construction-paper letter banners, pinned index cards, taped polaroid teacher spotlight, sticky-note calendar, torn-paper countdown. Handmade elementary charm.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: 'ELEMENTARY',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#C69C6D',
    zones: [
      {
        name: 'School Crest Pin',
        widgetType: 'LOGO',
        x: 2, y: 2, width: 10, height: 14,
        zIndex: 5, sortOrder: 0,
        defaultConfig: { theme: 'bulletin-board' },
      },
      {
        name: 'Welcome Letter Banner',
        widgetType: 'TEXT',
        x: 13, y: 3, width: 72, height: 15,
        zIndex: 4, sortOrder: 1,
        defaultConfig: {
          theme: 'bulletin-board',
          content: 'WELCOME BACK!',
          subtitle: "hey friends, so glad you're here",
        },
      },
      {
        name: 'Paper Clock',
        widgetType: 'CLOCK',
        x: 82, y: 1, width: 16, height: 18,
        zIndex: 5, sortOrder: 2,
        defaultConfig: { theme: 'bulletin-board', format: '12h' },
      },
      {
        name: 'Index-card Weather',
        widgetType: 'WEATHER',
        x: 2, y: 20, width: 20, height: 28,
        zIndex: 3, sortOrder: 3,
        defaultConfig: { theme: 'bulletin-board', location: 'Springfield', units: 'imperial' },
      },
      {
        name: 'Pinned Announcement',
        widgetType: 'ANNOUNCEMENT',
        x: 24, y: 20, width: 52, height: 28,
        zIndex: 10, sortOrder: 4,
        defaultConfig: {
          theme: 'bulletin-board',
          message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.',
          priority: 'normal',
        },
      },
      {
        name: 'Countdown Banner',
        widgetType: 'COUNTDOWN',
        x: 78, y: 20, width: 20, height: 28,
        zIndex: 4, sortOrder: 5,
        defaultConfig: { theme: 'bulletin-board', label: 'Field Trip in', targetDate: '' },
      },
      {
        name: 'Teacher Polaroid',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 2, y: 52, width: 30, height: 36,
        zIndex: 3, sortOrder: 6,
        defaultConfig: {
          theme: 'bulletin-board',
          staffName: 'Mrs. Johnson',
          role: 'Teacher of the Week',
          bio: 'Inspiring 3rd graders every day!',
        },
      },
      {
        name: 'Sticky-note Events',
        widgetType: 'CALENDAR',
        x: 34, y: 52, width: 64, height: 36,
        zIndex: 3, sortOrder: 7,
        defaultConfig: { theme: 'bulletin-board', daysToShow: 7, maxEvents: 3 },
      },
      {
        name: 'Paper-strip Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        zIndex: 6, sortOrder: 8,
        defaultConfig: {
          theme: 'bulletin-board',
          speed: 'medium',
          messages: [
            'Welcome back, Sunnyside Stars! ⭐',
            'Picture day is this Friday — wear your school colors!',
            'Parent-teacher conferences next Tuesday 🍎',
            'Reading Challenge: 20 minutes a day! 📖',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // ★ 📌 BULLETIN BOARD — PORTRAIT variant (2160×3840)
  // Same cork-paper widgets as the landscape preset, stacked vertical
  // for hallway doorway displays and lobby totems. Letter banner up
  // top, logo + clock under it, weather + countdown pair, big pinned
  // announcement, polaroid + sticky-note events split, ticker bottom.
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-bulletin-board-portrait',
    name: '📌 Bulletin Board — Portrait',
    description: 'Portrait remix of Bulletin Board. Construction-paper banner, paper clock with analog hands, index-card weather, pinned announcement, sticky-note events, paper-strip ticker — stacked for vertical displays.',
    category: 'LOBBY',
    orientation: 'PORTRAIT',
    schoolLevel: 'ELEMENTARY',
    screenWidth: 2160,
    screenHeight: 3840,
    bgColor: '#C69C6D',
    zones: [
      // Row 1 — full-width letter banner with subtitle
      {
        name: 'Welcome Letter Banner',
        widgetType: 'TEXT',
        x: 4, y: 2, width: 92, height: 11,
        zIndex: 4, sortOrder: 0,
        defaultConfig: {
          theme: 'bulletin-board',
          content: 'WELCOME BACK!',
          subtitle: "hey friends, so glad you're here",
        },
      },
      // Row 2 — school crest (left) + paper clock (right)
      {
        name: 'School Crest Pin',
        widgetType: 'LOGO',
        x: 4, y: 15, width: 28, height: 13,
        zIndex: 5, sortOrder: 1,
        defaultConfig: { theme: 'bulletin-board' },
      },
      {
        name: 'Paper Clock',
        widgetType: 'CLOCK',
        x: 68, y: 15, width: 28, height: 13,
        zIndex: 5, sortOrder: 2,
        defaultConfig: { theme: 'bulletin-board', format: '12h' },
      },
      // Row 3 — weather card + countdown banner (50/50)
      {
        name: 'Index-card Weather',
        widgetType: 'WEATHER',
        x: 4, y: 30, width: 44, height: 15,
        zIndex: 3, sortOrder: 3,
        defaultConfig: { theme: 'bulletin-board', location: 'Springfield', units: 'imperial' },
      },
      {
        name: 'Countdown Banner',
        widgetType: 'COUNTDOWN',
        x: 52, y: 30, width: 44, height: 15,
        zIndex: 4, sortOrder: 4,
        defaultConfig: { theme: 'bulletin-board', label: 'Field Trip in', targetDate: '' },
      },
      // Row 4 — pinned announcement (full-width hero)
      {
        name: 'Pinned Announcement',
        widgetType: 'ANNOUNCEMENT',
        x: 4, y: 47, width: 92, height: 17,
        zIndex: 10, sortOrder: 5,
        defaultConfig: {
          theme: 'bulletin-board',
          message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.',
          priority: 'normal',
        },
      },
      // Row 5 — taped polaroid (full-width, wide for portrait)
      {
        name: 'Teacher Polaroid',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 4, y: 66, width: 92, height: 13,
        zIndex: 3, sortOrder: 6,
        defaultConfig: {
          theme: 'bulletin-board',
          staffName: 'Mrs. Johnson',
          role: 'Teacher of the Week',
          bio: 'Inspiring 3rd graders every day!',
        },
      },
      // Row 6 — 3 sticky-note events side-by-side
      {
        name: 'Sticky-note Events',
        widgetType: 'CALENDAR',
        x: 4, y: 81, width: 92, height: 9,
        zIndex: 3, sortOrder: 7,
        defaultConfig: { theme: 'bulletin-board', daysToShow: 7, maxEvents: 3 },
      },
      // Paper-strip ticker across the bottom
      {
        name: 'Paper-strip Ticker',
        widgetType: 'TICKER',
        x: 0, y: 91, width: 100, height: 9,
        zIndex: 6, sortOrder: 8,
        defaultConfig: {
          theme: 'bulletin-board',
          speed: 'medium',
          messages: [
            'Welcome back, Sunnyside Stars! ⭐',
            'Picture day is this Friday — wear your school colors!',
            'Parent-teacher conferences next Tuesday 🍎',
            'Reading Challenge: 20 minutes a day! 📖',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // ★ 📖 STORYBOOK — picture-book / library welcome aesthetic
  // Warm parchment pages, illuminated drop-cap title, pocket-watch
  // clock with live hands, chapter-list events, pop-up teacher card.
  // Elementary reading-rich lobby. Second "welcome" option alongside
  // Rainbow Ribbon's candy-pop energy.
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-storybook',
    name: '📖 Storybook',
    description: 'Open picture-book welcome. Illuminated drop-cap title, pocket-watch clock, parchment weather sketch, bookmark-ribbon countdown, pop-up teacher card, chapter-list events, parchment banner ticker. Warm serif + handwriting typography on parchment.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: 'ELEMENTARY',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#FBF0DC',
    zones: [
      {
        name: 'Illuminated Crest',
        widgetType: 'LOGO',
        x: 2, y: 3, width: 11, height: 16,
        zIndex: 5, sortOrder: 0,
        defaultConfig: { theme: 'storybook' },
      },
      {
        name: 'Welcome Page Title',
        widgetType: 'TEXT',
        x: 14, y: 4, width: 70, height: 15,
        zIndex: 4, sortOrder: 1,
        defaultConfig: {
          theme: 'storybook',
          content: 'Welcome, Little Readers',
          subtitle: "once upon a school year…",
        },
      },
      {
        name: 'Pocket Watch',
        widgetType: 'CLOCK',
        x: 85, y: 3, width: 13, height: 16,
        zIndex: 5, sortOrder: 2,
        defaultConfig: { theme: 'storybook', format: '12h' },
      },
      {
        name: 'Parchment Weather',
        widgetType: 'WEATHER',
        x: 2, y: 22, width: 20, height: 28,
        zIndex: 3, sortOrder: 3,
        defaultConfig: { theme: 'storybook', location: 'Springfield', units: 'imperial' },
      },
      {
        name: 'Open Book Announcement',
        widgetType: 'ANNOUNCEMENT',
        x: 24, y: 22, width: 52, height: 28,
        zIndex: 10, sortOrder: 4,
        defaultConfig: {
          theme: 'storybook',
          message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.',
          priority: 'normal',
        },
      },
      {
        name: 'Bookmark Countdown',
        widgetType: 'COUNTDOWN',
        x: 78, y: 22, width: 20, height: 28,
        zIndex: 4, sortOrder: 5,
        defaultConfig: { theme: 'storybook', label: 'Field Trip in', targetDate: '' },
      },
      {
        name: 'Pop-up Teacher Card',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 2, y: 54, width: 34, height: 34,
        zIndex: 3, sortOrder: 6,
        defaultConfig: {
          theme: 'storybook',
          staffName: 'Mrs. Johnson',
          role: 'Teacher of the Week',
          bio: 'Inspiring 3rd graders every day!',
        },
      },
      {
        name: 'Chapter List Events',
        widgetType: 'CALENDAR',
        x: 38, y: 54, width: 60, height: 34,
        zIndex: 3, sortOrder: 7,
        defaultConfig: { theme: 'storybook', daysToShow: 7, maxEvents: 3 },
      },
      {
        name: 'Parchment Banner Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        zIndex: 6, sortOrder: 8,
        defaultConfig: {
          theme: 'storybook',
          speed: 'medium',
          messages: [
            'Once upon a school year… welcome back, readers! ⭐',
            'Library open every day after lunch 📚',
            'Picture day is this Friday',
            'Reading Challenge: 20 minutes a day!',
          ],
        },
      },
    ],
  },

  {
    id: "preset-lobby-scrapbook",
    name: "📎 Scrapbook",
    description: "Elementary polaroid-scrapbook welcome. Washi tape, handwriting, paper clips, doodle frames.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FFF8E7",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "scrapbook" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "scrapbook", content: "Welcome, Friends!", subtitle: "look who showed up today ★" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "scrapbook", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "scrapbook", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "scrapbook", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "scrapbook", label: "Field Trip in", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "scrapbook", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "scrapbook", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "scrapbook", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-locker-hallway",
    name: "🔐 Locker Hallway",
    description: "Middle school locker-row welcome. Magnetic letter tiles, combination-lock clock, notebook-paper announcements.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#6B727C",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "locker-hallway" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "locker-hallway", content: "WELCOME BACK, EAGLES", subtitle: "go grab your locker combo" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "locker-hallway", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "locker-hallway", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "locker-hallway", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "locker-hallway", label: "Field Trip in", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "locker-hallway", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "locker-hallway", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "locker-hallway", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-spirit-rally",
    name: "📣 Spirit Rally",
    description: "Middle school pep-rally welcome. Megaphones, foam fingers, scoreboard LED, jumbotron energy.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#1A365D",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "spirit-rally" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "spirit-rally", content: "LET'S GO TIGERS!", subtitle: "hype it up for the big game" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "spirit-rally", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "spirit-rally", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "spirit-rally", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "spirit-rally", label: "Game Day in", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "spirit-rally", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "spirit-rally", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "spirit-rally", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-stem-lab",
    name: "🔬 STEM Lab",
    description: "Middle school STEM classroom welcome. Circuit-board card, rocket countdown, oscilloscope ticker, terminal announcements.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0A192F",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "stem-lab" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "stem-lab", content: "WELCOME TO THE LAB", subtitle: "// today is launch day" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "stem-lab", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "stem-lab", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "stem-lab", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "stem-lab", label: "Launch in", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "stem-lab", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "stem-lab", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "stem-lab", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-morning-news",
    name: "📺 Morning News",
    description: "Middle school morning-show welcome. Lower-third chyrons, LIVE badge, breaking-news countdown, station-ID logo.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0F172A",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "morning-news" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "morning-news", content: "GOOD MORNING", subtitle: "Your top stories this morning" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "morning-news", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "morning-news", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "morning-news", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "morning-news", label: "Field Trip in", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "morning-news", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "morning-news", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "morning-news", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-art-studio",
    name: "🎨 Art Studio",
    description: "Middle school art-room welcome. Painter's palette logo, canvas easels, watercolor weather, spray-paint countdown.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FBF7F0",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "art-studio" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "art-studio", content: "make something today", subtitle: "~ paint outside the lines ~" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "art-studio", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "art-studio", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "art-studio", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "art-studio", label: "Gallery Night in", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "art-studio", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "art-studio", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "art-studio", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-varsity-athletic",
    name: "🥇 Varsity Athletic",
    description: "High school stadium-jumbotron welcome. Chrome crest, amber LED scoreboard, flip-card countdown, jersey-card events.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0F1F3A",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "varsity-athletic" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "varsity-athletic", content: "GO TIGERS!", subtitle: "HOME OF THE CHAMPIONS" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "varsity-athletic", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "varsity-athletic", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "varsity-athletic", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "varsity-athletic", label: "Kickoff in", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "varsity-athletic", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "varsity-athletic", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "varsity-athletic", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-senior-countdown",
    name: "🎓 Senior Countdown",
    description: "High school senior-class welcome. Parchment + gold foil, grandfather clock, diploma-scroll announcements, laurel-wreath seals.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#F5EFE1",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "senior-countdown" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "senior-countdown", content: "CLASS OF 2027", subtitle: "making memories together" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "senior-countdown", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "senior-countdown", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "senior-countdown", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "senior-countdown", label: "Graduation in", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "senior-countdown", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "senior-countdown", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "senior-countdown", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-news-studio-pro",
    name: "🎬 News Studio Pro",
    description: "High school premium broadcast welcome. Glass panels, network-blue accent, italic-serif ticker, hot-red LIVE indicator.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0B0F17",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "news-studio-pro" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "news-studio-pro", content: "BREAKING", subtitle: "Your student news network" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "news-studio-pro", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "news-studio-pro", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "news-studio-pro", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "news-studio-pro", label: "T-Minus", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "news-studio-pro", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "news-studio-pro", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "news-studio-pro", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-campus-quad",
    name: "🏛️ Campus Quad",
    description: "High school editorial welcome. Massive Fraunces serif, accent-red hairlines, line-art weather icons, generous whitespace.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#F7F5F0",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "campus-quad" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "campus-quad", content: "Welcome", subtitle: "This week on campus" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "campus-quad", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "campus-quad", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "campus-quad", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "campus-quad", label: "Days until", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "campus-quad", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "campus-quad", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "campus-quad", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },
  {
    id: "preset-lobby-achievement-hall",
    name: "🏅 Achievement Hall",
    description: "High school trophy-hall welcome. Engraved brass plaques, velvet backing, ornate gold frames, Roman-numeral clock.",
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#3D2817",
    zones: [
      { name: 'School Logo',       widgetType: 'LOGO',            x: 2, y: 2, width: 8, height: 13, zIndex: 5, sortOrder: 0, defaultConfig: { theme: "achievement-hall" } },
      { name: 'Welcome Banner',    widgetType: 'TEXT',            x: 10, y: 4, width: 78, height: 15, zIndex: 4, sortOrder: 1,
        defaultConfig: { theme: "achievement-hall", content: "HALL OF FAME", subtitle: "honoring excellence" } },
      { name: 'Clock',             widgetType: 'CLOCK',           x: 89, y: 2, width: 9, height: 13, zIndex: 5, sortOrder: 2, defaultConfig: { theme: "achievement-hall", format: '12h' } },
      { name: 'Weather',           widgetType: 'WEATHER',         x: 2, y: 22, width: 20, height: 26, zIndex: 3, sortOrder: 3, defaultConfig: { theme: "achievement-hall", location: 'Springfield', units: 'imperial' } },
      { name: 'Announcement',      widgetType: 'ANNOUNCEMENT',    x: 24, y: 22, width: 52, height: 26, zIndex: 10, sortOrder: 4,
        defaultConfig: { theme: "achievement-hall", message: 'Book Fair starts Monday! 📚 Come find your new favorite story in the library.', priority: 'normal' } },
      { name: 'Countdown',         widgetType: 'COUNTDOWN',       x: 78, y: 22, width: 20, height: 26, zIndex: 4, sortOrder: 5, defaultConfig: { theme: "achievement-hall", label: "Ceremony in", targetDate: '' } },
      { name: 'Teacher Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 2, y: 52, width: 30, height: 36, zIndex: 3, sortOrder: 6,
        defaultConfig: { theme: "achievement-hall", staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring students every day.' } },
      { name: 'Upcoming Events',   widgetType: 'CALENDAR',        x: 34, y: 52, width: 64, height: 36, zIndex: 2, sortOrder: 7, defaultConfig: { theme: "achievement-hall", daysToShow: 7, maxEvents: 3 } },
      { name: 'Ticker',            widgetType: 'TICKER',          x: 0, y: 90, width: 100, height: 10, zIndex: 6, sortOrder: 8,
        defaultConfig: { theme: "achievement-hall", speed: 'medium',
          messages: ['Welcome back, Stars! ⭐', 'Picture day is this Friday', 'Parent-teacher conferences next Tuesday', 'Reading Challenge: 20 minutes a day'] } },
    ],
  },

  // ─────────────────────────────────────────────────────
  // ★ 🏆 FIELD DAY — shape-based sports/varsity elementary theme
  // Ported from design-lab/opus/05-field-day.html. Stopwatch clock,
  // shield weather, medal countdown, trophy announcement, jersey
  // calendar cards, scoreboard ticker. Deep-navy stadium background.
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-field-day',
    name: '🏆 Field Day',
    description: 'Varsity pennant welcome, stopwatch clock, shield weather, medal countdown, trophy announcement scroll, jersey event cards, scoreboard ticker. Every widget is a real sports-sticker shape.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    schoolLevel: 'ELEMENTARY',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1E2A4A',
    zones: [
      {
        name: 'Mascot Patch',
        widgetType: 'LOGO',
        x: 85, y: 3, width: 12, height: 18,
        zIndex: 6, sortOrder: 0,
        defaultConfig: { theme: 'field-day' },
      },
      {
        name: 'Varsity Welcome Pennant',
        widgetType: 'TEXT',
        x: 7, y: 4, width: 76, height: 18,
        zIndex: 3, sortOrder: 1,
        defaultConfig: {
          theme: 'field-day',
          content: 'GO TIGERS!',
          subtitle: 'Welcome Back Elementary Champions',
        },
      },
      {
        name: 'Field Trip Medal',
        widgetType: 'COUNTDOWN',
        x: 42, y: 22, width: 16, height: 26,
        zIndex: 5, sortOrder: 2,
        defaultConfig: { theme: 'field-day', label: 'Field Trip in', targetDate: '' },
      },
      {
        name: 'Stopwatch Clock',
        widgetType: 'CLOCK',
        x: 4, y: 30, width: 18, height: 34,
        zIndex: 2, sortOrder: 3,
        defaultConfig: { theme: 'field-day', format: '12h' },
      },
      {
        name: 'Shield Weather',
        widgetType: 'WEATHER',
        x: 78, y: 30, width: 18, height: 34,
        zIndex: 2, sortOrder: 4,
        defaultConfig: { theme: 'field-day', location: 'Springfield', units: 'imperial' },
      },
      {
        name: 'Trophy Announcement',
        widgetType: 'ANNOUNCEMENT',
        x: 23, y: 44, width: 54, height: 22,
        zIndex: 10, sortOrder: 5,
        defaultConfig: {
          theme: 'field-day',
          message: 'ASSEMBLY FRIDAY — celebrate our reading champions in the gym at 2:00 PM!',
          priority: 'normal',
        },
      },
      {
        name: 'MVP Teacher Card',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 4, y: 68, width: 30, height: 20,
        zIndex: 3, sortOrder: 6,
        defaultConfig: {
          theme: 'field-day',
          staffName: 'Mrs. Johnson',
          role: 'Teacher of the Week',
          bio: 'Coaching every kid to their personal best.',
        },
      },
      {
        name: 'Jersey Event Cards',
        widgetType: 'CALENDAR',
        x: 36, y: 68, width: 60, height: 20,
        zIndex: 3, sortOrder: 7,
        defaultConfig: { theme: 'field-day', daysToShow: 7, maxEvents: 3 },
      },
      {
        name: 'Scoreboard Ticker',
        widgetType: 'TICKER',
        x: 2, y: 89, width: 96, height: 10,
        zIndex: 6, sortOrder: 8,
        defaultConfig: {
          theme: 'field-day',
          speed: 'medium',
          messages: [
            'GAME DAY TOMORROW — wear your team colors!',
            'Reading Challenge: 20 minutes a day!',
            'Lunch menu updates every Monday',
            'Picture day is this Friday',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // LOBBY — the main entrance display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-welcome',
    name: 'Lobby Welcome Board',
    description: 'Main entrance display with school logo, announcements, upcoming events, and a scrolling ticker at the bottom.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'School Logo',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 25, height: 20,
        sortOrder: 0,
        defaultConfig: { theme: 'sunshine-academy', fitMode: 'contain' },
      },
      {
        name: 'Welcome Message',
        widgetType: 'TEXT',
        x: 25, y: 0, width: 50, height: 20,
        sortOrder: 1,
        defaultConfig: { theme: 'sunshine-academy', content: 'Welcome to Sunshine Academy! ☀️', fontSize: 36, alignment: 'center' },
      },
      {
        name: 'Clock & Weather',
        widgetType: 'CLOCK',
        x: 75, y: 0, width: 25, height: 10,
        sortOrder: 2,
        defaultConfig: { theme: 'sunshine-academy', format: '12h', showSeconds: false },
      },
      {
        name: 'Weather',
        widgetType: 'WEATHER',
        x: 75, y: 10, width: 25, height: 10,
        sortOrder: 3,
        defaultConfig: { theme: 'sunshine-academy', units: 'imperial', showForecast: false },
      },
      {
        name: 'Main Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 0, y: 20, width: 60, height: 70,
        sortOrder: 4,
        defaultConfig: { theme: 'sunshine-academy', priority: 'normal' },
      },
      {
        name: 'Upcoming Events',
        widgetType: 'CALENDAR',
        x: 60, y: 20, width: 40, height: 70,
        sortOrder: 5,
        defaultConfig: { theme: 'sunshine-academy', daysToShow: 7, showWeekend: false },
      },
      {
        name: 'Bottom Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 6,
        defaultConfig: { theme: 'sunshine-academy', speed: 'medium', direction: 'left', messages: ['Welcome back, Sunshine Stars! ⭐', 'Picture day is this Friday!', 'Parent-teacher conferences next Tuesday'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // LOBBY — visitor information display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-lobby-info',
    name: 'Lobby Info Board',
    description: 'Visitor-focused display with a large video/slideshow area, school info, and wayfinding.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Header Bar',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 80, height: 12,
        sortOrder: 0,
        defaultConfig: { content: 'Springfield Elementary School', fontSize: 32, alignment: 'center', bgColor: '#1e3a5f', color: '#ffffff' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 80, y: 0, width: 20, height: 12,
        sortOrder: 1,
        defaultConfig: { format: '12h' },
      },
      {
        name: 'Main Slideshow',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 12, width: 65, height: 78,
        sortOrder: 2,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
      {
        name: 'Today at a Glance',
        widgetType: 'CALENDAR',
        x: 65, y: 12, width: 35, height: 40,
        sortOrder: 3,
        defaultConfig: { daysToShow: 1 },
      },
      {
        name: 'Quick Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 65, y: 52, width: 35, height: 38,
        sortOrder: 4,
      },
      {
        name: 'Scrolling Updates',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 5,
        defaultConfig: { speed: 'medium', direction: 'left' },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // HALLWAY — high-traffic corridor display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-hallway-trizone',
    name: 'Hallway Tri-Zone',
    description: 'Three horizontal bands: header with logo/clock, large media area in the middle, announcements at the bottom.',
    category: 'HALLWAY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Logo',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 20, height: 15,
        sortOrder: 0,
        defaultConfig: { theme: 'final-chance', fitMode: 'contain' },
      },
      {
        name: 'Header Title',
        widgetType: 'TEXT',
        x: 20, y: 0, width: 60, height: 15,
        sortOrder: 1,
        defaultConfig: { theme: 'final-chance', content: 'Eagle News', fontSize: 28, alignment: 'center' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 80, y: 0, width: 20, height: 15,
        sortOrder: 2,
      },
      {
        name: 'Main Content',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 15, width: 100, height: 60,
        sortOrder: 3,
        defaultConfig: { theme: 'final-chance', transitionEffect: 'slide', intervalMs: 6000, fitMode: 'cover' },
      },
      {
        name: 'Bottom Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 0, y: 75, width: 100, height: 25,
        sortOrder: 4,
      },
    ],
  },

  {
    id: 'preset-hallway-portrait',
    name: 'Hallway Portrait Display',
    description: 'Portrait-oriented display for narrow hallway spaces. Stacked layout: logo, photo slideshow, upcoming events, and ticker.',
    category: 'HALLWAY',
    orientation: 'PORTRAIT',
    screenWidth: 2160,
    screenHeight: 3840,
    zones: [
      {
        name: 'School Logo',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 100, height: 12,
        sortOrder: 0,
        defaultConfig: { fitMode: 'contain' },
      },
      {
        name: 'Photo Slideshow',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 12, width: 100, height: 40,
        sortOrder: 1,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 7000, fitMode: 'cover' },
      },
      {
        name: 'Events & Announcements',
        widgetType: 'CALENDAR',
        x: 0, y: 52, width: 100, height: 30,
        sortOrder: 2,
        defaultConfig: { daysToShow: 5, showWeekend: false },
      },
      {
        name: 'Staff Spotlight',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 0, y: 82, width: 100, height: 18,
        sortOrder: 3,
        defaultConfig: { rotateIntervalMs: 15000 },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // CAFETERIA — lunch and dining display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-cafeteria-menu',
    name: 'Cafeteria Menu Board',
    description: 'Large lunch menu with daily specials, a photo area, and countdown to next lunch period.',
    category: 'CAFETERIA',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Header',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 70, height: 12,
        sortOrder: 0,
        defaultConfig: { theme: 'diner-chalkboard', content: "Today's Menu", fontSize: 36, alignment: 'center', bgColor: '#2d5016', color: '#ffffff' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 70, y: 0, width: 30, height: 12,
        sortOrder: 1,
      },
      {
        name: 'Lunch Menu',
        widgetType: 'LUNCH_MENU',
        x: 0, y: 12, width: 55, height: 78,
        sortOrder: 2,
        defaultConfig: { theme: 'diner-chalkboard', meals: [
          { label: 'Main Entrée', items: ['Update in settings'] },
          { label: 'Side Options', items: ['Update in settings'] },
          { label: 'Drinks', items: ['Milk', 'Juice', 'Water'] },
        ]},
      },
      {
        name: 'Food Photos',
        widgetType: 'IMAGE_CAROUSEL',
        x: 55, y: 12, width: 45, height: 50,
        sortOrder: 3,
        defaultConfig: { theme: 'diner-chalkboard', transitionEffect: 'fade', intervalMs: 5000, fitMode: 'cover' },
      },
      {
        name: 'Next Period Countdown',
        widgetType: 'COUNTDOWN',
        x: 55, y: 62, width: 45, height: 28,
        sortOrder: 4,
        defaultConfig: { theme: 'diner-chalkboard', label: 'Next lunch period in', showHours: true, showDays: false },
      },
      {
        name: 'Nutrition Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 5,
        defaultConfig: { theme: 'diner-chalkboard', speed: 'slow', messages: ['Remember to eat your fruits and vegetables!', 'Allergy info available at the front counter'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // CLASSROOM — teacher-friendly in-class display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-classroom-daily',
    name: 'Classroom Daily Board',
    description: 'In-class display with bell schedule, daily agenda, and a rotating photo/announcement area.',
    category: 'CLASSROOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Class Title',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 75, height: 12,
        sortOrder: 0,
        defaultConfig: { theme: 'back-to-school', content: 'Room 204 — Mrs. Johnson', fontSize: 24, alignment: 'left' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 75, y: 0, width: 25, height: 12,
        sortOrder: 1,
        defaultConfig: { theme: 'back-to-school', format: '12h', showSeconds: true },
      },
      {
        name: 'Bell Schedule',
        widgetType: 'BELL_SCHEDULE',
        x: 0, y: 12, width: 30, height: 78,
        sortOrder: 2,
        defaultConfig: { theme: 'back-to-school', showCurrentHighlight: true },
      },
      {
        name: 'Daily Agenda / Announcements',
        widgetType: 'RICH_TEXT',
        x: 30, y: 12, width: 40, height: 78,
        sortOrder: 3,
        defaultConfig: { theme: 'back-to-school', html: '<h2>Today\'s Agenda</h2><ol><li>Warm-up activity</li><li>Lesson</li><li>Group work</li><li>Wrap-up</li></ol>' },
      },
      {
        name: 'Class Photos / Spotlight',
        widgetType: 'IMAGE_CAROUSEL',
        x: 70, y: 12, width: 30, height: 50,
        sortOrder: 4,
        defaultConfig: { theme: 'back-to-school', transitionEffect: 'fade', intervalMs: 10000, fitMode: 'cover' },
      },
      {
        name: 'Countdown to Event',
        widgetType: 'COUNTDOWN',
        x: 70, y: 62, width: 30, height: 28,
        sortOrder: 5,
        defaultConfig: { theme: 'back-to-school', label: 'Days until field trip', showDays: true, showHours: false },
      },
      {
        name: 'Bottom Updates',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 6,
        defaultConfig: { theme: 'back-to-school', speed: 'slow', messages: ['Remember: Science project due Friday!'] },
      },
    ],
  },

  {
    id: 'preset-classroom-simple',
    name: 'Classroom Simple',
    description: 'Minimal two-zone layout for teachers who want just an agenda and a visual area. No clutter.',
    category: 'CLASSROOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Agenda / Instructions',
        widgetType: 'RICH_TEXT',
        x: 0, y: 0, width: 50, height: 100,
        sortOrder: 0,
        defaultConfig: { html: '<h2>Today</h2><p>Update this with your daily agenda...</p>' },
      },
      {
        name: 'Visual Content',
        widgetType: 'IMAGE_CAROUSEL',
        x: 50, y: 0, width: 50, height: 100,
        sortOrder: 1,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // OFFICE — front office & admin display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-office-dashboard',
    name: 'Office Dashboard',
    description: 'Front office display with visitor info, staff directory spotlight, calendar, and emergency-ready announcement area.',
    category: 'OFFICE',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'School Logo & Name',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 30, height: 15,
        sortOrder: 0,
        defaultConfig: { theme: 'office-dashboard', fitMode: 'contain' },
      },
      {
        name: 'Welcome Text',
        widgetType: 'TEXT',
        x: 30, y: 0, width: 45, height: 15,
        sortOrder: 1,
        defaultConfig: { theme: 'office-dashboard', content: 'Welcome — Please check in at the front desk', fontSize: 20, alignment: 'center' },
      },
      {
        name: 'Clock & Weather',
        widgetType: 'CLOCK',
        x: 75, y: 0, width: 25, height: 15,
        sortOrder: 2,
      },
      {
        name: 'Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 0, y: 15, width: 50, height: 50,
        sortOrder: 3,
      },
      {
        name: 'Staff Spotlight',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 50, y: 15, width: 50, height: 25,
        sortOrder: 4,
        defaultConfig: { theme: 'office-dashboard', rotateIntervalMs: 20000 },
      },
      {
        name: 'School Calendar',
        widgetType: 'CALENDAR',
        x: 50, y: 40, width: 50, height: 25,
        sortOrder: 5,
        defaultConfig: { theme: 'office-dashboard', daysToShow: 5, showWeekend: false },
      },
      {
        name: 'Visitor Info / Web Embed',
        widgetType: 'WEBPAGE',
        x: 0, y: 65, width: 100, height: 25,
        sortOrder: 6,
        defaultConfig: { theme: 'office-dashboard', scrollEnabled: false },
      },
      {
        name: 'Alert Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 7,
        defaultConfig: { theme: 'office-dashboard', speed: 'medium', messages: ['Visitors: please remember to sign in and wear your badge'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // GYM — athletics & events display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-gym-scoreboard',
    name: 'Gym & Athletics Board',
    description: 'Large visual display for gym or multi-purpose room with video, event countdown, and team announcements.',
    category: 'GYM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Team Logo / School Logo',
        widgetType: 'LOGO',
        x: 0, y: 0, width: 20, height: 20,
        sortOrder: 0,
      },
      {
        name: 'Event Title',
        widgetType: 'TEXT',
        x: 20, y: 0, width: 60, height: 20,
        sortOrder: 1,
        defaultConfig: { content: 'Go Eagles!', fontSize: 42, alignment: 'center', bgColor: '#8b0000', color: '#ffd700' },
      },
      {
        name: 'Game Countdown',
        widgetType: 'COUNTDOWN',
        x: 80, y: 0, width: 20, height: 20,
        sortOrder: 2,
        defaultConfig: { label: 'Next Game', showDays: true, showHours: true },
      },
      {
        name: 'Main Video / Hype Reel',
        widgetType: 'VIDEO',
        x: 0, y: 20, width: 65, height: 70,
        sortOrder: 3,
        defaultConfig: { autoplay: true, muted: true, loop: true, fitMode: 'cover' },
      },
      {
        name: 'Schedule & Scores',
        widgetType: 'RICH_TEXT',
        x: 65, y: 20, width: 35, height: 40,
        sortOrder: 4,
        defaultConfig: { html: '<h3>This Week</h3><p>Update with game schedule...</p>' },
      },
      {
        name: 'Team Roster Spotlight',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 65, y: 60, width: 35, height: 30,
        sortOrder: 5,
        defaultConfig: { rotateIntervalMs: 10000 },
      },
      {
        name: 'Spirit Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 6,
        defaultConfig: { speed: 'fast', messages: ['Spirit Week is coming!', 'Wear your school colors Friday!'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // LIBRARY — quiet, information-focused display
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-library-info',
    name: 'Library Info Board',
    description: 'Quiet, information-rich display for library entrance with new arrivals, reading events, and a website embed.',
    category: 'LIBRARY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Library Header',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 75, height: 12,
        sortOrder: 0,
        defaultConfig: { content: 'Media Center', fontSize: 28, alignment: 'center', bgColor: '#1a3a1a', color: '#ffffff' },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 75, y: 0, width: 25, height: 12,
        sortOrder: 1,
      },
      {
        name: 'New Arrivals Slideshow',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 12, width: 50, height: 55,
        sortOrder: 2,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
      {
        name: 'Reading Events / Programs',
        widgetType: 'CALENDAR',
        x: 50, y: 12, width: 50, height: 55,
        sortOrder: 3,
        defaultConfig: { daysToShow: 14, showWeekend: true },
      },
      {
        name: 'Library Catalog / Website',
        widgetType: 'WEBPAGE',
        x: 0, y: 67, width: 60, height: 23,
        sortOrder: 4,
        defaultConfig: { scrollEnabled: false, refreshIntervalMs: 300000 },
      },
      {
        name: 'Book of the Week',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 60, y: 67, width: 40, height: 23,
        sortOrder: 5,
        defaultConfig: { rotateIntervalMs: 30000 },
      },
      {
        name: 'Reading Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 6,
        defaultConfig: { speed: 'slow', messages: ['Read-a-thon starts next Monday!', 'Book Club meets every Wednesday at 3pm'] },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // UNIVERSAL — flexible layouts for any location
  // ─────────────────────────────────────────────────────
  {
    id: 'preset-fullscreen-media',
    name: 'Full Screen Media',
    description: 'Simple full-screen layout for playing a single video, image, or slideshow. No distractions.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Full Screen Content',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 0, width: 100, height: 100,
        sortOrder: 0,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
    ],
  },

  {
    id: 'preset-split-50-50',
    name: 'Split Screen (50/50)',
    description: 'Equal left-right split. Put any content on each side — great for before/after, bilingual, or side-by-side info.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Left Panel',
        widgetType: 'EMPTY',
        x: 0, y: 0, width: 50, height: 100,
        sortOrder: 0,
      },
      {
        name: 'Right Panel',
        widgetType: 'EMPTY',
        x: 50, y: 0, width: 50, height: 100,
        sortOrder: 1,
      },
    ],
  },

  {
    id: 'preset-thirds-horizontal',
    name: 'Three Rows',
    description: 'Three equal horizontal bands. Header on top, main content in the middle, footer info on the bottom.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Top Band',
        widgetType: 'EMPTY',
        x: 0, y: 0, width: 100, height: 33.33,
        sortOrder: 0,
      },
      {
        name: 'Middle Band',
        widgetType: 'EMPTY',
        x: 0, y: 33.33, width: 100, height: 33.34,
        sortOrder: 1,
      },
      {
        name: 'Bottom Band',
        widgetType: 'EMPTY',
        x: 0, y: 66.67, width: 100, height: 33.33,
        sortOrder: 2,
      },
    ],
  },

  {
    id: 'preset-url-video-carousel',
    name: 'Web + Video + Photos',
    description: 'Three stacked zones: a website/embed on top, video in the middle, and a photo carousel on the bottom. The layout you asked for!',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Website / Web App',
        widgetType: 'WEBPAGE',
        x: 0, y: 0, width: 100, height: 30,
        sortOrder: 0,
        defaultConfig: { url: '', scrollEnabled: false, refreshIntervalMs: 60000 },
      },
      {
        name: 'Video Player',
        widgetType: 'VIDEO',
        x: 0, y: 30, width: 100, height: 40,
        sortOrder: 1,
        defaultConfig: { autoplay: true, muted: false, loop: true, fitMode: 'contain' },
      },
      {
        name: 'Photo Carousel',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 70, width: 100, height: 30,
        sortOrder: 2,
        defaultConfig: { transitionEffect: 'slide', intervalMs: 5000, fitMode: 'cover' },
      },
    ],
  },

  {
    id: 'preset-l-shaped',
    name: 'L-Shape Layout',
    description: 'Large main area with a sidebar and bottom bar — great for news-style displays with a sidebar for quick info.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Main Content',
        widgetType: 'EMPTY',
        x: 0, y: 0, width: 70, height: 75,
        sortOrder: 0,
      },
      {
        name: 'Sidebar',
        widgetType: 'EMPTY',
        x: 70, y: 0, width: 30, height: 75,
        sortOrder: 1,
      },
      {
        name: 'Bottom Bar',
        widgetType: 'EMPTY',
        x: 0, y: 75, width: 100, height: 25,
        sortOrder: 2,
      },
    ],
  },

  {
    id: 'preset-grid-four',
    name: 'Four-Panel Grid',
    description: 'Equal four-panel grid layout. Perfect for showing four different content areas at once.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Top Left',
        widgetType: 'EMPTY',
        x: 0, y: 0, width: 50, height: 50,
        sortOrder: 0,
      },
      {
        name: 'Top Right',
        widgetType: 'EMPTY',
        x: 50, y: 0, width: 50, height: 50,
        sortOrder: 1,
      },
      {
        name: 'Bottom Left',
        widgetType: 'EMPTY',
        x: 0, y: 50, width: 50, height: 50,
        sortOrder: 2,
      },
      {
        name: 'Bottom Right',
        widgetType: 'EMPTY',
        x: 50, y: 50, width: 50, height: 50,
        sortOrder: 3,
      },
    ],
  },

  {
    id: 'preset-picture-in-picture',
    name: 'Picture-in-Picture',
    description: 'Full-screen background with a small overlay in the corner — like a weather widget over a slideshow.',
    category: 'CUSTOM',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    zones: [
      {
        name: 'Background Content',
        widgetType: 'IMAGE_CAROUSEL',
        x: 0, y: 0, width: 100, height: 100,
        zIndex: 0,
        sortOrder: 0,
        defaultConfig: { transitionEffect: 'fade', intervalMs: 8000, fitMode: 'cover' },
      },
      {
        name: 'Overlay Widget',
        widgetType: 'WEATHER',
        x: 72, y: 3, width: 25, height: 20,
        zIndex: 10,
        sortOrder: 1,
        defaultConfig: { units: 'imperial', showForecast: false },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // ELEMENTARY MORNING WELCOME — K-5 colorful start-of-day
  // ─────────────────────────────────────────────────────
  {
    id: 'elementary-morning-welcome',
    name: 'Elementary Morning Welcome',
    description: 'Colorful K-5 morning screen with clock, weather, announcements ticker, and a mascot image zone — perfect for lobby or hallway before the bell.',
    category: 'welcome',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgGradient: 'linear-gradient(135deg, #FFF9C4 0%, #B3E5FC 50%, #F8BBD0 100%)',
    zones: [
      {
        name: 'Good Morning Clock',
        widgetType: 'CLOCK',
        x: 0, y: 0, width: 30, height: 28,
        sortOrder: 0,
        defaultConfig: { format: '12h', showSeconds: false, color: '#1565C0', bgColor: 'transparent' },
      },
      {
        name: 'Weather',
        widgetType: 'WEATHER',
        x: 30, y: 0, width: 40, height: 28,
        sortOrder: 1,
        defaultConfig: { units: 'imperial', showForecast: false },
      },
      {
        name: 'Mascot / School Image',
        widgetType: 'IMAGE',
        x: 70, y: 0, width: 30, height: 55,
        sortOrder: 2,
        defaultConfig: { fitMode: 'contain' },
      },
      {
        name: 'Morning Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 0, y: 28, width: 70, height: 55,
        sortOrder: 3,
        defaultConfig: {
          message: 'Good morning, Stars! Remember to return your reading logs today.',
          priority: 'normal',
        },
      },
      {
        name: 'Scrolling Morning Ticker',
        widgetType: 'TICKER',
        x: 0, y: 83, width: 100, height: 17,
        sortOrder: 4,
        defaultConfig: {
          speed: 'slow',
          messages: [
            'Welcome to school! Have a great day! ⭐',
            'Lunch today: pizza, salad bar, and fruit cup',
            'Library books due this Friday',
            'Early dismissal Wednesday at 1:30 PM',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // MIDDLE SCHOOL HALL BOARD — landscape tri-zone for corridors
  // ─────────────────────────────────────────────────────
  {
    id: 'middle-school-hall-board',
    name: 'Middle School Hall Board',
    description: 'Landscape hallway display for middle school: clock/date on the left, bell schedule in the center, and a scrolling announcement ticker at the bottom.',
    category: 'hallway',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#1A237E',
    zones: [
      {
        name: 'Clock & Date',
        widgetType: 'CLOCK',
        x: 0, y: 0, width: 28, height: 85,
        sortOrder: 0,
        defaultConfig: { theme: 'middle-school-hall', format: '12h', showSeconds: true, color: '#FFFFFF', bgColor: 'transparent' },
      },
      {
        name: 'Bell Schedule',
        widgetType: 'BELL_SCHEDULE',
        x: 29, y: 0, width: 70, height: 85,
        sortOrder: 1,
        defaultConfig: { theme: 'middle-school-hall', showCurrentHighlight: true },
      },
      {
        name: 'Hall Ticker',
        widgetType: 'TICKER',
        x: 0, y: 85, width: 100, height: 15,
        sortOrder: 2,
        defaultConfig: { theme: 'middle-school-hall', speed: 'medium',
          messages: [
            'Spirit Week: dress-up themes posted on the main office door',
            'Science fair projects due next Friday',
            'No phones in hallways — keep them in your locker',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // HIGH SCHOOL ATHLETICS SCOREBOARD — portrait, fan-facing
  // ─────────────────────────────────────────────────────
  {
    id: 'high-school-athletics-scoreboard',
    name: 'High School Athletics Scoreboard',
    description: 'Portrait display for team lobbies and gyms: school logo, next-game countdown, last-score summary, and a scrolling fan-hype ticker.',
    category: 'athletics',
    orientation: 'PORTRAIT',
    screenWidth: 1080,
    screenHeight: 1920,
    bgColor: '#0D0D0D',
    zones: [
      {
        name: 'Team / School Logo',
        widgetType: 'LOGO',
        x: 10, y: 2, width: 80, height: 18,
        sortOrder: 0,
        defaultConfig: { theme: 'high-school-athletics', fitMode: 'contain' },
      },
      {
        name: 'Next Game Countdown',
        widgetType: 'COUNTDOWN',
        x: 0, y: 22, width: 100, height: 24,
        sortOrder: 1,
        defaultConfig: { theme: 'high-school-athletics', label: 'Next Game',
          targetDate: '',
          showDays: true,
          showHours: true,
        },
      },
      {
        name: 'Last Score & Opponent',
        widgetType: 'RICH_TEXT',
        x: 0, y: 48, width: 100, height: 28,
        sortOrder: 2,
        defaultConfig: { theme: 'high-school-athletics', html: '<h2 style="color:#FFD700;text-align:center;font-size:2rem;">Last Game</h2><p style="color:#fff;text-align:center;font-size:1.5rem;">Eagles 42 — Rivals 28</p><p style="color:#aaa;text-align:center;">Update after each game</p>',
        },
      },
      {
        name: 'Fan Hype Ticker',
        widgetType: 'TICKER',
        x: 0, y: 78, width: 100, height: 12,
        sortOrder: 3,
        defaultConfig: { theme: 'high-school-athletics', speed: 'fast',
          messages: [
            'GO EAGLES! 🦅 Make some noise!',
            'Wear your school colors to the next home game',
            'Student section doors open 30 minutes before tip-off',
          ],
        },
      },
      {
        name: 'Hype Announcement',
        widgetType: 'TEXT',
        x: 0, y: 90, width: 100, height: 10,
        sortOrder: 4,
        defaultConfig: { theme: 'high-school-athletics', content: '🏆 State Champions 2024',
          fontSize: 28,
          alignment: 'center',
          color: '#FFD700',
          bgColor: 'transparent',
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // LIBRARY QUIET ZONE — subdued, minimal, reader-friendly
  // ─────────────────────────────────────────────────────
  {
    id: 'library-quiet-zone',
    name: 'Library Quiet Zone',
    description: 'Minimal, subdued library display with book-of-the-month image, quiet-hours schedule, and a small lunch menu — keeps noise down and readers informed.',
    category: 'library',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgGradient: LIBRARY_QUIET_BG,
    zones: [
      {
        name: 'Library Header',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 70, height: 14,
        sortOrder: 0,
        defaultConfig: { theme: 'library-quiet', content: 'Media Center — Please keep voices low 📚',
          fontSize: 22,
          alignment: 'center',
          color: '#3E2723',
          bgColor: 'transparent',
        },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 70, y: 0, width: 30, height: 14,
        sortOrder: 1,
        defaultConfig: { theme: 'library-quiet', format: '12h', showSeconds: false, color: '#3E2723', bgColor: 'transparent' },
      },
      {
        name: 'Book of the Month',
        widgetType: 'IMAGE',
        x: 0, y: 15, width: 35, height: 60,
        sortOrder: 2,
        defaultConfig: { theme: 'library-quiet', fitMode: 'contain' },
      },
      {
        name: 'Quiet Hours & Schedule',
        widgetType: 'RICH_TEXT',
        x: 36, y: 15, width: 36, height: 60,
        sortOrder: 3,
        defaultConfig: { theme: 'library-quiet', html: '<h3 style="color:#3E2723;">Library Hours</h3><p>Mon–Fri: 7:30 AM – 4:00 PM</p><p>Quiet Study: 8:00 – 11:00 AM</p><p>Open Reading: 11:00 AM – 3:00 PM</p>',
        },
      },
      {
        name: 'Lunch Menu (small)',
        widgetType: 'LUNCH_MENU',
        x: 73, y: 15, width: 27, height: 60,
        sortOrder: 4,
        defaultConfig: { theme: 'library-quiet', meals: [
            { label: 'Today', items: ['Update in settings'] },
          ],
        },
      },
      {
        name: 'Library Ticker',
        widgetType: 'TICKER',
        x: 0, y: 76, width: 100, height: 12,
        sortOrder: 5,
        defaultConfig: { theme: 'library-quiet', speed: 'slow',
          messages: [
            'New arrivals on the display shelf near the entrance',
            'Book Club meets Wednesdays at 3:15 PM — all grades welcome',
            'Overdue books? Return them to the front desk — no questions asked',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // GYM / PE DISPLAY — bold, motivational, activity-facing
  // ─────────────────────────────────────────────────────
  {
    id: 'gym-pe-display',
    name: 'Gym / PE Display',
    description: 'Bold gym-facing display with a motivational quote, class rotation schedule, and weather for outdoor activity planning.',
    category: 'gym',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgGradient: 'linear-gradient(160deg, #1B2631 0%, #2E4057 60%, #1B2631 100%)',
    zones: [
      {
        name: 'Motivational Quote',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 70, height: 28,
        sortOrder: 0,
        defaultConfig: { theme: 'gym-pe',
          content: '"Champions are made in the moments when they want to quit." — Keep going!',
          fontSize: 28,
          alignment: 'center',
          color: '#FFD700',
          bgColor: 'transparent',
        },
      },
      {
        name: 'Outdoor Weather',
        widgetType: 'WEATHER',
        x: 70, y: 0, width: 30, height: 28,
        sortOrder: 1,
        defaultConfig: { theme: 'gym-pe', units: 'imperial', showForecast: false },
      },
      {
        name: 'Class Rotation Schedule',
        widgetType: 'BELL_SCHEDULE',
        x: 0, y: 29, width: 60, height: 55,
        sortOrder: 2,
        defaultConfig: { theme: 'gym-pe', showCurrentHighlight: true },
      },
      {
        name: 'PE Announcements',
        widgetType: 'ANNOUNCEMENT',
        x: 61, y: 29, width: 39, height: 55,
        sortOrder: 3,
        defaultConfig: { theme: 'gym-pe',
          message: 'Fitness testing week starts Monday. Please wear appropriate athletic shoes.',
          priority: 'normal',
        },
      },
      {
        name: 'Activity Ticker',
        widgetType: 'TICKER',
        x: 0, y: 85, width: 100, height: 15,
        sortOrder: 4,
        defaultConfig: { theme: 'gym-pe',
          speed: 'medium',
          messages: [
            'Intramural sign-ups close this Friday — see Coach Davis',
            'Locker room reminder: clean up after yourself',
            'Outdoor PE cancelled when heat index exceeds 95°F',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // MUSIC ROOM / ARTS — artistic, concert-focused
  // ─────────────────────────────────────────────────────
  {
    id: 'music-room-arts',
    name: 'Music Room & Arts',
    description: 'Artistic display for music and arts classrooms: upcoming concert countdown, practice schedule, and a featured student spotlight.',
    category: 'arts',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgGradient: 'linear-gradient(135deg, #1A0533 0%, #2D1B5E 50%, #0D2137 100%)',
    zones: [
      {
        name: 'Arts Room Header',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 65, height: 16,
        sortOrder: 0,
        defaultConfig: { theme: 'music-arts', content: 'Music & Arts — Practice Makes Perfect 🎵',
          fontSize: 26,
          alignment: 'center',
          color: '#E040FB',
          bgColor: 'transparent',
        },
      },
      {
        name: 'Concert Countdown',
        widgetType: 'COUNTDOWN',
        x: 65, y: 0, width: 35, height: 16,
        sortOrder: 1,
        defaultConfig: { theme: 'music-arts', label: 'Spring Concert in',
          targetDate: '',
          showDays: true,
          showHours: false,
        },
      },
      {
        name: 'Practice Schedule',
        widgetType: 'RICH_TEXT',
        x: 0, y: 17, width: 45, height: 68,
        sortOrder: 2,
        defaultConfig: { theme: 'music-arts', html: '<h3 style="color:#E040FB;">Rehearsal Schedule</h3><p style="color:#fff;">Monday: Band 7:00–8:00 AM</p><p style="color:#fff;">Tuesday: Choir 3:15–4:30 PM</p><p style="color:#fff;">Thursday: Orchestra 3:15–5:00 PM</p><p style="color:#fff;">Update with current schedule</p>',
        },
      },
      {
        name: 'Featured Student Spotlight',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 46, y: 17, width: 54, height: 68,
        sortOrder: 3,
        defaultConfig: { theme: 'music-arts', staffName: 'Featured Artist',
          role: 'Student of the Month',
          bio: 'Outstanding dedication to our music program. Congratulations!',
          rotateIntervalMs: 20000,
        },
      },
      {
        name: 'Arts Ticker',
        widgetType: 'TICKER',
        x: 0, y: 86, width: 100, height: 14,
        sortOrder: 4,
        defaultConfig: { theme: 'music-arts', speed: 'slow',
          messages: [
            'All-State auditions — see Mr. Rivera for details',
            'Art gallery submissions due by the 15th',
            'Spring musical rehearsals begin next week — check the schedule',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // STEM / SCIENCE LAB — data-viz feel, fact-of-the-day
  // ─────────────────────────────────────────────────────
  {
    id: 'stem-science-lab',
    name: 'STEM & Science Lab',
    description: 'Data-inspired STEM lab display with a science fact of the day, project deadline countdown, and a safety reminders ticker.',
    category: 'stem',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgGradient: 'linear-gradient(160deg, #0A1628 0%, #0D3349 55%, #0A1628 100%)',
    zones: [
      {
        name: 'Lab Header',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 60, height: 15,
        sortOrder: 0,
        defaultConfig: { theme: 'stem-science', content: 'STEM Lab — Think. Build. Discover. 🔬',
          fontSize: 26,
          alignment: 'center',
          color: '#00E5FF',
          bgColor: 'transparent',
        },
      },
      {
        name: 'Project Countdown',
        widgetType: 'COUNTDOWN',
        x: 60, y: 0, width: 40, height: 15,
        sortOrder: 1,
        defaultConfig: { theme: 'stem-science', label: 'Science Fair Deadline',
          targetDate: '',
          showDays: true,
          showHours: true,
        },
      },
      {
        name: 'Science Fact of the Day',
        widgetType: 'RICH_TEXT',
        x: 0, y: 16, width: 55, height: 65,
        sortOrder: 2,
        defaultConfig: { theme: 'stem-science', html: '<h2 style="color:#00E5FF;">Fact of the Day</h2><p style="color:#E0F7FA;font-size:1.1rem;">The human body contains approximately 37 trillion cells.</p><br><p style="color:#80DEEA;">Update daily with a new science or STEM fact.</p>',
        },
      },
      {
        name: 'Lab Photo / Project Showcase',
        widgetType: 'IMAGE_CAROUSEL',
        x: 56, y: 16, width: 44, height: 65,
        sortOrder: 3,
        defaultConfig: { theme: 'stem-science', transitionEffect: 'fade',
          intervalMs: 7000,
          fitMode: 'cover',
        },
      },
      {
        name: 'Safety Reminders Ticker',
        widgetType: 'TICKER',
        x: 0, y: 82, width: 100, height: 18,
        sortOrder: 4,
        defaultConfig: { theme: 'stem-science', speed: 'slow',
          messages: [
            '🥽 Safety goggles required during all lab activities',
            'No food or drink in the lab at any time',
            'Report spills immediately to the teacher',
            'Wash hands after handling any lab materials',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // CAFETERIA DAILY SPECIAL — vibrant menu-first display
  // ─────────────────────────────────────────────────────
    {
    id: 'cafeteria-daily-special',
    name: 'Cafeteria Daily Special',
    description: 'Vibrant cafeteria display leading with the featured menu item, allergen legend, and next meal period countdown.',
    category: 'cafeteria',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgImage: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIHZpZXdCb3g9IjAgMCAxOTIwIDEwODAiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZzEiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjMkMzRTJEIiAvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiMxRTJCMUYiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGZpbHRlciBpZD0ibm9pc2UiPgoJCQk8ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC42NSIgbnVtT2N0YXZlcz0iMyIgc3RpdGNoVGlsZXM9InN0aXRjaCIvPgoJCQk8ZmVDb2xvck1hdHJpeCB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMSAwIDAgMCAwLCAwIDEgMCAwIDAsIDAgMCAxIDAgMCwgMCAwIDAgMC4wOCAwIiAvPgoJCTwvZmlsdGVyPgogICAgPHBhdHRlcm4gaWQ9ImNoYWxrLWR1c3QiIHg9IjAiIHk9IjAiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPGNpcmNsZSBjeD0iMjUiIGN5PSI1MCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIgLz4KICAgICAgPGNpcmNsZSBjeD0iMTMwIiBjeT0iODAiIHI9IjEuNSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgLz4KICAgICAgPGNpcmNsZSBjeD0iODAiIGN5PSIxNzAiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNCkiIC8+CiAgICAgIDxwYXRoIGQ9Ik00MCAxMzAgQzUwIDEyMCA2MCAxNDAgNzAgMTMwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMikiIGZpbGw9Im5vbmUiIC8+CiAgICAgIDxwYXRoIGQ9Ik0xNTAgMzAgQzE2MCAyMCAxNzAgNDAgMTgwIDMwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiIGZpbGw9Im5vbmUiIC8+CiAgICA8L3BhdHRlcm4+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjE0NDAiIGZpbGw9InVybCgjYmcxKSIgLz4KICA8cmVjdCB3aWR0aD0iMTkyMCIgaGVpZ2h0PSIxNDQwIiBmaWxsPSJ1cmwoI2NoYWxrLWR1c3QpIiAvPgogIDxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjE0NDAiIGZpbHRlcj0idXJsKCNub2lzZSkiIG9wYWNpdHk9IjAuNiIgLz4KPC9zdmc+",
    zones: [
      {
        name: 'Menu Header',
        widgetType: 'TEXT',
        x: 2, y: 3, width: 66, height: 14,
        sortOrder: 0,
        defaultConfig: {
          theme: 'diner-chalkboard',
          content: "Today's Cafeteria Menu 🍽️",
          fontSize: 32,
          alignment: 'center',
          color: '#FECA57',
          bgColor: 'transparent',
        },
      },
      {
        name: 'Next Meal Countdown',
        widgetType: 'COUNTDOWN',
        x: 70, y: 3, width: 28, height: 14,
        sortOrder: 1,
        defaultConfig: {
          theme: 'diner-chalkboard',
          label: 'Next meal period',
          showHours: true,
          showDays: false,
        },
      },
      {
        name: 'Featured Menu Item',
        widgetType: 'LUNCH_MENU',
        x: 2, y: 20, width: 55, height: 75,
        sortOrder: 2,
        defaultConfig: {
          theme: 'diner-chalkboard',
          meals: [
            { label: "Today's Special", items: ['Crispy Chicken Sandwich'] },
            { label: 'Sides', items: ['Sweet Potato Fries', 'Steamed Broccoli', 'Fruit Cup'] },
            { label: 'Drinks', items: ['Chocolate Milk', 'Apple Juice', 'Water'] },
          ],
        },
      },
      {
        name: 'Food Photo',
        widgetType: 'IMAGE_CAROUSEL',
        x: 60, y: 20, width: 38, height: 45,
        sortOrder: 3,
        defaultConfig: {
          theme: 'diner-chalkboard',
          title: "Today's Feature",
          urls: [],
        },
      },
      {
        name: 'Chef Spotlight',
        widgetType: 'STAFF_SPOTLIGHT',
        x: 60, y: 68, width: 38, height: 27,
        sortOrder: 4,
        defaultConfig: {
          theme: 'diner-chalkboard',
          staffName: 'Chef Rodriguez',
          role: 'Head Chef',
          bio: 'Making lunches everyone loves!',
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // BUS LOOP / DISMISSAL BOARD — high-contrast, safety-first
  // ─────────────────────────────────────────────────────
  {
    id: 'bus-loop-dismissal-board',
    name: 'Bus Loop & Dismissal Board',
    description: 'High-contrast dismissal display with scrolling bus arrival information, weather delay alert zone, and an announcement area for route changes.',
    category: 'transport',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0D0D0D',
    zones: [
      {
        name: 'Dismissal Header',
        widgetType: 'TEXT',
        x: 0, y: 0, width: 70, height: 16,
        sortOrder: 0,
        defaultConfig: { theme: 'bus-loop', content: 'BUS LOOP — DISMISSAL INFORMATION',
          fontSize: 30,
          alignment: 'center',
          color: '#FFD700',
          bgColor: '#1A1A00',
        },
      },
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 70, y: 0, width: 30, height: 16,
        sortOrder: 1,
        defaultConfig: { theme: 'bus-loop', format: '12h', showSeconds: true, color: '#FFFFFF', bgColor: 'transparent' },
      },
      {
        name: 'Route & Delay Announcement',
        widgetType: 'ANNOUNCEMENT',
        x: 0, y: 17, width: 45, height: 62,
        sortOrder: 2,
        defaultConfig: { theme: 'bus-loop', message: 'All buses running on schedule. Riders: proceed to your designated pickup zone.',
          priority: 'normal',
        },
      },
      {
        name: 'Weather & Delay Alert',
        widgetType: 'WEATHER',
        x: 46, y: 17, width: 54, height: 30,
        sortOrder: 3,
        defaultConfig: { theme: 'bus-loop', units: 'imperial', showForecast: false },
      },
      {
        name: 'Bus Arrival Notes',
        widgetType: 'RICH_TEXT',
        x: 46, y: 48, width: 54, height: 31,
        sortOrder: 4,
        defaultConfig: { theme: 'bus-loop', html: '<h3 style="color:#FFD700;">Today\'s Bus Notes</h3><p style="color:#fff;">Route 12 — Delayed approx. 10 min</p><p style="color:#fff;">Route 7 — On time</p><p style="color:#ccc;font-size:0.85rem;">Update with live information each day</p>',
        },
      },
      {
        name: 'Bus Ticker',
        widgetType: 'TICKER',
        x: 0, y: 80, width: 100, height: 20,
        sortOrder: 5,
        defaultConfig: { theme: 'bus-loop', speed: 'medium',
          messages: [
            'Students: wait for your bus number to be called before moving to the loop',
            'Car riders: proceed to the south parking lot — bring your ID card',
            'Walker/bike riders: use the crosswalk — staff on duty until 3:45 PM',
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────
  // PRINCIPAL'S OFFICE WELCOME — professional, visitor-ready
  // ─────────────────────────────────────────────────────
  {
    id: 'principals-office-welcome',
    name: "Principal's Office Welcome",
    description: "Professional display for the principal's office reception area: school logo, visitor welcome message, daily office hours, and current date and time.",
    category: 'admin',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgGradient: 'linear-gradient(180deg, #0A2744 0%, #123F6D 60%, #0A2744 100%)',
    zones: [
      {
        name: 'School Logo',
        widgetType: 'LOGO',
        x: 2, y: 4, width: 20, height: 28,
        sortOrder: 0,
        defaultConfig: { theme: 'principals-office', fitMode: 'contain' },
      },
      {
        name: 'Welcome Message',
        widgetType: 'TEXT',
        x: 23, y: 4, width: 55, height: 28,
        sortOrder: 1,
        defaultConfig: { theme: 'principals-office',
          content: 'Welcome — Please sign in at the front desk and have a seat. Someone will be with you shortly.',
          fontSize: 22,
          alignment: 'center',
          color: '#FFFFFF',
          bgColor: 'transparent',
        },
      },
      {
        name: 'Date & Time',
        widgetType: 'CLOCK',
        x: 79, y: 4, width: 20, height: 28,
        sortOrder: 2,
        defaultConfig: { theme: 'principals-office', format: '12h', showSeconds: false, color: '#FFFFFF', bgColor: 'transparent' },
      },
      {
        name: 'Office Hours',
        widgetType: 'RICH_TEXT',
        x: 2, y: 35, width: 45, height: 50,
        sortOrder: 3,
        defaultConfig: { theme: 'principals-office',
          html: '<h3 style="color:#90CAF9;">Office Hours</h3><p style="color:#fff;">Monday – Friday: 7:30 AM – 4:30 PM</p><p style="color:#fff;">Principal available: 8:00 – 11:30 AM</p><p style="color:#fff;">Appointments preferred — call ext. 100</p><br><p style="color:#ccc;font-size:0.85rem;">After-hours messages can be left with the main office.</p>',
        },
      },
      {
        name: 'Daily Announcement',
        widgetType: 'ANNOUNCEMENT',
        x: 48, y: 35, width: 50, height: 50,
        sortOrder: 4,
        defaultConfig: { theme: 'principals-office',
          message: 'Thank you for visiting. All visitors must check in and wear a visitor badge while on campus.',
          priority: 'normal',
        },
      },
      {
        name: 'Office Footer Ticker',
        widgetType: 'TICKER',
        x: 0, y: 86, width: 100, height: 14,
        sortOrder: 5,
        defaultConfig: { theme: 'principals-office',
          speed: 'slow',
          messages: [
            'School office hours: Mon–Fri, 7:30 AM – 4:30 PM',
            'For student absences, please call the attendance line by 9:00 AM',
            'Visitor badges must be returned upon departure — thank you!',
          ],
        },
      },
    ],
  },
];

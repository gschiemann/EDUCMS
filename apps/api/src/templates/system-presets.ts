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
  // GALLERY ORDER NOTE: the templates API sorts by updatedAt desc, and
  // the seed script writes presets in array order — so the LAST entries
  // in this array end up at the TOP of the gallery. The two APPROVED
  // gold-standard presets (Rainbow Ribbon · Welcome and Animated
  // Rainbow · Welcome) live at the END of this file for that reason.
  // Don't move them back to the top of the array unless you also flip
  // the API sort or the seed iteration order.
  // ════════════════════════════════════════════════════════════════
  {
    id: "preset-hallway-rainbow-ribbon",
    name: "🌈 Rainbow Ribbon · Hallway",
    description: "Hallway layout — Rainbow Ribbon theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "HALLWAY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#BFE8FF",
    bgGradient: "linear-gradient(180deg,#BFE8FF 0%,#FFE0EC 55%,#FFD8A8 100%)",
    zones: [
      {"name":"Hallway Banner","widgetType":"TEXT","x":2,"y":2,"width":96,"height":16,"zIndex":4,"sortOrder":0,"defaultConfig":{"theme":"rainbow-ribbon","content":"LEARN · GROW · SHINE","subtitle":"every day a new adventure"}},
      {"name":"Today's Schedule","widgetType":"SCHEDULE_GRID","x":2,"y":20,"width":58,"height":52,"zIndex":3,"sortOrder":1,"defaultConfig":{}},
      {"name":"Attendance","widgetType":"ATTENDANCE","x":62,"y":20,"width":36,"height":26,"zIndex":3,"sortOrder":2,"defaultConfig":{}},
      {"name":"Clock","widgetType":"CLOCK","x":62,"y":48,"width":18,"height":24,"zIndex":5,"sortOrder":3,"defaultConfig":{"theme":"rainbow-ribbon","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":82,"y":48,"width":16,"height":24,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"rainbow-ribbon","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":16,"zIndex":10,"sortOrder":5,"defaultConfig":{"theme":"rainbow-ribbon","message":"Assembly in the gym Friday at 2 PM — all classes welcome!"}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":16,"zIndex":4,"sortOrder":6,"defaultConfig":{"theme":"rainbow-ribbon","label":"Field Day in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":7,"defaultConfig":{"theme":"rainbow-ribbon","speed":"medium","messages":["Walk, don't run in the halls 🚶","Reading Challenge: 20 minutes a day","Wear school colors on Spirit Friday! 🎉"]}},
    ],
  },
  {
    id: "preset-cafeteria-rainbow-ribbon",
    name: "🌈 Rainbow Ribbon · Cafeteria",
    description: "Cafeteria layout — Rainbow Ribbon theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "CAFETERIA",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#BFE8FF",
    bgGradient: "linear-gradient(180deg,#BFE8FF 0%,#FFE0EC 55%,#FFD8A8 100%)",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":14,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"rainbow-ribbon"}},
      {"name":"Menu Title","widgetType":"TEXT","x":12,"y":3,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"rainbow-ribbon","content":"Today's Menu","subtitle":"what's cooking in the kitchen"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":14,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"rainbow-ribbon","format":"12h"}},
      {"name":"Food Carousel","widgetType":"IMAGE_CAROUSEL","x":2,"y":20,"width":56,"height":52,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"rainbow-ribbon","intervalMs":6000}},
      {"name":"Entrée","widgetType":"MENU_ITEM","x":60,"y":20,"width":38,"height":17,"zIndex":4,"sortOrder":4,"defaultConfig":{"itemName":"Chef Salad","description":"Romaine, grilled chicken, cherry tomatoes, shaved cheese, ranch.","allergens":["GF"],"price":""}},
      {"name":"Side","widgetType":"MENU_ITEM","x":60,"y":38,"width":38,"height":17,"zIndex":4,"sortOrder":5,"defaultConfig":{"itemName":"Roasted Veggies","description":"Carrots, zucchini, bell peppers — olive oil, sea salt.","allergens":["V","GF"],"price":""}},
      {"name":"Dessert","widgetType":"MENU_ITEM","x":60,"y":55,"width":38,"height":17,"zIndex":4,"sortOrder":6,"defaultConfig":{"itemName":"Fruit Cup","description":"Seasonal fresh fruit — watermelon, pineapple, berries.","allergens":["V","GF"],"price":""}},
      {"name":"Today's Special","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":14,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"rainbow-ribbon","message":"Pizza Friday is BACK! 🍕 Cheese + pepperoni in line 2."}},
      {"name":"Next Meal","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":14,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"rainbow-ribbon","label":"Next meal in","targetDate":""}},
      {"name":"Nutrition Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"rainbow-ribbon","speed":"slow","messages":["Eat the rainbow — fruits + veggies every day 🌈","Drink water, stay hydrated! 💧","Free + reduced meals — ask the office"]}},
    ],
  },
  {
    id: "preset-lobby-bulletin-board",
    name: "📌 Bulletin Board · Welcome",
    description: "Welcome layout — Bulletin Board theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#C69C6D",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"bulletin-board"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"bulletin-board","content":"Welcome, Friends!","subtitle":"today is going to be amazing"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"bulletin-board","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"bulletin-board","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"bulletin-board","message":"Book Fair starts Monday! 📚 Come find your new favorite story."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"bulletin-board","label":"Field Trip in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"bulletin-board","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"bulletin-board","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"bulletin-board","speed":"medium","messages":["Welcome back, Stars! ⭐","Picture day is Friday","Reading Challenge: 20 minutes a day! 📖","Parent-teacher conferences next Tuesday"]}},
    ],
  },
  {
    id: "preset-hallway-bulletin-board",
    name: "📌 Bulletin Board · Hallway",
    description: "Hallway layout — Bulletin Board theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "HALLWAY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#C69C6D",
    zones: [
      {"name":"Hallway Banner","widgetType":"TEXT","x":2,"y":2,"width":96,"height":16,"zIndex":4,"sortOrder":0,"defaultConfig":{"theme":"bulletin-board","content":"LEARN · GROW · SHINE","subtitle":"every day a new adventure"}},
      {"name":"Today's Schedule","widgetType":"SCHEDULE_GRID","x":2,"y":20,"width":58,"height":52,"zIndex":3,"sortOrder":1,"defaultConfig":{}},
      {"name":"Attendance","widgetType":"ATTENDANCE","x":62,"y":20,"width":36,"height":26,"zIndex":3,"sortOrder":2,"defaultConfig":{}},
      {"name":"Clock","widgetType":"CLOCK","x":62,"y":48,"width":18,"height":24,"zIndex":5,"sortOrder":3,"defaultConfig":{"theme":"bulletin-board","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":82,"y":48,"width":16,"height":24,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"bulletin-board","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":16,"zIndex":10,"sortOrder":5,"defaultConfig":{"theme":"bulletin-board","message":"Assembly in the gym Friday at 2 PM — all classes welcome!"}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":16,"zIndex":4,"sortOrder":6,"defaultConfig":{"theme":"bulletin-board","label":"Field Day in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":7,"defaultConfig":{"theme":"bulletin-board","speed":"medium","messages":["Walk, don't run in the halls 🚶","Reading Challenge: 20 minutes a day","Wear school colors on Spirit Friday! 🎉"]}},
    ],
  },
  {
    id: "preset-cafeteria-bulletin-board",
    name: "📌 Bulletin Board · Cafeteria",
    description: "Cafeteria layout — Bulletin Board theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "CAFETERIA",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#C69C6D",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":14,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"bulletin-board"}},
      {"name":"Menu Title","widgetType":"TEXT","x":12,"y":3,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"bulletin-board","content":"Today's Menu","subtitle":"what's cooking in the kitchen"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":14,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"bulletin-board","format":"12h"}},
      {"name":"Food Carousel","widgetType":"IMAGE_CAROUSEL","x":2,"y":20,"width":56,"height":52,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"bulletin-board","intervalMs":6000}},
      {"name":"Entrée","widgetType":"MENU_ITEM","x":60,"y":20,"width":38,"height":17,"zIndex":4,"sortOrder":4,"defaultConfig":{"itemName":"Chef Salad","description":"Romaine, grilled chicken, cherry tomatoes, shaved cheese, ranch.","allergens":["GF"],"price":""}},
      {"name":"Side","widgetType":"MENU_ITEM","x":60,"y":38,"width":38,"height":17,"zIndex":4,"sortOrder":5,"defaultConfig":{"itemName":"Roasted Veggies","description":"Carrots, zucchini, bell peppers — olive oil, sea salt.","allergens":["V","GF"],"price":""}},
      {"name":"Dessert","widgetType":"MENU_ITEM","x":60,"y":55,"width":38,"height":17,"zIndex":4,"sortOrder":6,"defaultConfig":{"itemName":"Fruit Cup","description":"Seasonal fresh fruit — watermelon, pineapple, berries.","allergens":["V","GF"],"price":""}},
      {"name":"Today's Special","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":14,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"bulletin-board","message":"Pizza Friday is BACK! 🍕 Cheese + pepperoni in line 2."}},
      {"name":"Next Meal","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":14,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"bulletin-board","label":"Next meal in","targetDate":""}},
      {"name":"Nutrition Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"bulletin-board","speed":"slow","messages":["Eat the rainbow — fruits + veggies every day 🌈","Drink water, stay hydrated! 💧","Free + reduced meals — ask the office"]}},
    ],
  },
  {
    id: "preset-lobby-storybook",
    name: "📖 Storybook · Welcome",
    description: "Welcome layout — Storybook theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FBF0DC",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"storybook"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"storybook","content":"Welcome, Friends!","subtitle":"today is going to be amazing"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"storybook","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"storybook","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"storybook","message":"Book Fair starts Monday! 📚 Come find your new favorite story."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"storybook","label":"Field Trip in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"storybook","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"storybook","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"storybook","speed":"medium","messages":["Welcome back, Stars! ⭐","Picture day is Friday","Reading Challenge: 20 minutes a day! 📖","Parent-teacher conferences next Tuesday"]}},
    ],
  },
  {
    id: "preset-hallway-storybook",
    name: "📖 Storybook · Hallway",
    description: "Hallway layout — Storybook theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "HALLWAY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FBF0DC",
    zones: [
      {"name":"Hallway Banner","widgetType":"TEXT","x":2,"y":2,"width":96,"height":16,"zIndex":4,"sortOrder":0,"defaultConfig":{"theme":"storybook","content":"LEARN · GROW · SHINE","subtitle":"every day a new adventure"}},
      {"name":"Today's Schedule","widgetType":"SCHEDULE_GRID","x":2,"y":20,"width":58,"height":52,"zIndex":3,"sortOrder":1,"defaultConfig":{}},
      {"name":"Attendance","widgetType":"ATTENDANCE","x":62,"y":20,"width":36,"height":26,"zIndex":3,"sortOrder":2,"defaultConfig":{}},
      {"name":"Clock","widgetType":"CLOCK","x":62,"y":48,"width":18,"height":24,"zIndex":5,"sortOrder":3,"defaultConfig":{"theme":"storybook","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":82,"y":48,"width":16,"height":24,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"storybook","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":16,"zIndex":10,"sortOrder":5,"defaultConfig":{"theme":"storybook","message":"Assembly in the gym Friday at 2 PM — all classes welcome!"}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":16,"zIndex":4,"sortOrder":6,"defaultConfig":{"theme":"storybook","label":"Field Day in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":7,"defaultConfig":{"theme":"storybook","speed":"medium","messages":["Walk, don't run in the halls 🚶","Reading Challenge: 20 minutes a day","Wear school colors on Spirit Friday! 🎉"]}},
    ],
  },
  {
    id: "preset-cafeteria-storybook",
    name: "📖 Storybook · Cafeteria",
    description: "Cafeteria layout — Storybook theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "CAFETERIA",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FBF0DC",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":14,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"storybook"}},
      {"name":"Menu Title","widgetType":"TEXT","x":12,"y":3,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"storybook","content":"Today's Menu","subtitle":"what's cooking in the kitchen"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":14,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"storybook","format":"12h"}},
      {"name":"Food Carousel","widgetType":"IMAGE_CAROUSEL","x":2,"y":20,"width":56,"height":52,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"storybook","intervalMs":6000}},
      {"name":"Entrée","widgetType":"MENU_ITEM","x":60,"y":20,"width":38,"height":17,"zIndex":4,"sortOrder":4,"defaultConfig":{"itemName":"Chef Salad","description":"Romaine, grilled chicken, cherry tomatoes, shaved cheese, ranch.","allergens":["GF"],"price":""}},
      {"name":"Side","widgetType":"MENU_ITEM","x":60,"y":38,"width":38,"height":17,"zIndex":4,"sortOrder":5,"defaultConfig":{"itemName":"Roasted Veggies","description":"Carrots, zucchini, bell peppers — olive oil, sea salt.","allergens":["V","GF"],"price":""}},
      {"name":"Dessert","widgetType":"MENU_ITEM","x":60,"y":55,"width":38,"height":17,"zIndex":4,"sortOrder":6,"defaultConfig":{"itemName":"Fruit Cup","description":"Seasonal fresh fruit — watermelon, pineapple, berries.","allergens":["V","GF"],"price":""}},
      {"name":"Today's Special","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":14,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"storybook","message":"Pizza Friday is BACK! 🍕 Cheese + pepperoni in line 2."}},
      {"name":"Next Meal","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":14,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"storybook","label":"Next meal in","targetDate":""}},
      {"name":"Nutrition Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"storybook","speed":"slow","messages":["Eat the rainbow — fruits + veggies every day 🌈","Drink water, stay hydrated! 💧","Free + reduced meals — ask the office"]}},
    ],
  },
  {
    id: "preset-lobby-scrapbook",
    name: "📎 Scrapbook · Welcome",
    description: "Welcome layout — Scrapbook theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FFF8E7",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"scrapbook"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"scrapbook","content":"Welcome, Friends!","subtitle":"today is going to be amazing"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"scrapbook","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"scrapbook","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"scrapbook","message":"Book Fair starts Monday! 📚 Come find your new favorite story."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"scrapbook","label":"Field Trip in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"scrapbook","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"scrapbook","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"scrapbook","speed":"medium","messages":["Welcome back, Stars! ⭐","Picture day is Friday","Reading Challenge: 20 minutes a day! 📖","Parent-teacher conferences next Tuesday"]}},
    ],
  },
  {
    id: "preset-hallway-scrapbook",
    name: "📎 Scrapbook · Hallway",
    description: "Hallway layout — Scrapbook theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "HALLWAY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FFF8E7",
    zones: [
      {"name":"Hallway Banner","widgetType":"TEXT","x":2,"y":2,"width":96,"height":16,"zIndex":4,"sortOrder":0,"defaultConfig":{"theme":"scrapbook","content":"LEARN · GROW · SHINE","subtitle":"every day a new adventure"}},
      {"name":"Today's Schedule","widgetType":"SCHEDULE_GRID","x":2,"y":20,"width":58,"height":52,"zIndex":3,"sortOrder":1,"defaultConfig":{}},
      {"name":"Attendance","widgetType":"ATTENDANCE","x":62,"y":20,"width":36,"height":26,"zIndex":3,"sortOrder":2,"defaultConfig":{}},
      {"name":"Clock","widgetType":"CLOCK","x":62,"y":48,"width":18,"height":24,"zIndex":5,"sortOrder":3,"defaultConfig":{"theme":"scrapbook","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":82,"y":48,"width":16,"height":24,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"scrapbook","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":16,"zIndex":10,"sortOrder":5,"defaultConfig":{"theme":"scrapbook","message":"Assembly in the gym Friday at 2 PM — all classes welcome!"}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":16,"zIndex":4,"sortOrder":6,"defaultConfig":{"theme":"scrapbook","label":"Field Day in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":7,"defaultConfig":{"theme":"scrapbook","speed":"medium","messages":["Walk, don't run in the halls 🚶","Reading Challenge: 20 minutes a day","Wear school colors on Spirit Friday! 🎉"]}},
    ],
  },
  {
    id: "preset-cafeteria-scrapbook",
    name: "📎 Scrapbook · Cafeteria",
    description: "Cafeteria layout — Scrapbook theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "CAFETERIA",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FFF8E7",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":14,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"scrapbook"}},
      {"name":"Menu Title","widgetType":"TEXT","x":12,"y":3,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"scrapbook","content":"Today's Menu","subtitle":"what's cooking in the kitchen"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":14,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"scrapbook","format":"12h"}},
      {"name":"Food Carousel","widgetType":"IMAGE_CAROUSEL","x":2,"y":20,"width":56,"height":52,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"scrapbook","intervalMs":6000}},
      {"name":"Entrée","widgetType":"MENU_ITEM","x":60,"y":20,"width":38,"height":17,"zIndex":4,"sortOrder":4,"defaultConfig":{"itemName":"Chef Salad","description":"Romaine, grilled chicken, cherry tomatoes, shaved cheese, ranch.","allergens":["GF"],"price":""}},
      {"name":"Side","widgetType":"MENU_ITEM","x":60,"y":38,"width":38,"height":17,"zIndex":4,"sortOrder":5,"defaultConfig":{"itemName":"Roasted Veggies","description":"Carrots, zucchini, bell peppers — olive oil, sea salt.","allergens":["V","GF"],"price":""}},
      {"name":"Dessert","widgetType":"MENU_ITEM","x":60,"y":55,"width":38,"height":17,"zIndex":4,"sortOrder":6,"defaultConfig":{"itemName":"Fruit Cup","description":"Seasonal fresh fruit — watermelon, pineapple, berries.","allergens":["V","GF"],"price":""}},
      {"name":"Today's Special","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":14,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"scrapbook","message":"Pizza Friday is BACK! 🍕 Cheese + pepperoni in line 2."}},
      {"name":"Next Meal","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":14,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"scrapbook","label":"Next meal in","targetDate":""}},
      {"name":"Nutrition Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"scrapbook","speed":"slow","messages":["Eat the rainbow — fruits + veggies every day 🌈","Drink water, stay hydrated! 💧","Free + reduced meals — ask the office"]}},
    ],
  },
  {
    id: "preset-lobby-field-day",
    name: "🏆 Field Day · Welcome",
    description: "Welcome layout — Field Day theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#1E2A4A",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"field-day"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"field-day","content":"Welcome, Friends!","subtitle":"today is going to be amazing"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"field-day","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"field-day","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"field-day","message":"Book Fair starts Monday! 📚 Come find your new favorite story."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"field-day","label":"Field Trip in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"field-day","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"field-day","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"field-day","speed":"medium","messages":["Welcome back, Stars! ⭐","Picture day is Friday","Reading Challenge: 20 minutes a day! 📖","Parent-teacher conferences next Tuesday"]}},
    ],
  },
  {
    id: "preset-athletics-field-day",
    name: "🏆 Field Day · Athletics",
    description: "Athletics layout — Field Day theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#1E2A4A",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"field-day"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"field-day","content":"GO TIGERS!","subtitle":"home of the champions"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"field-day","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"home of the champions","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"field-day","staffName":"Morgan P.","role":"Student of the Month","bio":"Kindness + teamwork on and off the field."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"field-day","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"field-day","message":"Everyone plays, everyone matters. See you at practice!"}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"field-day","label":"Field Day in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"field-day","speed":"medium","messages":["Jump Rope for Heart next Friday 🪢","Field Day coming up — bring water + sunscreen ☀️","PE rocks — remember sneakers on gym days"]}},
    ],
  },
  {
    id: "preset-lobby-track-day",
    name: "🏃 Track Day · Welcome",
    description: "Welcome layout — Track Day theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#4FB06B",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"track-day"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"track-day","content":"Welcome, Friends!","subtitle":"today is going to be amazing"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"track-day","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"track-day","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"track-day","message":"Book Fair starts Monday! 📚 Come find your new favorite story."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"track-day","label":"Field Trip in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"track-day","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"track-day","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"track-day","speed":"medium","messages":["Welcome back, Stars! ⭐","Picture day is Friday","Reading Challenge: 20 minutes a day! 📖","Parent-teacher conferences next Tuesday"]}},
    ],
  },
  {
    id: "preset-athletics-track-day",
    name: "🏃 Track Day · Athletics",
    description: "Athletics layout — Track Day theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#4FB06B",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"track-day"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"track-day","content":"GO TIGERS!","subtitle":"home of the champions"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"track-day","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"home of the champions","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"track-day","staffName":"Morgan P.","role":"Student of the Month","bio":"Kindness + teamwork on and off the field."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"track-day","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"track-day","message":"Everyone plays, everyone matters. See you at practice!"}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"track-day","label":"Field Day in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"track-day","speed":"medium","messages":["Jump Rope for Heart next Friday 🪢","Field Day coming up — bring water + sunscreen ☀️","PE rocks — remember sneakers on gym days"]}},
    ],
  },
  {
    id: "preset-lobby-locker-hallway",
    name: "🔐 Locker Hallway · Welcome",
    description: "Welcome layout — Locker Hallway theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#6B727C",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"locker-hallway"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"locker-hallway","content":"WELCOME BACK, EAGLES","subtitle":"this is going to be a great year"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"locker-hallway","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"locker-hallway","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"locker-hallway","message":"Student council elections next Friday. Nominations open through Wednesday."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"locker-hallway","label":"Fall Break in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"locker-hallway","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"locker-hallway","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"locker-hallway","speed":"medium","messages":["Picture day is Friday — wear school colors","Clubs fair Thursday after school in the gym","Join the Student Council — nominations open","Reminder: phones off during class"]}},
    ],
  },
  {
    id: "preset-hallway-locker-hallway",
    name: "🔐 Locker Hallway · Hallway",
    description: "Hallway layout — Locker Hallway theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "HALLWAY",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#6B727C",
    zones: [
      {"name":"Hallway Banner","widgetType":"TEXT","x":2,"y":2,"width":96,"height":16,"zIndex":4,"sortOrder":0,"defaultConfig":{"theme":"locker-hallway","content":"BE KIND · WORK HARD · BE PROUD","subtitle":"every day a fresh start"}},
      {"name":"Today's Schedule","widgetType":"SCHEDULE_GRID","x":2,"y":20,"width":58,"height":52,"zIndex":3,"sortOrder":1,"defaultConfig":{}},
      {"name":"Attendance","widgetType":"ATTENDANCE","x":62,"y":20,"width":36,"height":26,"zIndex":3,"sortOrder":2,"defaultConfig":{}},
      {"name":"Clock","widgetType":"CLOCK","x":62,"y":48,"width":18,"height":24,"zIndex":5,"sortOrder":3,"defaultConfig":{"theme":"locker-hallway","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":82,"y":48,"width":16,"height":24,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"locker-hallway","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":16,"zIndex":10,"sortOrder":5,"defaultConfig":{"theme":"locker-hallway","message":"Pep rally this Friday at 2:30 — bring your spirit!"}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":16,"zIndex":4,"sortOrder":6,"defaultConfig":{"theme":"locker-hallway","label":"Next half-day in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":7,"defaultConfig":{"theme":"locker-hallway","speed":"medium","messages":["Hall passes required during class time","Late to class = no pass needed if teacher signs","Library is open until 4 PM every day"]}},
    ],
  },
  {
    id: "preset-cafeteria-locker-hallway",
    name: "🔐 Locker Hallway · Cafeteria",
    description: "Cafeteria layout — Locker Hallway theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "CAFETERIA",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#6B727C",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":14,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"locker-hallway"}},
      {"name":"Menu Title","widgetType":"TEXT","x":12,"y":3,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"locker-hallway","content":"Today's Menu","subtitle":"lunch line + à la carte"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":14,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"locker-hallway","format":"12h"}},
      {"name":"Food Carousel","widgetType":"IMAGE_CAROUSEL","x":2,"y":20,"width":56,"height":52,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"locker-hallway","intervalMs":6000}},
      {"name":"Entrée","widgetType":"MENU_ITEM","x":60,"y":20,"width":38,"height":17,"zIndex":4,"sortOrder":4,"defaultConfig":{"itemName":"Chef Salad","description":"Romaine, grilled chicken, cherry tomatoes, shaved cheese, ranch.","allergens":["GF"],"price":""}},
      {"name":"Side","widgetType":"MENU_ITEM","x":60,"y":38,"width":38,"height":17,"zIndex":4,"sortOrder":5,"defaultConfig":{"itemName":"Roasted Veggies","description":"Carrots, zucchini, bell peppers — olive oil, sea salt.","allergens":["V","GF"],"price":""}},
      {"name":"Dessert","widgetType":"MENU_ITEM","x":60,"y":55,"width":38,"height":17,"zIndex":4,"sortOrder":6,"defaultConfig":{"itemName":"Fruit Cup","description":"Seasonal fresh fruit — watermelon, pineapple, berries.","allergens":["V","GF"],"price":""}},
      {"name":"Today's Special","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":14,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"locker-hallway","message":"Build-your-own salad bar today! Line 3."}},
      {"name":"Next Meal","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":14,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"locker-hallway","label":"Next lunch period in","targetDate":""}},
      {"name":"Nutrition Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"locker-hallway","speed":"slow","messages":["Keep it clean — clear your tray","Allergens listed by each dish","Vegetarian options every day"]}},
    ],
  },
  {
    id: "preset-lobby-art-studio",
    name: "🎨 Art Studio · Welcome",
    description: "Welcome layout — Art Studio theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FBF7F0",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"art-studio"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"art-studio","content":"WELCOME BACK, EAGLES","subtitle":"this is going to be a great year"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"art-studio","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"art-studio","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"art-studio","message":"Student council elections next Friday. Nominations open through Wednesday."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"art-studio","label":"Fall Break in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"art-studio","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"art-studio","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"art-studio","speed":"medium","messages":["Picture day is Friday — wear school colors","Clubs fair Thursday after school in the gym","Join the Student Council — nominations open","Reminder: phones off during class"]}},
    ],
  },
  {
    id: "preset-hallway-art-studio",
    name: "🎨 Art Studio · Hallway",
    description: "Hallway layout — Art Studio theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "HALLWAY",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FBF7F0",
    zones: [
      {"name":"Hallway Banner","widgetType":"TEXT","x":2,"y":2,"width":96,"height":16,"zIndex":4,"sortOrder":0,"defaultConfig":{"theme":"art-studio","content":"BE KIND · WORK HARD · BE PROUD","subtitle":"every day a fresh start"}},
      {"name":"Today's Schedule","widgetType":"SCHEDULE_GRID","x":2,"y":20,"width":58,"height":52,"zIndex":3,"sortOrder":1,"defaultConfig":{}},
      {"name":"Attendance","widgetType":"ATTENDANCE","x":62,"y":20,"width":36,"height":26,"zIndex":3,"sortOrder":2,"defaultConfig":{}},
      {"name":"Clock","widgetType":"CLOCK","x":62,"y":48,"width":18,"height":24,"zIndex":5,"sortOrder":3,"defaultConfig":{"theme":"art-studio","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":82,"y":48,"width":16,"height":24,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"art-studio","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":16,"zIndex":10,"sortOrder":5,"defaultConfig":{"theme":"art-studio","message":"Pep rally this Friday at 2:30 — bring your spirit!"}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":16,"zIndex":4,"sortOrder":6,"defaultConfig":{"theme":"art-studio","label":"Next half-day in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":7,"defaultConfig":{"theme":"art-studio","speed":"medium","messages":["Hall passes required during class time","Late to class = no pass needed if teacher signs","Library is open until 4 PM every day"]}},
    ],
  },
  {
    id: "preset-cafeteria-art-studio",
    name: "🎨 Art Studio · Cafeteria",
    description: "Cafeteria layout — Art Studio theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "CAFETERIA",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#FBF7F0",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":14,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"art-studio"}},
      {"name":"Menu Title","widgetType":"TEXT","x":12,"y":3,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"art-studio","content":"Today's Menu","subtitle":"lunch line + à la carte"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":14,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"art-studio","format":"12h"}},
      {"name":"Food Carousel","widgetType":"IMAGE_CAROUSEL","x":2,"y":20,"width":56,"height":52,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"art-studio","intervalMs":6000}},
      {"name":"Entrée","widgetType":"MENU_ITEM","x":60,"y":20,"width":38,"height":17,"zIndex":4,"sortOrder":4,"defaultConfig":{"itemName":"Chef Salad","description":"Romaine, grilled chicken, cherry tomatoes, shaved cheese, ranch.","allergens":["GF"],"price":""}},
      {"name":"Side","widgetType":"MENU_ITEM","x":60,"y":38,"width":38,"height":17,"zIndex":4,"sortOrder":5,"defaultConfig":{"itemName":"Roasted Veggies","description":"Carrots, zucchini, bell peppers — olive oil, sea salt.","allergens":["V","GF"],"price":""}},
      {"name":"Dessert","widgetType":"MENU_ITEM","x":60,"y":55,"width":38,"height":17,"zIndex":4,"sortOrder":6,"defaultConfig":{"itemName":"Fruit Cup","description":"Seasonal fresh fruit — watermelon, pineapple, berries.","allergens":["V","GF"],"price":""}},
      {"name":"Today's Special","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":14,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"art-studio","message":"Build-your-own salad bar today! Line 3."}},
      {"name":"Next Meal","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":14,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"art-studio","label":"Next lunch period in","targetDate":""}},
      {"name":"Nutrition Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"art-studio","speed":"slow","messages":["Keep it clean — clear your tray","Allergens listed by each dish","Vegetarian options every day"]}},
    ],
  },
  {
    id: "preset-lobby-morning-news",
    name: "📺 Morning News · Welcome",
    description: "Welcome layout — Morning News theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0F172A",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"morning-news"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"morning-news","content":"WELCOME BACK, EAGLES","subtitle":"this is going to be a great year"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"morning-news","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"morning-news","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"morning-news","message":"Student council elections next Friday. Nominations open through Wednesday."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"morning-news","label":"Fall Break in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"morning-news","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"morning-news","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"morning-news","speed":"medium","messages":["Picture day is Friday — wear school colors","Clubs fair Thursday after school in the gym","Join the Student Council — nominations open","Reminder: phones off during class"]}},
    ],
  },
  {
    id: "preset-athletics-morning-news",
    name: "📺 Morning News · Athletics",
    description: "Athletics layout — Morning News theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0F172A",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"morning-news"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"morning-news","content":"EAGLES vs COUGARS","subtitle":"Homecoming · Friday 7pm · Home field"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"morning-news","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"Homecoming · Friday 7pm · Home field","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"morning-news","staffName":"Jordan Miller","role":"Point Guard · 8th grade","bio":"Season avg: 18.4 PPG, 6 assists, 3 steals."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"morning-news","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"morning-news","message":"Work hard. Play smart. Lift each other up. Go Eagles!"}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"morning-news","label":"Homecoming in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"morning-news","speed":"medium","messages":["Girls volleyball states next Saturday","Cheer tryouts Monday 3 PM","JV soccer wins 4-1 vs Central!","Wrestling sign-ups close Friday"]}},
    ],
  },
  {
    id: "preset-lobby-stem-lab",
    name: "🔬 STEM Lab · Welcome",
    description: "Welcome layout — STEM Lab theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0A192F",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"stem-lab"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"stem-lab","content":"WELCOME BACK, EAGLES","subtitle":"this is going to be a great year"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"stem-lab","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"stem-lab","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"stem-lab","message":"Student council elections next Friday. Nominations open through Wednesday."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"stem-lab","label":"Fall Break in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"stem-lab","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"stem-lab","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"stem-lab","speed":"medium","messages":["Picture day is Friday — wear school colors","Clubs fair Thursday after school in the gym","Join the Student Council — nominations open","Reminder: phones off during class"]}},
    ],
  },
  {
    id: "preset-athletics-stem-lab",
    name: "🔬 STEM Lab · Athletics",
    description: "Athletics layout — STEM Lab theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0A192F",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"stem-lab"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"stem-lab","content":"EAGLES vs COUGARS","subtitle":"Homecoming · Friday 7pm · Home field"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"stem-lab","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"Homecoming · Friday 7pm · Home field","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"stem-lab","staffName":"Jordan Miller","role":"Point Guard · 8th grade","bio":"Season avg: 18.4 PPG, 6 assists, 3 steals."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"stem-lab","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"stem-lab","message":"Work hard. Play smart. Lift each other up. Go Eagles!"}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"stem-lab","label":"Homecoming in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"stem-lab","speed":"medium","messages":["Girls volleyball states next Saturday","Cheer tryouts Monday 3 PM","JV soccer wins 4-1 vs Central!","Wrestling sign-ups close Friday"]}},
    ],
  },
  {
    id: "preset-lobby-spirit-rally",
    name: "📣 Spirit Rally · Welcome",
    description: "Welcome layout — Spirit Rally theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#1A365D",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"spirit-rally"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"spirit-rally","content":"WELCOME BACK, EAGLES","subtitle":"this is going to be a great year"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"spirit-rally","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"spirit-rally","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"spirit-rally","message":"Student council elections next Friday. Nominations open through Wednesday."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"spirit-rally","label":"Fall Break in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"spirit-rally","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"spirit-rally","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"spirit-rally","speed":"medium","messages":["Picture day is Friday — wear school colors","Clubs fair Thursday after school in the gym","Join the Student Council — nominations open","Reminder: phones off during class"]}},
    ],
  },
  {
    id: "preset-athletics-spirit-rally",
    name: "📣 Spirit Rally · Athletics",
    description: "Athletics layout — Spirit Rally theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#1A365D",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"spirit-rally"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"spirit-rally","content":"EAGLES vs COUGARS","subtitle":"Homecoming · Friday 7pm · Home field"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"spirit-rally","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"Homecoming · Friday 7pm · Home field","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"spirit-rally","staffName":"Jordan Miller","role":"Point Guard · 8th grade","bio":"Season avg: 18.4 PPG, 6 assists, 3 steals."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"spirit-rally","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"spirit-rally","message":"Work hard. Play smart. Lift each other up. Go Eagles!"}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"spirit-rally","label":"Homecoming in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"spirit-rally","speed":"medium","messages":["Girls volleyball states next Saturday","Cheer tryouts Monday 3 PM","JV soccer wins 4-1 vs Central!","Wrestling sign-ups close Friday"]}},
    ],
  },
  {
    id: "preset-lobby-scorebug",
    name: "📊 Scorebug · Welcome",
    description: "Welcome layout — Scorebug theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0B111C",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"scorebug"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"scorebug","content":"WELCOME BACK, EAGLES","subtitle":"this is going to be a great year"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"scorebug","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"scorebug","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"scorebug","message":"Student council elections next Friday. Nominations open through Wednesday."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"scorebug","label":"Fall Break in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"scorebug","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"scorebug","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"scorebug","speed":"medium","messages":["Picture day is Friday — wear school colors","Clubs fair Thursday after school in the gym","Join the Student Council — nominations open","Reminder: phones off during class"]}},
    ],
  },
  {
    id: "preset-athletics-scorebug",
    name: "📊 Scorebug · Athletics",
    description: "Athletics layout — Scorebug theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "MIDDLE",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0B111C",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"scorebug"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"scorebug","content":"EAGLES vs COUGARS","subtitle":"Homecoming · Friday 7pm · Home field"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"scorebug","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"Homecoming · Friday 7pm · Home field","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"scorebug","staffName":"Jordan Miller","role":"Point Guard · 8th grade","bio":"Season avg: 18.4 PPG, 6 assists, 3 steals."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"scorebug","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"scorebug","message":"Work hard. Play smart. Lift each other up. Go Eagles!"}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"scorebug","label":"Homecoming in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"scorebug","speed":"medium","messages":["Girls volleyball states next Saturday","Cheer tryouts Monday 3 PM","JV soccer wins 4-1 vs Central!","Wrestling sign-ups close Friday"]}},
    ],
  },
  {
    id: "preset-lobby-senior-countdown",
    name: "🎓 Senior Countdown · Welcome",
    description: "Welcome layout — Senior Countdown theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#F5EFE1",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"senior-countdown"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"senior-countdown","content":"WELCOME, SENIORS","subtitle":"make this one count"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"senior-countdown","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"senior-countdown","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"senior-countdown","message":"Senior portraits next week. Sign-up sheet in the main office."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"senior-countdown","label":"Graduation in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"senior-countdown","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"senior-countdown","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"senior-countdown","speed":"medium","messages":["Senior trip sign-ups close Friday","College fair in the gym Thursday 6 PM","FAFSA workshop Tuesday in the library","Yearbook orders due end of month"]}},
    ],
  },
  {
    id: "preset-hallway-senior-countdown",
    name: "🎓 Senior Countdown · Hallway",
    description: "Hallway layout — Senior Countdown theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "HALLWAY",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#F5EFE1",
    zones: [
      {"name":"Hallway Banner","widgetType":"TEXT","x":2,"y":2,"width":96,"height":16,"zIndex":4,"sortOrder":0,"defaultConfig":{"theme":"senior-countdown","content":"EXCELLENCE · INTEGRITY · LEGACY","subtitle":"carry it forward"}},
      {"name":"Today's Schedule","widgetType":"SCHEDULE_GRID","x":2,"y":20,"width":58,"height":52,"zIndex":3,"sortOrder":1,"defaultConfig":{}},
      {"name":"Attendance","widgetType":"ATTENDANCE","x":62,"y":20,"width":36,"height":26,"zIndex":3,"sortOrder":2,"defaultConfig":{}},
      {"name":"Clock","widgetType":"CLOCK","x":62,"y":48,"width":18,"height":24,"zIndex":5,"sortOrder":3,"defaultConfig":{"theme":"senior-countdown","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":82,"y":48,"width":16,"height":24,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"senior-countdown","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":16,"zIndex":10,"sortOrder":5,"defaultConfig":{"theme":"senior-countdown","message":"Assembly Friday — guest speaker on mental wellness."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":16,"zIndex":4,"sortOrder":6,"defaultConfig":{"theme":"senior-countdown","label":"Prom in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":7,"defaultConfig":{"theme":"senior-countdown","speed":"medium","messages":["Hall passes required","Counseling office open during all lunches","Tutoring available in the library 3-5 PM"]}},
    ],
  },
  {
    id: "preset-cafeteria-senior-countdown",
    name: "🎓 Senior Countdown · Cafeteria",
    description: "Cafeteria layout — Senior Countdown theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "CAFETERIA",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#F5EFE1",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":14,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"senior-countdown"}},
      {"name":"Menu Title","widgetType":"TEXT","x":12,"y":3,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"senior-countdown","content":"Today's Menu","subtitle":"cafeteria + grab-and-go"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":14,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"senior-countdown","format":"12h"}},
      {"name":"Food Carousel","widgetType":"IMAGE_CAROUSEL","x":2,"y":20,"width":56,"height":52,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"senior-countdown","intervalMs":6000}},
      {"name":"Entrée","widgetType":"MENU_ITEM","x":60,"y":20,"width":38,"height":17,"zIndex":4,"sortOrder":4,"defaultConfig":{"itemName":"Chef Salad","description":"Romaine, grilled chicken, cherry tomatoes, shaved cheese, ranch.","allergens":["GF"],"price":""}},
      {"name":"Side","widgetType":"MENU_ITEM","x":60,"y":38,"width":38,"height":17,"zIndex":4,"sortOrder":5,"defaultConfig":{"itemName":"Roasted Veggies","description":"Carrots, zucchini, bell peppers — olive oil, sea salt.","allergens":["V","GF"],"price":""}},
      {"name":"Dessert","widgetType":"MENU_ITEM","x":60,"y":55,"width":38,"height":17,"zIndex":4,"sortOrder":6,"defaultConfig":{"itemName":"Fruit Cup","description":"Seasonal fresh fruit — watermelon, pineapple, berries.","allergens":["V","GF"],"price":""}},
      {"name":"Today's Special","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":14,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"senior-countdown","message":"Chef's special: Korean BBQ bowls at the grill line."}},
      {"name":"Next Meal","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":14,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"senior-countdown","label":"Next period in","targetDate":""}},
      {"name":"Nutrition Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"senior-countdown","speed":"slow","messages":["Grab-and-go available until 1 PM","Allergen info posted by each station","Free + reduced meal program — ask admin"]}},
    ],
  },
  {
    id: "preset-lobby-campus-quad",
    name: "🏛️ Campus Quad · Welcome",
    description: "Welcome layout — Campus Quad theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#F7F5F0",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"campus-quad"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"campus-quad","content":"WELCOME, SENIORS","subtitle":"make this one count"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"campus-quad","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"campus-quad","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"campus-quad","message":"Senior portraits next week. Sign-up sheet in the main office."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"campus-quad","label":"Graduation in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"campus-quad","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"campus-quad","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"campus-quad","speed":"medium","messages":["Senior trip sign-ups close Friday","College fair in the gym Thursday 6 PM","FAFSA workshop Tuesday in the library","Yearbook orders due end of month"]}},
    ],
  },
  {
    id: "preset-hallway-campus-quad",
    name: "🏛️ Campus Quad · Hallway",
    description: "Hallway layout — Campus Quad theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "HALLWAY",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#F7F5F0",
    zones: [
      {"name":"Hallway Banner","widgetType":"TEXT","x":2,"y":2,"width":96,"height":16,"zIndex":4,"sortOrder":0,"defaultConfig":{"theme":"campus-quad","content":"EXCELLENCE · INTEGRITY · LEGACY","subtitle":"carry it forward"}},
      {"name":"Today's Schedule","widgetType":"SCHEDULE_GRID","x":2,"y":20,"width":58,"height":52,"zIndex":3,"sortOrder":1,"defaultConfig":{}},
      {"name":"Attendance","widgetType":"ATTENDANCE","x":62,"y":20,"width":36,"height":26,"zIndex":3,"sortOrder":2,"defaultConfig":{}},
      {"name":"Clock","widgetType":"CLOCK","x":62,"y":48,"width":18,"height":24,"zIndex":5,"sortOrder":3,"defaultConfig":{"theme":"campus-quad","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":82,"y":48,"width":16,"height":24,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"campus-quad","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":16,"zIndex":10,"sortOrder":5,"defaultConfig":{"theme":"campus-quad","message":"Assembly Friday — guest speaker on mental wellness."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":16,"zIndex":4,"sortOrder":6,"defaultConfig":{"theme":"campus-quad","label":"Prom in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":7,"defaultConfig":{"theme":"campus-quad","speed":"medium","messages":["Hall passes required","Counseling office open during all lunches","Tutoring available in the library 3-5 PM"]}},
    ],
  },
  {
    id: "preset-cafeteria-campus-quad",
    name: "🏛️ Campus Quad · Cafeteria",
    description: "Cafeteria layout — Campus Quad theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "CAFETERIA",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#F7F5F0",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":14,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"campus-quad"}},
      {"name":"Menu Title","widgetType":"TEXT","x":12,"y":3,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"campus-quad","content":"Today's Menu","subtitle":"cafeteria + grab-and-go"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":14,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"campus-quad","format":"12h"}},
      {"name":"Food Carousel","widgetType":"IMAGE_CAROUSEL","x":2,"y":20,"width":56,"height":52,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"campus-quad","intervalMs":6000}},
      {"name":"Entrée","widgetType":"MENU_ITEM","x":60,"y":20,"width":38,"height":17,"zIndex":4,"sortOrder":4,"defaultConfig":{"itemName":"Chef Salad","description":"Romaine, grilled chicken, cherry tomatoes, shaved cheese, ranch.","allergens":["GF"],"price":""}},
      {"name":"Side","widgetType":"MENU_ITEM","x":60,"y":38,"width":38,"height":17,"zIndex":4,"sortOrder":5,"defaultConfig":{"itemName":"Roasted Veggies","description":"Carrots, zucchini, bell peppers — olive oil, sea salt.","allergens":["V","GF"],"price":""}},
      {"name":"Dessert","widgetType":"MENU_ITEM","x":60,"y":55,"width":38,"height":17,"zIndex":4,"sortOrder":6,"defaultConfig":{"itemName":"Fruit Cup","description":"Seasonal fresh fruit — watermelon, pineapple, berries.","allergens":["V","GF"],"price":""}},
      {"name":"Today's Special","widgetType":"ANNOUNCEMENT","x":2,"y":74,"width":60,"height":14,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"campus-quad","message":"Chef's special: Korean BBQ bowls at the grill line."}},
      {"name":"Next Meal","widgetType":"COUNTDOWN","x":64,"y":74,"width":34,"height":14,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"campus-quad","label":"Next period in","targetDate":""}},
      {"name":"Nutrition Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"campus-quad","speed":"slow","messages":["Grab-and-go available until 1 PM","Allergen info posted by each station","Free + reduced meal program — ask admin"]}},
    ],
  },
  {
    id: "preset-lobby-varsity-athletic",
    name: "🥇 Varsity · Welcome",
    description: "Welcome layout — Varsity theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0F1F3A",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"varsity-athletic"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"varsity-athletic","content":"WELCOME, SENIORS","subtitle":"make this one count"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"varsity-athletic","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"varsity-athletic","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"varsity-athletic","message":"Senior portraits next week. Sign-up sheet in the main office."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"varsity-athletic","label":"Graduation in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"varsity-athletic","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"varsity-athletic","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"varsity-athletic","speed":"medium","messages":["Senior trip sign-ups close Friday","College fair in the gym Thursday 6 PM","FAFSA workshop Tuesday in the library","Yearbook orders due end of month"]}},
    ],
  },
  {
    id: "preset-athletics-varsity-athletic",
    name: "🥇 Varsity · Athletics",
    description: "Athletics layout — Varsity theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0F1F3A",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"varsity-athletic"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"varsity-athletic","content":"EAGLES vs COUGARS","subtitle":"HOMECOMING · FRI 7PM · HOME FIELD"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"varsity-athletic","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"HOMECOMING · FRI 7PM · HOME FIELD","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"varsity-athletic","staffName":"Alex Rivera","role":"QB #7 · Senior","bio":"32 TDs · 4,112 yds · 68% completion — All-Conference."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"varsity-athletic","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"varsity-athletic","message":"GO EAGLES. Play smart, play hard, play together."}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"varsity-athletic","label":"Kickoff in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"varsity-athletic","speed":"medium","messages":["FINAL: Varsity 28 — Central 14","Girls volleyball advances to state finals","JV soccer moves on to regionals","Pep rally Friday @ 2:30 in the gym"]}},
    ],
  },
  {
    id: "preset-lobby-jumbotron-pro",
    name: "🏟️ Jumbotron Pro · Welcome",
    description: "Welcome layout — Jumbotron Pro theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#050A14",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"jumbotron-pro"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"jumbotron-pro","content":"WELCOME, SENIORS","subtitle":"make this one count"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"jumbotron-pro","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"jumbotron-pro","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"jumbotron-pro","message":"Senior portraits next week. Sign-up sheet in the main office."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"jumbotron-pro","label":"Graduation in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"jumbotron-pro","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"jumbotron-pro","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"jumbotron-pro","speed":"medium","messages":["Senior trip sign-ups close Friday","College fair in the gym Thursday 6 PM","FAFSA workshop Tuesday in the library","Yearbook orders due end of month"]}},
    ],
  },
  {
    id: "preset-athletics-jumbotron-pro",
    name: "🏟️ Jumbotron Pro · Athletics",
    description: "Athletics layout — Jumbotron Pro theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#050A14",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"jumbotron-pro"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"jumbotron-pro","content":"EAGLES vs COUGARS","subtitle":"HOMECOMING · FRI 7PM · HOME FIELD"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"jumbotron-pro","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"HOMECOMING · FRI 7PM · HOME FIELD","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"jumbotron-pro","staffName":"Alex Rivera","role":"QB #7 · Senior","bio":"32 TDs · 4,112 yds · 68% completion — All-Conference."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"jumbotron-pro","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"jumbotron-pro","message":"GO EAGLES. Play smart, play hard, play together."}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"jumbotron-pro","label":"Kickoff in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"jumbotron-pro","speed":"medium","messages":["FINAL: Varsity 28 — Central 14","Girls volleyball advances to state finals","JV soccer moves on to regionals","Pep rally Friday @ 2:30 in the gym"]}},
    ],
  },
  {
    id: "preset-lobby-news-studio-pro",
    name: "🎬 News Studio Pro · Welcome",
    description: "Welcome layout — News Studio Pro theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0B0F17",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"news-studio-pro"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"news-studio-pro","content":"WELCOME, SENIORS","subtitle":"make this one count"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"news-studio-pro","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"news-studio-pro","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"news-studio-pro","message":"Senior portraits next week. Sign-up sheet in the main office."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"news-studio-pro","label":"Graduation in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"news-studio-pro","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"news-studio-pro","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"news-studio-pro","speed":"medium","messages":["Senior trip sign-ups close Friday","College fair in the gym Thursday 6 PM","FAFSA workshop Tuesday in the library","Yearbook orders due end of month"]}},
    ],
  },
  {
    id: "preset-athletics-news-studio-pro",
    name: "🎬 News Studio Pro · Athletics",
    description: "Athletics layout — News Studio Pro theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#0B0F17",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"news-studio-pro"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"news-studio-pro","content":"EAGLES vs COUGARS","subtitle":"HOMECOMING · FRI 7PM · HOME FIELD"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"news-studio-pro","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"HOMECOMING · FRI 7PM · HOME FIELD","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"news-studio-pro","staffName":"Alex Rivera","role":"QB #7 · Senior","bio":"32 TDs · 4,112 yds · 68% completion — All-Conference."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"news-studio-pro","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"news-studio-pro","message":"GO EAGLES. Play smart, play hard, play together."}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"news-studio-pro","label":"Kickoff in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"news-studio-pro","speed":"medium","messages":["FINAL: Varsity 28 — Central 14","Girls volleyball advances to state finals","JV soccer moves on to regionals","Pep rally Friday @ 2:30 in the gym"]}},
    ],
  },
  {
    id: "preset-lobby-achievement-hall",
    name: "🏅 Achievement Hall · Welcome",
    description: "Welcome layout — Achievement Hall theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#3D2817",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"achievement-hall"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"achievement-hall","content":"WELCOME, SENIORS","subtitle":"make this one count"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"achievement-hall","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"achievement-hall","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"achievement-hall","message":"Senior portraits next week. Sign-up sheet in the main office."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"achievement-hall","label":"Graduation in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"achievement-hall","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"achievement-hall","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"achievement-hall","speed":"medium","messages":["Senior trip sign-ups close Friday","College fair in the gym Thursday 6 PM","FAFSA workshop Tuesday in the library","Yearbook orders due end of month"]}},
    ],
  },
  {
    id: "preset-athletics-achievement-hall",
    name: "🏅 Achievement Hall · Athletics",
    description: "Athletics layout — Achievement Hall theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "ATHLETICS",
    orientation: 'LANDSCAPE',
    schoolLevel: "HIGH",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#3D2817",
    zones: [
      {"name":"Team Logo","widgetType":"LOGO","x":2,"y":2,"width":10,"height":16,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"achievement-hall"}},
      {"name":"Matchup Banner","widgetType":"TEXT","x":12,"y":4,"width":76,"height":14,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"achievement-hall","content":"EAGLES vs COUGARS","subtitle":"HOMECOMING · FRI 7PM · HOME FIELD"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":16,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"achievement-hall","format":"12h"}},
      {"name":"Live Scoreboard","widgetType":"SCOREBOARD","x":2,"y":22,"width":58,"height":34,"zIndex":4,"sortOrder":3,"defaultConfig":{"homeName":"EAGLES","awayName":"COUGARS","homeScore":0,"awayScore":0,"status":"HOMECOMING · FRI 7PM · HOME FIELD","period":"KICKOFF FRIDAY"}},
      {"name":"Athlete of the Week","widgetType":"STAFF_SPOTLIGHT","x":62,"y":22,"width":36,"height":34,"zIndex":3,"sortOrder":4,"defaultConfig":{"theme":"achievement-hall","staffName":"Alex Rivera","role":"QB #7 · Senior","bio":"32 TDs · 4,112 yds · 68% completion — All-Conference."}},
      {"name":"Season Stats","widgetType":"STATS","x":2,"y":58,"width":58,"height":20,"zIndex":3,"sortOrder":5,"defaultConfig":{"stats":[{"value":"8-2","label":"RECORD"},{"value":"247","label":"POINTS FOR"},{"value":"4","label":"STREAK"}]}},
      {"name":"Upcoming Games","widgetType":"CALENDAR","x":62,"y":58,"width":36,"height":20,"zIndex":2,"sortOrder":6,"defaultConfig":{"theme":"achievement-hall","maxEvents":3}},
      {"name":"Coach's Message","widgetType":"ANNOUNCEMENT","x":2,"y":80,"width":60,"height":10,"zIndex":10,"sortOrder":7,"defaultConfig":{"theme":"achievement-hall","message":"GO EAGLES. Play smart, play hard, play together."}},
      {"name":"Next Game Countdown","widgetType":"COUNTDOWN","x":64,"y":80,"width":34,"height":10,"zIndex":4,"sortOrder":8,"defaultConfig":{"theme":"achievement-hall","label":"Kickoff in","targetDate":""}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":92,"width":100,"height":8,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"achievement-hall","speed":"medium","messages":["FINAL: Varsity 28 — Central 14","Girls volleyball advances to state finals","JV soccer moves on to regionals","Pep rally Friday @ 2:30 in the gym"]}},
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // ✓ APPROVED GOLD-STANDARD PRESETS — appear FIRST in the gallery.
  //   Listed last in this array because the seed script iterates in
  //   order and the API sorts gallery rows by updatedAt desc — so
  //   the last entries seeded show first in the picker. Rebuild any
  //   future templates against THESE two as the visual + interaction
  //   reference. DO NOT regress without explicit re-approval.
  // ════════════════════════════════════════════════════════════════
  {
    id: "preset-lobby-rainbow-ribbon",
    name: "🌈 Rainbow Ribbon · Welcome",
    description: "Welcome layout — Rainbow Ribbon theme. Shape-based widgets, auto-fit text, inline-edit in the builder.",
    category: "LOBBY",
    orientation: 'LANDSCAPE',
    schoolLevel: "ELEMENTARY",
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: "#BFE8FF",
    bgGradient: "linear-gradient(180deg,#BFE8FF 0%,#FFE0EC 55%,#FFD8A8 100%)",
    zones: [
      {"name":"Logo","widgetType":"LOGO","x":2,"y":2,"width":8,"height":13,"zIndex":5,"sortOrder":0,"defaultConfig":{"theme":"rainbow-ribbon"}},
      {"name":"Welcome Banner","widgetType":"TEXT","x":10,"y":4,"width":78,"height":15,"zIndex":4,"sortOrder":1,"defaultConfig":{"theme":"rainbow-ribbon","content":"Welcome, Friends!","subtitle":"today is going to be amazing"}},
      {"name":"Clock","widgetType":"CLOCK","x":89,"y":2,"width":9,"height":13,"zIndex":5,"sortOrder":2,"defaultConfig":{"theme":"rainbow-ribbon","format":"12h"}},
      {"name":"Weather","widgetType":"WEATHER","x":2,"y":22,"width":20,"height":28,"zIndex":3,"sortOrder":3,"defaultConfig":{"theme":"rainbow-ribbon","location":"Springfield","units":"imperial"}},
      {"name":"Announcement","widgetType":"ANNOUNCEMENT","x":24,"y":22,"width":52,"height":28,"zIndex":10,"sortOrder":4,"defaultConfig":{"theme":"rainbow-ribbon","message":"Book Fair starts Monday! 📚 Come find your new favorite story."}},
      {"name":"Countdown","widgetType":"COUNTDOWN","x":78,"y":22,"width":20,"height":28,"zIndex":4,"sortOrder":5,"defaultConfig":{"theme":"rainbow-ribbon","label":"Field Trip in","targetDate":""}},
      {"name":"Teacher","widgetType":"STAFF_SPOTLIGHT","x":2,"y":54,"width":30,"height":34,"zIndex":3,"sortOrder":6,"defaultConfig":{"theme":"rainbow-ribbon","staffName":"Mrs. Johnson","role":"Teacher of the Week","bio":"Inspiring students every day."}},
      {"name":"Events","widgetType":"CALENDAR","x":34,"y":54,"width":36,"height":34,"zIndex":2,"sortOrder":7,"defaultConfig":{"theme":"rainbow-ribbon","maxEvents":3}},
      {"name":"Birthdays","widgetType":"BIRTHDAYS","x":72,"y":54,"width":26,"height":34,"zIndex":3,"sortOrder":8,"defaultConfig":{}},
      {"name":"Ticker","widgetType":"TICKER","x":0,"y":90,"width":100,"height":10,"zIndex":6,"sortOrder":9,"defaultConfig":{"theme":"rainbow-ribbon","speed":"medium","messages":["Welcome back, Stars! ⭐","Picture day is Friday","Reading Challenge: 20 minutes a day! 📖","Parent-teacher conferences next Tuesday"]}},
    ],
  },
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
];
